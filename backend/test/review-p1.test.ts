import assert from 'node:assert/strict';
import { test } from 'node:test';
import { WebSocket } from 'ws';
import { build } from '../src/app.ts';
import { createStubCapability } from '../src/application/capability.ts';
import { createHost, harness, joinGuest, secret, testConfig, uuid, validateModel } from './helpers.ts';
import type { Config } from '../src/config.ts';

/**
 * PR #7 review 提出的 12 项问题的回归测试。
 *
 * 每个用例都对应一条实测失败路径，修复前必须失败。
 */

// ======================================================= P1-1 请求契约校验

test('[P1-1] 缺少必填字段的建房请求被拒绝', async t => {
  const h = await harness();
  t.after(() => h.close());

  // 省略 bootstrapToken 与 clientRequestId，此前会返回 201 并共享 undefined 引导键。
  const missing = await h.call({
    method: 'POST',
    url: '/api/v1/rooms',
    body: { profile: { nickname: '小林', interestTags: ['阅读'], bio: '' } },
  });
  assert.equal(missing.status, 400);
  assert.equal(missing.code, 'VALIDATION_ERROR');
  const paths = missing.data.fieldErrors.map((e: any) => e.path);
  assert.ok(paths.includes('/clientRequestId'), `缺少 clientRequestId 未报告：${JSON.stringify(paths)}`);
  assert.ok(paths.includes('/bootstrapToken'), `缺少 bootstrapToken 未报告：${JSON.stringify(paths)}`);
});

test('[P1-1] 两次省略引导凭证不会取回同一房主凭证', async t => {
  const h = await harness();
  t.after(() => h.close());

  const body = { profile: { nickname: '小林', interestTags: ['阅读'], bio: '' } };
  const first = await h.call({ method: 'POST', url: '/api/v1/rooms', body });
  const second = await h.call({ method: 'POST', url: '/api/v1/rooms', body });
  assert.equal(first.status, 400);
  assert.equal(second.status, 400);
});

test('[P1-1] 非法类型不再导致 500', async t => {
  const h = await harness();
  t.after(() => h.close());

  // bio: null 此前触发 500。
  const badBio = await h.call({
    method: 'POST',
    url: '/api/v1/rooms',
    body: {
      clientRequestId: uuid(),
      bootstrapToken: secret(),
      profile: { nickname: '小林', interestTags: ['阅读'], bio: null },
    },
  });
  assert.equal(badBio.status, 400);
  assert.equal(badBio.code, 'VALIDATION_ERROR');

  // Secret 格式不符（太短、含非法字符）。
  const badToken = await h.call({
    method: 'POST',
    url: '/api/v1/rooms',
    body: {
      clientRequestId: uuid(),
      bootstrapToken: 'short!!',
      profile: { nickname: '小林', interestTags: ['阅读'], bio: '' },
    },
  });
  assert.equal(badToken.status, 400);

  // clientRequestId 不是 uuid。
  const badId = await h.call({
    method: 'POST',
    url: '/api/v1/rooms',
    body: {
      clientRequestId: 'not-a-uuid',
      bootstrapToken: secret(),
      profile: { nickname: '小林', interestTags: ['阅读'], bio: '' },
    },
  });
  assert.equal(badId.status, 400);
});

test('[P1-1] 不接受契约未定义的额外字段', async t => {
  const h = await harness();
  t.after(() => h.close());

  const extra = await h.call({
    method: 'POST',
    url: '/api/v1/rooms',
    body: {
      clientRequestId: uuid(),
      bootstrapToken: secret(),
      profile: { nickname: '小林', interestTags: ['阅读'], bio: '' },
      role: 'host',
    },
  });
  assert.equal(extra.status, 400);
});

// ======================================================= P1-2 AI 提及格式

test('[P1-2] 房主用契约格式 mentions:["ai"] 能创建 AI 调用', async t => {
  const h = await harness();
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
  validateModel('SendMessageData', sent.data, 'sendMessage');
  assert.notEqual(sent.data.ai.status, 'not_requested', '契约格式的提及必须创建调用');
  assert.ok(['queued', 'running'].includes(sent.data.ai.status), JSON.stringify(sent.data.ai));
  assert.ok(sent.data.ai.invocationId);
});

test('[P1-2] 契约不允许的对象数组 mentions 被请求校验拒绝', async t => {
  const h = await harness();
  t.after(() => h.close());

  const host = await createHost(h);
  const bad = await h.call({
    method: 'POST',
    url: `/api/v1/rooms/${host.roomId}/messages`,
    credential: host.credential,
    membershipId: host.membershipId,
    body: { clientRequestId: uuid(), text: 'hi', mentions: [{ type: 'ai' }] },
  });
  assert.equal(bad.status, 400);
  assert.equal(bad.code, 'VALIDATION_ERROR');
});

test('[P1-2] 普通成员的契约格式提及仍按普通聊天处理', async t => {
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
});
