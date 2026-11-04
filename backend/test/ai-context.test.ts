/**
 * AI 上下文测试：模型必须看得到自己上一轮说过的话。
 *
 * 真实缺陷（房主提供的会话记录）：连续四次「@AI 有没有别的话题」都在电影这一支上打转，
 * 追问「换个方向」之后又绕回电影。根因不是提示词写得不够狠，而是应用层拼上下文时
 * 只放了成员消息 —— 模型根本不知道自己刚说过什么，也就无从避免重复。
 *
 * 这里用一个记录上下文的假插件验证：第二次调用的 recentMessages 里必须同时有
 * 成员消息和 AI 已完成的回复，且按发生顺序排列。
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { build } from '../src/app.ts';
import { wantsTopicIntent } from '../src/application/ai.ts';
import type {
  Capability,
  CapabilityChunk,
  CapabilityContext,
} from '../src/application/capability.ts';
import { AI_SPEAKER_AUTHOR_ID, AI_SPEAKER_NICKNAME } from '../src/domain/room.ts';
import { secret, testConfig, uuid } from './helpers.ts';

/** 记录每次调用上下文，并立即吐出一句固定文本。 */
class RecordingCapability implements Capability {
  readonly name = 'recording';
  readonly contexts: CapabilityContext[] = [];
  readonly reply: string;

  constructor(reply: string) {
    this.reply = reply;
  }

  async *run(context: CapabilityContext): AsyncIterable<CapabilityChunk> {
    this.contexts.push(context);
    yield { kind: 'text', delta: this.reply };
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

test('AI 上下文：第二次调用能看到 AI 自己已完成的回复', async (t) => {
  const reply = '你们最近一次觉得「值回票价」的体验是什么？';
  const capability = new RecordingCapability(reply);
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
      profile: { nickname: '小林', interestTags: ['电影'], bio: '' },
    },
  });
  assert.equal(created.statusCode, 201);
  const createdBody = created.json() as any;
  const roomId = createdBody.data.room.id as string;
  const credential = createdBody.data.memberCredential as string;
  const membershipId = createdBody.data.member.membership.id as string;

  const say = async (text: string) => {
    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/rooms/${roomId}/messages`,
      headers: { authorization: `Bearer ${credential}`, 'x-membership-id': membershipId },
      payload: { clientRequestId: uuid(), text, mentions: ['ai'] },
    });
    assert.equal(response.statusCode, 201, response.body);
  };

  const service = (app as any).roomService;
  const room = service.authenticate(roomId, credential).room;

  await say('@AI 帮我们找个话题');
  await waitUntil(() => capability.contexts.length === 1, '第一次 AI 调用');
  await waitUntil(
    () => [...room.replies.values()].some((item: any) => item.status === 'completed'),
    '第一条 AI 回复完成',
  );

  // 第一次调用时没有任何 AI 历史，只应有成员消息。
  assert.equal(
    capability.contexts[0]!.recentMessages.some((m) => m.authorId === AI_SPEAKER_AUTHOR_ID),
    false,
    '第一次调用不该凭空出现 AI 历史',
  );

  await say('@AI 我们刚才聊到哪了？');
  await waitUntil(() => capability.contexts.length === 2, '第二次 AI 调用');

  assert.equal(capability.contexts[0]!.purpose, 'topic', '「帮我找个话题」应走选题用途');
  assert.equal(capability.contexts[1]!.purpose, 'reply', '追问上文应走普通回复用途');

  const second = capability.contexts[1]!;
  const aiMessages = second.recentMessages.filter((m) => m.authorId === AI_SPEAKER_AUTHOR_ID);
  assert.equal(aiMessages.length, 1, `第二次上下文应包含 1 条 AI 发言，实际 ${aiMessages.length}`);
  assert.equal(aiMessages[0]!.text, reply, 'AI 历史必须是自己实际说出去的那句话');
  assert.equal(aiMessages[0]!.nickname, AI_SPEAKER_NICKNAME);

  // 顺序：成员提问在前，AI 回复在后；不能把 AI 的话插到提问之前。
  const memberIndex = second.recentMessages.findIndex((m) => m.authorId !== AI_SPEAKER_AUTHOR_ID);
  const aiIndex = second.recentMessages.findIndex((m) => m.authorId === AI_SPEAKER_AUTHOR_ID);
  assert.ok(memberIndex >= 0, '成员消息不能丢');
  assert.ok(aiIndex > memberIndex, 'AI 回复应排在触发它的成员消息之后');
  assert.ok(
    second.recentMessages.some((m) => m.nickname === '小林'),
    '成员昵称必须保留，生成器要靠它识别「谁在说话」',
  );
});

test('意图识别：要话题的提及走 topic，问事实和闲聊走 reply', () => {
  for (const text of [
    '帮我找个话题',
    '还有别的话题吗，换一个',
    '电影的聊过了，电影之外还有什么话题',
    '来点话题吧',
    '换个方向聊',
  ]) {
    assert.equal(wantsTopicIntent(text), true, text);
  }
  for (const text of [
    '帮我们聊起来',
    '《当尼采哭泣》讲了什么',
    '你说的这个是什么意思',
    '你好',
  ]) {
    assert.equal(wantsTopicIntent(text), false, text);
  }
});
