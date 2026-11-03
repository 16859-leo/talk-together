/**
 * DeepSeekTextGenerator 内部行为测试。
 * 用 MockLanguageModelV4 + simulateReadableStream 驱动真实生成器，
 * 复现 PR #5 review 指出的流式 / 错误 / 取消缺陷并验证修复。
 * 不触达真实模型与知乎，零额度。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MockLanguageModelV4, simulateReadableStream } from 'ai/test';

import { DeepSeekTextGenerator } from '../src/infrastructure/model/deepseek-generator.ts';
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

function textChunks(parts: readonly string[], finishReason = 'stop'): Chunk[] {
  const out: Chunk[] = [{ type: 'text-start', id: '1' }];
  for (const p of parts) out.push({ type: 'text-delta', id: '1', delta: p });
  out.push({ type: 'text-end', id: '1' });
  out.push({
    type: 'finish',
    finishReason,
    usage: { inputTokens: 1, outputTokens: parts.length, totalTokens: parts.length + 1 },
  } as Chunk);
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

test('P1 渐进产出：文本分多片增量 yield，而非一次性全文', async () => {
  const gen = makeGen(mockModel(textChunks(['你们周末', '一般都', '怎么过呀？'])));
  const chunks = await collect(gen.generate(makeRequest()));
  const textChunksOut = chunks.filter((c) => c.kind === 'text');
  assert.ok(textChunksOut.length >= 2, `应分多片产出，实际 ${textChunksOut.length} 片`);
  const whole = textChunksOut.map((c) => (c.kind === 'text' ? c.delta : '')).join('');
  assert.equal(whole, '你们周末一般都怎么过呀？');
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
  // 分片有延迟，便于在产出中途取消
  const gen = makeGen(mockModel(textChunks(['这是第一段', '这是第二段', '这是第三段']), 20));
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
