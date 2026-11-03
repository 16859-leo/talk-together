import assert from 'node:assert/strict';
import { test } from 'node:test';
import { WebSocket } from 'ws';
import { build } from '../src/app.ts';
import { createStubCapability } from '../src/application/capability.ts';
import { testConfig, uuid, secret, validateServerMessage } from './helpers.ts';
import type { Config } from '../src/config.ts';

/**
 * 掉线恢复与超时关房依赖真实定时器，因此把恢复期压缩到百毫秒级。
 * 等待时留足余量，避免偶发失败。
 */
const live = async (config: Config, delayMs = 10) => {
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

  const connect = async (roomId: string, credential: string, membershipId: string) => {
    const ticket = await call({
      method: 'POST',
      path: `/api/v1/rooms/${roomId}/connection-tickets`,
      credential,
      membershipId,
    });
    assert.equal(ticket.status, 201, JSON.stringify(ticket));
    const socket = new WebSocket(ticket.data.webSocketUrl);
    const frames: any[] = [];
    socket.on('message', raw => frames.push(JSON.parse(String(raw))));
    await new Promise<void>((resolve, reject) => {
      socket.once('open', resolve);
      socket.once('error', reject);
    });
    return { socket, frames, close: () => socket.close() };
  };

  const host = async (nickname = '小林') => {
    const created = await call({
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

  const guest = async (roomId: string, inviteCode: string, nickname: string) => {
    const joined = await call({
      method: 'POST',
      path: `/api/v1/rooms/${roomId}/members`,
      body: {
        clientRequestId: uuid(),
        bootstrapToken: secret(),
        inviteCode,
        profile: { nickname, interestTags: ['旅行'], bio: '' },
      },
    });
    return {
      memberId: joined.data.member.id as string,
      membershipId: joined.data.member.membership.id as string,
      credential: joined.data.memberCredential as string,
    };
  };

  return { app, call, connect, host, guest, close: () => app.close() };
};

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

test('普通成员掉线进入 offline 并保留名额，期限内重连恢复原 membership', async t => {
  const env = await live(testConfig({ recoveryMs: 1_500 }));
  t.after(() => env.close());

  const host = await env.host();
  const guest = await env.guest(host.roomId, host.inviteCode, '小周');
  const hostClient = await env.connect(host.roomId, host.credential, host.membershipId);
  const guestClient = await env.connect(host.roomId, guest.credential, guest.membershipId);
  await sleep(80);

  guestClient.close();
  await sleep(150);

  const offline = hostClient.frames.find(
    frame => frame.type === 'member.presence.changed' && frame.data.presence === 'offline',
  );
  assert.ok(offline, '掉线必须广播 offline');
  assert.equal(offline.data.membershipId, guest.membershipId);
  assert.ok(offline.data.recoveryExpiresAt, 'offline 必须带恢复期限');
  // 恢复期内不释放名额。
  assert.equal(
    hostClient.frames.some(frame => frame.type === 'member.left'),
    false,
    '恢复期内不得释放名额',
  );

  // 期限内以原 membership 重连。
  const rejoined = await env.connect(host.roomId, guest.credential, guest.membershipId);
  await sleep(120);
  const online = hostClient.frames.filter(
    frame => frame.type === 'member.presence.changed' && frame.data.presence === 'online',
  );
  assert.ok(
    online.some(frame => frame.data.membershipId === guest.membershipId),
    '重连必须恢复 online',
  );

  const snapshot = rejoined.frames.find(frame => frame.type === 'room.snapshot');
  assert.equal(snapshot.data.self.membershipId, guest.membershipId, '恢复期内 membershipId 不变');
  for (const frame of hostClient.frames) validateServerMessage(frame, frame.type);

  hostClient.close();
  rejoined.close();
});

test('普通成员恢复超时释放名额，member.left 的 reason 为 timeout', async t => {
  const env = await live(testConfig({ recoveryMs: 400 }));
  t.after(() => env.close());

  const host = await env.host();
  const guest = await env.guest(host.roomId, host.inviteCode, '小周');
  const hostClient = await env.connect(host.roomId, host.credential, host.membershipId);
  const guestClient = await env.connect(host.roomId, guest.credential, guest.membershipId);
  await sleep(80);

  guestClient.close();
  await sleep(900);

  const left = hostClient.frames.find(frame => frame.type === 'member.left');
  assert.ok(left, '超时必须释放名额');
  assert.equal(left.data.reason, 'timeout');
  assert.equal(left.data.membershipId, guest.membershipId);

  // 身份仍保留，但 membership 为空。
  const self = await env.call({
    method: 'GET',
    path: `/api/v1/rooms/${host.roomId}/members/me`,
    credential: guest.credential,
  });
  assert.equal(self.status, 200);
  assert.equal(self.data.member.membership, null, '超时退出后 membership 必须为空');
  for (const frame of hostClient.frames) validateServerMessage(frame, frame.type);
  hostClient.close();
});

test('房主掉线广播 host_reconnecting，恢复后回到 open', async t => {
  const env = await live(testConfig({ hostRecoveryMs: 1_500 }));
  t.after(() => env.close());

  const host = await env.host();
  const guest = await env.guest(host.roomId, host.inviteCode, '小周');
  const guestClient = await env.connect(host.roomId, guest.credential, guest.membershipId);
  const hostClient = await env.connect(host.roomId, host.credential, host.membershipId);
  await sleep(80);

  hostClient.close();
  await sleep(150);

  const reconnecting = guestClient.frames.find(
    frame => frame.type === 'room.updated' && frame.data.status === 'host_reconnecting',
  );
  assert.ok(reconnecting, '房主掉线必须广播 host_reconnecting');
  assert.ok(reconnecting.data.hostRecoveryExpiresAt, '必须带房主恢复期限');

  // 房间未关闭，公共聊天继续。
  const stillAlive = await env.call({
    method: 'POST',
    path: `/api/v1/rooms/${host.roomId}/messages`,
    credential: guest.credential,
    membershipId: guest.membershipId,
    body: { clientRequestId: uuid(), text: '房主不在也能聊' },
  });
  assert.equal(stillAlive.status, 201, '房主掉线期间公共聊天必须继续');

  // 房主恢复。
  const restored = await env.connect(host.roomId, host.credential, host.membershipId);
  await sleep(150);
  const reopened = guestClient.frames.find(
    frame => frame.type === 'room.updated' && frame.data.status === 'open',
  );
  assert.ok(reopened, '房主恢复后必须回到 open');
  assert.equal(reopened.data.hostRecoveryExpiresAt, null);

  const snapshot = restored.frames.find(frame => frame.type === 'room.snapshot');
  assert.equal(snapshot.data.self.membershipId, host.membershipId, '房主恢复沿用原 membership');
  for (const frame of guestClient.frames) validateServerMessage(frame, frame.type);

  guestClient.close();
  restored.close();
});

test('房主掉线期间已受理的 AI 调用继续完成', async t => {
  const env = await live(testConfig({ hostRecoveryMs: 2_000 }), 40);
  t.after(() => env.close());

  const host = await env.host();
  const guest = await env.guest(host.roomId, host.inviteCode, '小周');
  const guestClient = await env.connect(host.roomId, guest.credential, guest.membershipId);
  const hostClient = await env.connect(host.roomId, host.credential, host.membershipId);
  await sleep(80);

  await env.call({
    method: 'POST',
    path: `/api/v1/rooms/${host.roomId}/messages`,
    credential: host.credential,
    membershipId: host.membershipId,
    body: { clientRequestId: uuid(), text: '@AI 说点什么', mentions: [{ type: 'ai' }] },
  });
  // 等回复开始后再让房主掉线。
  await sleep(120);
  hostClient.close();

  await sleep(900);
  const completed = guestClient.frames.find(frame => frame.type === 'ai.reply.completed');
  assert.ok(completed, '房主掉线后已受理调用必须继续完成');
  assert.equal(completed.data.invocation.status, 'completed');
  assert.ok(completed.data.reply.text.length > 0);
  guestClient.close();
});

test('房主恢复超时关房：先取消剩余调用，再发 room.closed，reason 为 host_timeout', async t => {
  const env = await live(testConfig({ hostRecoveryMs: 400 }), 200);
  t.after(() => env.close());

  const host = await env.host();
  const guest = await env.guest(host.roomId, host.inviteCode, '小周');
  const guestClient = await env.connect(host.roomId, guest.credential, guest.membershipId);
  const hostClient = await env.connect(host.roomId, host.credential, host.membershipId);
  await sleep(80);

  // 发起一个慢回复，确保关房时它仍在生成中。
  await env.call({
    method: 'POST',
    path: `/api/v1/rooms/${host.roomId}/messages`,
    credential: host.credential,
    membershipId: host.membershipId,
    body: { clientRequestId: uuid(), text: '@AI 慢慢说', mentions: [{ type: 'ai' }] },
  });
  await sleep(250);
  hostClient.close();

  await sleep(1_200);
  const types = guestClient.frames.map(frame => frame.type);
  const closedIndex = types.indexOf('room.closed');
  assert.ok(closedIndex >= 0, '房主恢复超时必须关房');

  const closed = guestClient.frames[closedIndex];
  assert.equal(closed.data.reason, 'host_timeout');
  assert.equal(closedIndex, types.length - 1, 'room.closed 必须是最后一个事件');

  const cancelIndex = types.indexOf('ai.reply.cancelled');
  if (cancelIndex >= 0) {
    assert.ok(cancelIndex < closedIndex, '取消必须先于 room.closed');
  }
  // 关房后每条已开始的回复都必须有终态，不得残留 streaming。
  const startedCount = types.filter(type => type === 'ai.reply.started').length;
  const terminalCount = types.filter(type =>
    ['ai.reply.completed', 'ai.reply.failed', 'ai.reply.cancelled'].includes(type),
  ).length;
  assert.equal(terminalCount, startedCount, '已开始的回复必须全部进入终态');
  for (const frame of guestClient.frames) validateServerMessage(frame, frame.type);

  const after = await env.call({
    method: 'GET',
    path: `/api/v1/rooms/${host.roomId}/members/me`,
    credential: guest.credential,
  });
  assert.equal(after.status, 404, '关房后房间不可访问');
});

test('旧入房的消息重试返回 IDEMPOTENCY_CONTEXT_EXPIRED，不重放旧正文', async t => {
  const env = await live(testConfig());
  t.after(() => env.close());

  const host = await env.host();
  const guest = await env.guest(host.roomId, host.inviteCode, '小周');

  const requestId = uuid();
  const first = await env.call({
    method: 'POST',
    path: `/api/v1/rooms/${host.roomId}/messages`,
    credential: guest.credential,
    membershipId: guest.membershipId,
    body: { clientRequestId: requestId, text: '旧入房说的话' },
  });
  assert.equal(first.status, 201);

  // 退出后重新加入，形成新的一次入房。
  await env.call({
    method: 'DELETE',
    path: `/api/v1/rooms/${host.roomId}/members/me`,
    credential: guest.credential,
    membershipId: guest.membershipId,
  });
  const rejoined = await env.call({
    method: 'POST',
    path: `/api/v1/rooms/${host.roomId}/members`,
    credential: guest.credential,
    body: {
      clientRequestId: uuid(),
      inviteCode: host.inviteCode,
      profile: { nickname: '小周', interestTags: ['旅行'], bio: '' },
    },
  });
  assert.equal(rejoined.status, 201);
  const newMembershipId = rejoined.data.member.membership.id as string;
  assert.notEqual(newMembershipId, guest.membershipId);

  // 用旧请求标识重试：不得重放旧正文。
  const retried = await env.call({
    method: 'POST',
    path: `/api/v1/rooms/${host.roomId}/messages`,
    credential: guest.credential,
    membershipId: newMembershipId,
    body: { clientRequestId: requestId, text: '旧入房说的话' },
  });
  assert.equal(retried.status, 409);
  assert.equal(retried.code, 'IDEMPOTENCY_CONTEXT_EXPIRED');

  // 换新请求标识可以正常发送。
  const fresh = await env.call({
    method: 'POST',
    path: `/api/v1/rooms/${host.roomId}/messages`,
    credential: guest.credential,
    membershipId: newMembershipId,
    body: { clientRequestId: uuid(), text: '新入房说的话' },
  });
  assert.equal(fresh.status, 201);
});
