import assert from 'node:assert/strict';
import { test } from 'node:test';
import { build } from '../src/app.ts';
import { defaultConfig } from '../src/config.ts';
import { createHost, harness, joinGuest, secret, testConfig, uuid } from './helpers.ts';
import type { Capability } from '../src/application/capability.ts';

/** PR #7 第三轮 review 的 4 项 P2 回归测试。 */

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// =============================== R3-1 首次入房请求 ID 也要记归属

test('[R3-1] 匿名首次加入后退出，复用该请求 ID 携带 Bearer 重入被拒', async t => {
  const h = await harness();
  t.after(() => h.close());

  const host = await createHost(h);
  const firstRequestId = uuid();

  const joined = await h.call({
    method: 'POST',
    url: `/api/v1/rooms/${host.roomId}/members`,
    body: {
      clientRequestId: firstRequestId,
      bootstrapToken: secret(),
      inviteCode: host.inviteCode,
      profile: { nickname: '小周', interestTags: ['旅行'], bio: '' },
    },
  });
  assert.equal(joined.status, 201);
  const credential = joined.data.memberCredential as string;

  await h.call({
    method: 'DELETE',
    url: `/api/v1/rooms/${host.roomId}/members/me`,
    credential,
    membershipId: joined.data.member.membership.id,
  });

  // 携带 Bearer 复用首次加入的请求 ID：此前会返回 201 并撤销退出。
  const stale = await h.call({
    method: 'POST',
    url: `/api/v1/rooms/${host.roomId}/members`,
    credential,
    body: {
      clientRequestId: firstRequestId,
      inviteCode: host.inviteCode,
      profile: { nickname: '小周', interestTags: ['旅行'], bio: '' },
    },
  });
  assert.equal(stale.status, 409, `首次请求 ID 重新创建了入房：${JSON.stringify(stale)}`);
  assert.equal(stale.code, 'IDEMPOTENCY_CONTEXT_EXPIRED');

  const self = await h.call({
    method: 'GET',
    url: `/api/v1/rooms/${host.roomId}/members/me`,
    credential,
  });
  assert.equal(self.data.member.membership, null, '退出状态被旧请求撤销');
});

test('[R3-1] 房主建房请求 ID 同样不可用于重入', async t => {
  const h = await harness();
  t.after(() => h.close());

  const requestId = uuid();
  const created = await h.call({
    method: 'POST',
    url: '/api/v1/rooms',
    body: {
      clientRequestId: requestId,
      bootstrapToken: secret(),
      profile: { nickname: '小林', interestTags: ['阅读'], bio: '' },
    },
  });
  const roomId = created.data.room.id as string;
  const credential = created.data.memberCredential as string;
  const inviteCode = created.data.room.invitation.inviteCode as string;

  // 房主退出会关房，所以换个场景：普通成员用建房者的请求 ID 无影响，
  // 这里验证房主自身的请求 ID 已被记录。
  const service = (h.app as any).roomService;
  const recorded = (service as any).rejoinRequests.has(`${credential}:${requestId}`);
  assert.equal(recorded, true, '建房请求 ID 未记录归属');
  assert.ok(roomId && inviteCode);
});

// =============================== R3-2 无话题分支也要检查冷却

test('[R3-2] 首次自动选题失败后遵守冷却，不会每轮重试', async t => {
  const failing: Capability = {
    name: 'failing',
    // eslint-disable-next-line require-yield
    async *run() {
      throw new Error('provider down');
    },
  };
  const h = await harness(
    testConfig({ idle: { topicMs: 200, invitationMs: 100, tickMs: 3_600_000 } }),
    failing,
  );
  t.after(() => h.close());

  const host = await createHost(h);
  const service = (h.app as any).roomService;
  const ai = service.aiService(host.roomId);
  const room = service.authenticate(host.roomId, host.credential).room;
  for (const member of room.members.values()) {
    if (member.membership) member.membership.presence = 'online';
  }

  room.lastMemberMessageAt = Date.now() - 10_000;
  const first = ai.tickIdle();
  assert.ok(first, '应触发首次自动选题');
  await sleep(150);

  // 失败后 currentTopic 仍为空。立刻再轮询不得重试。
  assert.equal(room.currentTopic, null);
  const immediate = ai.tickIdle();
  assert.equal(immediate, null, '失败后立刻重试，未遵守冷却');

  // 冷却期满后才允许再次尝试。
  const later = ai.tickIdle(room.lastAutoAt + 250);
  assert.ok(later, '冷却期满后应可重试');
  assert.notEqual(later.id, first.id);
});

test('[R3-2] 从未自动发话过的房间不被冷却阻塞', async t => {
  const h = await harness(testConfig({ idle: { topicMs: 200, invitationMs: 100, tickMs: 3_600_000 } }));
  t.after(() => h.close());

  const host = await createHost(h);
  const service = (h.app as any).roomService;
  const room = service.authenticate(host.roomId, host.credential).room;
  for (const member of room.members.values()) {
    if (member.membership) member.membership.presence = 'online';
  }
  // lastAutoAt 初始为 0，不应被当成「刚刚发过话」。
  assert.equal(room.lastAutoAt, 0);
  room.lastMemberMessageAt = Date.now() - 10_000;

  const fired = service.aiService(host.roomId).tickIdle();
  assert.ok(fired, '首次自动选题不应被冷却阻塞');
  assert.equal(fired.purpose, 'topic');
});

// =============================== R3-3 票据过期回收与关房清理

test('[R3-3] 关房后未消费票据被清理', async t => {
  const h = await harness();
  t.after(() => h.close());

  const host = await createHost(h);
  const ticket = await h.call({
    method: 'POST',
    url: `/api/v1/rooms/${host.roomId}/connection-tickets`,
    credential: host.credential,
    membershipId: host.membershipId,
  });
  const value = ticket.data.ticket as string;
  const store = (h.app as any).roomService.store;
  assert.ok(store.getTicket(value), '关房前票据应存在');

  await h.call({
    method: 'DELETE',
    url: `/api/v1/rooms/${host.roomId}`,
    credential: host.credential,
    membershipId: host.membershipId,
  });
  assert.equal(store.getTicket(value), undefined, '关房后未消费票据仍残留');
});

test('[R3-3] 过期票据在下次签发时被回收', async t => {
  // 票据有效期设为 0，签发即过期。
  const h = await harness(testConfig({ ticketMs: 0 }));
  t.after(() => h.close());

  const host = await createHost(h);
  const store = (h.app as any).roomService.store;

  const first = await h.call({
    method: 'POST',
    url: `/api/v1/rooms/${host.roomId}/connection-tickets`,
    credential: host.credential,
    membershipId: host.membershipId,
  });
  const stale = first.data.ticket as string;
  await sleep(20);

  // 再次签发时应回收上一张已过期的票据。
  await h.call({
    method: 'POST',
    url: `/api/v1/rooms/${host.roomId}/connection-tickets`,
    credential: host.credential,
    membershipId: host.membershipId,
  });
  assert.equal(store.getTicket(stale), undefined, '过期票据未被回收');
});

test('[R3-3] 过期票据不能用于建连', async t => {
  const h = await harness(testConfig({ ticketMs: 0 }));
  t.after(() => h.close());

  const host = await createHost(h);
  const issued = await h.call({
    method: 'POST',
    url: `/api/v1/rooms/${host.roomId}/connection-tickets`,
    credential: host.credential,
    membershipId: host.membershipId,
  });
  await sleep(20);

  const service = (h.app as any).roomService;
  assert.throws(
    () => service.consumeTicket(host.roomId, issued.data.ticket),
    (error: any) => ['CONNECTION_TICKET_EXPIRED', 'CONNECTION_TICKET_INVALID'].includes(error.code),
  );
});

// =============================== R3-4 保留框架 4xx 语义

test('[R3-4] 请求体过大返回 413 而不是 500', async t => {
  // 把请求体上限压到很小，便于构造 413。
  const app = await build({ config: { ...defaultConfig, port: 0 }, bodyLimit: 256 });
  await app.ready();
  t.after(() => app.close());

  const response = await app.inject({
    method: 'POST',
    url: '/api/v1/rooms',
    headers: { 'content-type': 'application/json' },
    payload: JSON.stringify({
      clientRequestId: uuid(),
      bootstrapToken: secret(),
      profile: { nickname: '小林', interestTags: ['阅读'], bio: 'x'.repeat(2_000) },
    }),
  });
  assert.equal(response.statusCode, 413, `返回 ${response.statusCode}，应保留 413`);
  const payload = response.json() as any;
  assert.notEqual(payload.code, 'INTERNAL_ERROR', '客户端输入问题被误报为服务故障');
});

test('[R3-4] 不支持的 Content-Type 返回 415 而不是 500', async t => {
  const h = await harness();
  t.after(() => h.close());

  // text/plain 是 Fastify 内置解析器（按 400 处理），用未注册的类型才触发 415。
  const response = await h.app.inject({
    method: 'POST',
    url: '/api/v1/rooms',
    headers: { 'content-type': 'application/xml' },
    payload: '<room/>',
  });
  assert.equal(response.statusCode, 415, `返回 ${response.statusCode}，应保留 415`);
  const payload = response.json() as any;
  assert.notEqual(payload.code, 'INTERNAL_ERROR');
});

test('[R3-4] text/plain 走内置解析器，按 400 返回而非 500', async t => {
  const h = await harness();
  t.after(() => h.close());

  const response = await h.app.inject({
    method: 'POST',
    url: '/api/v1/rooms',
    headers: { 'content-type': 'text/plain' },
    payload: 'hello',
  });
  assert.equal(response.statusCode, 400);
  const payload = response.json() as any;
  assert.notEqual(payload.code, 'INTERNAL_ERROR');
});

test('[R3-4] 非法 JSON 仍返回 400', async t => {
  const h = await harness();
  t.after(() => h.close());

  const response = await h.app.inject({
    method: 'POST',
    url: '/api/v1/rooms',
    headers: { 'content-type': 'application/json' },
    payload: '{not json',
  });
  assert.equal(response.statusCode, 400);
  const payload = response.json() as any;
  assert.equal(payload.code, 'VALIDATION_ERROR');
});
