/**
 * 游戏主持的应用层集成测试。
 *
 * 验证：房主的按钮文本 → 应用层识别轮次 → 能力插件拿到 game 任务；
 * 轮次推进/收尾不依赖模型；游戏进行中不触发自动话题。
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { build } from '../src/app.ts';
import { guessedSecret } from '../src/application/ai.ts';
import type {
  Capability,
  CapabilityChunk,
  CapabilityContext,
} from '../src/application/capability.ts';
import { secret, testConfig, uuid } from './helpers.ts';

class RecordingCapability implements Capability {
  readonly name = 'recording';
  readonly contexts: CapabilityContext[] = [];

  async *run(context: CapabilityContext): AsyncIterable<CapabilityChunk> {
    this.contexts.push(context);
    yield { kind: 'text', delta: '好的，这就开始。' };
  }
}

const waitUntil = async (
  predicate: () => boolean,
  label: string,
  timeoutMs = 3000,
): Promise<void> => {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error(`timeout waiting for ${label}`);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
};

test('游戏：房主按钮推进轮次，能力插件拿到带任务的主持上下文', async (t) => {
  const capability = new RecordingCapability();
  const app = await build({
    config: testConfig({ idle: { topicMs: 45_000, invitationMs: 30_000, tickMs: 3_600_000 } }),
    capability,
  });
  t.after(() => app.close());

  const created = await app.inject({
    method: 'POST',
    url: '/api/v1/rooms',
    payload: {
      clientRequestId: uuid(),
      bootstrapToken: secret(),
      profile: { nickname: '房主小林', interestTags: ['电影'], bio: '' },
    },
  });
  assert.equal(created.statusCode, 201);
  const createdBody = created.json() as any;
  const roomId = createdBody.data.room.id as string;
  const credential = createdBody.data.memberCredential as string;
  const membershipId = createdBody.data.member.membership.id as string;

  const service = (app as any).roomService;
  const room = service.authenticate(roomId, credential).room;

  const say = async (text: string) => {
    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/rooms/${roomId}/messages`,
      headers: { authorization: `Bearer ${credential}`, 'x-membership-id': membershipId },
      payload: { clientRequestId: uuid(), text, mentions: ['ai'] },
    });
    assert.equal(response.statusCode, 201, response.body);
  };

  // 开局
  await say('@AI 来玩默契二选一');
  await waitUntil(() => capability.contexts.length === 1, '开局调用');
  const started = capability.contexts[0]!.game;
  assert.ok(started, '开局这一轮必须带 game 任务');
  assert.equal(started.phase, 'start');
  assert.equal(started.round, 1);
  assert.equal(started.totalRounds, 5);
  assert.ok(started.instruction.includes('二选一'), '任务文案应来自游戏插件');
  assert.deepEqual(
    { gameId: room.game.gameId, round: room.game.round },
    { gameId: 'this-or-that', round: 1 },
  );

  // 游戏进行中：冷场自动话题必须让位
  await waitUntil(() => room.running === null, '开局回复结束');
  assert.equal(service.aiService(roomId).triggerAutomatic('topic'), null);

  // 下一题
  await say('@AI 下一题');
  await waitUntil(() => capability.contexts.length === 2, '第二轮调用');
  assert.equal(capability.contexts[1]!.game?.phase, 'round');
  assert.equal(capability.contexts[1]!.game?.round, 2);
  assert.equal(room.game.round, 2);

  // 收尾
  await say('@AI 结束游戏');
  await waitUntil(() => capability.contexts.length === 3, '收尾调用');
  assert.equal(capability.contexts[2]!.game?.phase, 'end');
  assert.equal(room.game, null, '收尾后不再有进行中的游戏');

  // 收尾之后「下一题」回到普通回复，不会凭空开一局
  await say('@AI 下一题');
  await waitUntil(() => capability.contexts.length === 4, '收尾后的普通回复');
  assert.equal(capability.contexts[3]!.game, null);
});

test('游戏：二十问的暗牌开局抽定，后面每一轮都是同一张', async (t) => {
  const capability = new RecordingCapability();
  const app = await build({
    config: testConfig({ idle: { topicMs: 45_000, invitationMs: 30_000, tickMs: 3_600_000 } }),
    capability,
  });
  t.after(() => app.close());

  const created = await app.inject({
    method: 'POST',
    url: '/api/v1/rooms',
    payload: {
      clientRequestId: uuid(),
      bootstrapToken: secret(),
      profile: { nickname: '房主阿哲', interestTags: ['电影'], bio: '' },
    },
  });
  const body = created.json() as any;
  const roomId = body.data.room.id as string;
  const credential = body.data.memberCredential as string;
  const membershipId = body.data.member.membership.id as string;
  const service = (app as any).roomService;
  const room = service.authenticate(roomId, credential).room;

  const say = async (text: string) => {
    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/rooms/${roomId}/messages`,
      headers: { authorization: `Bearer ${credential}`, 'x-membership-id': membershipId },
      payload: { clientRequestId: uuid(), text, mentions: ['ai'] },
    });
    assert.equal(response.statusCode, 201, response.body);
  };

  await say('@AI 来玩二十问猜词');
  await waitUntil(() => capability.contexts.length === 1, '二十问开局');
  const secretWord = room.game.secret as string;
  assert.equal(typeof secretWord, 'string');
  assert.ok(capability.contexts[0]!.game?.instruction.includes(secretWord), '开局任务要带暗牌');

  await say('@AI 下一问');
  await waitUntil(() => capability.contexts.length === 2, '二十问第二轮');
  assert.equal(capability.contexts[1]!.game?.round, 2);
  assert.equal(room.game.secret, secretWord, '中途不能换暗牌');
  assert.ok(
    capability.contexts[1]!.game?.instruction.includes(secretWord),
    '第二轮任务要继续带同一张暗牌',
  );

  await say('@AI 结束游戏');
  await waitUntil(() => capability.contexts.length === 3, '二十问收尾');
  assert.ok(
    capability.contexts[2]!.game?.instruction.includes(secretWord),
    '收尾要公布同一张暗牌',
  );
});

test('游戏：二十问被猜中后自动收尾，不需要房主再点下一问', async (t) => {
  const capability = new RecordingCapability();
  const app = await build({
    config: testConfig({ idle: { topicMs: 45_000, invitationMs: 30_000, tickMs: 3_600_000 } }),
    capability,
  });
  t.after(() => app.close());

  const created = await app.inject({
    method: 'POST',
    url: '/api/v1/rooms',
    payload: {
      clientRequestId: uuid(),
      bootstrapToken: secret(),
      profile: { nickname: '房主小林', interestTags: ['电影'], bio: '' },
    },
  });
  const body = created.json() as any;
  const roomId = body.data.room.id as string;
  const inviteCode = body.data.room.invitation.inviteCode as string;
  const credential = body.data.memberCredential as string;
  const membershipId = body.data.member.membership.id as string;
  const service = (app as any).roomService;
  const room = service.authenticate(roomId, credential).room;

  // 另一个人进房，才有「成员猜中」的场景。
  const guest = await app.inject({
    method: 'POST',
    url: `/api/v1/rooms/${roomId}/members`,
    payload: {
      clientRequestId: uuid(),
      bootstrapToken: secret(),
      inviteCode,
      profile: { nickname: '小帅', interestTags: ['电影'], bio: '' },
    },
  });
  assert.equal(guest.statusCode, 201, guest.body);
  const guestCredential = (guest.json() as any).data.memberCredential as string;
  const guestMembership = (guest.json() as any).data.member.membership.id as string;

  await app.inject({
    method: 'POST',
    url: `/api/v1/rooms/${roomId}/messages`,
    headers: { authorization: `Bearer ${credential}`, 'x-membership-id': membershipId },
    payload: { clientRequestId: uuid(), text: '@AI 来玩二十问猜词', mentions: ['ai'] },
  });
  await waitUntil(() => capability.contexts.length === 1, '二十问开局');
  const secretWord = room.game.secret as string;
  assert.equal(typeof secretWord, 'string');

  // 无关消息不能结束游戏。
  await app.inject({
    method: 'POST',
    url: `/api/v1/rooms/${roomId}/messages`,
    headers: { authorization: `Bearer ${guestCredential}`, 'x-membership-id': guestMembership },
    payload: { clientRequestId: uuid(), text: '这是悬疑的吗' },
  });
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(capability.contexts.length, 1, '没猜中不能触发收尾');
  assert.ok(room.game !== null, '游戏应继续');

  // 猜中暗牌：自动收尾，不需要房主下指令。
  await app.inject({
    method: 'POST',
    url: `/api/v1/rooms/${roomId}/messages`,
    headers: { authorization: `Bearer ${guestCredential}`, 'x-membership-id': guestMembership },
    payload: { clientRequestId: uuid(), text: `是${secretWord}吗` },
  });
  await waitUntil(() => capability.contexts.length === 2, '猜中后的自动收尾');

  const ending = capability.contexts[1]!.game;
  assert.ok(ending, '收尾这一轮也要带 game 任务');
  assert.equal(ending.phase, 'end');
  assert.ok(ending.instruction.includes('猜对了'), '收尾任务要求先说猜对了');
  assert.ok(ending.instruction.includes(secretWord), '收尾要公布答案');
  assert.equal(room.game, null, '猜中后游戏立即结束');
});

test('猜中判定：只认猜答案的说法，闲聊提到不算', () => {
  assert.equal(guessedSecret('是千与千寻吗', '千与千寻'), true);
  assert.equal(guessedSecret('千与千寻', '千与千寻'), true);
  assert.equal(guessedSecret('答案是不是《千与千寻》？', '千与千寻'), true);
  assert.equal(guessedSecret('我今天坐地铁上班迟到了', '地铁'), false);
  assert.equal(guessedSecret('还没想好', '地铁'), false);
});
