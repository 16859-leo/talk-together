/**
 * DeepSeek 文本生成器。
 *
 * 经 AI SDK Core 接入（架构文档选型），供应商细节封装在本文件内。
 *
 * 实测依据（agent/test/deepseek-probe.js 与本层冒烟）：
 *   - deepseek-flash 支持 Tool Calls 与 JSON Output，工具选择 4/4 正确
 *   - 并发 2500，延迟 0.7–1.6s，远低于应用层 30 秒生成期限
 *   - thinking 必须显式 disabled，否则延迟与 token 显著上升
 *   - 工具定义每次请求全量计入 input token，故与 system 一起固定在最前以命中 cache
 *
 * 循环防护：DeepSeek 官方承认存在循环工具调用与空响应风险，故设轮次上限与重复检测。
 */

import { streamText, stepCountIs, tool, type ToolSet, type LanguageModel } from 'ai';
import { createDeepSeek } from '@ai-sdk/deepseek';
import { z } from 'zod';

import { CapabilityError } from '../zhihu/types.ts';
import type { ZhihuTopicSource } from '../zhihu/topic-source.ts';
import type { TopicCandidate } from '../zhihu/types.ts';
import { SYSTEM_PROMPT, buildUserPrompt, commonInterestTags } from './prompts.ts';
import { cleanOutput, rejectOutput } from './sanitize.ts';
import type { GenerationChunk, GenerationRequest, TextGenerator } from './types.ts';

export interface DeepSeekGeneratorOptions {
  /** 从环境变量注入，本模块不落盘、不记录、不转发。测试用 modelOverride 时可省略。 */
  readonly apiKey?: string;
  readonly model?: string;
  /** 工具调用轮次上限，防御官方已知的循环调用风险。 */
  readonly maxSteps?: number;
  /** 输出不合格时的重试次数。 */
  readonly maxRetries?: number;
  /** 注入自定义语言模型，仅用于测试（如 MockLanguageModelV4）；生产留空。 */
  readonly modelOverride?: LanguageModel;
}

const DEFAULT_MODEL = 'deepseek-flash';
/** 检索 + 作答两步即可；去掉 select_topic 后不再需要额外步数。 */
const DEFAULT_MAX_STEPS = 3;
/** 零文本/不合格重试次数。单条话题时模型偶尔只调工具不作答，多留一次重试。 */
const DEFAULT_MAX_RETRIES = 2;

export class DeepSeekTextGenerator implements TextGenerator {
  readonly #model: LanguageModel;
  readonly #maxSteps: number;
  readonly #maxRetries: number;
  readonly #topics: ZhihuTopicSource;

  constructor(topics: ZhihuTopicSource, options: DeepSeekGeneratorOptions) {
    this.#topics = topics;
    if (options.modelOverride !== undefined) {
      this.#model = options.modelOverride;
    } else {
      if (options.apiKey === undefined || options.apiKey.length === 0) {
        throw new Error('DeepSeekTextGenerator 需要 apiKey 或 modelOverride');
      }
      this.#model = createDeepSeek({ apiKey: options.apiKey })(options.model ?? DEFAULT_MODEL);
    }
    this.#maxSteps = options.maxSteps ?? DEFAULT_MAX_STEPS;
    this.#maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;
  }

  async *generate(request: GenerationRequest): AsyncIterable<GenerationChunk> {
    for (let attempt = 0; attempt <= this.#maxRetries; attempt += 1) {
      const picked: TopicCandidate[] = [];
      const seenCalls = new Set<string>();
      const tools = this.#buildTools(request, picked, seenCalls);

      // exactOptionalPropertyTypes 下不能显式传 tools: undefined，改为条件展开。
      // invitation 不需要工具：目标已由应用层选定，只生成话术。
      const toolOption = request.purpose === 'invitation' ? {} : { tools };

      // SDK 把错误放入流事件而非抛出，用 onError 显式捕获再映射。
      let streamError: unknown = null;

      const result = streamText({
        model: this.#model,
        system: SYSTEM_PROMPT,
        prompt: buildUserPrompt(request),
        ...toolOption,
        stopWhen: stepCountIs(this.#maxSteps),
        abortSignal: request.signal,
        providerOptions: { deepseek: { thinking: { type: 'disabled' } } },
        onError: ({ error }) => {
          streamError = error;
        },
      });

      // 边生成边产出：清洗有状态，逐段累积原始文本后对「新增的干净部分」做增量 yield。
      // 这样应用层能实时拿到增量，失败/取消时也能保留已输出文字。
      let raw = '';
      let emitted = '';
      let topicSent = false;

      try {
        for await (const delta of result.textStream) {
          if (request.signal.aborted) {
            throw new CapabilityError('AI_CANCELLED', '调用已取消');
          }
          raw += delta;

          // 话题草稿一旦确定就先行发出，供应用层尽早更新当前话题。
          if (request.purpose === 'topic' && !topicSent && picked[0] !== undefined) {
            topicSent = true;
            yield { kind: 'topic', topic: picked[0] };
          }

          const cleaned = cleanOutput(raw);
          if (cleaned.length > emitted.length && cleaned.startsWith(emitted)) {
            const increment = cleaned.slice(emitted.length);
            emitted = cleaned;
            yield { kind: 'text', delta: increment };
          }
        }
      } catch (error) {
        throw toCapabilityError(error, request.signal);
      }

      // 流正常结束，但 SDK 可能把错误放进了事件：此时已产出的文字应保留，错误照抛。
      if (streamError !== null) {
        throw toCapabilityError(streamError, request.signal);
      }
      if (request.signal.aborted) {
        throw new CapabilityError('AI_CANCELLED', '调用已取消');
      }

      const finalText = cleanOutput(raw);
      const rejected = finalText.length === 0 ? 'TOO_SHORT' : rejectOutput(finalText, request.recentMessages);
      // 选题成功必须有草稿：模型不调工具直接作答时 picked 为空，视为未完成，触发重试。
      const topicMissing = request.purpose === 'topic' && picked[0] === undefined;

      if (rejected === null && !topicMissing) {
        // 补发清洗后可能新增的尾部（如末尾标点在流结束时才补全）。
        if (finalText.length > emitted.length && finalText.startsWith(emitted)) {
          yield { kind: 'text', delta: finalText.slice(emitted.length) };
        }
        return;
      }

      // 本次不合格。已经 yield 过增量时不能静默重试（会导致重复文本），
      // 因此只有在尚未产出任何内容时才允许重试，否则直接抛错由应用层处理。
      if (emitted.length > 0 || topicSent) {
        throw new CapabilityError('AI_PROVIDER_ERROR', '模型输出不完整');
      }
    }

    // 重试后仍不合格。契约要求 completed 的 text 非空（NonBlankText），
    // 零文本不能标记为完成，也不得产占位文本凑数 —— 直接抛错，由应用层落 failed。
    throw new CapabilityError('AI_PROVIDER_ERROR', '模型未产出可用文本');
  }

  #buildTools(
    request: GenerationRequest,
    picked: TopicCandidate[],
    seenCalls: Set<string>,
  ): ToolSet {
    const shared = commonInterestTags(request.members);
    const allTags = [...new Set(request.members.flatMap((m) => m.interestTags))];

    const guard = (name: string, args: unknown): void => {
      const fingerprint = `${name}:${JSON.stringify(args)}`;
      if (seenCalls.has(fingerprint)) {
        throw new Error('重复的工具调用已被拦截，请基于已有结果作答');
      }
      seenCalls.add(fingerprint);
    };

    return {
      search_zhihu_topic: tool({
        description:
          '按关键词检索知乎上适合破冰的话题。当成员兴趣标签存在交集、需要共同话题时调用；不要凭记忆编造话题。',
        inputSchema: z.object({
          keyword: z
            .string()
            .min(1)
            .describe(
              '检索关键词。不要只填兴趣标签本身（如「摄影」会搜到教程和器材贴），' +
                '应构造成能引出个人经历的口语化问句，例如「拍照时最难忘的一次经历」「露营遇到过什么有意思的事」',
            ),
          count: z.number().int().min(1).max(10).default(5),
        }),
        execute: async ({ keyword, count }) => {
          guard('search_zhihu_topic', { keyword, count });
          const topics = await this.#topics.searchCommonTopics(keyword, {
            count,
            interestTags: shared.length > 0 ? shared : allTags,
            signal: request.signal,
          });
          picked.push(...topics);
          // 只返回首条（已由数据源轮换选定），模型据此写话术，不自行挑选，
          // 以保证草稿与发言一致、且话题随轮换变化。
          const top = topics[0];
          return top === undefined
            ? { topic: null, hint: '没有找到合适的话题，请换个关键词或改用热榜' }
            : { topic: { title: top.title, content: top.content } };
        },
      }),

      get_hot_list: tool({
        description:
          '获取知乎热榜中适合破冰的话题。仅当成员兴趣没有交集、无法确定共同关键词时调用；返回已选定的那一条，直接据此向房间抛话题。',
        inputSchema: z.object({
          limit: z.number().int().min(1).max(5).default(3),
        }),
        execute: async ({ limit }) => {
          guard('get_hot_list', { limit });
          const topics = await this.#topics.getPopularTopics({
            limit,
            interestTags: allTags,
            signal: request.signal,
          });
          picked.push(...topics);
          const top = topics[0];
          return top === undefined
            ? { topic: null, hint: '暂无合适话题' }
            : { topic: { title: top.title, content: top.content } };
        },
      }),
    };
  }
}

/** 把 SDK 与网络错误映射为契约允许的错误码。 */
function toCapabilityError(error: unknown, signal: AbortSignal): CapabilityError {
  if (error instanceof CapabilityError) return error;

  if (signal.aborted) return new CapabilityError('AI_CANCELLED', '调用已取消', { cause: error });

  const name = error instanceof Error ? error.name : '';
  if (name === 'AbortError') {
    return new CapabilityError('AI_CANCELLED', '调用已取消', { cause: error });
  }
  if (name === 'TimeoutError') {
    return new CapabilityError('AI_TIMEOUT', '模型调用超时', { cause: error });
  }

  const status = (error as { statusCode?: number; status?: number }).statusCode
    ?? (error as { status?: number }).status;
  if (status === 429) {
    return new CapabilityError('AI_RATE_LIMITED', '模型调用频率受限', {
      retryAfterMs: 20_000,
      cause: error,
    });
  }
  if (status !== undefined && status >= 500) {
    return new CapabilityError('AI_UNAVAILABLE', '模型服务不可用', { cause: error });
  }

  return new CapabilityError('AI_PROVIDER_ERROR', '模型调用失败', { cause: error });
}
