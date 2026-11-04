/**
 * DeepSeekTextGenerator 内部行为测试。
 * 用 MockLanguageModelV4 + simulateReadableStream 驱动真实生成器，
 * 复现 PR #5 review 指出的流式 / 错误 / 取消缺陷并验证修复。
 * 不触达真实模型与知乎，零额度。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { APICallError, RetryError } from 'ai';
import { MockLanguageModelV4, simulateReadableStream } from 'ai/test';

import { DeepSeekTextGenerator } from '../src/infrastructure/model/deepseek-generator.ts';
import { MAX_REPLY_TEXT_LENGTH, cleanOutput } from '../src/infrastructure/model/sanitize.ts';
import { ZhihuTopicSource } from '../src/infrastructure/zhihu/topic-source.ts';
import { CapabilityError } from '../src/infrastructure/zhihu/types.ts';
import type {
  ZhihuContentSource,
  ZhihuHotItem,
  ZhihuSearchItem,
} from '../src/infrastructure/zhihu/types.ts';
import type {
  GenerationChunk,
  GenerationRequest,
  MemberView,
} from '../src/infrastructure/model/types.ts';

type Chunk = Parameters<typeof simulateReadableStream>[0]['chunks'][number];

function textChunks(parts: readonly string[], finishReason: 'stop' | 'tool-calls' = 'stop'): Chunk[] {
  const out: Chunk[] = [{ type: 'text-start', id: '1' }];
  for (const p of parts) out.push({ type: 'text-delta', id: '1', delta: p });
  out.push({ type: 'text-end', id: '1' });
  out.push({
    type: 'finish',
    finishReason: { unified: finishReason, raw: finishReason },
    usage: { inputTokens: 1, outputTokens: parts.length, totalTokens: parts.length + 1 },
  });
  return out;
}

function mockModel(chunks: Chunk[], chunkDelayMs = 0): MockLanguageModelV4 {
  return new MockLanguageModelV4({
    doStream: async () => ({
      stream: simulateReadableStream({
        chunks,
        chunkDelayInMs: chunkDelayMs,
      }) as unknown as ReadableStream,
    }),
  });
}

/** 多步 mock：AI SDK 每个工具轮次会再调用一次 doStream，按顺序取下一组分片。 */
function mockModelStages(
  stages: readonly (readonly Chunk[])[],
  chunkDelayMs = 0,
  prompts: unknown[] = [],
): MockLanguageModelV4 {
  let call = 0;
  return new MockLanguageModelV4({
    doStream: async (options: unknown) => {
      prompts.push((options as { prompt?: unknown }).prompt);
      const chunks = stages[call] ?? stages[stages.length - 1] ?? [];
      call += 1;
      return {
        stream: simulateReadableStream({
          chunks: [...chunks],
          chunkDelayInMs: chunkDelayMs,
        }) as unknown as ReadableStream,
      };
    },
  });
}

/** 构造一次工具调用轮次的分片（v4 规范：finishReason 是 { unified, raw }）。 */
function toolCallChunks(callId: string, toolName: string, args: unknown): Chunk[] {
  return [...toolCallParts(callId, toolName, args), finishChunk('tool-calls')];
}

/** 同一步里的并行工具调用：多个 tool-call 之后只跟一个 finish。 */
function parallelToolCallChunks(
  calls: readonly { readonly id: string; readonly toolName: string; readonly args: unknown }[],
): Chunk[] {
  return [...calls.flatMap((call) => toolCallParts(call.id, call.toolName, call.args)), finishChunk('tool-calls')];
}

function toolCallParts(callId: string, toolName: string, args: unknown): Chunk[] {
  const input = JSON.stringify(args);
  return [
    { type: 'tool-input-start', id: callId, toolName },
    { type: 'tool-input-delta', id: callId, delta: input },
    { type: 'tool-input-end', id: callId },
    { type: 'tool-call', toolCallId: callId, toolName, input },
  ];
}

function finishChunk(reason: 'stop' | 'tool-calls'): Chunk {
  return {
    type: 'finish',
    finishReason: { unified: reason, raw: reason },
    usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
  };
}

/** 同一步里先写正文、再调工具（复现「正文产生于检索之前」）。 */
function textThenToolCallChunks(
  text: string,
  callId: string,
  toolName: string,
  args: unknown,
): Chunk[] {
  return [
    { type: 'text-start', id: '1' },
    { type: 'text-delta', id: '1', delta: text },
    { type: 'text-end', id: '1' },
    ...toolCallParts(callId, toolName, args),
    finishChunk('tool-calls'),
  ];
}

/** 按关键词返回不同话题的上游，用于验证「多次检索时草稿归属」。 */
class KeywordSource implements ZhihuContentSource {
  searchCalls = 0;
  readonly #delayMs: number;

  constructor(delayMs = 0) {
    this.#delayMs = delayMs;
  }

  async searchZhihu(keyword: string): Promise<readonly ZhihuSearchItem[]> {
    this.searchCalls += 1;
    if (this.#delayMs > 0) await new Promise((r) => setTimeout(r, this.#delayMs));
    const isTravel = keyword.includes('旅行');
    return [
      isTravel
        ? {
            title: '旅行中遇到过什么难忘的经历？',
            contentText: '路上遇到的人、临时改的路线，都可以聊。',
            url: 'https://z.com/travel',
            authorName: null,
          }
        : {
            title: '音乐现场让你印象最深的一次是哪次？',
            contentText: '聊现场、聊乐队，都行。',
            url: 'https://z.com/music',
            authorName: null,
          },
    ];
  }

  async getHotList(): Promise<readonly ZhihuHotItem[]> {
    return [];
  }
}

class StubSource implements ZhihuContentSource {
  async searchZhihu(): Promise<readonly ZhihuSearchItem[]> {
    return [];
  }
  async getHotList(): Promise<readonly ZhihuHotItem[]> {
    return [];
  }
}

function makeGen(model: MockLanguageModelV4, maxRetries = 0): DeepSeekTextGenerator {
  return new DeepSeekTextGenerator(new ZhihuTopicSource(new StubSource()), {
    modelOverride: model,
    maxRetries,
  });
}

function makeRequest(over: Partial<GenerationRequest> = {}): GenerationRequest {
  const members: MemberView[] = [
    { memberId: 'a', nickname: '小林', interestTags: [], bio: '' },
    { memberId: 'b', nickname: '阿哲', interestTags: [], bio: '' },
  ];
  // 默认 reply：不强制要求话题草稿，便于聚焦流式/错误/取消行为
  return {
    purpose: 'reply',
    members,
    recentMessages: [],
    currentTopic: null,
    prompt: '说点什么',
    caller: members[0] ?? null,
    invitedMember: null,
    signal: new AbortController().signal,
    ...over,
  };
}

async function collect(it: AsyncIterable<GenerationChunk>): Promise<GenerationChunk[]> {
  const out: GenerationChunk[] = [];
  for await (const c of it) out.push(c);
  return out;
}

// ---------- P1：渐进产出 ----------

test('P1 渐进产出：前导定型后文本分多片增量 yield，而非一次性全文', async () => {
  // 超过前导判定窗口（30 字）才会开始流式，故用一条完整的主持话术
  const gen = makeGen(
    mockModel(
      textChunks([
        '你们周末一般都怎么过呀？',
        '是出门走走还是在家待着，',
        '有没有什么固定的小安排？',
        '我最近迷上了露营。',
      ]),
    ),
  );
  const chunks = await collect(gen.generate(makeRequest()));
  const textChunksOut = chunks.filter((c) => c.kind === 'text');
  assert.ok(textChunksOut.length >= 2, `应分多片产出，实际 ${textChunksOut.length} 片`);
  const whole = textChunksOut.map((c) => (c.kind === 'text' ? c.delta : '')).join('');
  assert.equal(
    whole,
    '你们周末一般都怎么过呀？是出门走走还是在家待着，有没有什么固定的小安排？我最近迷上了露营。',
  );
});

test('P1 前缀缓冲：先出「主持」再补「发言：」，不得把半句交付出去', async () => {
  // review 复现用例：前两片看起来是正文，第三片才说明开头是元话语前缀
  const gen = makeGen(mockModel(textChunks(['主持', '发言：', '你们周末都怎么过呀？'])));
  const chunks = await collect(gen.generate(makeRequest()));
  const text = chunks
    .filter((c) => c.kind === 'text')
    .map((c) => (c.kind === 'text' ? c.delta : ''))
    .join('');

  assert.equal(text, '你们周末都怎么过呀？', '应只交付清洗后的完整正文');
  assert.ok(!text.includes('主持'), '缓冲的前缀不得泄露给应用层');
});

test('P1 前导定型：冒号晚到时不得提前输出被截掉的前缀', async () => {
  // 「我想问问大家」先到达时看不出是元话语，冒号一到整段前缀就应被丢弃
  const gen = makeGen(
    mockModel(textChunks(['我想问问大家', '：周末一般都怎么安排？', '有没有固定的安排'])),
  );
  const chunks = await collect(gen.generate(makeRequest()));
  const text = chunks
    .filter((c) => c.kind === 'text')
    .map((c) => (c.kind === 'text' ? c.delta : ''))
    .join('');

  assert.equal(text, '周末一般都怎么安排？有没有固定的安排');
  assert.ok(!text.includes('我想问问大家'), '被截断的前缀不得交付');
});

test('P1 超长输出：裁剪后增量仍与最终清洗结果一致，不抛错', async () => {
  const parts = [
    '你们周末一般都怎么过呀？',
    '后面还有很多很多内容'.repeat(8),
  ];
  const gen = makeGen(mockModel(textChunks(parts)));
  const chunks = await collect(gen.generate(makeRequest()));
  const text = chunks
    .filter((c) => c.kind === 'text')
    .map((c) => (c.kind === 'text' ? c.delta : ''))
    .join('');

  assert.equal(
    text,
    cleanOutput(parts.join(''), MAX_REPLY_TEXT_LENGTH),
    '交付文本必须等于最终清洗结果',
  );
  assert.ok(text.length <= MAX_REPLY_TEXT_LENGTH, `不应超过回复硬上限，实际 ${text.length}`);
});

// ---------- P1：错误事件 ----------

test('P1 错误事件：先出合格文本再出 error，应抛错而非标成功', async () => {
  const chunks: Chunk[] = [
    { type: 'text-start', id: '1' },
    { type: 'text-delta', id: '1', delta: '这是一句合格的话术内容' },
    { type: 'text-end', id: '1' },
    { type: 'error', error: new Error('provider boom') },
    { type: 'finish', finishReason: 'error', usage: { inputTokens: 1, outputTokens: 5, totalTokens: 6 } },
  ];
  const gen = makeGen(mockModel(chunks));
  await assert.rejects(
    () => collect(gen.generate(makeRequest())),
    (e: unknown) => e instanceof CapabilityError,
    'stream 内的 error 必须被捕获并抛出',
  );
});

// ---------- P2：取消时机 ----------

test('P2 取消：合格文本已出但随后 abort，仍应抛 AI_CANCELLED', async () => {
  const controller = new AbortController();
  // 文本要够长，前导定型后才会开始产出增量，便于在产出中途取消
  const gen = makeGen(
    mockModel(
      textChunks([
        '你们周末一般都怎么过呀？',
        '是出门走走还是在家待着，',
        '有没有什么固定的小安排？',
        '我最近迷上了露营。',
      ]),
      20,
    ),
  );
  const req = makeRequest({ signal: controller.signal });

  await assert.rejects(
    async () => {
      const it = gen.generate(req)[Symbol.asyncIterator]();
      await it.next(); // 取首片
      controller.abort();
      // 继续迭代直到抛错
      while (true) {
        const r = await it.next();
        if (r.done === true) break;
      }
    },
    (e: unknown) => e instanceof CapabilityError && e.code === 'AI_CANCELLED',
  );
});

// ---------- P2：选题缺草稿 ----------

test('P2 选题：topic 未调工具直接作答时，视为未完成并抛错', async () => {
  // topic 场景，但 mock 不触发任何工具，直接给文本
  const gen = makeGen(mockModel(textChunks(['你们周末都怎么过呀？'])));
  await assert.rejects(
    () => collect(gen.generate(makeRequest({ purpose: 'topic', prompt: null, caller: null }))),
    (e: unknown) => e instanceof CapabilityError && e.code === 'AI_PROVIDER_ERROR',
    'topic 缺少话题草稿应判未完成',
  );
});

// ---------- 正常路径 ----------

test('reply 正常：合格文本完整产出并结束', async () => {
  const gen = makeGen(mockModel(textChunks(['最近有啥', '好玩的事', '分享下？'])));
  const chunks = await collect(gen.generate(makeRequest()));
  const whole = chunks.filter((c) => c.kind === 'text').map((c) => (c.kind === 'text' ? c.delta : '')).join('');
  assert.equal(whole, '最近有啥好玩的事分享下？');
});

// ---------- P2：草稿归属与取消时机（第二轮 review） ----------

test('P2 草稿归属：多次检索时草稿固定为工具实际采用的那一条', async () => {
  const source = new KeywordSource();
  const prompts: unknown[] = [];
  const gen = new DeepSeekTextGenerator(new ZhihuTopicSource(source), {
    modelOverride: mockModelStages(
      [
        toolCallChunks('c1', 'search_zhihu_topic', { keyword: '旅行', count: 5 }),
        toolCallChunks('c2', 'search_zhihu_topic', { keyword: '音乐', count: 5 }),
        textChunks(['你们有没有', '在路上遇到过', '特别难忘的事情？']),
      ],
      0,
      prompts,
    ),
    maxRetries: 0,
  });

  const chunks = await collect(
    gen.generate(makeRequest({ purpose: 'topic', prompt: null, caller: null })),
  );
  const draft = chunks.find((c) => c.kind === 'topic');
  assert.ok(draft !== undefined && draft.kind === 'topic', '选题必须产出草稿');
  assert.equal(draft.topic.title, '旅行中遇到过什么难忘的经历？');

  // 第二次检索不再打上游，模型拿到的仍是已选定话题
  assert.equal(source.searchCalls, 1, '选定话题后不应再消耗额度');
  const secondStepPrompt = JSON.stringify(prompts[1] ?? '');
  assert.ok(secondStepPrompt.includes('旅行中遇到过什么难忘的经历？'), '第二次工具结果应是已选定话题');
  assert.ok(!secondStepPrompt.includes('音乐现场'), '不得把另一条话题喂给模型造成草稿/发言不一致');
});

test('P2 草稿后取消：收到话题草稿后立刻 abort，不得再产出文本', async () => {
  const controller = new AbortController();
  const source = new KeywordSource();
  const gen = new DeepSeekTextGenerator(new ZhihuTopicSource(source), {
    modelOverride: mockModelStages(
      [
        toolCallChunks('c1', 'search_zhihu_topic', { keyword: '旅行', count: 5 }),
        // 首片就直接超过前导窗口：草稿 yield 恢复后立刻满足「可以输出文本」的条件，
        // 只有 yield 前的取消复查能拦住它。
        textChunks(['你们周末一般都怎么过呀？是出门走走还是在家待着，有没有什么固定安排？'], 'stop'),
      ],
      20,
    ),
    maxRetries: 0,
  });

  const it = gen.generate(
    makeRequest({ purpose: 'topic', prompt: null, caller: null, signal: controller.signal }),
  )[Symbol.asyncIterator]();

  const first = await it.next();
  assert.ok(first.done !== true && first.value.kind === 'topic', '首片应是话题草稿');

  controller.abort();
  await assert.rejects(
    () => it.next(),
    (e: unknown) => e instanceof CapabilityError && e.code === 'AI_CANCELLED',
    '草稿 yield 恢复后必须重新检查取消状态',
  );
});

// ---------- 第三轮 review：并行选题 / 收尾草稿 / 末片取消 ----------

test('P2 并行检索：同一步里的多个工具调用共享同一次选题', async () => {
  const source = new KeywordSource(10);
  const prompts: unknown[] = [];
  const gen = new DeepSeekTextGenerator(new ZhihuTopicSource(source), {
    modelOverride: mockModelStages(
      [
        parallelToolCallChunks([
          { id: 'c1', toolName: 'search_zhihu_topic', args: { keyword: '旅行', count: 5 } },
          { id: 'c2', toolName: 'search_zhihu_topic', args: { keyword: '音乐', count: 5 } },
        ]),
        textChunks(['你们有没有', '在路上遇到过', '特别难忘的事情？']),
      ],
      0,
      prompts,
    ),
    maxRetries: 0,
  });

  const chunks = await collect(
    gen.generate(makeRequest({ purpose: 'topic', prompt: null, caller: null })),
  );
  const draft = chunks.find((c) => c.kind === 'topic');
  assert.ok(draft !== undefined && draft.kind === 'topic', '选题必须产出草稿');

  // 两个并行调用只能采用同一条话题，且上游只被打一次
  assert.equal(source.searchCalls, 1, '并行检索应共享同一次上游请求');
  const travel = '旅行中遇到过什么难忘的经历？';
  const music = '音乐现场让你印象最深的一次是哪次？';
  const draftTitle = draft.topic.title;
  assert.ok(draftTitle === travel || draftTitle === music);
  const secondStepPrompt = JSON.stringify(prompts[1] ?? '');
  assert.ok(secondStepPrompt.includes(draftTitle), '两次工具结果都应是草稿对应的话题');
  assert.ok(
    !secondStepPrompt.includes(draftTitle === travel ? music : travel),
    '不得让并行调用返回两条不同话题',
  );
});

test('P2 检索后无正文：先写正文再检索、零文本收尾判未完成', async () => {
  const source = new KeywordSource();
  const musicText = '你们最近都在听什么歌呀？我最近一直在循环一张现场专辑，特别好听';
  const gen = new DeepSeekTextGenerator(new ZhihuTopicSource(source), {
    modelOverride: mockModelStages([
      // 同一步：先把话术写完，再调检索工具
      [
        { type: 'text-start', id: '1' },
        { type: 'text-delta', id: '1', delta: musicText },
        { type: 'text-end', id: '1' },
        ...toolCallParts('c1', 'search_zhihu_topic', { keyword: '旅行', count: 5 }),
        finishChunk('tool-calls'),
      ],
      // 下一步零文本结束：检索之后没有任何话术
      [finishChunk('stop')],
    ]),
    maxRetries: 0,
  });

  await assert.rejects(
    () => collect(gen.generate(makeRequest({ purpose: 'topic', prompt: null, caller: null }))),
    (e: unknown) => e instanceof CapabilityError && e.code === 'AI_PROVIDER_ERROR',
    '检索前写的话术不能用于满足选题成功条件',
  );
});

test('P2 选题正常：检索之后产出话术，草稿与正文都交付', async () => {
  const source = new KeywordSource();
  const text = '你们周末怎么过？';
  const gen = new DeepSeekTextGenerator(new ZhihuTopicSource(source), {
    modelOverride: mockModelStages([
      toolCallChunks('c1', 'search_zhihu_topic', { keyword: '旅行', count: 5 }),
      textChunks([text], 'stop'),
    ]),
    maxRetries: 0,
  });

  const chunks = await collect(
    gen.generate(makeRequest({ purpose: 'topic', prompt: null, caller: null })),
  );
  const draft = chunks.find((c) => c.kind === 'topic');
  assert.ok(draft !== undefined && draft.kind === 'topic', '选题必须产出草稿');
  assert.equal(draft.topic.title, '旅行中遇到过什么难忘的经历？');

  const whole = chunks
    .filter((c) => c.kind === 'text')
    .map((c) => (c.kind === 'text' ? c.delta : ''))
    .join('');
  assert.equal(whole, text, '话术本身也要完整交付');
});

test('P2 末片后取消：收到最后一片再 abort，应抛 AI_CANCELLED 而非正常结束', async () => {
  const controller = new AbortController();
  const source = new KeywordSource();
  const gen = new DeepSeekTextGenerator(new ZhihuTopicSource(source), {
    modelOverride: mockModelStages([
      toolCallChunks('c1', 'search_zhihu_topic', { keyword: '旅行', count: 5 }),
      textChunks(['你们周末都怎么过呀？'], 'stop'),
    ]),
    maxRetries: 0,
  });

  const it = gen.generate(
    makeRequest({ purpose: 'topic', prompt: null, caller: null, signal: controller.signal }),
  )[Symbol.asyncIterator]();

  const first = await it.next();
  assert.ok(first.done !== true && first.value.kind === 'topic', '首片是话题草稿');

  const second = await it.next();
  assert.ok(second.done !== true && second.value.kind === 'text', '第二片是收尾文本');

  controller.abort();
  await assert.rejects(
    () => it.next(),
    (e: unknown) => e instanceof CapabilityError && e.code === 'AI_CANCELLED',
    '最后一片之后、正常结束之前必须再检查取消状态',
  );
});

test('P2 围栏+未闭合标记：补全后照常交付正文，不抛错也不泄露标记', async () => {
  const gen = makeGen(
    mockModel(
      textChunks([
        '```\n【bridge',
        '还有一个很长的说明'.repeat(3),
        '】你们周末都怎么过呀？',
      ]),
    ),
  );
  const chunks = await collect(gen.generate(makeRequest()));
  const text = chunks
    .filter((c) => c.kind === 'text')
    .map((c) => (c.kind === 'text' ? c.delta : ''))
    .join('');

  assert.equal(text, '你们周末都怎么过呀？');
  assert.ok(!text.includes('【'), '未闭合标记不得泄露');
});

// ---------- 第四轮 review：错误分类 / 提前拦截 / 检索后正文 ----------

test('P2 质量闸门：转录式正文超过前导窗口也不得先交付', async () => {
  // 超过 30 字才会流式输出，这里正好落在「旧实现会先广播」的区间
  const transcript = '小林：我最近在学吉他，每天练半小时，周末还会去上课，已经坚持两个月了。';
  const gen = makeGen(mockModel(textChunks([transcript])));

  const it = gen.generate(makeRequest())[Symbol.asyncIterator]();
  const delivered: GenerationChunk[] = [];
  await assert.rejects(
    async () => {
      while (true) {
        const r = await it.next();
        if (r.done === true) break;
        delivered.push(r.value);
      }
    },
    (e: unknown) => e instanceof CapabilityError && e.code === 'AI_PROVIDER_ERROR',
    '转录式复述必须被质量闸门拦下',
  );

  const textParts = delivered.filter((c) => c.kind === 'text');
  assert.equal(textParts.length, 0, '不合格正文不得先交付给应用层');
});

test('P2 错误分类：SDK 重试耗尽后的 RetryError 要按真实状态码映射', async () => {
  const cases: readonly { readonly status: number; readonly code: string }[] = [
    { status: 429, code: 'AI_RATE_LIMITED' },
    { status: 503, code: 'AI_UNAVAILABLE' },
  ];

  for (const item of cases) {
    const apiError = new APICallError({
      message: `provider returned ${item.status}`,
      url: 'https://api.deepseek.com/chat/completions',
      requestBodyValues: {},
      statusCode: item.status,
      responseHeaders: {},
      responseBody: '{}',
      isRetryable: true,
    });
    const retryError = new RetryError({
      message: 'failed after 2 retries',
      reason: 'maxRetriesExceeded',
      errors: [apiError],
    });

    const model = new MockLanguageModelV4({
      doStream: async () => {
        throw retryError;
      },
    });

    await assert.rejects(
      () => collect(makeGen(model).generate(makeRequest())),
      (e: unknown) => e instanceof CapabilityError && e.code === item.code,
      `HTTP ${item.status} 应映射为 ${item.code}`,
    );
  }
});

// ---------- 第五轮 review：交付正文边界 / 事件顺序 / 共同话题轮换 ----------

const MUSIC_TEXT = '你们最近都在听什么歌呀？我最近一直在循环一张现场专辑，特别好听';

test('P2 检索后只补 Markdown：交付正文没有增长，判未完成', async () => {
  const gen = new DeepSeekTextGenerator(new ZhihuTopicSource(new KeywordSource()), {
    modelOverride: mockModelStages([
      textThenToolCallChunks(MUSIC_TEXT, 'c1', 'search_zhihu_topic', { keyword: '旅行', count: 5 }),
      textChunks(['**'], 'stop'),
    ]),
    maxRetries: 0,
  });

  await assert.rejects(
    () => collect(gen.generate(makeRequest({ purpose: 'topic', prompt: null, caller: null }))),
    (e: unknown) => e instanceof CapabilityError && e.code === 'AI_PROVIDER_ERROR',
    '检索后只补了会被清洗掉的字符，交付的仍是检索前正文',
  );
});

test('P2 检索后另起一行：首行仍是检索前正文，判未完成', async () => {
  const gen = new DeepSeekTextGenerator(new ZhihuTopicSource(new KeywordSource()), {
    modelOverride: mockModelStages([
      textThenToolCallChunks(MUSIC_TEXT, 'c1', 'search_zhihu_topic', { keyword: '旅行', count: 5 }),
      textChunks(['\n我们聊聊旅行吧？'], 'stop'),
    ]),
    maxRetries: 0,
  });

  await assert.rejects(
    () => collect(gen.generate(makeRequest({ purpose: 'topic', prompt: null, caller: null }))),
    (e: unknown) => e instanceof CapabilityError && e.code === 'AI_PROVIDER_ERROR',
    'cleanOutput 只保留首行，检索后另起一行时交付正文没有增长',
  );
});

test('P2 事件顺序：消费者中途暂停，检索前文本也不会被算成检索后正文', async () => {
  const gen = new DeepSeekTextGenerator(new ZhihuTopicSource(new KeywordSource()), {
    modelOverride: mockModelStages([
      textThenToolCallChunks(MUSIC_TEXT, 'c1', 'search_zhihu_topic', { keyword: '旅行', count: 5 }),
      [finishChunk('stop')],
    ]),
    maxRetries: 0,
  });

  const it = gen.generate(makeRequest({ purpose: 'topic', prompt: null, caller: null }))[
    Symbol.asyncIterator
  ]();

  await assert.rejects(
    async () => {
      while (true) {
        const r = await it.next();
        if (r.done === true) break;
        // 消费变慢：SDK 可能已继续读流并执行检索，边界必须按事件顺序记录
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
    },
    (e: unknown) => e instanceof CapabilityError && e.code === 'AI_PROVIDER_ERROR',
    '检索后没有任何正文，暂停消费不应改变这个判断',
  );
});

// ---------- 第六轮 review：检索后内容的质量校验 ----------

test('P2 检索后只补一个句号：没有实质正文，判未完成', async () => {
  const gen = new DeepSeekTextGenerator(new ZhihuTopicSource(new KeywordSource()), {
    modelOverride: mockModelStages([
      textThenToolCallChunks(MUSIC_TEXT, 'c1', 'search_zhihu_topic', { keyword: '旅行', count: 5 }),
      textChunks(['。'], 'stop'),
    ]),
    maxRetries: 0,
  });

  await assert.rejects(
    () => collect(gen.generate(makeRequest({ purpose: 'topic', prompt: null, caller: null }))),
    (e: unknown) => e instanceof CapabilityError && e.code === 'AI_PROVIDER_ERROR',
    '标点补尾不能算「基于检索结果说了一句话」',
  );
});

test('P2 检索后只补一串标点：长度够但无实义字符，仍判未完成', async () => {
  const gen = new DeepSeekTextGenerator(new ZhihuTopicSource(new KeywordSource()), {
    modelOverride: mockModelStages([
      textThenToolCallChunks(MUSIC_TEXT, 'c1', 'search_zhihu_topic', { keyword: '旅行', count: 5 }),
      textChunks(['。。。。。。'], 'stop'),
    ]),
    maxRetries: 0,
  });

  await assert.rejects(
    () => collect(gen.generate(makeRequest({ purpose: 'topic', prompt: null, caller: null }))),
    (e: unknown) => e instanceof CapabilityError && e.code === 'AI_PROVIDER_ERROR',
    '纯标点不构成实质正文',
  );
});

// ---------- 能力扩展：资料检索 ----------

/** 返回一段资料摘要的上游；fail=true 时模拟知乎不可用。 */
class KnowledgeSource implements ZhihuContentSource {
  readonly queries: string[] = [];
  readonly #fail: boolean;

  constructor(fail = false) {
    this.#fail = fail;
  }

  async searchZhihu(keyword: string): Promise<readonly ZhihuSearchItem[]> {
    this.queries.push(keyword);
    if (this.#fail) throw new CapabilityError('AI_UNAVAILABLE', '知乎接口不可用');
    return [
      {
        title: '当尼采哭泣',
        contentText: '欧文·亚隆的小说，虚构了尼采与医生布雷尔互相治疗的故事。',
        url: 'https://z.com/book',
        authorName: '某人',
      },
    ];
  }

  async getHotList(): Promise<readonly ZhihuHotItem[]> {
    return [];
  }
}

test('能力扩展：reply 问事实时调用资料检索，摘要回喂模型后再产出', async () => {
  const source = new KnowledgeSource();
  const prompts: unknown[] = [];
  const gen = new DeepSeekTextGenerator(new ZhihuTopicSource(source), {
    modelOverride: mockModelStages(
      [
        toolCallChunks('c1', 'search_zhihu_knowledge', { query: '当尼采哭泣', limit: 3 }),
        textChunks(['《当尼采哭泣》是欧文·亚隆的小说，', '写尼采和布雷尔互相治疗。']),
      ],
      0,
      prompts,
    ),
    maxRetries: 0,
  });

  const chunks = await collect(
    gen.generate(makeRequest({ prompt: '《当尼采哭泣》讲了什么' })),
  );
  const whole = chunks
    .filter((c) => c.kind === 'text')
    .map((c) => (c.kind === 'text' ? c.delta : ''))
    .join('');
  assert.ok(whole.includes('欧文·亚隆'), `回答应基于摘要，实际：${whole}`);
  assert.deepEqual(source.queries, ['当尼采哭泣'], '应按查询词检索资料');
  assert.ok(
    JSON.stringify(prompts[1] ?? '').includes('布雷尔'),
    '检索到的摘要必须回喂模型，否则模型还是会凭记忆编',
  );
  assert.equal(
    chunks.some((c) => c.kind === 'topic'),
    false,
    '普通回复的检索结果不是话题，不应产出草稿',
  );
});

test('能力扩展：资料检索只提供给普通回复，选题拿不到这个工具', async () => {
  const toolNames: string[][] = [];
  const capture = (firstTool: 'search_zhihu_topic' | 'get_hot_list' | 'search_zhihu_knowledge' = 'search_zhihu_topic'): MockLanguageModelV4 => {
    let call = 0;
    return new MockLanguageModelV4({
      doStream: async (options: unknown) => {
        // SDK v7 把工具作为数组传进来，每项带 name。
        const tools = (options as { tools?: readonly { name?: string }[] }).tools ?? [];
        toolNames.push(tools.map((item) => item.name ?? '').sort());
        call += 1;
        const args =
          firstTool === 'get_hot_list'
            ? { limit: 3 }
            : firstTool === 'search_zhihu_knowledge'
              ? { query: '某本书', limit: 3 }
              : { keyword: '旅行', count: 5 };
        const chunks = call === 1
          ? toolCallChunks('c1', firstTool, args)
          : textChunks(['你们最近一次说走就走的旅行是去哪？']);
        return {
          stream: simulateReadableStream({ chunks: [...chunks], chunkDelayInMs: 0 }) as unknown as ReadableStream,
        };
      },
    });
  };

  const gen = new DeepSeekTextGenerator(new ZhihuTopicSource(new KeywordSource()), {
    modelOverride: capture(),
    maxRetries: 0,
  });
  await collect(gen.generate(makeRequest({ purpose: 'topic', prompt: null, caller: null })));

  const topicTools = toolNames[0] ?? [];
  assert.ok(topicTools.includes('search_zhihu_topic'));
  assert.equal(
    topicTools.includes('search_zhihu_knowledge'),
    false,
    '选题必须走话题工具，否则模型会把百科摘要当话题抛出去',
  );

  toolNames.length = 0;
  const replyGen = new DeepSeekTextGenerator(new ZhihuTopicSource(new KnowledgeSource()), {
    modelOverride: capture('search_zhihu_knowledge'),
    maxRetries: 0,
  });
  await collect(replyGen.generate(makeRequest({ prompt: '《当尼采哭泣》讲了什么' })));
  const replyTools = toolNames[0] ?? [];
  assert.ok(
    replyTools.includes('search_zhihu_knowledge'),
    '普通回复应能查资料回答事实性问题',
  );

  // 已经聊过话题后选题只给热榜：共同兴趣检索会反复命中同一批关键词。
  toolNames.length = 0;
  const secondTopicGen = new DeepSeekTextGenerator(new ZhihuTopicSource(new KeywordSource()), {
    modelOverride: capture('get_hot_list'),
    maxRetries: 0,
  });
  await collect(
    secondTopicGen.generate(
      makeRequest({
        purpose: 'topic',
        prompt: '还有别的话题吗',
        caller: { memberId: 'a', nickname: '小林', interestTags: [], bio: '' },
        recentMessages: [
          {
            authorId: 'ai',
            nickname: 'AI 导播',
            text: '你们最难忘的一次旅行是去哪？',
            createdAt: '2026-11-04T10:00:05.000Z',
          },
        ],
      }),
    ),
  );
  const secondTopicTools = toolNames[0] ?? [];
  assert.deepEqual(
    secondTopicTools,
    ['get_hot_list'],
    '换话题时不能再用共同兴趣检索，否则会一直在同一类话题里打转',
  );
});

test('能力扩展：资料检索失败不终止整轮回复', async () => {
  const gen = new DeepSeekTextGenerator(new ZhihuTopicSource(new KnowledgeSource(true)), {
    modelOverride: mockModelStages([
      toolCallChunks('c1', 'search_zhihu_knowledge', { query: '某本冷门书', limit: 3 }),
      textChunks(['这本我没查到可靠资料，', '不如聊聊你读到它的感受？']),
    ]),
    maxRetries: 0,
  });

  const chunks = await collect(gen.generate(makeRequest({ prompt: '某本冷门书讲了什么' })));
  const whole = chunks
    .filter((c) => c.kind === 'text')
    .map((c) => (c.kind === 'text' ? c.delta : ''))
    .join('');
  assert.ok(whole.includes('没查到'), `上游失败时也要说人话，实际：${whole}`);
});

// ---------- 插件式游戏：主持轮次 ----------

test('游戏主持：不挂任何工具，直接产出主持话术', async () => {
  const toolNames: string[][] = [];
  const model = new MockLanguageModelV4({
    doStream: async (options: unknown) => {
      const tools = (options as { tools?: readonly { name?: string }[] }).tools ?? [];
      toolNames.push(tools.map((item) => item.name ?? ''));
      return {
        stream: simulateReadableStream({
          chunks: textChunks(['第一题：周末是早起出门，还是熬夜补剧？']),
          chunkDelayInMs: 0,
        }) as unknown as ReadableStream,
      };
    },
  });
  const gen = new DeepSeekTextGenerator(new ZhihuTopicSource(new StubSource()), {
    modelOverride: model,
    maxRetries: 0,
  });

  const chunks = await collect(
    gen.generate(
      makeRequest({
        prompt: '来玩默契二选一',
        game: {
          gameId: 'this-or-that',
          name: '默契二选一',
          emoji: '⚖️',
          phase: 'start',
          round: 1,
          totalRounds: 5,
          instruction: '说明玩法并出第一道二选一。',
        },
      }),
    ),
  );
  const whole = chunks
    .filter((c) => c.kind === 'text')
    .map((c) => (c.kind === 'text' ? c.delta : ''))
    .join('');
  assert.ok(whole.includes('早起'), `应产出主持话术，实际：${whole}`);
  assert.deepEqual(toolNames[0], [], '主持游戏不该给模型任何工具');
});
