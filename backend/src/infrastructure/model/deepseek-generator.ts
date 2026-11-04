/**
 * DeepSeek 文本生成器。
 *
 * 经 AI SDK Core 接入（架构文档选型），供应商细节封装在本文件内。
 *
 * 实测依据（agent/archive/prototype-js/test/deepseek-probe.js 与本层冒烟）：
 *   - deepseek-flash 支持 Tool Calls 与 JSON Output，工具选择 4/4 正确
 *   - 并发 2500，延迟 0.7–1.6s，远低于应用层 30 秒生成期限
 *   - thinking 必须显式 disabled，否则延迟与 token 显著上升
 *   - 工具定义每次请求全量计入 input token，故与 system 一起固定在最前以命中 cache
 *
 * 循环防护：DeepSeek 官方承认存在循环工具调用与空响应风险，故设轮次上限与重复检测。
 *
 * 流式安全（PR #5 第二轮 review P1）：
 *   cleanOutput 的前导处理会在后续字符到达时改写开头（「主持」+「发言：」=> 前两字消失），
 *   已 yield 的文本无法撤回。因此前导未定型前一个字都不输出，定型后只追加；
 *   收尾时断言「累计产出 == 最终清洗结果」，不一致直接抛错，绝不交付被截断的句子。
 */

import { streamText, stepCountIs, tool, RetryError, type ToolSet, type LanguageModel } from 'ai';
import { createDeepSeek } from '@ai-sdk/deepseek';
import { z } from 'zod';

import { CapabilityError } from '../zhihu/types.ts';
import type { KnowledgeSnippet, TopicCandidate } from '../zhihu/types.ts';
import type { ZhihuTopicSource } from '../zhihu/topic-source.ts';
import { AI_SPEAKER_AUTHOR_ID } from '../../domain/room.ts';
import { SYSTEM_PROMPT, buildUserPrompt, commonInterestTags } from './prompts.ts';
import {
  MAX_REPLY_TEXT_LENGTH,
  MAX_TEXT_LENGTH,
  MIN_TEXT_LENGTH,
  analyzeOutput,
  cleanOutput,
  rejectOutput,
} from './sanitize.ts';
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

/** 单次生成内「已选定话题」的状态，由工具与主循环共享。 */
interface SelectionState {
  selected: TopicCandidate | null;
  /** 进行中的选题检索；并行工具调用复用同一次请求，避免各自 adopt 出不同话题。 */
  pending: Promise<ToolPayload> | null;
  /**
   * 选定话题那一刻已产出的原始文本长度。收尾时用它判断「检索之后是否还有正文」：
   * 若话术全部产生于检索结果之前，topic 调用不能算成功（草稿与发言会不一致）。
   */
  selectedAtLength: number | null;
}

/** 工具返回给模型的载荷：一条已选定话题，或空结果提示。 */
interface ToolPayload {
  readonly topic: { readonly title: string; readonly content: string } | null;
  readonly hint: string;
}

/** 资料检索的工具载荷：摘要 + 使用约束提示。 */
interface KnowledgePayload {
  readonly results: readonly KnowledgeSnippet[];
  readonly hint: string;
}

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
    // 转录判定需要「谁在说话」：只有冒号前确实是房间成员的昵称才算复述。
    const memberNicknames = request.members.map((member) => member.nickname);
    // 质量闸门只看真人说过的话。AI 自己的历史留在上下文里帮它避免重复，
    // 但不能参与「复述原话」判定：追问同一部作品时，回答开头撞上自己上一句
    // 会被误杀（真实现象：用户追问「再讲讲」，模型回答被 ECHOES_USER_MESSAGE 拦掉）。
    const memberMessages = request.recentMessages.filter(
      (message) => message.authorId !== AI_SPEAKER_AUTHOR_ID,
    );
    // 回答类回复比抛话题需要更多篇幅：70 字会把「讲了什么」拦腰截断。
    const maxLength =
      request.purpose === 'reply' ? MAX_REPLY_TEXT_LENGTH : MAX_TEXT_LENGTH;
    for (let attempt = 0; attempt <= this.#maxRetries; attempt += 1) {
      // 每次重试都从零开始：已选话题、去重指纹、缓冲文本都不能跨次复用。
      const state: SelectionState = { selected: null, pending: null, selectedAtLength: null };
      const seenCalls = new Set<string>();
      const tools = this.#buildTools(request, state, seenCalls);

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

      // raw：模型原始输出；emitted：已交付给应用层的清洗结果。
      // 前者是清洗的输入，后者是判定「还能追加多少」的游标。
      let raw = '';
      let emitted = '';
      let topicSent = false;
      let headSettled = false;

      try {
        // 用 fullStream 而不是 textStream：需要按模型事件顺序看到 tool-result，
        // 才能在「检索完成」那一刻给正文划界。若用下游已消费的长度，
        // 消费者暂停时 SDK 可能已继续读流并执行检索，检索前的文本会被算成检索后。
        for await (const part of result.fullStream) {
          throwIfCancelled(request.signal);

          if (part.type === 'error') {
            streamError = part.error;
            continue;
          }
          if (part.type === 'tool-result') {
            // 检索完成：此刻 raw 里正好是检索前的全部正文。
            if (state.selected !== null && state.selectedAtLength === null) {
              state.selectedAtLength = raw.length;
            }
            continue;
          }
          if (part.type !== 'text-delta') continue;

          const delta = part.text;
          raw += delta;

          // 话题草稿一旦确定就先行发出，供应用层尽早更新当前话题。
          // 消费者可能在收到草稿后立刻取消，所以恢复执行后每个 yield 前都要重查 signal。
          if (request.purpose === 'topic' && !topicSent && state.selected !== null) {
            topicSent = true;
            yield { kind: 'topic', topic: state.selected };
          }

          const analysis = analyzeOutput(raw, maxLength);
          if (analysis.headSettled) headSettled = true;
          // 前导还可能被改写（如「主持」后面补上「发言：」）：继续缓冲，一个字都不发。
          if (!headSettled) continue;

          // 末尾留一个字符不急于交付：包裹引号、尾部围栏等只在行尾成立，
          // 拿到下一个字符才能确定它是否会被剥掉。
          const target = Math.min(analysis.text.length - 1, maxLength - 1);
          if (target <= emitted.length) continue;
          if (!analysis.text.startsWith(emitted)) {
            throw new CapabilityError('AI_PROVIDER_ERROR', '文本增量与清洗结果不一致');
          }
          // 质量闸门里「转录式复述」「复述成员原话」一旦成立就不会再变：
          // 失败回复会原样保留已广播的文字，所以必须在这里拦住，不能先发再判。
          const earlyReject = rejectOutput(analysis.text, memberMessages, memberNicknames);
          if (earlyReject === 'LOOKS_LIKE_TRANSCRIPT' || earlyReject === 'ECHOES_USER_MESSAGE') {
            continue;
          }
          throwIfCancelled(request.signal);
          yield { kind: 'text', delta: analysis.text.slice(emitted.length, target) };
          emitted = analysis.text.slice(0, target);
        }
      } catch (error) {
        throw toCapabilityError(error, request.signal);
      }

      // 流正常结束，但 SDK 可能把错误放进了事件：此时已产出的文字应保留，错误照抛。
      if (streamError !== null) {
        throw toCapabilityError(streamError, request.signal);
      }
      throwIfCancelled(request.signal);

      const finalText = cleanOutput(raw, maxLength);
      const rejected =
        finalText.length === 0
          ? 'TOO_SHORT'
          : rejectOutput(finalText, memberMessages, memberNicknames);

      // 选题成功必须有草稿，且**实际交付的正文**要产生于检索结果之后。
      // 只检查原始字符非空不够：检索后只补了 `**` 或另起一行时，cleanOutput 会
      // 把新增内容剥掉/丢弃，交付出去的仍然是检索前那段；此时正文与草稿必然不一致。
      const boundaryText =
        state.selectedAtLength === null
          ? ''
          : analyzeOutput(raw.slice(0, state.selectedAtLength), maxLength).text;
      const deliveredAfterSelection =
        boundaryText.length > 0 && finalText.startsWith(boundaryText)
          ? finalText.slice(boundaryText.length)
          : finalText;
      // 检索后追加的内容还要自己站得住：只补一个句号、几个标点或单字补尾，
      // 都不能算「基于检索结果说了一句话」（长度与「有实义字符」两道都查）。
      const postText = deliveredAfterSelection.trim();
      const postUsable =
        postText.length >= MIN_TEXT_LENGTH && /[\p{L}\p{N}]/u.test(postText);
      const topicMissing =
        request.purpose === 'topic' && (state.selected === null || !postUsable);

      // 排查用：模型输出被清洗/闸门拦掉时，事件里只看得到「失败」，
      // 打开 AI_DEBUG=1 才能看到每一轮原文与拒绝原因（默认不输出）。
      if (process.env['AI_DEBUG'] === '1') {
        console.error(
          '[ai-debug]',
          JSON.stringify({
            attempt,
            purpose: request.purpose,
            raw,
            finalText,
            rejected,
            topicMissing,
            emittedLength: emitted.length,
            topicDraft: state.selected?.title ?? null,
          }),
        );
      }

      if (rejected === null && !topicMissing) {
        // 草稿补发：正常路径草稿已在文本循环里先行发出，这里只作防御
        // （例如话题选定后正文恰好没有触发增量的极端情况）。
        if (request.purpose === 'topic' && !topicSent && state.selected !== null) {
          throwIfCancelled(request.signal);
          topicSent = true;
          yield { kind: 'topic', topic: state.selected };
        }
        // 收尾补发：未定型的短回复、缓冲的末尾字符都在这里交付。
        if (!finalText.startsWith(emitted)) {
          throw new CapabilityError('AI_PROVIDER_ERROR', '文本增量与最终清洗结果不一致');
        }
        if (finalText.length > emitted.length) {
          throwIfCancelled(request.signal);
          yield { kind: 'text', delta: finalText.slice(emitted.length) };
          emitted = finalText;
        }
        // 最后一片之后、正常返回之前再查一次：消费者收到末片后 abort，
        // 不能因为生成器已无事可做就返回 done（那会被当成成功完成）。
        throwIfCancelled(request.signal);
        return;
      }

      // 本次不合格。已经 yield 过内容时不能静默重试（会导致重复文本），
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
    state: SelectionState,
    seenCalls: Set<string>,
  ): ToolSet {
    const shared = commonInterestTags(request.members);
    const allTags = [...new Set(request.members.flatMap((m) => m.interestTags))];
    /** 换话题场景下不要把当前话题再抛一次。 */
    const currentTopicTitles = (): readonly string[] =>
      request.currentTopic === null ? [] : [request.currentTopic.title];

    const guard = (name: string, args: unknown): void => {
      const fingerprint = `${name}:${JSON.stringify(args)}`;
      if (seenCalls.has(fingerprint)) {
        throw new Error('重复的工具调用已被拦截，请基于已有结果作答');
      }
      seenCalls.add(fingerprint);
    };

    /** 采用本次检索的首条话题；此后整次生成都以它为准。 */
    const adopt = (topics: readonly TopicCandidate[]): ToolPayload => {
      const top = topics[0];
      if (top === undefined) {
        return { topic: null, hint: '没有找到合适的话题，请换个关键词或改用热榜' };
      }
      state.selected = top;
      return { topic: { title: top.title, content: top.content }, hint: '请直接用这条话题向房间提问' };
    };

    /**
     * 话题已选定时不再访问上游：多次不同关键词检索会让模型围绕后一次结果写话术，
     * 而草稿只可能来自第一次（草稿已先行发出、无法撤回），两者会不一致。
     * 因此第一次选定后固定复用，既保证草稿与发言一致，也省一次额度。
     */
    const frozen = (): ToolPayload | null => {
      const top = state.selected;
      if (top === null) return null;
      return {
        topic: { title: top.title, content: top.content },
        hint: '本次已选定这条话题，直接用它提问，不要再换话题',
      };
    };

    /**
     * 执行一次选题并固定结果。
     *
     * 模型可能在同一步里并行调用多个检索工具：两个调用都会在上游返回前读到空的
     * `selected`，随后各自 adopt 出不同话题、互相覆盖（草稿 A、发言 B）。
     * 因此进行中的请求放在 state.pending 里共享，后到的调用直接复用同一个 Promise。
     */
    const requestSelection = async (
      fetcher: () => Promise<readonly TopicCandidate[]>,
    ): Promise<ToolPayload> => {
      const already = frozen();
      if (already !== null) return already;

      const inFlight = state.pending;
      if (inFlight !== null) return inFlight;

      const task = (async () => adopt(await fetcher()))();
      state.pending = task;
      try {
        return await task;
      } finally {
        if (state.pending === task) state.pending = null;
      }
    };

    const tools: ToolSet = {
      search_zhihu_topic: tool({
        description:
          '按关键词检索知乎上适合破冰的话题。当成员兴趣标签存在交集、需要共同话题时调用；不要凭记忆编造话题。' +
          '如果最近已经给过话题，关键词要换到其他领域，不要沿用上一次的方向。',
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
        execute: async ({ keyword, count }): Promise<ToolPayload> => {
          guard('search_zhihu_topic', { keyword, count });
          return requestSelection(() =>
            this.#topics.searchCommonTopics(keyword, {
              count,
              interestTags: shared.length > 0 ? shared : allTags,
              signal: request.signal,
              excludeTitles: currentTopicTitles(),
            }),
          );
        },
      }),

      get_hot_list: tool({
        description:
          '获取知乎热榜中适合破冰的话题。当成员兴趣没有交集、无法确定共同关键词，' +
          '或者需要换到与之前不同领域的话题时调用；返回已选定的那一条，直接据此向房间抛话题。',
        inputSchema: z.object({
          limit: z.number().int().min(1).max(5).default(3),
        }),
        execute: async ({ limit }): Promise<ToolPayload> => {
          guard('get_hot_list', { limit });
          return requestSelection(() =>
            this.#topics.getPopularTopics({
              limit,
              interestTags: allTags,
              signal: request.signal,
              excludeTitles: currentTopicTitles(),
            }),
          );
        },
      }),
    };

    // 资料检索只给普通回复用：选题时必须走话题工具，否则模型可能把一条百科摘要
    // 当成话题抛出来，绕过去重、适宜性筛选和「当前话题」排除。
    if (request.purpose === 'reply') {
      tools['search_zhihu_knowledge'] = tool({
        description:
          '查询资料，用于回答「某个作品讲了什么」「某个人物、事件、概念是什么」这类事实性问题。' +
          '只在房主问事实时调用；找聊天话题不要用它。回答必须以返回的摘要为准。',
        inputSchema: z.object({
          query: z
            .string()
            .min(1)
            .describe('要查的对象，用名词短语，例如「当尼采哭泣 小说 内容」「费曼 是谁」'),
          limit: z.number().int().min(1).max(4).default(3),
        }),
        execute: async ({ query, limit }): Promise<KnowledgePayload> => {
          guard('search_zhihu_knowledge', { query, limit });
          return searchKnowledge(this.#topics, query, limit, request.signal);
        },
      });
    }

    return tools;
  }
}

/** 取消检查：任何 yield 之前都必须调用，保证 abort 后不再产出。 */
function throwIfCancelled(signal: AbortSignal): void {
  if (signal.aborted) throw new CapabilityError('AI_CANCELLED', '调用已取消');
}

/**
 * 查资料。
 *
 * 上游失败不终止整轮生成：把「查不到」当作工具结果交给模型，
 * 由提示词约束它别编（宁可说没查到，也不要胡诌情节）。只有取消才向上抛，
 * 交给生成循环按 AI_CANCELLED 处理。
 */
async function searchKnowledge(
  source: ZhihuTopicSource,
  query: string,
  limit: number,
  signal: AbortSignal,
): Promise<KnowledgePayload> {
  if (signal.aborted) throw new CapabilityError('AI_CANCELLED', '调用已取消');
  try {
    const results = await source.searchKnowledge(query, { limit, signal });
    if (results.length === 0) {
      return { results: [], hint: '没有查到相关资料。直接说没查到，不要编。' };
    }
    return {
      results,
      hint: '只根据这些摘要回答，用口语说清结论；摘要里没有的细节不要补。',
    };
  } catch (error) {
    if (error instanceof CapabilityError && error.code === 'AI_CANCELLED') throw error;
    if (signal.aborted) {
      throw new CapabilityError('AI_CANCELLED', '调用已取消', { cause: error });
    }
    return { results: [], hint: '资料暂时查不到。可以按常识简短回应，但不要编造具体细节。' };
  }
}

/** 把 SDK 与网络错误映射为契约允许的错误码。 */
function toCapabilityError(error: unknown, signal: AbortSignal): CapabilityError {
  if (error instanceof CapabilityError) return error;

  if (signal.aborted) return new CapabilityError('AI_CANCELLED', '调用已取消', { cause: error });

  // SDK 在重试耗尽后抛的是 RetryError，真正的 HTTP 状态在 lastError 里。
  // 不解包会把 429 当成 AI_PROVIDER_ERROR（丢掉 retryAfterMs），503 也归错类。
  let source: unknown = error;
  for (let depth = 0; depth < 3 && RetryError.isInstance(source); depth += 1) {
    source = source.lastError;
  }

  const name = source instanceof Error ? source.name : '';
  if (name === 'AbortError') {
    return new CapabilityError('AI_CANCELLED', '调用已取消', { cause: source });
  }
  if (name === 'TimeoutError') {
    return new CapabilityError('AI_TIMEOUT', '模型调用超时', { cause: source });
  }

  const status = (source as { statusCode?: number; status?: number }).statusCode
    ?? (source as { status?: number }).status;
  if (status === 429) {
    return new CapabilityError('AI_RATE_LIMITED', '模型调用频率受限', {
      retryAfterMs: 20_000,
      cause: source,
    });
  }
  if (status !== undefined && status >= 500) {
    return new CapabilityError('AI_UNAVAILABLE', '模型服务不可用', { cause: source });
  }

  return new CapabilityError('AI_PROVIDER_ERROR', '模型调用失败', { cause: source });
}
