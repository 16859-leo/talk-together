import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHost, harness, joinGuest, testConfig, uuid } from './helpers.ts';
import { createStubCapability } from '../src/application/capability.ts';

/** 冷场调度是纯函数式判定，用注入时间戳驱动，不依赖真实等待。 */
const idleConfig = () =>
  testConfig({ idle: { topicMs: 45_000, invitationMs: 30_000, tickMs: 3_600_000 } });

test('冷场只会补话题，不会自动点名邀答', async t => {
  const h = await harness(idleConfig());
  t.after(() => h.close());

  const host = await createHost(h);
  const service = (h.app as any).roomService;
  const ai = service.aiService(host.roomId);
  const room = service.authenticate(host.roomId, host.credential).room;

  // 已有当前话题、持续冷场：应换话题，而不是点名某个人。
  room.currentTopic = {
    id: 'topic_solo',
    title: '热门话题',
    content: '聊聊最近的热门话题',
    kind: 'popular',
    sourceLabel: null,
    sourceUrl: null,
    publishedAt: new Date().toISOString(),
  };
  const base = Date.now();
  room.lastMemberMessageAt = base;
  room.lastAutoAt = base;

  const fired = ai.tickIdle(base + 46_000);
  assert.ok(fired, '持续冷场应发起自动补话');
  assert.equal(fired.purpose, 'topic', '自动补话只能是话题，不能点名邀答');
  assert.equal(fired.invitedMemberId, null, '自动补话不能指定成员');
});

test('冷场达到阈值先自动选题，且自动调用不带 caller', async t => {
  const h = await harness(idleConfig());
  t.after(() => h.close());

  const host = await createHost(h);
  await joinGuest(h, host.roomId, host.inviteCode, '小周');
  const service = (h.app as any).roomService;
  const ai = service.aiService(host.roomId);
  const room = service.authenticate(host.roomId, host.credential).room;

  const base = Date.now();
  room.lastMemberMessageAt = base;

  // 未达阈值不触发。
  assert.equal(ai.tickIdle(base + 44_000), null);

  const fired = ai.tickIdle(base + 46_000);
  assert.ok(fired, '应触发自动选题');
  assert.equal(fired.source, 'automatic');
  assert.equal(fired.purpose, 'topic');
  assert.equal(fired.callerMemberId, null);
  assert.equal(fired.clientRequestId, null);
  assert.equal(fired.triggerMessageId, null);
});

test('自动触发遇忙直接跳过，不进入等待队列', async t => {
  const h = await harness(idleConfig());
  t.after(() => h.close());

  const host = await createHost(h);
  await joinGuest(h, host.roomId, host.inviteCode, '小周');
  const service = (h.app as any).roomService;
  const ai = service.aiService(host.roomId);
  const room = service.authenticate(host.roomId, host.credential).room;

  const base = Date.now();
  room.lastMemberMessageAt = base;
  const first = ai.tickIdle(base + 46_000);
  assert.ok(first);

  const queueLength = room.queue.length;
  const skipped = ai.tickIdle(base + 50_000);
  assert.equal(skipped, null, '遇忙必须跳过');
  assert.equal(room.queue.length, queueLength, '跳过不得改变队列长度');
});

test('已有话题时冷场继续换话题，不会点名成员', async t => {
  const h = await harness(idleConfig());
  t.after(() => h.close());

  const host = await createHost(h);
  await joinGuest(h, host.roomId, host.inviteCode, '小周');
  const service = (h.app as any).roomService;
  const ai = service.aiService(host.roomId);
  const room = service.authenticate(host.roomId, host.credential).room;

  room.currentTopic = {
    id: 'topic_x',
    title: '最近看过的电影',
    content: '聊聊最近看过的电影',
    kind: 'popular',
    sourceLabel: null,
    sourceUrl: null,
    publishedAt: new Date().toISOString(),
  };

  const base = Date.now();
  room.lastMemberMessageAt = base;
  room.lastAutoAt = base;

  const first = ai.tickIdle(base + 46_000);
  assert.ok(first, '应触发换话题');
  assert.equal(first.purpose, 'topic');
  assert.equal(first.invitedMemberId, null);

  // 同一轮冷却之后再冷场，仍然只是换话题。
  room.running = null;
  room.queue = [];
  room.lastAutoAt = base;
  const second = ai.tickIdle(base + 50_000);
  assert.equal(second?.purpose, 'topic', '第二次冷场仍然只换话题');
  assert.equal(second?.invitedMemberId, null, '任何自动触发都不能点名');
});

test('点名邀答只由房主发起：没「邀请」不算，成员发起被忽略', async t => {
  const h = await harness(idleConfig());
  t.after(() => h.close());

  const host = await createHost(h);
  const guest = await joinGuest(h, host.roomId, host.inviteCode, '小美');
  const service = (h.app as any).roomService;
  const room = service.authenticate(host.roomId, host.credential).room;

  const hostSay = (text: string) =>
    h.call({
      method: 'POST',
      url: `/api/v1/rooms/${host.roomId}/messages`,
      credential: host.credential,
      membershipId: host.membershipId,
      body: { clientRequestId: uuid(), text, mentions: ['ai'] },
    });

  // 提到成员昵称，但没有邀请语气：按普通回复处理，不点名。
  const plain = await hostSay('@AI 小美最近在忙什么');
  const plainInvocation = [...room.invocations.values()].find(
    invocation => invocation.id === plain.data.ai.invocationId,
  );
  assert.equal(plainInvocation?.purpose, 'reply');
  assert.equal(plainInvocation?.invitedMemberId, null);

  // 房主明确点名：走 invitation，目标是这位成员。
  const invited = await hostSay('@AI 邀请小美聊聊电影');
  const invitation = [...room.invocations.values()].find(
    invocation => invocation.id === invited.data.ai.invocationId,
  );
  assert.equal(invitation?.purpose, 'invitation');
  assert.equal(invitation?.invitedMemberId, guest.data.member.id);

  // 普通成员发起点名：整条忽略（AI 不受理）。
  const guestSay = await h.call({
    method: 'POST',
    url: `/api/v1/rooms/${host.roomId}/messages`,
    credential: guest.data.memberCredential,
    membershipId: guest.data.member.membership.id,
    body: { clientRequestId: uuid(), text: '@AI 邀请房主聊聊', mentions: ['ai'] },
  });
  assert.equal(guestSay.data.ai.status, 'ignored');
});

test('房主掉线暂停自动触发，恢复后继续', async t => {
  const h = await harness(idleConfig());
  t.after(() => h.close());

  const host = await createHost(h);
  await joinGuest(h, host.roomId, host.inviteCode, '小周');
  const service = (h.app as any).roomService;
  const ai = service.aiService(host.roomId);
  const room = service.authenticate(host.roomId, host.credential).room;

  const base = Date.now();
  room.lastMemberMessageAt = base;

  ai.setAutoPaused(true);
  assert.equal(ai.tickIdle(base + 60_000), null, '房主掉线期间不得自动触发');

  ai.setAutoPaused(false);
  assert.ok(ai.tickIdle(base + 60_000), '恢复后应继续自动触发');
});

test('成员发言重置冷场计时，AI 发言不重置', async t => {
  const h = await harness(idleConfig());
  t.after(() => h.close());

  const host = await createHost(h);
  await joinGuest(h, host.roomId, host.inviteCode, '小周');
  const service = (h.app as any).roomService;
  const room = service.authenticate(host.roomId, host.credential).room;
  const before = room.lastMemberMessageAt;

  await new Promise(resolve => setTimeout(resolve, 20));
  await h.call({
    method: 'POST',
    url: `/api/v1/rooms/${host.roomId}/messages`,
    credential: host.credential,
    membershipId: host.membershipId,
    body: { clientRequestId: uuid(), text: '我来说两句' },
  });
  assert.ok(room.lastMemberMessageAt > before, '成员发言必须重置计时');
});

test('AI 零文本输出落 failed 而非 completed', async t => {
  // 契约要求 completed 的 text 为非空，空输出只能是 failed。
  const silent = {
    name: 'silent',
    // eslint-disable-next-line require-yield
    async *run() {
      return;
    },
  };
  const h = await harness(testConfig(), silent as never);
  t.after(() => h.close());

  const host = await createHost(h);
  const sent = await h.call({
    method: 'POST',
    url: `/api/v1/rooms/${host.roomId}/messages`,
    credential: host.credential,
    membershipId: host.membershipId,
    body: { clientRequestId: uuid(), text: '@AI 说点什么', mentions: ['ai'] },
  });
  assert.equal(sent.status, 201);

  await new Promise(resolve => setTimeout(resolve, 150));
  const service = (h.app as any).roomService;
  const room = service.authenticate(host.roomId, host.credential).room;
  const invocation = [...room.invocations.values()][0] as any;
  assert.equal(invocation.status, 'failed');
  assert.equal(invocation.error.code, 'AI_PROVIDER_ERROR');
  assert.equal(invocation.expiresAt, null, '终态必须清空 expiresAt');
  assert.equal(invocation.queuePosition, null, '终态必须清空 queuePosition');
});

test('AI 队列满时拒绝新调用但不影响聊天', async t => {
  const h = await harness(testConfig({ aiQueueLimit: 1 }), createStubCapability({ delayMs: 40 }));
  t.after(() => h.close());

  const host = await createHost(h);
  const send = (text: string) =>
    h.call({
      method: 'POST',
      url: `/api/v1/rooms/${host.roomId}/messages`,
      credential: host.credential,
      membershipId: host.membershipId,
      body: { clientRequestId: uuid(), text, mentions: ['ai'] },
    });

  const results = [await send('@AI 一'), await send('@AI 二'), await send('@AI 三')];
  const rejected = results.filter(result => result.data.ai.status === 'rejected');
  assert.ok(rejected.length > 0, '队列满后必须出现 rejected');
  assert.equal(rejected[0]!.data.ai.error.code, 'AI_QUEUE_FULL');

  // AI 未受理不回滚合法聊天。
  for (const result of results) {
    assert.equal(result.status, 201);
    assert.ok(result.data.message.id, '聊天消息必须照常发布');
  }
});

test('并发抢最后一个名额只能成功一人', async t => {
  // capacity 在契约中是常量 5，不可配置；先填满 4 人再并发抢第 5 个名额。
  const h = await harness();
  t.after(() => h.close());

  const host = await createHost(h);
  for (const name of ['小周', '小陈', '小吴']) {
    const joined = await joinGuest(h, host.roomId, host.inviteCode, name);
    assert.equal(joined.status, 201, `${name} 应先入房成功`);
  }

  const attempts = await Promise.all(
    ['小郑', '小孙', '小李'].map(name => joinGuest(h, host.roomId, host.inviteCode, name)),
  );
  const succeeded = attempts.filter(result => result.status === 201);
  const full = attempts.filter(result => result.code === 'ROOM_FULL');
  assert.equal(succeeded.length, 1, '只剩一个名额时只能成功一人');
  assert.equal(full.length, 2);
});

test('同 clientRequestId 并发提交只产生一条消息', async t => {
  const h = await harness();
  t.after(() => h.close());

  const host = await createHost(h);
  const requestId = uuid();
  const body = { clientRequestId: requestId, text: '并发同一条' };

  const results = await Promise.all(
    Array.from({ length: 5 }, () =>
      h.call({
        method: 'POST',
        url: `/api/v1/rooms/${host.roomId}/messages`,
        credential: host.credential,
        membershipId: host.membershipId,
        body,
      }),
    ),
  );

  const ids = new Set(results.map(result => result.data.message.id));
  assert.equal(ids.size, 1, '幂等提交只能产生一条消息');

  const service = (h.app as any).roomService;
  const room = service.authenticate(host.roomId, host.credential).room;
  assert.equal(room.messages.length, 1);
});

test('已退出身份重新加入获得新 membershipId', async t => {
  const h = await harness();
  t.after(() => h.close());

  const host = await createHost(h);
  const guest = await joinGuest(h, host.roomId, host.inviteCode, '小周');
  const firstMembership = guest.data.member.membership.id as string;

  await h.call({
    method: 'DELETE',
    url: `/api/v1/rooms/${host.roomId}/members/me`,
    credential: guest.data.memberCredential,
    membershipId: firstMembership,
  });

  const rejoined = await h.call({
    method: 'POST',
    url: `/api/v1/rooms/${host.roomId}/members`,
    credential: guest.data.memberCredential,
    body: {
      clientRequestId: uuid(),
      inviteCode: host.inviteCode,
      profile: { nickname: '小周', interestTags: ['旅行'], bio: '' },
    },
  });
  assert.equal(rejoined.status, 201);
  assert.notEqual(rejoined.data.member.membership.id, firstMembership, '重新加入必须换 membershipId');
  assert.equal(rejoined.data.member.id, guest.data.member.id, 'memberId 必须稳定');
});

test('旧入房标识的操作被拒绝', async t => {
  const h = await harness();
  t.after(() => h.close());

  const host = await createHost(h);
  const guest = await joinGuest(h, host.roomId, host.inviteCode, '小周');
  const oldMembership = guest.data.member.membership.id as string;

  await h.call({
    method: 'DELETE',
    url: `/api/v1/rooms/${host.roomId}/members/me`,
    credential: guest.data.memberCredential,
    membershipId: oldMembership,
  });
  await h.call({
    method: 'POST',
    url: `/api/v1/rooms/${host.roomId}/members`,
    credential: guest.data.memberCredential,
    body: {
      clientRequestId: uuid(),
      inviteCode: host.inviteCode,
      profile: { nickname: '小周', interestTags: ['旅行'], bio: '' },
    },
  });

  // 旧标签页拿着旧 membershipId 操作新入房。
  const stale = await h.call({
    method: 'POST',
    url: `/api/v1/rooms/${host.roomId}/messages`,
    credential: guest.data.memberCredential,
    membershipId: oldMembership,
    body: { clientRequestId: uuid(), text: '旧标签页发言' },
  });
  assert.equal(stale.status, 409);
  assert.equal(stale.code, 'MEMBERSHIP_CHANGED');
});
