import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHost, harness, joinGuest, secret, testConfig, uuid, validateModel } from './helpers.ts';
import type { Capability } from '../src/application/capability.ts';

/** PR #7 第二轮 review 的 5 项 P2 回归测试。 */

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

const popularTopic = (room: any) => {
  room.currentTopic = {
    id: 'topic_hot',
    title: '热门话题',
    content: '聊聊最近的热门话题',
    kind: 'popular',
    sourceLabel: null,
    sourceUrl: null,
    publishedAt: new Date().toISOString(),
  };
};

// ===================================== R2-1 旧重入请求不得重新创建入房

test('[R2-1] 退出后用旧 clientRequestId 重入被拒绝', async t => {
  const h = await harness();
  t.after(() => h.close());

  const host = await createHost(h);
  const guest = await joinGuest(h, host.roomId, host.inviteCode, '小周');
  const credential = guest.data.memberCredential as string;
  const firstMembership = guest.data.member.membership.id as string;

  // 第一次退出。
  await h.call({
    method: 'DELETE',
    url: `/api/v1/rooms/${host.roomId}/members/me`,
    credential,
    membershipId: firstMembership,
  });

  // 用新请求 ID 重新加入，符合协议。
  const rejoinId = uuid();
  const rejoined = await h.call({
    method: 'POST',
    url: `/api/v1/rooms/${host.roomId}/members`,
    credential,
    body: {
      clientRequestId: rejoinId,
      inviteCode: host.inviteCode,
      profile: { nickname: '小周', interestTags: ['旅行'], bio: '' },
    },
  });
  assert.equal(rejoined.status, 201);
  const secondMembership = rejoined.data.member.membership.id as string;

  // 用户再次退出。
  await h.call({
    method: 'DELETE',
    url: `/api/v1/rooms/${host.roomId}/members/me`,
    credential,
    membershipId: secondMembership,
  });

  // 迟到的网络重试用同一个请求 ID，不得撤销刚完成的退出。
  const stale = await h.call({
    method: 'POST',
    url: `/api/v1/rooms/${host.roomId}/members`,
    credential,
    body: {
      clientRequestId: rejoinId,
      inviteCode: host.inviteCode,
      profile: { nickname: '小周', interestTags: ['旅行'], bio: '' },
    },
  });
  assert.equal(stale.status, 409, `旧请求重新创建了入房：${JSON.stringify(stale)}`);
  assert.equal(stale.code, 'IDEMPOTENCY_CONTEXT_EXPIRED');

  // 确认仍处于已退出状态。
  const self = await h.call({
    method: 'GET',
    url: `/api/v1/rooms/${host.roomId}/members/me`,
    credential,
  });
  assert.equal(self.data.member.membership, null, '退出状态被旧请求撤销');
});

test('[R2-1] 换新请求 ID 仍可正常重入', async t => {
  const h = await harness();
  t.after(() => h.close());

  const host = await createHost(h);
  const guest = await joinGuest(h, host.roomId, host.inviteCode, '小周');
  const credential = guest.data.memberCredential as string;

  await h.call({
    method: 'DELETE',
    url: `/api/v1/rooms/${host.roomId}/members/me`,
    credential,
    membershipId: guest.data.member.membership.id,
  });
  const again = await h.call({
    method: 'POST',
    url: `/api/v1/rooms/${host.roomId}/members`,
    credential,
    body: {
      clientRequestId: uuid(),
      inviteCode: host.inviteCode,
      profile: { nickname: '小周', interestTags: ['旅行'], bio: '' },
    },
  });
  assert.equal(again.status, 201);
  validateModel('RoomEntryData', again.data, 'rejoin');
});

// ================================= R2-2 重放首次入房结果前检查资格

test('[R2-2] 已退出成员的 bootstrap 重放不再声称入房成功', async t => {
  const h = await harness();
  t.after(() => h.close());

  const host = await createHost(h);
  const token = secret();
  const requestId = uuid();
  const body = {
    clientRequestId: requestId,
    bootstrapToken: token,
    inviteCode: host.inviteCode,
    profile: { nickname: '小周', interestTags: ['旅行'], bio: '' },
  };

  const joined = await h.call({ method: 'POST', url: `/api/v1/rooms/${host.roomId}/members`, body });
  assert.equal(joined.status, 201);
  const credential = joined.data.memberCredential as string;

  await h.call({
    method: 'DELETE',
    url: `/api/v1/rooms/${host.roomId}/members/me`,
    credential,
    membershipId: joined.data.member.membership.id,
  });

  // 重放原始 bootstrap 请求：此前返回 201 且 membership 为 null，违反 RoomEntryData。
  const replay = await h.call({ method: 'POST', url: `/api/v1/rooms/${host.roomId}/members`, body });
  assert.notEqual(replay.status, 201, `重放返回 201：${JSON.stringify(replay)}`);
  assert.equal(replay.code, 'IDEMPOTENCY_CONTEXT_EXPIRED');
});

test('[R2-2] 被移出成员的 bootstrap 重放返回 MEMBER_REMOVED', async t => {
  const h = await harness();
  t.after(() => h.close());

  const host = await createHost(h);
  const token = secret();
  const body = {
    clientRequestId: uuid(),
    bootstrapToken: token,
    inviteCode: host.inviteCode,
    profile: { nickname: '小周', interestTags: ['旅行'], bio: '' },
  };

  const joined = await h.call({ method: 'POST', url: `/api/v1/rooms/${host.roomId}/members`, body });
  await h.call({
    method: 'DELETE',
    url: `/api/v1/rooms/${host.roomId}/members/${joined.data.member.id}`,
    credential: host.credential,
    membershipId: host.membershipId,
  });

  const replay = await h.call({ method: 'POST', url: `/api/v1/rooms/${host.roomId}/members`, body });
  assert.equal(replay.status, 403);
  assert.equal(replay.code, 'MEMBER_REMOVED');
});

test('[R2-2] 正常重放仍返回可用的 ActiveMember', async t => {
  const h = await harness();
  t.after(() => h.close());

  const host = await createHost(h);
  const body = {
    clientRequestId: uuid(),
    bootstrapToken: secret(),
    inviteCode: host.inviteCode,
    profile: { nickname: '小周', interestTags: ['旅行'], bio: '' },
  };
  const first = await h.call({ method: 'POST', url: `/api/v1/rooms/${host.roomId}/members`, body });
  const replay = await h.call({ method: 'POST', url: `/api/v1/rooms/${host.roomId}/members`, body });
  assert.equal(replay.status, 201);
  validateModel('RoomEntryData', replay.data, 'bootstrap replay');
  assert.equal(replay.data.member.id, first.data.member.id);
  assert.ok(replay.data.member.membership, 'membership 不应为 null');
});

// ============================= R2-3 指纹不受 JSON 属性顺序影响

test('[R2-3] 调整 profile 属性顺序不产生 BOOTSTRAP_CONFLICT', async t => {
  const h = await harness();
  t.after(() => h.close());

  const token = secret();
  const requestId = uuid();

  const first = await h.call({
    method: 'POST',
    url: '/api/v1/rooms',
    body: {
      clientRequestId: requestId,
      bootstrapToken: token,
      profile: { nickname: '小林', interestTags: ['阅读'], bio: '安静' },
    },
  });
  assert.equal(first.status, 201);

  // 同一请求，仅 JSON 属性排列顺序不同——语义未变，不应冲突。
  const reordered = await h.call({
    method: 'POST',
    url: '/api/v1/rooms',
    body: {
      bootstrapToken: token,
      clientRequestId: requestId,
      profile: { bio: '安静', interestTags: ['阅读'], nickname: '小林' },
    },
  });
  assert.equal(reordered.status, 201, `属性换序被判冲突：${JSON.stringify(reordered)}`);
  assert.equal(reordered.data.room.id, first.data.room.id);
  assert.equal(reordered.data.memberCredential, first.data.memberCredential);
});

test('[R2-3] 入房请求同样不受属性顺序影响，但内容变化仍冲突', async t => {
  const h = await harness();
  t.after(() => h.close());

  const host = await createHost(h);
  const token = secret();
  const requestId = uuid();

  const first = await h.call({
    method: 'POST',
    url: `/api/v1/rooms/${host.roomId}/members`,
    body: {
      clientRequestId: requestId,
      bootstrapToken: token,
      inviteCode: host.inviteCode,
      profile: { nickname: '小周', interestTags: ['旅行'], bio: '' },
    },
  });
  assert.equal(first.status, 201);

  const reordered = await h.call({
    method: 'POST',
    url: `/api/v1/rooms/${host.roomId}/members`,
    body: {
      profile: { bio: '', nickname: '小周', interestTags: ['旅行'] },
      inviteCode: host.inviteCode,
      bootstrapToken: token,
      clientRequestId: requestId,
    },
  });
  assert.equal(reordered.status, 201);
  assert.equal(reordered.data.member.id, first.data.member.id);

  // 真正改内容仍必须冲突。
  const changed = await h.call({
    method: 'POST',
    url: `/api/v1/rooms/${host.roomId}/members`,
    body: {
      clientRequestId: requestId,
      bootstrapToken: token,
      inviteCode: host.inviteCode,
      profile: { nickname: '另一个人', interestTags: ['旅行'], bio: '' },
    },
  });
  assert.equal(changed.status, 409);
  assert.equal(changed.code, 'BOOTSTRAP_CONFLICT');
});

// ==================== R2-4 邀答仅在热门话题之后  R2-5 冷却从输出完成算起

test('[R2-4] 共同话题持续冷场不发起邀答', async t => {
  const h = await harness(testConfig({ idle: { topicMs: 45_000, invitationMs: 30_000, tickMs: 3_600_000 } }));
  t.after(() => h.close());

  const host = await createHost(h);
  const service = (h.app as any).roomService;
  const room = service.authenticate(host.roomId, host.credential).room;
  for (const member of room.members.values()) {
    if (member.membership) member.membership.presence = 'online';
  }
  room.currentTopic = {
    id: 'topic_common',
    title: '共同兴趣',
    content: '你们都喜欢阅读',
    kind: 'common',
    sourceLabel: null,
    sourceUrl: null,
    publishedAt: new Date().toISOString(),
  };
  const base = Date.now();
  room.lastMemberMessageAt = base;
  room.lastAutoAt = base;
  room.invitedForCurrentTopic = false;

  const fired = service.aiService(host.roomId).tickIdle(base + 46_000);
  assert.notEqual(fired?.purpose, 'invitation', '共同话题不应进入邀答分支');
  // 持续冷场应改为换话题。
  assert.equal(fired?.purpose, 'topic');
});

test('[R2-4] 热门话题持续冷场才发起邀答', async t => {
  const h = await harness(testConfig({ idle: { topicMs: 45_000, invitationMs: 30_000, tickMs: 3_600_000 } }));
  t.after(() => h.close());

  const host = await createHost(h);
  const service = (h.app as any).roomService;
  const room = service.authenticate(host.roomId, host.credential).room;
  for (const member of room.members.values()) {
    if (member.membership) member.membership.presence = 'online';
  }
  popularTopic(room);
  const base = Date.now();
  room.lastMemberMessageAt = base;
  room.lastAutoAt = base;
  room.invitedForCurrentTopic = false;

  const fired = service.aiService(host.roomId).tickIdle(base + 46_000);
  assert.equal(fired?.purpose, 'invitation');
  assert.ok(fired?.invitedMemberId);
});

test('[R2-5] 冷却从话题发布后开始，生成耗时不计入等待期', async t => {
  // 生成耗时远大于邀答等待时间：若冷却从入队算起，话题一发布就会立刻邀答。
  const slowTopic: Capability = {
    name: 'slow-topic',
    async *run() {
      for (const ch of '热门话题') {
        await new Promise(resolve => setTimeout(resolve, 40));
        yield { kind: 'text', delta: ch };
      }
      yield {
        kind: 'topic',
        topic: { title: '热门话题', content: '聊聊热门话题', kind: 'popular' },
      };
    },
  };
  const h = await harness(
    testConfig({ idle: { topicMs: 120, invitationMs: 70, tickMs: 3_600_000 } }),
    slowTopic,
  );
  t.after(() => h.close());

  const host = await createHost(h);
  const service = (h.app as any).roomService;
  const ai = service.aiService(host.roomId);
  const room = service.authenticate(host.roomId, host.credential).room;
  for (const member of room.members.values()) {
    if (member.membership) member.membership.presence = 'online';
  }

  // 触发自动选题，生成约 160ms。
  room.lastMemberMessageAt = Date.now() - 1_000;
  ai.triggerAutomatic('topic');
  await sleep(400);
  assert.ok(room.currentTopic, '选题应已完成');
  assert.equal(room.currentTopic.kind, 'popular');

  const publishedAt = Date.parse(room.currentTopic.publishedAt);
  // 冷却起点必须接近话题发布时刻，而不是入队时刻。
  assert.ok(
    room.lastAutoAt >= publishedAt - 50,
    `冷却起点早于话题发布：lastAutoAt=${room.lastAutoAt} published=${publishedAt}`,
  );

  // 话题刚发布、未到邀答等待时间，不应立刻邀答。
  room.lastMemberMessageAt = publishedAt - 10_000;
  const immediate = ai.tickIdle(publishedAt + 20);
  assert.notEqual(immediate?.purpose, 'invitation', '话题刚发布就邀答，没给成员回应时间');

  // 等待期满后才允许邀答。
  const later = ai.tickIdle(room.lastAutoAt + 80);
  assert.equal(later?.purpose, 'invitation');
});
