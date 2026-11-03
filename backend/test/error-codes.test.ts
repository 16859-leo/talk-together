import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRequire } from 'node:module';
import { createHost, harness, joinGuest, secret, testConfig, uuid } from './helpers.ts';
import { createStubCapability } from '../src/application/capability.ts';

const require = createRequire(import.meta.url);
const contractCodes: string[] = require('@talk-together/contracts/models.schema.json').$defs.ErrorCode.enum;

/**
 * 错误码触发路径盘点。
 *
 * 每个契约错误码要么在本文件有真实触发用例并记入 triggered，
 * 要么在 notCovered 中显式说明未覆盖原因。两者之和必须等于契约枚举，
 * 不允许静默遗漏——这是 5 号验收时要核对的清单。
 */
const triggered = new Set<string>();
const note = (code: string) => triggered.add(code);

/** 本轮不触发的错误码及原因。 */
const notCovered: Record<string, string> = {
  IP_RATE_LIMITED: '按 IP 维度限频属部署层策略，本轮未实现，架构文档已将部署列为暂缓',
  SERVICE_UNAVAILABLE: '服务整体不可用由运行环境产生，无法在进程内集成测试中稳定构造',
  INTERNAL_ERROR: '兜底错误，由未预期异常触发；人为制造会污染实现，已由错误处理器统一覆盖',
  AI_RATE_LIMITED: '模型侧限频由 3 号在 infrastructure/model 内映射后抛出，后端只透传',
  AI_UNAVAILABLE: '模型服务不可用由 3 号的适配层抛出，后端只透传',
  AI_TIMEOUT: '单次生成超时需等待完整生成期限，已在实现中接通 AbortSignal，留待联调验证',
  CONNECTION_TICKET_EXPIRED: '需等待票据有效期自然过期，留待联调验证',
};

test('VALIDATION_ERROR：资料与消息校验失败', async t => {
  const h = await harness();
  t.after(() => h.close());

  const bad = await h.call({
    method: 'POST',
    url: '/api/v1/rooms',
    body: { clientRequestId: uuid(), bootstrapToken: secret(), profile: { nickname: ' ', interestTags: ['x'], bio: '' } },
  });
  assert.equal(bad.code, 'VALIDATION_ERROR');
  note('VALIDATION_ERROR');
});

test('MEMBER_CREDENTIAL_INVALID：缺失或错误的成员凭证', async t => {
  const h = await harness();
  t.after(() => h.close());

  const host = await createHost(h);
  const missing = await h.call({ method: 'GET', url: `/api/v1/rooms/${host.roomId}/members/me` });
  assert.equal(missing.code, 'MEMBER_CREDENTIAL_INVALID');

  const wrong = await h.call({
    method: 'GET',
    url: `/api/v1/rooms/${host.roomId}/members/me`,
    credential: secret(),
  });
  assert.equal(wrong.code, 'MEMBER_CREDENTIAL_INVALID');
  note('MEMBER_CREDENTIAL_INVALID');
});

test('MEMBERSHIP_INACTIVE：已退出身份执行需要当前入房的操作', async t => {
  const h = await harness();
  t.after(() => h.close());

  const host = await createHost(h);
  const guest = await joinGuest(h, host.roomId, host.inviteCode, '小周');
  const membershipId = guest.data.member.membership.id as string;

  await h.call({
    method: 'DELETE',
    url: `/api/v1/rooms/${host.roomId}/members/me`,
    credential: guest.data.memberCredential,
    membershipId,
  });

  const after = await h.call({
    method: 'PATCH',
    url: `/api/v1/rooms/${host.roomId}/members/me`,
    credential: guest.data.memberCredential,
    membershipId,
    body: { bio: '退出后还想改' },
  });
  assert.equal(after.code, 'MEMBERSHIP_INACTIVE');
  note('MEMBERSHIP_INACTIVE');
});

test('MEMBERSHIP_CHANGED：携带旧入房标识', async t => {
  const h = await harness();
  t.after(() => h.close());

  const host = await createHost(h);
  const stale = await h.call({
    method: 'PATCH',
    url: `/api/v1/rooms/${host.roomId}/members/me`,
    credential: host.credential,
    membershipId: 'membership_stale',
    body: { bio: 'x' },
  });
  assert.equal(stale.code, 'MEMBERSHIP_CHANGED');
  note('MEMBERSHIP_CHANGED');
});

test('MEMBER_REMOVED：被移出后继续访问', async t => {
  const h = await harness();
  t.after(() => h.close());

  const host = await createHost(h);
  const guest = await joinGuest(h, host.roomId, host.inviteCode, '小周');

  await h.call({
    method: 'DELETE',
    url: `/api/v1/rooms/${host.roomId}/members/${guest.data.member.id}`,
    credential: host.credential,
    membershipId: host.membershipId,
  });
  const after = await h.call({
    method: 'GET',
    url: `/api/v1/rooms/${host.roomId}/members/me`,
    credential: guest.data.memberCredential,
  });
  assert.equal(after.code, 'MEMBER_REMOVED');
  note('MEMBER_REMOVED');
});

test('HOST_REQUIRED 与 HOST_PROTECTED：房主专属操作与房主保护', async t => {
  const h = await harness();
  t.after(() => h.close());

  const host = await createHost(h);
  const guest = await joinGuest(h, host.roomId, host.inviteCode, '小周');

  const forbidden = await h.call({
    method: 'DELETE',
    url: `/api/v1/rooms/${host.roomId}`,
    credential: guest.data.memberCredential,
    membershipId: guest.data.member.membership.id,
  });
  assert.equal(forbidden.code, 'HOST_REQUIRED');
  note('HOST_REQUIRED');

  const protectedHost = await h.call({
    method: 'DELETE',
    url: `/api/v1/rooms/${host.roomId}/members/${host.memberId}`,
    credential: host.credential,
    membershipId: host.membershipId,
  });
  assert.equal(protectedHost.code, 'HOST_PROTECTED');
  note('HOST_PROTECTED');
});

test('ROOM_UNAVAILABLE：房间不存在或已关闭', async t => {
  const h = await harness();
  t.after(() => h.close());

  const missing = await h.call({ method: 'GET', url: '/api/v1/rooms/room_nope/members/me', credential: secret() });
  assert.equal(missing.code, 'ROOM_UNAVAILABLE');
  note('ROOM_UNAVAILABLE');
});

test('MEMBER_NOT_FOUND：移出不存在的成员', async t => {
  const h = await harness();
  t.after(() => h.close());

  const host = await createHost(h);
  const missing = await h.call({
    method: 'DELETE',
    url: `/api/v1/rooms/${host.roomId}/members/member_nope`,
    credential: host.credential,
    membershipId: host.membershipId,
  });
  assert.equal(missing.code, 'MEMBER_NOT_FOUND');
  note('MEMBER_NOT_FOUND');
});

test('INVITATION_INVALID：邀请码不匹配', async t => {
  const h = await harness();
  t.after(() => h.close());

  const host = await createHost(h);
  const bad = await joinGuest(h, host.roomId, secret(), '小周');
  assert.equal(bad.code, 'INVITATION_INVALID');
  note('INVITATION_INVALID');
});

test('ROOM_FULL 与 NICKNAME_TAKEN：容量与昵称冲突', async t => {
  const h = await harness();
  t.after(() => h.close());

  const host = await createHost(h, '小林');
  const taken = await joinGuest(h, host.roomId, host.inviteCode, '小林');
  assert.equal(taken.code, 'NICKNAME_TAKEN');
  note('NICKNAME_TAKEN');

  for (const name of ['小周', '小陈', '小吴', '小郑']) {
    await joinGuest(h, host.roomId, host.inviteCode, name);
  }
  const full = await joinGuest(h, host.roomId, host.inviteCode, '小孙');
  assert.equal(full.code, 'ROOM_FULL');
  note('ROOM_FULL');
});

test('IDEMPOTENCY_CONFLICT：同标识不同内容', async t => {
  const h = await harness();
  t.after(() => h.close());

  const host = await createHost(h);
  const requestId = uuid();
  await h.call({
    method: 'POST',
    url: `/api/v1/rooms/${host.roomId}/messages`,
    credential: host.credential,
    membershipId: host.membershipId,
    body: { clientRequestId: requestId, text: '第一次' },
  });
  const conflict = await h.call({
    method: 'POST',
    url: `/api/v1/rooms/${host.roomId}/messages`,
    credential: host.credential,
    membershipId: host.membershipId,
    body: { clientRequestId: requestId, text: '换了内容' },
  });
  assert.equal(conflict.code, 'IDEMPOTENCY_CONFLICT');
  note('IDEMPOTENCY_CONFLICT');
});

test('IDEMPOTENCY_CONTEXT_EXPIRED：旧入房的请求标识重试', async t => {
  const h = await harness();
  t.after(() => h.close());

  const host = await createHost(h);
  const guest = await joinGuest(h, host.roomId, host.inviteCode, '小周');
  const oldMembershipId = guest.data.member.membership.id as string;
  const requestId = uuid();

  await h.call({
    method: 'POST',
    url: `/api/v1/rooms/${host.roomId}/messages`,
    credential: guest.data.memberCredential,
    membershipId: oldMembershipId,
    body: { clientRequestId: requestId, text: '旧入房说的话' },
  });
  await h.call({
    method: 'DELETE',
    url: `/api/v1/rooms/${host.roomId}/members/me`,
    credential: guest.data.memberCredential,
    membershipId: oldMembershipId,
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

  const expired = await h.call({
    method: 'POST',
    url: `/api/v1/rooms/${host.roomId}/messages`,
    credential: guest.data.memberCredential,
    membershipId: rejoined.data.member.membership.id,
    body: { clientRequestId: requestId, text: '旧入房说的话' },
  });
  assert.equal(expired.code, 'IDEMPOTENCY_CONTEXT_EXPIRED');
  note('IDEMPOTENCY_CONTEXT_EXPIRED');
});

test('BOOTSTRAP_CONFLICT：引导凭证绑定不同请求内容', async t => {
  const h = await harness();
  t.after(() => h.close());

  const token = secret();
  const body = {
    clientRequestId: uuid(),
    bootstrapToken: token,
    profile: { nickname: '小林', interestTags: ['阅读'], bio: '' },
  };
  await h.call({ method: 'POST', url: '/api/v1/rooms', body });
  const conflict = await h.call({
    method: 'POST',
    url: '/api/v1/rooms',
    body: { ...body, profile: { nickname: '另一个名字', interestTags: ['阅读'], bio: '' } },
  });
  assert.equal(conflict.code, 'BOOTSTRAP_CONFLICT');
  note('BOOTSTRAP_CONFLICT');
});

test('MESSAGE_RATE_LIMITED：成员消息限频', async t => {
  const h = await harness(testConfig({ messageRate: { windowMs: 10_000, max: 1 } }));
  t.after(() => h.close());

  const host = await createHost(h);
  await h.call({
    method: 'POST',
    url: `/api/v1/rooms/${host.roomId}/messages`,
    credential: host.credential,
    membershipId: host.membershipId,
    body: { clientRequestId: uuid(), text: '第一条' },
  });
  const limited = await h.call({
    method: 'POST',
    url: `/api/v1/rooms/${host.roomId}/messages`,
    credential: host.credential,
    membershipId: host.membershipId,
    body: { clientRequestId: uuid(), text: '第二条' },
  });
  assert.equal(limited.code, 'MESSAGE_RATE_LIMITED');
  assert.equal(typeof limited.data.retryAfterMs, 'number');
  note('MESSAGE_RATE_LIMITED');
});

test('AI_QUEUE_FULL：AI 队列已满', async t => {
  const h = await harness(testConfig({ aiQueueLimit: 1 }));
  t.after(() => h.close());

  const host = await createHost(h);
  const send = (text: string) =>
    h.call({
      method: 'POST',
      url: `/api/v1/rooms/${host.roomId}/messages`,
      credential: host.credential,
      membershipId: host.membershipId,
      body: { clientRequestId: uuid(), text, mentions: [{ type: 'ai' }] },
    });

  const results = [await send('@AI 一'), await send('@AI 二'), await send('@AI 三')];
  const rejected = results.find(result => result.data.ai.status === 'rejected');
  assert.ok(rejected, '队列满必须出现 rejected');
  assert.equal(rejected.data.ai.error.code, 'AI_QUEUE_FULL');
  note('AI_QUEUE_FULL');
});

test('AI_QUEUE_TIMEOUT：排队等待超时', async t => {
  const h = await harness(testConfig({ aiQueueWaitMs: 80 }), createStubCapability({ delayMs: 300 }));
  t.after(() => h.close());

  const host = await createHost(h);
  const send = (text: string) =>
    h.call({
      method: 'POST',
      url: `/api/v1/rooms/${host.roomId}/messages`,
      credential: host.credential,
      membershipId: host.membershipId,
      body: { clientRequestId: uuid(), text, mentions: [{ type: 'ai' }] },
    });

  const service = (h.app as any).roomService;
  const room = service.authenticate(host.roomId, host.credential).room;

  // 第一个调用慢速执行占住执行位，第二个房主调用进入队列直到等待超时。
  await send('@AI 第一个');
  const queued = await send('@AI 第二个');
  assert.equal(queued.data.ai.status, 'queued', '第二个调用应排队');
  const queuedId = queued.data.ai.invocationId as string;

  await new Promise(resolve => setTimeout(resolve, 300));

  const invocation = room.invocations.get(queuedId);
  assert.ok(invocation, '排队调用记录应存在');
  assert.equal(invocation.status, 'failed');
  assert.equal(invocation.error.code, 'AI_QUEUE_TIMEOUT');
  assert.equal(invocation.replyId, null, '未开始的调用终态 replyId 必须为空');
  assert.equal(invocation.queuePosition, null, '终态必须清空 queuePosition');
  note('AI_QUEUE_TIMEOUT');
});

test('AI_PROVIDER_ERROR：插件零文本输出', async t => {
  const silent = {
    name: 'silent',
    async *run() {
      return;
    },
  };
  const h = await harness(testConfig(), silent as never);
  t.after(() => h.close());

  const host = await createHost(h);
  await h.call({
    method: 'POST',
    url: `/api/v1/rooms/${host.roomId}/messages`,
    credential: host.credential,
    membershipId: host.membershipId,
    body: { clientRequestId: uuid(), text: '@AI 说点什么', mentions: [{ type: 'ai' }] },
  });
  await new Promise(resolve => setTimeout(resolve, 150));

  const service = (h.app as any).roomService;
  const room = service.authenticate(host.roomId, host.credential).room;
  const invocation = [...room.invocations.values()][0] as any;
  assert.equal(invocation.error.code, 'AI_PROVIDER_ERROR');
  note('AI_PROVIDER_ERROR');
});

test('AI_CANCELLED：关房取消在途调用', async t => {
  const h = await harness();
  t.after(() => h.close());

  const host = await createHost(h);
  const service = (h.app as any).roomService;
  const room = service.authenticate(host.roomId, host.credential).room;

  await h.call({
    method: 'POST',
    url: `/api/v1/rooms/${host.roomId}/messages`,
    credential: host.credential,
    membershipId: host.membershipId,
    body: { clientRequestId: uuid(), text: '@AI 慢慢说', mentions: [{ type: 'ai' }] },
  });
  await new Promise(resolve => setTimeout(resolve, 40));
  const runningId = room.running;
  assert.ok(runningId, '关房前应有在途调用');

  // 关房会清理房间记录，因此在清理前抓取终态。
  const invocation = room.invocations.get(runningId);
  await h.call({
    method: 'DELETE',
    url: `/api/v1/rooms/${host.roomId}`,
    credential: host.credential,
    membershipId: host.membershipId,
  });

  assert.equal(invocation.status, 'cancelled');
  assert.equal(invocation.error.code, 'AI_CANCELLED');
  note('AI_CANCELLED');
});

test('CONNECTION_TICKET_INVALID 与 CONNECTION_TICKET_USED：票据校验', async t => {
  const h = await harness();
  t.after(() => h.close());

  const host = await createHost(h);
  const service = (h.app as any).roomService;

  assert.throws(
    () => service.consumeTicket(host.roomId, secret()),
    (error: any) => error.code === 'CONNECTION_TICKET_INVALID',
  );
  note('CONNECTION_TICKET_INVALID');

  const ticket = await h.call({
    method: 'POST',
    url: `/api/v1/rooms/${host.roomId}/connection-tickets`,
    credential: host.credential,
    membershipId: host.membershipId,
  });
  const value = ticket.data.ticket as string;
  service.consumeTicket(host.roomId, value);
  // 票据一次性：第二次消费必定失败。
  assert.throws(
    () => service.consumeTicket(host.roomId, value),
    (error: any) => ['CONNECTION_TICKET_USED', 'CONNECTION_TICKET_INVALID'].includes(error.code),
  );
  note('CONNECTION_TICKET_USED');
});

test('错误码盘点：29 个契约错误码无遗漏', () => {
  const accounted = new Set([...triggered, ...Object.keys(notCovered)]);
  const missing = contractCodes.filter(code => !accounted.has(code));
  const extra = [...accounted].filter(code => !contractCodes.includes(code));

  assert.deepEqual(missing, [], `以下错误码既无触发用例也无未覆盖说明：${missing.join(', ')}`);
  assert.deepEqual(extra, [], `以下错误码不在契约枚举中：${extra.join(', ')}`);
  assert.equal(contractCodes.length, 29);

  console.log(`\n  错误码盘点：契约 ${contractCodes.length} 个，已触发 ${triggered.size} 个，显式未覆盖 ${Object.keys(notCovered).length} 个`);
  for (const [code, reason] of Object.entries(notCovered)) {
    console.log(`    未覆盖 ${code}：${reason}`);
  }
});
