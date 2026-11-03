/**
 * 生成器编排逻辑测试：用假 TextGenerator 覆盖零文本、取消、重试等路径，
 * 不触达真实模型，不消耗额度。
 *
 * 真实模型行为由 test/smoke-model.ts 单独冒烟。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { CapabilityError } from '../src/infrastructure/zhihu/types.ts';
import { ZhihuTopicSource } from '../src/infrastructure/zhihu/topic-source.ts';
import type {
  ZhihuContentSource,
  ZhihuHotItem,
  ZhihuSearchItem,
} from '../src/infrastructure/zhihu/types.ts';
import { cleanOutput, rejectOutput } from '../src/infrastructure/model/sanitize.ts';
import type {
  GenerationChunk,
  GenerationRequest,
  MemberView,
  TextGenerator,
} from '../src/infrastructure/model/types.ts';

class StubSource implements ZhihuContentSource {
  async searchZhihu(): Promise<readonly ZhihuSearchItem[]> {
    return [
      {
        title: '你们都在哪儿拍过最满意的照片？',
        contentText: '聊聊拍照的地点和当时的情形。',
        url: 'https://www.zhihu.com/question/1',
        authorName: null,
      },
    ];
  }
  async getHotList(): Promise<readonly ZhihuHotItem[]> {
    return [];
  }
}

/**
 * 复刻 DeepSeekTextGenerator 的产出判定，但模型输出可注入。
 * 验证的是编排契约，不是 SDK 本身。
 */
class FakeGenerator implements TextGenerator {
  attempts = 0;
  readonly #outputs: readonly string[];
  readonly #maxRetries: number;

  constructor(outputs: readonly string[], maxRetries = 1) {
    this.#outputs = outputs;
    this.#maxRetries = maxRetries;
  }

  async *generate(request: GenerationRequest): AsyncIterable<GenerationChunk> {
    for (let attempt = 0; attempt <= this.#maxRetries; attempt += 1) {
      if (request.signal.aborted) {
        throw new CapabilityError('AI_CANCELLED', '调用已取消');
      }
      this.attempts += 1;
      const raw = this.#outputs[Math.min(attempt, this.#outputs.length - 1)] ?? '';
      const text = cleanOutput(raw);
      const rejected =
        text.length === 0 ? 'TOO_SHORT' : rejectOutput(text, request.recentMessages);
      if (rejected === null) {
        yield { kind: 'text', delta: text };
        return;
      }
    }
    throw new CapabilityError('AI_PROVIDER_ERROR', '模型未产出可用文本');
  }
}

function makeRequest(overrides: Partial<GenerationRequest> = {}): GenerationRequest {
  const members: MemberView[] = [
    { memberId: 'a', nickname: '小林', interestTags: ['摄影'], bio: '' },
    { memberId: 'b', nickname: '阿哲', interestTags: ['摄影'], bio: '' },
  ];
  return {
    purpose: 'topic',
    members,
    recentMessages: [],
    currentTopic: null,
    prompt: null,
    caller: null,
    invitedMember: null,
    signal: new AbortController().signal,
    ...overrides,
  };
}

async function collect(iterable: AsyncIterable<GenerationChunk>): Promise<GenerationChunk[]> {
  const out: GenerationChunk[] = [];
  for await (const chunk of iterable) out.push(chunk);
  return out;
}

// ---------- 零文本路径（契约硬约束） ----------

test('零文本：模型始终返回空时抛 AI_PROVIDER_ERROR，不产占位文本', async () => {
  const gen = new FakeGenerator(['', '']);
  await assert.rejects(
    () => collect(gen.generate(makeRequest())),
    (error: unknown) =>
      error instanceof CapabilityError && error.code === 'AI_PROVIDER_ERROR',
  );
});

test('零文本：纯元话语等价于零文本，同样抛错', async () => {
  const gen = new FakeGenerator(['可以这样追问：', '可以追问：']);
  await assert.rejects(
    () => collect(gen.generate(makeRequest())),
    (error: unknown) =>
      error instanceof CapabilityError && error.code === 'AI_PROVIDER_ERROR',
  );
});

test('零文本：首次为空、重试成功时正常产出', async () => {
  const gen = new FakeGenerator(['', '你们都在哪儿拍过最满意的照片？']);
  const chunks = await collect(gen.generate(makeRequest()));
  assert.equal(gen.attempts, 2, '应重试一次');
  assert.equal(chunks.length, 1);
  assert.equal(chunks[0]?.kind, 'text');
});

test('不合格输出触发重试：转录式复述被拦下后重试', async () => {
  const recent = [{ authorId: 'a', nickname: '小林', text: '我最近在学吉他，每天练半小时', createdAt: '' }];
  const gen = new FakeGenerator([
    '小林：我最近在学吉他，每天练半小时',
    '学乐器最难的是坚持，你们有类似经历吗？',
  ]);
  const chunks = await collect(gen.generate(makeRequest({ recentMessages: recent })));
  assert.equal(gen.attempts, 2);
  assert.equal(chunks[0]?.kind, 'text');
  assert.ok(chunks[0]?.kind === 'text' && chunks[0].delta.startsWith('学乐器'));
});

// ---------- 取消 ----------

test('取消：已 abort 的请求立即抛 AI_CANCELLED', async () => {
  const controller = new AbortController();
  controller.abort();
  const gen = new FakeGenerator(['正常文本内容在这里']);
  await assert.rejects(
    () => collect(gen.generate(makeRequest({ signal: controller.signal }))),
    (error: unknown) => error instanceof CapabilityError && error.code === 'AI_CANCELLED',
  );
  assert.equal(gen.attempts, 0, '取消后不应发起调用');
});

// ---------- 工具层与数据源联动 ----------

test('数据源：检索结果可直接作为话题草稿，字段满足契约', async () => {
  const source = new ZhihuTopicSource(new StubSource());
  const topics = await source.searchCommonTopics('摄影', { count: 3 });
  assert.ok(topics.length > 0);
  const first = topics[0];
  assert.ok(first !== undefined);
  assert.equal(first.kind, 'common');
  assert.ok(first.title.length > 0);
  assert.ok(first.content.length > 0);
});
