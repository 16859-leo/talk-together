/**
 * infrastructure/model 离线测试。
 * 清洗与闸门用例来自真实调用中观察到的缺陷，不消耗外部额度。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { cleanOutput, rejectOutput } from '../src/infrastructure/model/sanitize.ts';
import {
  buildUserPrompt,
  commonInterestTags,
  SYSTEM_PROMPT,
} from '../src/infrastructure/model/prompts.ts';
import type { GenerationRequest, MemberView } from '../src/infrastructure/model/types.ts';

// ---------- 输出清洗（真实缺陷回归） ----------

test('清洗：剥掉独占一行的元话语「可以这样追问：」', () => {
  const r = cleanOutput('可以这样追问：\n\n你刚说还行，是哪方面还行呀？');
  assert.ok(!r.includes('可以这样追问'), `残留元话语：${r}`);
  assert.ok(r.includes('还行'));
});

test('清洗：剥掉与正文同行的元话语', () => {
  const r = cleanOutput('可以这样追问：「你说的『还行吧』，是哪一部分让你觉得一般？');
  assert.ok(!r.includes('可以这样追问'), `残留元话语：${r}`);
  assert.ok(r.startsWith('你说的'));
});

test('清洗：剥掉变体「可以追问：」', () => {
  const r = cleanOutput('可以追问：「你说的『还行吧』，是这次体验里哪一段让你觉得只能算还行？');
  assert.ok(!r.includes('可以追问'), `残留元话语：${r}`);
  assert.ok(r.startsWith('你说的'));
});

test('清洗：剥掉长前导变体「把这两点连起来，可以这样回应：」', () => {
  const raw = '小林和阿哲的分歧点其实很集中。把这两点连起来，可以这样回应：你们俩说的不是同一件事，要不互相问问？';
  const r = cleanOutput(raw);
  assert.ok(!r.includes('可以这样回应'), `残留元话语：${r}`);
  assert.ok(r.startsWith('你们俩'));
});

test('清洗：正文中的正常冒号不被误伤', () => {
  assert.equal(cleanOutput('我想问问大家：周末一般都怎么安排？'), '周末一般都怎么安排？');
});

test('清洗：剥掉「主持发言：」前缀', () => {
  assert.equal(cleanOutput('主持发言：大家好呀'), '大家好呀');
});

test('清洗：剥掉【bridge】标记', () => {
  assert.equal(cleanOutput('【主持发言·bridge】你们俩聊聊？'), '你们俩聊聊？');
});

test('清洗：剥掉 code fence', () => {
  assert.equal(cleanOutput('```\n今天过得怎么样？\n```'), '今天过得怎么样？');
});

test('清洗：去掉包裹引号', () => {
  assert.equal(cleanOutput('“最近在忙什么？”'), '最近在忙什么？');
});

test('清洗：去除 Markdown 粗体', () => {
  assert.equal(cleanOutput('**小林**说得有道理，要不展开聊聊？'), '小林说得有道理，要不展开聊聊？');
});

test('清洗：超长按句号截断且不留半句', () => {
  const long = `这是第一句话用来测试截断效果。${'后面还有很多很多内容'.repeat(10)}`;
  const r = cleanOutput(long, 30);
  assert.ok(r.length <= 31, `长度 ${r.length}`);
  assert.ok(/[。？！…]$/.test(r), `结尾不完整：${r}`);
});

test('清洗：纯元话语无正文返回空，交由调用方抛错', () => {
  assert.equal(cleanOutput('可以这样追问：'), '');
});

test('清洗：正常短句原样保留', () => {
  const s = '你们俩的角度不太一样，要不互相问问？';
  assert.equal(cleanOutput(s), s);
});

// ---------- 质量闸门 ----------

test('闸门：拦截复述成员原话', () => {
  const recent = [{ text: '我觉得远程办公挺好的，省通勤' }];
  assert.equal(rejectOutput('小林：我觉得远程办公挺好的，省通勤', recent), 'LOOKS_LIKE_TRANSCRIPT');
});

test('闸门：拦截不带昵称前缀的复述', () => {
  const recent = [{ text: '我最近在学吉他，每天练半小时' }];
  assert.equal(rejectOutput('我最近在学吉他，每天练半小时呢', recent), 'ECHOES_USER_MESSAGE');
});

test('闸门：拦截过短输出', () => {
  assert.equal(rejectOutput('好的', []), 'TOO_SHORT');
});

test('闸门：正常主持发言放行', () => {
  const recent = [{ text: '我觉得远程办公挺好的，省通勤' }];
  assert.equal(rejectOutput('你们俩的角度不太一样，要不互相问问？', recent), null);
});

// ---------- 兴趣交集 ----------

test('兴趣交集：取出两人以上共有的标签', () => {
  const members: MemberView[] = [
    { memberId: 'a', nickname: '小林', interestTags: ['摄影', '露营'], bio: '' },
    { memberId: 'b', nickname: '阿哲', interestTags: ['摄影', '咖啡'], bio: '' },
    { memberId: 'c', nickname: 'Momo', interestTags: ['健身'], bio: '' },
  ];
  assert.deepEqual(commonInterestTags(members), ['摄影']);
});

test('兴趣交集：无交集时返回空', () => {
  const members: MemberView[] = [
    { memberId: 'a', nickname: '小林', interestTags: ['金融'], bio: '' },
    { memberId: 'b', nickname: '阿哲', interestTags: ['二次元'], bio: '' },
  ];
  assert.deepEqual(commonInterestTags(members), []);
});

test('兴趣交集：单人时返回其全部标签', () => {
  const members: MemberView[] = [
    { memberId: 'a', nickname: '小林', interestTags: ['摄影', '露营'], bio: '' },
  ];
  assert.deepEqual(commonInterestTags(members), ['摄影', '露营']);
});

// ---------- 提示词 ----------

function makeRequest(overrides: Partial<GenerationRequest> = {}): GenerationRequest {
  const members: MemberView[] = [
    { memberId: 'a', nickname: '小林', interestTags: ['摄影'], bio: '' },
    { memberId: 'b', nickname: '阿哲', interestTags: ['摄影'], bio: '' },
  ];
  return {
    purpose: 'topic',
    members,
    recentMessages: [],
    currentTopic: null,
    prompt: null,
    caller: null,
    invitedMember: null,
    signal: new AbortController().signal,
    ...overrides,
  };
}

test('提示词：system 明确禁止编造话题', () => {
  assert.ok(SYSTEM_PROMPT.includes('禁止凭记忆编造'));
  assert.ok(SYSTEM_PROMPT.includes('不催促沉默的成员'));
});

test('提示词：有共同兴趣时引导走共同话题检索', () => {
  const p = buildUserPrompt(makeRequest());
  assert.ok(p.includes('共同兴趣标签：摄影'));
  assert.ok(p.includes('search_zhihu_topic'));
});

test('提示词：无共同兴趣时引导走热榜', () => {
  const members: MemberView[] = [
    { memberId: 'a', nickname: '小林', interestTags: ['金融'], bio: '' },
    { memberId: 'b', nickname: '阿哲', interestTags: ['二次元'], bio: '' },
  ];
  const p = buildUserPrompt(makeRequest({ members }));
  assert.ok(p.includes('没有交集'));
  assert.ok(p.includes('get_hot_list'));
});

test('提示词：邀答分支点名目标且声明不调用工具', () => {
  const target: MemberView = { memberId: 'c', nickname: 'Momo', interestTags: [], bio: '' };
  const p = buildUserPrompt(
    makeRequest({
      purpose: 'invitation',
      invitedMember: target,
      currentTopic: { title: '你们周末怎么过？', content: '' },
    }),
  );
  assert.ok(p.includes('Momo'));
  assert.ok(p.includes('不想回答也没关系'));
  assert.ok(p.includes('不要调用任何工具'));
});

test('提示词：reply 分支带上房主正文', () => {
  const caller: MemberView = { memberId: 'a', nickname: '小林', interestTags: [], bio: '' };
  const p = buildUserPrompt(
    makeRequest({ purpose: 'reply', caller, prompt: '帮我们找个话题聊聊' }),
  );
  assert.ok(p.includes('帮我们找个话题聊聊'));
  assert.ok(p.includes('小林'));
});
