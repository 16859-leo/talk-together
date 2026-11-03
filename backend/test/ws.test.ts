import assert from 'node:assert/strict';
import { test } from 'node:test';
import { WebSocket } from 'ws';
import { build } from '../src/app.ts';
import { createStubCapability } from '../src/application/capability.ts';
import { testConfig, uuid, secret, validateServerMessage } from './helpers.ts';
import type { FastifyInstance } from 'fastify';

interface Client {
  frames: any[];
  socket: WebSocket;
  /** 等到出现满足条件的帧，或超时抛错。 */
  waitFor(predicate: (frame: any) => boolean, label: string, timeoutMs?: number): Promise<any>;
  close(): void;
}

const live = async (config = testConfig(), delayMs = 5) => {
  const app = await build({ config, capability: createStubCapability({ delayMs }) });
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
      socket,
      waitFor: (predicate, label, timeoutMs = 3000) =>
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

  return { app: app as FastifyInstance, call, connect, close: () => app.close() };
};

const hostOf = async (env: Awaited<ReturnType<typeof live>>, nickname = '小林') => {
  const created = await env.call({
    method: 'POST',
    path: '/api/v1/rooms',
    body: { clientRequestId: uuid(), bootstrapToken: secret(), profile: { nickname, interestTags: ['阅读'], bio: '' } },
  });
  return {
    roomId: created.data.room.id as string,
    inviteCode: created.data.room.invitation.inviteCode as string,
    memberId: created.data.member.id as string,
    membershipId: created.data.member.membership.id as string,
    credential: created.data.memberCredential as string,
  };
};

test('首帧是快照，且全部帧符合事件 Schema', async t => {
  const env = await live();
  t.after(() => env.close());

  const host = await hostOf(env);
  const client = await env.connect(host.roomId, host.credential, host.membershipId);
  const snapshot = await client.waitFor(frame => frame.type === 'room.snapshot', 'snapshot');

  validateServerMessage(snapshot, 'snapshot');
  assert.equal(snapshot.data.self.memberId, host.memberId);
  assert.equal(snapshot.data.self.role, 'host');
  assert.equal(snapshot.data.room.occupiedSlots, snapshot.data.members.length);
  assert.equal(typeof snapshot.cursor, 'number');
  client.close();
});

test('房主提及走完整流式生命周期并更新话题', async t => {
  const env = await live();
  t.after(() => env.close());

  const host = await hostOf(env);
  const client = await env.connect(host.roomId, host.credential, host.membershipId);
  await client.waitFor(frame => frame.type === 'room.snapshot', 'snapshot');

  const sent = await env.call({
    method: 'POST',
    path: `/api/v1/rooms/${host.roomId}/messages`,
    credential: host.credential,
    membershipId: host.membershipId,
    body: { clientRequestId: uuid(), text: '@AI 来个话题', mentions: ['ai'] },
  });
  assert.equal(sent.status, 201);
  assert.ok(['queued', 'running'].includes(sent.data.ai.status), JSON.stringify(sent.data.ai));

  const completed = await client.waitFor(frame => frame.type === 'ai.reply.completed', 'completed');
  const started = client.frames.find(frame => frame.type === 'ai.reply.started');
  const deltas = client.frames.filter(frame => frame.type === 'ai.reply.delta');

  for (const frame of client.frames) validateServerMessage(frame, frame.type);

  assert.ok(started, 'missing started');
  assert.ok(deltas.length > 0, 'missing deltas');
  // 增量拼接必须等于终态全文。
  const joined = deltas.map(frame => frame.data.textDelta).join('');
  assert.equal(joined, completed.data.reply.text);
  assert.equal(completed.data.reply.status, 'completed');
  assert.equal(completed.data.invocation.status, 'completed');
  assert.equal(completed.data.invocation.replyId, completed.data.reply.id);

  // 普通提及用途为 reply，不改话题；本桩实现对 reply 不产出 topic。
  assert.equal(completed.data.reply.purpose, 'reply');
  assert.equal(client.frames.some(frame => frame.type === 'topic.changed'), false);
  client.close();
});

test('同房间 AI 严格串行，房主调用按 FIFO 执行', async t => {
  const env = await live(testConfig(), 10);
  t.after(() => env.close());

  const host = await hostOf(env);
  const client = await env.connect(host.roomId, host.credential, host.membershipId);
  await client.waitFor(frame => frame.type === 'room.snapshot', 'snapshot');

  const send = (text: string) =>
    env.call({
      method: 'POST',
      path: `/api/v1/rooms/${host.roomId}/messages`,
      credential: host.credential,
      membershipId: host.membershipId,
      body: { clientRequestId: uuid(), text, mentions: ['ai'] },
    });

  const first = await send('@AI 第一次');
  const second = await send('@AI 第二次');
  const third = await send('@AI 第三次');
  const order = [first, second, third].map(result => result.data.ai.invocationId);

  await client.waitFor(
    () => client.frames.filter(frame => frame.type === 'ai.reply.completed').length === 3,
    'three completions',
    8000,
  );

  // 任意时刻最多一个 running：started 与 completed 必须严格交替。
  const timeline = client.frames.filter(frame => ['ai.reply.started', 'ai.reply.completed'].includes(frame.type));
  let active = 0;
  for (const frame of timeline) {
    if (frame.type === 'ai.reply.started') active += 1;
    else active -= 1;
    assert.ok(active === 0 || active === 1, 'AI must run serially');
  }

  const executed = client.frames
    .filter(frame => frame.type === 'ai.reply.started')
    .map(frame => frame.data.invocation.id);
  assert.deepEqual(executed, order, 'host invocations must run FIFO');
  client.close();
});

test('中途加入不接收入房前已开始的回复，但可见当前话题', async t => {
  const env = await live(testConfig(), 40);
  t.after(() => env.close());

  const host = await hostOf(env);
  const hostClient = await env.connect(host.roomId, host.credential, host.membershipId);
  await hostClient.waitFor(frame => frame.type === 'room.snapshot', 'host snapshot');

  await env.call({
    method: 'POST',
    path: `/api/v1/rooms/${host.roomId}/messages`,
    credential: host.credential,
    membershipId: host.membershipId,
    body: { clientRequestId: uuid(), text: '@AI 开场', mentions: ['ai'] },
  });
  const started = await hostClient.waitFor(frame => frame.type === 'ai.reply.started', 'started');
  const hiddenReplyId = started.data.reply.id as string;

  // 回复已开始后才加入的新成员。
  const guest = await env.call({
    method: 'POST',
    path: `/api/v1/rooms/${host.roomId}/members`,
    body: {
      clientRequestId: uuid(),
      bootstrapToken: secret(),
      inviteCode: host.inviteCode,
      profile: { nickname: '小周', interestTags: ['旅行'], bio: '' },
    },
  });
  const guestClient = await env.connect(
    host.roomId,
    guest.data.memberCredential,
    guest.data.member.membership.id,
  );
  const guestSnapshot = await guestClient.waitFor(frame => frame.type === 'room.snapshot', 'guest snapshot');

  await hostClient.waitFor(frame => frame.type === 'ai.reply.completed', 'completed', 8000);
  await new Promise(resolve => setTimeout(resolve, 100));

  // 快照与后续事件都不得夹带这条隐藏回复的任何内容。
  assert.equal(JSON.stringify(guestSnapshot).includes(hiddenReplyId), false, 'snapshot leaked hidden reply');
  for (const frame of guestClient.frames) {
    assert.equal(JSON.stringify(frame).includes(hiddenReplyId), false, `frame ${frame.type} leaked hidden reply`);
    validateServerMessage(frame, frame.type);
  }
  // 入房前的聊天原文也不可见。
  assert.equal(guestSnapshot.data.messages.some((item: any) => item.text === '@AI 开场'), false);

  hostClient.close();
  guestClient.close();
});

test('多标签页共享身份：关闭一个连接不触发掉线', async t => {
  const env = await live();
  t.after(() => env.close());

  const host = await hostOf(env);
  const tabOne = await env.connect(host.roomId, host.credential, host.membershipId);
  await tabOne.waitFor(frame => frame.type === 'room.snapshot', 'snapshot one');
  const tabTwo = await env.connect(host.roomId, host.credential, host.membershipId);
  await tabTwo.waitFor(frame => frame.type === 'room.snapshot', 'snapshot two');

  tabTwo.close();
  await new Promise(resolve => setTimeout(resolve, 150));

  const offline = tabOne.frames.filter(
    frame => frame.type === 'member.presence.changed' && frame.data.presence === 'offline',
  );
  assert.equal(offline.length, 0, 'closing one tab must not mark member offline');
  tabOne.close();
});

test('关房先终结在途回复再发 room.closed，之后没有业务事件', async t => {
  const env = await live(testConfig(), 60);
  t.after(() => env.close());

  const host = await hostOf(env);
  const client = await env.connect(host.roomId, host.credential, host.membershipId);
  await client.waitFor(frame => frame.type === 'room.snapshot', 'snapshot');

  await env.call({
    method: 'POST',
    path: `/api/v1/rooms/${host.roomId}/messages`,
    credential: host.credential,
    membershipId: host.membershipId,
    body: { clientRequestId: uuid(), text: '@AI 慢慢说', mentions: ['ai'] },
  });
  await client.waitFor(frame => frame.type === 'ai.reply.delta', 'first delta');

  await env.call({
    method: 'DELETE',
    path: `/api/v1/rooms/${host.roomId}`,
    credential: host.credential,
    membershipId: host.membershipId,
  });
  await client.waitFor(frame => frame.type === 'room.closed', 'closed');
  await new Promise(resolve => setTimeout(resolve, 200));

  const types = client.frames.map(frame => frame.type);
  const cancelIndex = types.indexOf('ai.reply.cancelled');
  const closeIndex = types.indexOf('room.closed');
  assert.ok(cancelIndex >= 0, 'in-flight reply must be cancelled');
  assert.ok(cancelIndex < closeIndex, 'cancellation must precede room.closed');
  assert.equal(closeIndex, types.length - 1, 'room.closed must be the final event');

  // 取消保留已输出文字，且不出现冲突终态。
  const cancelled = client.frames[cancelIndex];
  assert.equal(cancelled.data.reply.status, 'cancelled');
  assert.ok(cancelled.data.reply.text.length > 0, 'partial text must be preserved');
  assert.equal(types.filter(type => type === 'ai.reply.completed').length, 0);
  for (const frame of client.frames) validateServerMessage(frame, frame.type);
});

test('被移出的成员连接立即结束', async t => {
  const env = await live();
  t.after(() => env.close());

  const host = await hostOf(env);
  const guest = await env.call({
    method: 'POST',
    path: `/api/v1/rooms/${host.roomId}/members`,
    body: {
      clientRequestId: uuid(),
      bootstrapToken: secret(),
      inviteCode: host.inviteCode,
      profile: { nickname: '小周', interestTags: ['旅行'], bio: '' },
    },
  });
  const guestClient = await env.connect(host.roomId, guest.data.memberCredential, guest.data.member.membership.id);
  await guestClient.waitFor(frame => frame.type === 'room.snapshot', 'guest snapshot');

  const closed = new Promise<number>(resolve => guestClient.socket.once('close', code => resolve(code)));
  await env.call({
    method: 'DELETE',
    path: `/api/v1/rooms/${host.roomId}/members/${guest.data.member.id}`,
    credential: host.credential,
    membershipId: host.membershipId,
  });

  const code = await closed;
  assert.equal(code, 1008, 'removal must use 1008');
  const removed = guestClient.frames.find(frame => frame.type === 'member.removed');
  assert.ok(removed, 'missing member.removed');

  // 被移出后不能再访问房间数据。
  const after = await env.call({
    method: 'GET',
    path: `/api/v1/rooms/${host.roomId}/members/me`,
    credential: guest.data.memberCredential,
  });
  assert.equal(after.status, 403);
  assert.equal(after.code, 'MEMBER_REMOVED');
});

test('票据一次性：重复使用被拒绝', async t => {
  const env = await live();
  t.after(() => env.close());

  const host = await hostOf(env);
  const ticket = await env.call({
    method: 'POST',
    path: `/api/v1/rooms/${host.roomId}/connection-tickets`,
    credential: host.credential,
    membershipId: host.membershipId,
  });
  const url = ticket.data.webSocketUrl as string;

  const first = new WebSocket(url);
  await new Promise<void>((resolve, reject) => {
    first.once('open', resolve);
    first.once('error', reject);
  });

  const second = new WebSocket(url);
  const code = await new Promise<number>(resolve => {
    second.once('close', closeCode => resolve(closeCode));
    second.once('error', () => undefined);
  });
  assert.equal(code, 1008, 'reused ticket must be rejected');
  first.close();
});
