/**
 * TopicsCapability 测试：用假生成器验证接口契约，不触达真实模型。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createTopicsCapabilityWith } from '../src/capabilities/topics/index.ts';
import { AppError } from '../src/domain/errors.ts';
import { CapabilityError } from '../src/infrastructure/zhihu/types.ts';
import type {
  GenerationChunk,
  GenerationRequest,
  TextGenerator,
} from '../src/infrastructure/model/types.ts';
import type {
  CapabilityChunk,
  CapabilityContext,
  CapabilityMemberView,
} from '../src/application/capability.ts';

class RecordingGenerator implements TextGenerator {
  lastRequest: GenerationRequest | null = null;
  readonly #chunks: readonly GenerationChunk[];
  readonly #error: CapabilityError | null;

  constructor(chunks: readonly GenerationChunk[], error: CapabilityError | null = null) {
    this.#chunks = chunks;
    this.#error = error;
  }

  async *generate(request: GenerationRequest): AsyncIterable<GenerationChunk> {
    this.lastRequest = request;
    if (this.#error !== null) throw this.#error;
    for (const chunk of this.#chunks) yield chunk;
  }
}

const member = (over: Partial<CapabilityMemberView> = {}): CapabilityMemberView => ({
  memberId: 'a',
  nickname: '小林',
  interestTags: ['摄影'],
  bio: '',
  ...over,
});

function makeContext(over: Partial<CapabilityContext> = {}): CapabilityContext {
  return {
    roomId: 'room-1',
    purpose: 'topic',
    caller: null,
    invitedMember: null,
    members: [member(), member({ memberId: 'b', nickname: '阿哲' })],
    recentMessages: [],
    currentTopic: null,
    prompt: null,
    signal: new AbortController().signal,
    ...over,
  };
}

async function collect(iterable: AsyncIterable<CapabilityChunk>): Promise<CapabilityChunk[]> {
  const out: CapabilityChunk[] = [];
  for await (const chunk of iterable) out.push(chunk);
  return out;
}

test('上下文转换：CapabilityContext 正确映射为 GenerationRequest', async () => {
  const gen = new RecordingGenerator([{ kind: 'text', delta: '周末都怎么过呀？' }]);
  const cap = createTopicsCapabilityWith(gen);

  await collect(
    cap.run(
      makeContext({
        purpose: 'reply',
        caller: member(),
        prompt: '找个话题',
        recentMessages: [{ authorId: 'b', nickname: '阿哲', text: '在呢', createdAt: '2026-11-03T00:00:00Z' }],
      }),
    ),
  );

  const req = gen.lastRequest;
  assert.ok(req !== null);
  assert.equal(req.purpose, 'reply');
  assert.equal(req.prompt, '找个话题');
  assert.equal(req.caller?.nickname, '小林');
  assert.equal(req.members.length, 2);
  assert.equal(req.recentMessages[0]?.text, '在呢');
});

test('产出：topic chunk 原样透传为草稿', async () => {
  const gen = new RecordingGenerator([
    {
      kind: 'topic',
      topic: {
        title: '你拍过最满意的照片是在哪儿？',
        content: '聊聊拍照的地点与故事。',
        kind: 'common',
        sourceLabel: '知乎 · 某人',
        sourceUrl: 'https://www.zhihu.com/question/1',
      },
    },
    { kind: 'text', delta: '你们拍照有没有死等过一张图？' },
  ]);
  const cap = createTopicsCapabilityWith(gen);

  const chunks = await collect(cap.run(makeContext()));
  assert.equal(chunks.length, 2);
  assert.equal(chunks[0]?.kind, 'topic');
  assert.ok(chunks[0]?.kind === 'topic' && chunks[0].topic.kind === 'common');
  assert.equal(chunks[1]?.kind, 'text');
});

test('产出：空白草稿被丢弃但不影响文本', async () => {
  const gen = new RecordingGenerator([
    {
      kind: 'topic',
      topic: { title: '   ', content: '正文', kind: 'popular', sourceLabel: null, sourceUrl: null },
    },
    { kind: 'text', delta: '大家聊点轻松的吧' },
  ]);
  const cap = createTopicsCapabilityWith(gen);

  const chunks = await collect(cap.run(makeContext()));
  assert.equal(chunks.length, 1, '空白草稿应被过滤');
  assert.equal(chunks[0]?.kind, 'text');
});

test('取消：signal 透传到生成请求', async () => {
  const controller = new AbortController();
  const gen = new RecordingGenerator([{ kind: 'text', delta: 'ok 的内容在这里' }]);
  const cap = createTopicsCapabilityWith(gen);

  await collect(cap.run(makeContext({ signal: controller.signal })));
  assert.equal(gen.lastRequest?.signal, controller.signal);
});

test('错误：生成器抛出的 CapabilityError 转成应用层 AppError 并保留错误码', async () => {
  const gen = new RecordingGenerator([], new CapabilityError('AI_PROVIDER_ERROR', '模型未产出'));
  const cap = createTopicsCapabilityWith(gen);

  await assert.rejects(
    () => collect(cap.run(makeContext())),
    (error: unknown) =>
      error instanceof AppError && error.code === 'AI_PROVIDER_ERROR' && error.message === '模型未产出',
    '应用层要靠 AppError 识别失败原因，插件边界必须完成转换',
  );
});

test('邀答：invitedMember 透传，目标由应用层给定', async () => {
  const gen = new RecordingGenerator([{ kind: 'text', delta: '阿哲，聊聊你的看法？' }]);
  const cap = createTopicsCapabilityWith(gen);

  const invited = member({ memberId: 'b', nickname: '阿哲' });
  await collect(cap.run(makeContext({ purpose: 'invitation', invitedMember: invited })));

  assert.equal(gen.lastRequest?.purpose, 'invitation');
  assert.equal(gen.lastRequest?.invitedMember?.nickname, '阿哲');
});

test('name 为 topics', () => {
  const cap = createTopicsCapabilityWith(new RecordingGenerator([]));
  assert.equal(cap.name, 'topics');
});
