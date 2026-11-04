/**
 * infrastructure/model 离线测试。
 * 清洗与闸门用例来自真实调用中观察到的缺陷，不消耗外部额度。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { analyzeOutput, cleanOutput, rejectOutput } from '../src/infrastructure/model/sanitize.ts';
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

test('清洗：超长硬裁剪到上限并用省略号标记，不再按句号缩短', () => {
  const long = `这是第一句话用来测试截断效果。${'后面还有很多很多内容'.repeat(10)}`;
  const r = cleanOutput(long, 30);
  assert.equal(r.length, 30, `应裁剪到上限，实际 ${r.length}`);
  assert.ok(r.endsWith('…'), `超长输出应带省略号标记：${r}`);
});

test('清洗：超过上限后结果固定，后续标点不会让已输出文本变短', () => {
  const prefix = '啊'.repeat(69);
  const s69 = cleanOutput(prefix);
  const s70 = cleanOutput(`${prefix}吧`);
  const s72 = cleanOutput(`${prefix}吧。后面还有更多内容`);

  assert.equal(s69.length, 69);
  assert.equal(s70.length, 70);
  assert.equal(s72.length, 70, '越过上限后长度固定');
  assert.ok(s72.startsWith(s69.slice(0, 68)), '已输出的前缀必须被保留');
  assert.ok(s72.endsWith('…'));
});

// ---------- 前导定型（流式缓冲的依据） ----------

test('分析：前导未定型时不输出，「主持」补成「发言：」后正文才出现', () => {
  const partial = analyzeOutput('主持');
  assert.equal(partial.text, '');
  assert.equal(partial.headSettled, false, '补上「发言：」会让开头两个字消失');

  const completed = analyzeOutput(
    '主持发言：你们周末一般都怎么过呀？是出门走走，还是在家待着，有没有什么固定安排？',
  );
  assert.equal(completed.headSettled, true);
  assert.equal(completed.text, '你们周末一般都怎么过呀？是出门走走，还是在家待着，有没有什么固定安排？');
});

test('分析：单行短正文在 30 字窗口内保持未定型，写完一行才定型', () => {
  const short = analyzeOutput('你们周末都怎么过呀？');
  assert.equal(short.headSettled, false, '后续仍可能出现引导性冒号');

  const multiLine = analyzeOutput('你们周末都怎么过呀？\n另外想问问大家。');
  assert.equal(multiLine.headSettled, true, '换行说明首行已经写完');
  assert.equal(multiLine.text, '你们周末都怎么过呀？');
});

test('分析：未闭合的【】随时会被整段剥离，不得提前输出', () => {
  const partial = analyzeOutput('【bridge');
  assert.equal(partial.text, '');
  assert.equal(partial.headSettled, false);

  const completed = analyzeOutput('【bridge】你们俩聊聊？');
  assert.equal(completed.text, '你们俩聊聊？');
});

test('分析：围栏后面的未闭合【】也要缓冲（不能只看原文开头）', () => {
  const raw = `\`\`\`\n【bridge${'还有一个很长的说明'.repeat(3)}`;
  const analysis = analyzeOutput(raw);
  assert.equal(analysis.headSettled, false, '剥掉围栏后仍未闭合，不能提前定型');
  assert.equal(analysis.text, '', '未闭合标记不能提前交给应用层');
});

test('清洗：长行末尾的冒号不会让整行被当作元话语丢弃', () => {
  const line = '你们周末一般都怎么过呀？最近我一直在琢磨到底要不要说说大家的安排：';
  const r = cleanOutput(line);
  assert.equal(r, line, '长行里的正文不能因为行尾冒号被整行丢弃');
  assert.equal(analyzeOutput(line).headSettled, true, '超过丢弃长度上限后不会再被整行改写');
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
  const recent = [{ text: '我觉得远程办公挺好的，省通勤', nickname: '小林' }];
  assert.equal(
    rejectOutput('小林：我觉得远程办公挺好的，省通勤', recent, ['小林']),
    'LOOKS_LIKE_TRANSCRIPT',
  );
});

test('闸门：引导语带冒号不误判为转录（真实缺陷回归）', () => {
  // AI 说「换个话题：你露营时拍过哪张照片…」被连续三轮判成转录，最后报
  // 「模型未产出可用文本」。冒号前的短标签不是任何成员昵称，就不该拦。
  const recent = [{ text: '你还有没有其他话题', nickname: '小帅' }];
  assert.equal(
    rejectOutput('换个话题：你露营时拍过哪张最难忘的照片？', recent, ['小帅']),
    null,
  );
  assert.equal(rejectOutput('补充一下：你们露营一般带什么装备？', recent, ['小帅']), null);
});

test('闸门：冒号前确实是成员昵称才算转录', () => {
  const recent = [{ text: '我觉得远程办公挺好的，省通勤', nickname: '小林' }];
  assert.equal(rejectOutput('小帅：换个话题聊聊露营吧', recent, ['小林', '小帅']), 'LOOKS_LIKE_TRANSCRIPT');
});

test('闸门：没有昵称信息时保持旧的保守判断', () => {
  assert.equal(rejectOutput('换个话题：你们露营一般带什么装备？', []), 'LOOKS_LIKE_TRANSCRIPT');
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

test('提示词：邀答分支点名目标、带出话题标题且不调用工具', () => {
  const target: MemberView = { memberId: 'c', nickname: 'Momo', interestTags: [], bio: '' };
  const p = buildUserPrompt(
    makeRequest({
      purpose: 'invitation',
      invitedMember: target,
      currentTopic: { title: '你们周末怎么过？', content: '' },
    }),
  );
  assert.ok(p.includes('Momo'));
  // 关键：邀答必须带出当前话题的具体标题，而不是笼统说「这个话题」
  assert.ok(p.includes('你们周末怎么过？'), '应带出当前话题标题');
  assert.ok(p.includes('不要只说'), '应要求说清话题而非笼统');
  assert.ok(p.includes('不要调用任何工具'));
});

test('提示词：reply 分支要求有实质内容', () => {
  const caller: MemberView = { memberId: 'a', nickname: '小林', interestTags: [], bio: '' };
  const p = buildUserPrompt(makeRequest({ purpose: 'reply', caller, prompt: '找个话题' }));
  assert.ok(p.includes('实质内容'));
  assert.ok(p.includes('不要用大段客套'));
});

test('提示词：reply 分支带上房主正文', () => {
  const caller: MemberView = { memberId: 'a', nickname: '小林', interestTags: [], bio: '' };
  const p = buildUserPrompt(
    makeRequest({ purpose: 'reply', caller, prompt: '帮我们找个话题聊聊' }),
  );
  assert.ok(p.includes('帮我们找个话题聊聊'));
  assert.ok(p.includes('小林'));
});
