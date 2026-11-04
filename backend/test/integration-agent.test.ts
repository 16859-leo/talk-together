/**
 * Agent × 后端整合测试。
 *
 * 把真实的 `TopicsCapability`（真流式增量、真话题草稿、真错误映射）接进完整应用
 * （HTTP + WebSocket + 队列 + 取消），只把模型和知乎数据源换成假实现，零额度。
 *
 * 覆盖 docs/api/handoff.md 里与 AI 相关的联调场景：
 * - 流式增量归并为同一条回复，完成/失败/取消互斥且保留已输出文字；
 * - 自动触发选题后由应用层发布 topic.changed，草稿字段完整；
 * - 失败按契约错误码落 failed，不标成功。
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { WebSocket } from 'ws';
import { MockLanguageModelV4, simulateReadableStream } from 'ai/test';

import { build } from '../src/app.ts';
import { TopicsCapability } from '../src/capabilities/topics/topics-capability.ts';
import { DeepSeekTextGenerator } from '../src/infrastructure/model/deepseek-generator.ts';
import { ZhihuTopicSource } from '../src/infrastructure/zhihu/topic-source.ts';
import type {
  ZhihuContentSource,
  ZhihuHotItem,
  ZhihuSearchItem,
} from '../src/infrastructure/zhihu/types.ts';
import { secret, testConfig, uuid, validateServerMessage } from './helpers.ts';

type Chunk = Parameters<typeof simulateReadableStream>[0]['chunks'][number];

// ---------------------------------------------------------------- 假模型/假数据源

function textChunks(parts: readonly string[], reason: 'stop' | 'tool-calls' = 'stop'): Chunk[] {
  const out: Chunk[] = [{ type: 'text-start', id: '1' }];
  for (const part of parts) out.push({ type: 'text-delta', id: '1', delta: part });
  out.push({ type: 'text-end', id: '1' });
  out.push({
    type: 'finish',
    finishReason: { unified: reason, raw: reason },
    usage: { inputTokens: 1, outputTokens: parts.length, totalTokens: parts.length + 1 },
  });
  return out;
}

function toolCallChunks(callId: string, toolName: string, args: unknown): Chunk[] {
  const input = JSON.stringify(args);
  return [
    { type: 'tool-input-start', id: callId, toolName },
    { type: 'tool-input-delta', id: callId, delta: input },
    { type: 'tool-input-end', id: callId },
    { type: 'tool-call', toolCallId: callId, toolName, input },
    {
      type: 'finish',
      finishReason: { unified: 'tool-calls', raw: 'tool_calls' },
      usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
    },
  ];
}

/** 按顺序取分片：AI SDK 每个工具轮次会再调用一次 doStream。 */
function stagedModel(stages: readonly (readonly Chunk[])[], delayMs = 0): MockLanguageModelV4 {
  let call = 0;
  return new MockLanguageModelV4({
    doStream: async () => {
      const chunks = stages[call] ?? stages[stages.length - 1] ?? [];
      call += 1;
      return {
        stream: simulateReadableStream({
          chunks: [...chunks],
          chunkDelayInMs: delayMs,
        }) as unknown as ReadableStream,
      };
    },
  });
}

const TRAVEL_TITLE = '旅行中遇到过什么难忘的经历？';
const TRAVEL_URL = 'https://z.com/travel';

class FakeZhihuSource implements ZhihuContentSource {
  searchCalls = 0;

  async searchZhihu(): Promise<readonly ZhihuSearchItem[]> {
    this.searchCalls += 1;
    return [
      {
        title: TRAVEL_TITLE,
        contentText: '路上遇到的人、临时改的路线，都可以聊。',
        url: TRAVEL_URL,
        authorName: null,
      },
    ];
  }

  async getHotList(): Promise<readonly ZhihuHotItem[]> {
    return [];
  }
}

// ------------------------------------------------------------------ 测试台

interface Client {
  frames: any[];
  waitFor(predicate: (frame: any) => boolean, label: string, timeoutMs?: number): Promise<any>;
  close(): void;
}

const live = async (model: MockLanguageModelV4, config = testConfig()) => {
  const capability = new TopicsCapability(
    new DeepSeekTextGenerator(new ZhihuTopicSource(new FakeZhihuSource()), {
      modelOverride: model,
      maxRetries: 0,
    }),
  );
  const app = await build({ config, capability });
  await app.listen({ host: '127.0.0.1', port: 0 });
  const address = app.server.address();
  const port = typeof address === 'object' && address !== null ? address.port : 0;
  const origin = `http://127.0.0.1:${port}`;

  const call = async (options: {
    method: string;
    path: string;
    body?: unknown;
    credential?: string;
    membershipId?: string;
  }) => {
    const headers: Record<string, string> = {};
    if (options.body !== undefined) headers['content-type'] = 'application/json';
    if (options.credential) headers['authorization'] = `Bearer ${options.credential}`;
    if (options.membershipId) headers['x-membership-id'] = options.membershipId;
    const response = await fetch(origin + options.path, {
      method: options.method,
      headers,
      ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
    });
    return { status: response.status, ...((await response.json()) as Record<string, unknown>) } as any;
  };

  const connect = async (roomId: string, credential: string, membershipId: string): Promise<Client> => {
    const ticket = await call({
      method: 'POST',
      path: `/api/v1/rooms/${roomId}/connection-tickets`,
      credential,
      membershipId,
    });
    assert.equal(ticket.status, 201, JSON.stringify(ticket));
    const socket = new WebSocket(ticket.data.webSocketUrl);
    const frames: any[] = [];
    const waiters: { predicate: (frame: any) => boolean; resolve: (frame: any) => void }[] = [];

    socket.on('message', raw => {
      const frame = JSON.parse(String(raw));
      frames.push(frame);
      for (let index = waiters.length - 1; index >= 0; index -= 1) {
        const waiter = waiters[index]!;
        if (waiter.predicate(frame)) {
          waiters.splice(index, 1);
          waiter.resolve(frame);
        }
      }
    });
    await new Promise<void>((resolve, reject) => {
      socket.once('open', resolve);
      socket.once('error', reject);
    });

    return {
      frames,
      waitFor: (predicate, label, timeoutMs = 5000) =>
        new Promise((resolve, reject) => {
          const existing = frames.find(predicate);
          if (existing) {
            resolve(existing);
            return;
          }
          const timer = setTimeout(() => reject(new Error(`timeout waiting for ${label}`)), timeoutMs);
          waiters.push({
            predicate,
            resolve: frame => {
              clearTimeout(timer);
              resolve(frame);
            },
          });
        }),
      close: () => socket.close(),
    };
  };

  const host = async (nickname = '小林') => {
    const created = await call({
      method: 'POST',
      path: '/api/v1/rooms',
      body: {
        clientRequestId: uuid(),
        bootstrapToken: secret(),
        profile: { nickname, interestTags: ['摄影', '露营'], bio: '' },
      },
    });
    assert.equal(created.status, 201, JSON.stringify(created));
    return {
      roomId: created.data.room.id as string,
      memberId: created.data.member.id as string,
      membershipId: created.data.member.membership.id as string,
      credential: created.data.memberCredential as string,
    };
  };

  return { app, call, connect, host, close: () => app.close() };
};

const sayToAi = (env: Awaited<ReturnType<typeof live>>, roomId: string, host: Awaited<ReturnType<Awaited<ReturnType<typeof live>>['host']>>) =>
  env.call({
    method: 'POST',
    path: `/api/v1/rooms/${roomId}/messages`,
    credential: host.credential,
    membershipId: host.membershipId,
    body: { clientRequestId: uuid(), text: '@AI 帮我们聊起来', mentions: ['ai'] },
  });

// ------------------------------------------------------------------ 用例

test('整合：房主 @AI，真实插件的增量归并为一条 completed', async t => {
  const spoken = '你们周末一般都怎么过呀？是出门走走还是在家待着，有没有什么固定的小安排？';
  const env = await live(
    stagedModel([textChunks(['你们周末一般都怎么过呀？', '是出门走走还是在家待着，', '有没有什么固定的小安排？'])]),
  );
  t.after(() => env.close());

  const host = await env.host();
  const client = await env.connect(host.roomId, host.credential, host.membershipId);
  await client.waitFor(frame => frame.type === 'room.snapshot', 'snapshot');

  const sent = await sayToAi(env, host.roomId, host);
  assert.equal(sent.status, 201);
  // 队列可能瞬间进入 running，两种状态都属于「已受理」。
  assert.ok(
    sent.data.ai.status === 'queued' || sent.data.ai.status === 'running',
    `AI 回执应为 queued/running，实际 ${sent.data.ai.status}`,
  );

  const completed = await client.waitFor(frame => frame.type === 'ai.reply.completed', 'completed', 8000);
  const started = client.frames.find(frame => frame.type === 'ai.reply.started');
  const deltas = client.frames.filter(frame => frame.type === 'ai.reply.delta');

  for (const frame of client.frames) validateServerMessage(frame, frame.type);
  assert.ok(started, '必须收到 ai.reply.started');
  assert.ok(deltas.length >= 2, `真实插件应分多片产出，实际 ${deltas.length} 片`);
  assert.equal(
    deltas.map(frame => frame.data.textDelta).join(''),
    spoken,
    '增量拼接结果必须等于完整话术',
  );
  assert.equal(completed.data.reply.text, spoken);
  assert.equal(completed.data.reply.status, 'completed');
  assert.equal(completed.data.reply.id, started.data.reply.id, '增量必须归并到同一条回复');
  client.close();
});

test('整合：自动选题走真实插件，应用层发布 topic.changed 并保留草稿字段', async t => {
  const spoken = '你们有没有在路上遇到过特别难忘的事情？';
  const env = await live(
    stagedModel([
      toolCallChunks('c1', 'search_zhihu_topic', { keyword: '旅行', count: 5 }),
      textChunks(['你们有没有', '在路上遇到过', '特别难忘的事情？']),
    ]),
    testConfig({ idle: { topicMs: 45_000, invitationMs: 30_000, tickMs: 3_600_000 } }),
  );
  t.after(() => env.close());

  const host = await env.host();
  const client = await env.connect(host.roomId, host.credential, host.membershipId);
  await client.waitFor(frame => frame.type === 'room.snapshot', 'snapshot');

  const service = (env.app as any).roomService;
  const ai = service.aiService(host.roomId);
  const room = service.authenticate(host.roomId, host.credential).room;
  const base = Date.now();
  room.lastMemberMessageAt = base;

  const fired = ai.tickIdle(base + 46_000);
  assert.ok(fired, '冷场应触发自动选题');
  assert.equal(fired.purpose, 'topic');

  const changed = await client.waitFor(frame => frame.type === 'topic.changed', 'topic.changed', 8000);
  const completed = await client.waitFor(frame => frame.type === 'ai.reply.completed', 'completed', 8000);

  assert.equal(changed.data.topic.title, TRAVEL_TITLE, '草稿来自真实检索结果');
  assert.equal(changed.data.topic.kind, 'common');
  assert.equal(changed.data.topic.sourceUrl, TRAVEL_URL, '来源要带出去');
  assert.equal(completed.data.reply.purpose, 'topic');
  assert.equal(completed.data.reply.text, spoken);

  const snap = await client.waitFor(frame => frame.type === 'room.snapshot', 'snapshot');
  assert.ok(snap, '快照应已存在（首帧）');
  client.close();
});

test('整合：模型报错时落 failed(AI_PROVIDER_ERROR)，已输出文字保留', async t => {
  const partialText = '你们周末一般都怎么过呀？是出门走走还是在家待着，有没有什么固定的小安排？';
  const chunks: Chunk[] = [
    { type: 'text-start', id: '1' },
    { type: 'text-delta', id: '1', delta: partialText },
    { type: 'text-end', id: '1' },
    { type: 'error', error: new Error('provider boom') },
    {
      type: 'finish',
      finishReason: { unified: 'error', raw: 'error' },
      usage: { inputTokens: 1, outputTokens: 5, totalTokens: 6 },
    },
  ];
  const env = await live(stagedModel([chunks]));
  t.after(() => env.close());

  const host = await env.host();
  const client = await env.connect(host.roomId, host.credential, host.membershipId);
  await client.waitFor(frame => frame.type === 'room.snapshot', 'snapshot');

  await sayToAi(env, host.roomId, host);
  const failed = await client.waitFor(frame => frame.type === 'ai.reply.failed', 'failed', 8000);

  assert.equal(failed.data.reply.status, 'failed');
  assert.equal(failed.data.reply.error.code, 'AI_PROVIDER_ERROR', '契约允许的错误码');
  assert.ok(failed.data.reply.text.length > 0, '失败也要保留已输出文字');
  assert.ok(failed.data.reply.text.length <= partialText.length);
  assert.equal(
    client.frames.some(frame => frame.type === 'ai.reply.completed'),
    false,
    '失败与完成互斥',
  );
  client.close();
});

test('整合：生成中关房，落 cancelled(AI_CANCELLED) 且保留部分文字', async t => {
  const long = '你们周末一般都怎么过呀？是出门走走还是在家待着，有没有什么固定的小安排？我最近迷上了露营。';
  const parts = long.match(/.{1,8}/gu) ?? [];
  const env = await live(stagedModel([textChunks(parts)], 40));
  t.after(() => env.close());

  const host = await env.host();
  const client = await env.connect(host.roomId, host.credential, host.membershipId);
  await client.waitFor(frame => frame.type === 'room.snapshot', 'snapshot');

  await sayToAi(env, host.roomId, host);
  const firstDelta = await client.waitFor(frame => frame.type === 'ai.reply.delta', 'delta', 8000);
  assert.ok(firstDelta.data.textDelta.length > 0);

  await env.call({
    method: 'DELETE',
    path: `/api/v1/rooms/${host.roomId}`,
    credential: host.credential,
    membershipId: host.membershipId,
  });

  const cancelled = await client.waitFor(frame => frame.type === 'ai.reply.cancelled', 'cancelled', 8000);
  assert.equal(cancelled.data.reply.status, 'cancelled');
  assert.equal(cancelled.data.reply.error.code, 'AI_CANCELLED');
  assert.ok(cancelled.data.reply.text.length > 0, '取消也要保留已输出文字');
  assert.ok(
    cancelled.data.reply.text.length < long.length,
    '取消发生在生成中途，不能是完整正文',
  );
  assert.equal(
    client.frames.some(frame => frame.type === 'ai.reply.completed'),
    false,
    '取消与完成互斥',
  );
  client.close();
});
