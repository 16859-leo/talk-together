import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHost, harness, joinGuest, secret, testConfig, uuid, validateModel } from './helpers.ts';

test('client-config 声明对外校验约束', async t => {
  const h = await harness();
  t.after(() => h.close());

  const result = await h.call({ method: 'GET', url: '/api/v1/client-config' });
  assert.equal(result.status, 200);
  validateModel('ClientConfigData', result.data, 'client-config');
  assert.equal(result.data.contractVersion, '0.1.0');
  assert.equal(result.data.validation.nickname.maxLength, 20);
});

test('建房返回房主身份与邀请入口', async t => {
  const h = await harness();
  t.after(() => h.close());

  const host = await createHost(h);
  assert.match(host.roomId, /^room_/);
  assert.equal(host.credential.length >= 32, true);

  const self = await h.call({ method: 'GET', url: `/api/v1/rooms/${host.roomId}/members/me`, credential: host.credential });
  assert.equal(self.status, 200);
  validateModel('SelfData', self.data, 'getSelf');
  assert.equal(self.data.member.role, 'host');
});

test('引导凭证重试返回原房间，变更内容则冲突', async t => {
  const h = await harness();
  t.after(() => h.close());

  const token = secret();
  const requestId = uuid();
  const body = { clientRequestId: requestId, bootstrapToken: token, profile: { nickname: '小林', interestTags: ['阅读'], bio: '' } };

  const first = await h.call({ method: 'POST', url: '/api/v1/rooms', body });
  const replay = await h.call({ method: 'POST', url: '/api/v1/rooms', body });
  assert.equal(first.data.room.id, replay.data.room.id);
  assert.equal(first.data.memberCredential, replay.data.memberCredential);

  const conflict = await h.call({
    method: 'POST',
    url: '/api/v1/rooms',
    body: { ...body, profile: { nickname: '别的名字', interestTags: ['阅读'], bio: '' } },
  });
  assert.equal(conflict.status, 409);
  assert.equal(conflict.code, 'BOOTSTRAP_CONFLICT');
});

test('入房校验邀请码、昵称唯一与人数上限', async t => {
  const h = await harness();
  t.after(() => h.close());

  const host = await createHost(h, '小林');

  const badInvite = await joinGuest(h, host.roomId, secret(), '小周');
  assert.equal(badInvite.status, 404);
  assert.equal(badInvite.code, 'INVITATION_INVALID');

  const taken = await joinGuest(h, host.roomId, host.inviteCode, '小林');
  assert.equal(taken.status, 409);
  assert.equal(taken.code, 'NICKNAME_TAKEN');

  for (const name of ['小周', '小陈', '小吴', '小郑']) {
    const joined = await joinGuest(h, host.roomId, host.inviteCode, name);
    assert.equal(joined.status, 201, `${name}: ${JSON.stringify(joined)}`);
  }
  const overflow = await joinGuest(h, host.roomId, host.inviteCode, '小孙');
  assert.equal(overflow.status, 409);
  assert.equal(overflow.code, 'ROOM_FULL');
});

test('资料校验与 PATCH 语义', async t => {
  const h = await harness();
  t.after(() => h.close());

  const host = await createHost(h);

  const empty = await h.call({
    method: 'POST',
    url: '/api/v1/rooms',
    body: { clientRequestId: uuid(), bootstrapToken: secret(), profile: { nickname: '  ', interestTags: ['阅读'], bio: '' } },
  });
  assert.equal(empty.status, 400);
  assert.equal(empty.code, 'VALIDATION_ERROR');
  assert.equal(empty.data.fieldErrors[0].path, '/profile/nickname');

  // 缺省字段保持原值，bio: "" 清空。
  const patched = await h.call({
    method: 'PATCH',
    url: `/api/v1/rooms/${host.roomId}/members/me`,
    credential: host.credential,
    membershipId: host.membershipId,
    body: { bio: '喜欢安静的周末' },
  });
  assert.equal(patched.status, 200);
  assert.equal(patched.data.member.profile.nickname, '小林');
  assert.equal(patched.data.member.profile.bio, '喜欢安静的周末');
});

test('权限与入房标识校验', async t => {
  const h = await harness();
  t.after(() => h.close());

  const host = await createHost(h);
  const guest = await joinGuest(h, host.roomId, host.inviteCode, '小周');

  // 普通成员不能移出成员。
  const forbidden = await h.call({
    method: 'DELETE',
    url: `/api/v1/rooms/${host.roomId}/members/${host.memberId}`,
    credential: guest.data.memberCredential,
    membershipId: guest.data.member.membership.id,
  });
  assert.equal(forbidden.status, 403);
  assert.equal(forbidden.code, 'HOST_REQUIRED');

  // 房主不可被移出。
  const protectedHost = await h.call({
    method: 'DELETE',
    url: `/api/v1/rooms/${host.roomId}/members/${host.memberId}`,
    credential: host.credential,
    membershipId: host.membershipId,
  });
  assert.equal(protectedHost.status, 403);
  assert.equal(protectedHost.code, 'HOST_PROTECTED');

  // 旧入房标识被拒绝。
  const stale = await h.call({
    method: 'PATCH',
    url: `/api/v1/rooms/${host.roomId}/members/me`,
    credential: host.credential,
    membershipId: 'membership_stale',
    body: { bio: 'x' },
  });
  assert.equal(stale.status, 409);
  assert.equal(stale.code, 'MEMBERSHIP_CHANGED');

  // 无凭证。
  const anonymous = await h.call({ method: 'GET', url: `/api/v1/rooms/${host.roomId}/members/me` });
  assert.equal(anonymous.status, 401);
  assert.equal(anonymous.code, 'MEMBER_CREDENTIAL_INVALID');
});

test('消息幂等、限频与整次失败', async t => {
  const h = await harness(testConfig({ messageRate: { windowMs: 10_000, max: 2 } }));
  t.after(() => h.close());

  const host = await createHost(h);
  const send = (body: unknown) =>
    h.call({
      method: 'POST',
      url: `/api/v1/rooms/${host.roomId}/messages`,
      credential: host.credential,
      membershipId: host.membershipId,
      body,
    });

  const requestId = uuid();
  const first = await send({ clientRequestId: requestId, text: '大家好' });
  assert.equal(first.status, 201);
  validateModel('SendMessageData', first.data, 'sendMessage');
  assert.equal(first.data.ai.status, 'not_requested');

  // 同 ID 同内容幂等：返回原消息，不新增。
  const replay = await send({ clientRequestId: requestId, text: '大家好' });
  assert.equal(replay.data.message.id, first.data.message.id);

  // 同 ID 不同内容冲突。
  const conflict = await send({ clientRequestId: requestId, text: '换了内容' });
  assert.equal(conflict.status, 409);
  assert.equal(conflict.code, 'IDEMPOTENCY_CONFLICT');

  await send({ clientRequestId: uuid(), text: '第二条' });
  const limited = await send({ clientRequestId: uuid(), text: '第三条' });
  assert.equal(limited.status, 429);
  assert.equal(limited.code, 'MESSAGE_RATE_LIMITED');
  assert.equal(typeof limited.data.retryAfterMs, 'number');

  // 空消息整次失败。
  const blank = await send({ clientRequestId: uuid(), text: '   ' });
  assert.equal(blank.status, 400);
});

test('普通成员的 AI 提及按普通聊天处理', async t => {
  const h = await harness();
  t.after(() => h.close());

  const host = await createHost(h);
  const guest = await joinGuest(h, host.roomId, host.inviteCode, '小周');

  const ignored = await h.call({
    method: 'POST',
    url: `/api/v1/rooms/${host.roomId}/messages`,
    credential: guest.data.memberCredential,
    membershipId: guest.data.member.membership.id,
    body: { clientRequestId: uuid(), text: '@AI 来个话题', mentions: ['ai'] },
  });
  assert.equal(ignored.status, 201);
  assert.equal(ignored.data.ai.status, 'ignored');
  assert.equal(ignored.data.message.text, '@AI 来个话题');
});

test('连接票据一次性且绑定当前入房', async t => {
  const h = await harness();
  t.after(() => h.close());

  const host = await createHost(h);
  const ticket = await h.call({
    method: 'POST',
    url: `/api/v1/rooms/${host.roomId}/connection-tickets`,
    credential: host.credential,
    membershipId: host.membershipId,
  });
  assert.equal(ticket.status, 201);
  validateModel('ConnectionTicketData', ticket.data, 'connection-ticket');
  assert.match(ticket.data.webSocketUrl, /^ws:\/\//);
  assert.equal(ticket.data.membershipId, host.membershipId);
});

test('关房后资源不可访问', async t => {
  const h = await harness();
  t.after(() => h.close());

  const host = await createHost(h);
  const closed = await h.call({
    method: 'DELETE',
    url: `/api/v1/rooms/${host.roomId}`,
    credential: host.credential,
    membershipId: host.membershipId,
  });
  assert.equal(closed.status, 200);

  const after = await h.call({ method: 'GET', url: `/api/v1/rooms/${host.roomId}/members/me`, credential: host.credential });
  assert.equal(after.status, 404);
  assert.equal(after.code, 'ROOM_UNAVAILABLE');
});

test('房主主动退出即关房，普通成员退出只释放名额', async t => {
  const h = await harness();
  t.after(() => h.close());

  const host = await createHost(h);
  const guest = await joinGuest(h, host.roomId, host.inviteCode, '小周');

  const guestLeft = await h.call({
    method: 'DELETE',
    url: `/api/v1/rooms/${host.roomId}/members/me`,
    credential: guest.data.memberCredential,
    membershipId: guest.data.member.membership.id,
  });
  assert.equal(guestLeft.status, 200);
  assert.equal(guestLeft.data.roomClosed, false);

  // 已退出身份仍可查身份，但 membership 为 null。
  const self = await h.call({
    method: 'GET',
    url: `/api/v1/rooms/${host.roomId}/members/me`,
    credential: guest.data.memberCredential,
  });
  assert.equal(self.data.member.membership, null);

  const hostLeft = await h.call({
    method: 'DELETE',
    url: `/api/v1/rooms/${host.roomId}/members/me`,
    credential: host.credential,
    membershipId: host.membershipId,
  });
  assert.equal(hostLeft.data.roomClosed, true);
});
