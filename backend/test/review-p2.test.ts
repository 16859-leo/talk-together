import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHost, harness, joinGuest, secret, testConfig, uuid, validateModel } from './helpers.ts';
import { createStubCapability, type Capability } from '../src/application/capability.ts';

/** PR #7 review 的 P2 项回归测试（快照与断开回调见 review-snapshot.test.ts）。 */

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// =============================================== P2-5 回放原始 AI 回执

test('[P2-5] 队列满时的 rejected 回执在重试时原样回放', async t => {
  const h = await harness(testConfig({ aiQueueLimit: 1 }), createStubCapability({ delayMs: 60 }));
  t.after(() => h.close());

  const host = await createHost(h);
  const send = (clientRequestId: string, text: string) =>
    h.call({
      method: 'POST',
      url: `/api/v1/rooms/${host.roomId}/messages`,
      credential: host.credential,
      membershipId: host.membershipId,
      body: { clientRequestId, text, mentions: ['ai'] },
    });

  // 占满执行位与队列，让第三次提交被拒。
  await send(uuid(), '@AI 一');
  await send(uuid(), '@AI 二');
  const rejectedId = uuid();
  const rejected = await send(rejectedId, '@AI 三');
  assert.equal(rejected.data.ai.status, 'rejected', JSON.stringify(rejected.data.ai));
  assert.equal(rejected.data.ai.error.code, 'AI_QUEUE_FULL');

  // 相同请求重试：必须返回原 rejected 回执，而不是 not_requested。
  const retried = await send(rejectedId, '@AI 三');
  assert.equal(retried.status, 201);
  validateModel('SendMessageData', retried.data, 'retry receipt');
  assert.equal(retried.data.ai.status, 'rejected', `重试回执退化为 ${retried.data.ai.status}`);
  assert.equal(retried.data.ai.error.code, 'AI_QUEUE_FULL');
});

test('[P2-5] 普通成员的 ignored 回执在重试时不丢失', async t => {
  const h = await harness();
  t.after(() => h.close());

  const host = await createHost(h);
  const guest = await joinGuest(h, host.roomId, host.inviteCode, '小周');
  const requestId = uuid();
  const body = { clientRequestId: requestId, text: '@AI 来个话题', mentions: ['ai'] };

  const first = await h.call({
    method: 'POST',
    url: `/api/v1/rooms/${host.roomId}/messages`,
    credential: guest.data.memberCredential,
    membershipId: guest.data.member.membership.id,
    body,
  });
  assert.equal(first.data.ai.status, 'ignored');

  const retried = await h.call({
    method: 'POST',
    url: `/api/v1/rooms/${host.roomId}/messages`,
    credential: guest.data.memberCredential,
    membershipId: guest.data.member.membership.id,
    body,
  });
  assert.equal(retried.data.ai.status, 'ignored', `重试回执退化为 ${retried.data.ai.status}`);
});

test('[P2-5] 已受理但随后失败的调用不被误报为未受理', async t => {
  const silent: Capability = {
    name: 'silent',
    // eslint-disable-next-line require-yield
    async *run() {
      return;
    },
  };
  const h = await harness(testConfig(), silent);
  t.after(() => h.close());

  const host = await createHost(h);
  const requestId = uuid();
  const body = { clientRequestId: requestId, text: '@AI 说点什么', mentions: ['ai'] };

  const first = await h.call({
    method: 'POST',
    url: `/api/v1/rooms/${host.roomId}/messages`,
    credential: host.credential,
    membershipId: host.membershipId,
    body,
  });
  assert.ok(['queued', 'running'].includes(first.data.ai.status));
  await sleep(200);

  // 此时调用已 failed，但回执仍应表达「当时已受理」。
  const retried = await h.call({
    method: 'POST',
    url: `/api/v1/rooms/${host.roomId}/messages`,
    credential: host.credential,
    membershipId: host.membershipId,
    body,
  });
  assert.notEqual(retried.data.ai.status, 'not_requested', '已受理的调用被误报为未受理');
  assert.equal(retried.data.ai.invocationId, first.data.ai.invocationId);
});

// =============================================== P2-6 幂等纳入 mentions

test('[P2-6] 同标识同正文但新增 AI 提及返回冲突', async t => {
  const h = await harness();
  t.after(() => h.close());

  const host = await createHost(h);
  const requestId = uuid();

  const plain = await h.call({
    method: 'POST',
    url: `/api/v1/rooms/${host.roomId}/messages`,
    credential: host.credential,
    membershipId: host.membershipId,
    body: { clientRequestId: requestId, text: '同一句话' },
  });
  assert.equal(plain.data.ai.status, 'not_requested');

  // 相同 ID、相同正文，但这次带提及——属于不同操作，必须冲突。
  const withMention = await h.call({
    method: 'POST',
    url: `/api/v1/rooms/${host.roomId}/messages`,
    credential: host.credential,
    membershipId: host.membershipId,
    body: { clientRequestId: requestId, text: '同一句话', mentions: ['ai'] },
  });
  assert.equal(withMention.status, 409);
  assert.equal(withMention.code, 'IDEMPOTENCY_CONFLICT');
});

// =============================== P2-7 / P2-10 / P2-11 AI 终态与话题生效

test('[P2-7] 插件响应取消后正常结束，终态必须是 failed 而非 completed', async t => {
  // 输出部分文字，收到取消信号后正常返回（不抛异常）。
  const giveUp: Capability = {
    name: 'give-up',
    async *run(context) {
      yield { kind: 'text', delta: '我在' };
      await new Promise(resolve => setTimeout(resolve, 150));
      if (context.signal.aborted) return;
      yield { kind: 'text', delta: '继续说' };
    },
  };
  // 生成期限短于插件等待时间，必然触发超时。
  const h = await harness(testConfig({ aiRunMs: 60 }), giveUp);
  t.after(() => h.close());

  const host = await createHost(h);
  await h.call({
    method: 'POST',
    url: `/api/v1/rooms/${host.roomId}/messages`,
    credential: host.credential,
    membershipId: host.membershipId,
    body: { clientRequestId: uuid(), text: '@AI 说点什么', mentions: ['ai'] },
  });
  await sleep(400);

  const service = (h.app as any).roomService;
  const room = service.authenticate(host.roomId, host.credential).room;
  const invocation = [...room.invocations.values()][0] as any;
  assert.notEqual(invocation.status, 'completed', '响应取消后正常结束不能算成功');
  assert.equal(invocation.status, 'failed');
  assert.equal(invocation.error.code, 'AI_TIMEOUT');
});

test('[P2-7] 超时的选题草稿不得生效', async t => {
  const lateTopic: Capability = {
    name: 'late-topic',
    async *run(context) {
      yield { kind: 'text', delta: '想个话题' };
      yield {
        kind: 'topic',
        topic: { title: '超时话题', content: '不该生效', kind: 'common' },
      };
      await new Promise(resolve => setTimeout(resolve, 150));
      if (context.signal.aborted) return;
    },
  };
  const h = await harness(testConfig({ aiRunMs: 60 }), lateTopic);
  t.after(() => h.close());

  const host = await createHost(h);
  const service = (h.app as any).roomService;
  const room = service.authenticate(host.roomId, host.credential).room;
  service.aiService(host.roomId).triggerAutomatic('topic');
  await sleep(400);

  assert.equal(room.currentTopic, null, '超时调用的话题草稿不得生效');
});

test('[P2-10] 纯空白输出判为失败', async t => {
  const blank: Capability = {
    name: 'blank',
    async *run() {
      yield { kind: 'text', delta: ' \n' };
    },
  };
  const h = await harness(testConfig(), blank);
  t.after(() => h.close());

  const host = await createHost(h);
  await h.call({
    method: 'POST',
    url: `/api/v1/rooms/${host.roomId}/messages`,
    credential: host.credential,
    membershipId: host.membershipId,
    body: { clientRequestId: uuid(), text: '@AI 说点什么', mentions: ['ai'] },
  });
  await sleep(250);

  const service = (h.app as any).roomService;
  const room = service.authenticate(host.roomId, host.credential).room;
  const invocation = [...room.invocations.values()][0] as any;
  assert.equal(invocation.status, 'failed', '纯空白输出不能标记为 completed');
  assert.equal(invocation.error.code, 'AI_PROVIDER_ERROR');

  // 该终态必须能通过 AIReply Schema（completed 要求 NonBlankText）。
  const reply = [...room.replies.values()][0] as any;
  assert.equal(reply.status, 'failed');
});

test('[P2-11] 普通回复携带话题草稿也不改变当前话题', async t => {
  const sneaky: Capability = {
    name: 'sneaky',
    async *run() {
      yield { kind: 'text', delta: '随便聊聊' };
      yield {
        kind: 'topic',
        topic: { title: '偷换的话题', content: '普通回复不该改话题', kind: 'common' },
      };
    },
  };
  const h = await harness(testConfig(), sneaky);
  t.after(() => h.close());

  const host = await createHost(h);
  const service = (h.app as any).roomService;
  const room = service.authenticate(host.roomId, host.credential).room;

  // 房主提及属于 purpose='reply'。
  await h.call({
    method: 'POST',
    url: `/api/v1/rooms/${host.roomId}/messages`,
    credential: host.credential,
    membershipId: host.membershipId,
    body: { clientRequestId: uuid(), text: '@AI 聊聊', mentions: ['ai'] },
  });
  await sleep(250);

  const invocation = [...room.invocations.values()][0] as any;
  assert.equal(invocation.status, 'completed');
  assert.equal(room.currentTopic, null, '普通回复不得改变当前话题');
});

test('[P2-11] 选题调用的草稿正常生效', async t => {
  const h = await harness(testConfig(), createStubCapability({ delayMs: 5 }));
  t.after(() => h.close());

  const host = await createHost(h);
  const service = (h.app as any).roomService;
  const room = service.authenticate(host.roomId, host.credential).room;
  service.aiService(host.roomId).triggerAutomatic('topic');
  await sleep(400);

  assert.ok(room.currentTopic, '选题调用的草稿应生效');
  assert.ok(room.lastAutoAt > 0, '话题发布后应重新开始冷场冷却');
});

// =============================================== P2-8 关房清理引导记录

test('[P2-8] 关房后引导记录中的公开资料被清理', async t => {
  const h = await harness();
  t.after(() => h.close());

  const token = secret();
  const created = await h.call({
    method: 'POST',
    url: '/api/v1/rooms',
    body: {
      clientRequestId: uuid(),
      bootstrapToken: token,
      profile: { nickname: '小林', interestTags: ['阅读', '电影'], bio: '喜欢安静的周末' },
    },
  });
  const roomId = created.data.room.id as string;
  const credential = created.data.memberCredential as string;
  const membershipId = created.data.member.membership.id as string;

  const service = (h.app as any).roomService;
  const store = service.store;
  assert.ok(store.getBootstrap(token), '关房前应存在引导记录');

  await h.call({ method: 'DELETE', url: `/api/v1/rooms/${roomId}`, credential, membershipId });

  const left = store.getBootstrap(token);
  assert.equal(left, undefined, '关房后引导记录仍残留资料原文');
});

// =============================================== P2-12 标签归一化后唯一

test('[P2-12] 归一化后重复的兴趣标签被拒绝', async t => {
  const h = await harness();
  t.after(() => h.close());

  // "travel" 与 " travel " trim 后重复，违反公共模型的 uniqueItems。
  const dup = await h.call({
    method: 'POST',
    url: '/api/v1/rooms',
    body: {
      clientRequestId: uuid(),
      bootstrapToken: secret(),
      profile: { nickname: '小林', interestTags: ['travel', ' travel '], bio: '' },
    },
  });
  assert.equal(dup.status, 400);
  assert.equal(dup.code, 'VALIDATION_ERROR');
});

test('[P2-12] PATCH 的重复标签同样被拒绝', async t => {
  const h = await harness();
  t.after(() => h.close());

  const host = await createHost(h);
  const patched = await h.call({
    method: 'PATCH',
    url: `/api/v1/rooms/${host.roomId}/members/me`,
    credential: host.credential,
    membershipId: host.membershipId,
    body: { interestTags: ['读书', ' 读书 '] },
  });
  assert.equal(patched.status, 400);
  assert.equal(patched.code, 'VALIDATION_ERROR');
});

// =============================================== P2-9 单人房间冷场

test('[P2-9] 单人房间持续冷场只补话题，不会自动点名房主', async t => {
  const h = await harness(testConfig({ idle: { topicMs: 45_000, invitationMs: 30_000, tickMs: 3_600_000 } }));
  t.after(() => h.close());

  const host = await createHost(h);
  const service = (h.app as any).roomService;
  const room = service.authenticate(host.roomId, host.credential).room;
  for (const member of room.members.values()) {
    if (member.membership) member.membership.presence = 'online';
  }
  room.currentTopic = {
    id: 'topic_solo',
    title: '热门话题',
    content: '聊聊热门话题',
    kind: 'popular',
    sourceLabel: null,
    sourceUrl: null,
    publishedAt: new Date().toISOString(),
  };
  const base = Date.now();
  room.lastMemberMessageAt = base;
  room.lastAutoAt = base;

  const fired = service.aiService(host.roomId).tickIdle(base + 46_000);
  assert.ok(fired, '单人房间冷场也应补话题');
  assert.equal(fired.purpose, 'topic', '自动补话不再是点名邀答');
  assert.equal(fired.invitedMemberId, null);
});
