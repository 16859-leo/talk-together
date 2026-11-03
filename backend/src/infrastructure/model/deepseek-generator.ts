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

import { streamText, stepCountIs, tool, type ToolSet } from 'ai';
import { createDeepSeek } from '@ai-sdk/deepseek';
import { z } from 'zod';

import { CapabilityError } from '../zhihu/types.ts';
import type { ZhihuTopicSource } from '../zhihu/topic-source.ts';
import type { TopicCandidate } from '../zhihu/types.ts';
import { SYSTEM_PROMPT, buildUserPrompt, commonInterestTags } from './prompts.ts';
import { cleanOutput, rejectOutput } from './sanitize.ts';
import type { GenerationChunk, GenerationRequest, TextGenerator } from './types.ts';

export interface DeepSeekGeneratorOptions {
  /** 从环境变量注入，本模块不落盘、不记录、不转发。 */
  readonly apiKey: string;
  readonly model?: string;
  /** 工具调用轮次上限，防御官方已知的循环调用风险。 */
  readonly maxSteps?: number;
  /** 输出不合格时的重试次数。 */
  readonly maxRetries?: number;
}

const DEFAULT_MODEL = 'deepseek-flash';
/** 检索 + 声明选择 + 作答，留一步余量。 */
const DEFAULT_MAX_STEPS = 4;
const DEFAULT_MAX_RETRIES = 1;

export class DeepSeekTextGenerator implements TextGenerator {
  readonly #provider: ReturnType<typeof createDeepSeek>;
  readonly #model: string;
  readonly #maxSteps: number;
  readonly #maxRetries: number;
  readonly #topics: ZhihuTopicSource;

  constructor(topics: ZhihuTopicSource, options: DeepSeekGeneratorOptions) {
    this.#topics = topics;
    this.#provider = createDeepSeek({ apiKey: options.apiKey });
    this.#model = options.model ?? DEFAULT_MODEL;
    this.#maxSteps = options.maxSteps ?? DEFAULT_MAX_STEPS;
    this.#maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;
  }

  async *generate(request: GenerationRequest): AsyncIterable<GenerationChunk> {
    for (let attempt = 0; attempt <= this.#maxRetries; attempt += 1) {
      const picked: TopicCandidate[] = [];
      const seenCalls = new Set<string>();
      // 模型通过 select_topic 声明实际采用的话题，避免草稿与发言不一致
      const selection: { index: number | null } = { index: null };
      let raw = '';

      const tools = this.#buildTools(request, picked, seenCalls, selection);

      try {
        // exactOptionalPropertyTypes 下不能显式传 tools: undefined，改为条件展开。
        // invitation 不需要工具：目标已由应用层选定，只生成话术。
        const toolOption = request.purpose === 'invitation' ? {} : { tools };

        const result = streamText({
          model: this.#provider(this.#model),
          system: SYSTEM_PROMPT,
          prompt: buildUserPrompt(request),
          ...toolOption,
          stopWhen: stepCountIs(this.#maxSteps),
          abortSignal: request.signal,
          providerOptions: { deepseek: { thinking: { type: 'disabled' } } },
        });

        for await (const delta of result.textStream) {
          raw += delta;
        }
      } catch (error) {
        throw toCapabilityError(error, request.signal);
      }

      const text = cleanOutput(raw);
      const rejected = text.length === 0 ? 'TOO_SHORT' : rejectOutput(text, request.recentMessages);

      if (rejected === null) {
        // 先给话题草稿，应用层据此决定是否发布 topic.changed。
        // 优先用模型显式选定的那条；未声明则回退到第一条。
        const chosen = selection.index === null ? picked[0] : picked[selection.index];
        if (request.purpose === 'topic' && chosen !== undefined) {
          yield { kind: 'topic', topic: chosen };
        }
        yield { kind: 'text', delta: text };
        return;
      }

      if (request.signal.aborted) {
        throw new CapabilityError('AI_CANCELLED', '调用已取消');
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
    selection: { index: number | null },
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
          // 带序号返回，便于模型在后续 select_topic 中指明实际采用的是哪条
          return {
            topics: topics.map((t, i) => ({ index: i + 1, title: t.title, content: t.content })),
          };
        },
      }),

      get_hot_list: tool({
        description:
          '获取知乎热榜中适合破冰的话题。仅当成员兴趣没有交集、无法确定共同关键词时调用；返回结果已过滤掉争议性和垂直话题。',
        inputSchema: z.object({
          limit: z.number().int().min(1).max(30).default(10),
        }),
        execute: async ({ limit }) => {
          guard('get_hot_list', { limit });
          const topics = await this.#topics.getPopularTopics({
            limit,
            interestTags: allTags,
            signal: request.signal,
          });
          picked.push(...topics);
          return {
            topics: topics.map((t, i) => ({ index: i + 1, title: t.title, content: t.content })),
          };
        },
      }),

      select_topic: tool({
        description:
          '声明你最终采用了哪一条话题。取得话题列表后必须调用一次，传入该条的 index，然后再说出要对房间讲的话。',
        inputSchema: z.object({
          index: z.number().int().min(1).describe('所选话题在列表中的序号'),
        }),
        execute: async ({ index }) => {
          // 不做 guard：这是终局声明，重复调用说明模型改了主意，以最后一次为准
          if (index >= 1 && index <= picked.length) {
            selection.index = index - 1;
            return { ok: true };
          }
          return { ok: false, reason: '序号超出范围，请从列表中选择' };
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
