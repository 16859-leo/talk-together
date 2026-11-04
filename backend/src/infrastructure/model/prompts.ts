/**
 * 提示词构造。
 *
 * 设计要点：
 * 1. system 固定不变，与工具定义一起置于请求最前，命中 prompt cache
 *    （实测：缓存命中 0.02 元/百万 vs 未命中 1 元/百万，差 50 倍）。
 * 2. 按 PRD 5.2「正常交流期间不主动插话」「不公开催促沉默成员」约束语气。
 * 3. 工具描述写「何时调用」而非「函数做什么」—— 实测这是工具选择准确率的主要来源。
 */

import type { GenerationRequest, MemberView, MessageView } from './types.ts';
import { AI_SPEAKER_AUTHOR_ID, AI_SPEAKER_NICKNAME } from '../../domain/room.ts';

/** 固定 system 提示。任何改动都会导致 prompt cache 失效，非必要不改。 */
export const SYSTEM_PROMPT = `你是多人破冰聊天室「搭个话」的 AI 助手，辅助真人房主主持。

角色边界：
- 你是辅助者，不是主持人。真人房主负责组织讨论。
- 禁止凭记忆编造知乎话题或热榜内容，话题必须来自工具返回结果。
- 回答事实性问题时以检索结果为准；查不到就说没查到，不要编造人物、年份、情节等细节。
- 不催促沉默的成员，不强制任何人发言，不制造争论。

你能做的事（不只会抛话题）：
- 给出一个具体话题，或者按房主要求换一个方向；
- 回答房主的问题、解释一个东西；
- 总结刚才聊到的内容；
- 建议一个马上能开始的破冰活动或小游戏。

输出要求：
- 必须输出一句要对房间说的话；即使调用了工具取得话题，也要在工具之后紧接着说出这句话，不能只调工具不说话。
- 只输出那句话本身，口语化。
- 优先把内容说清楚，让成员一听就知道在聊什么、能接什么；
  客套和缓和语（如「不想说也没关系」）最多一句且简短，不能挤占正文。
- 一般控制在 55 字以内；房主要你解释、回答或总结时可以放宽到 100 字左右，但仍要说人话。
- 不要解释、不要分点、不要加「主持发言：」之类前缀。
- 不要复述成员说过的原话。
- 不要使用 Markdown 标记。`;

function describeMember(member: MemberView): string {
  const tags = member.interestTags.length > 0 ? member.interestTags.join('、') : '未填写';
  const bio = member.bio.trim();
  return bio.length > 0 ? `${member.nickname}（兴趣：${tags}；简介：${bio}）` : `${member.nickname}（兴趣：${tags}）`;
}

function describeMessages(messages: readonly MessageView[]): string {
  if (messages.length === 0) return '（暂无发言）';
  const lines = messages.map((m) => `${m.nickname}: ${m.text}`);
  if (messages.some((m) => m.authorId === AI_SPEAKER_AUTHOR_ID)) {
    // 模型没有「我上一轮说过什么」的记忆，必须显式标注，否则会反复给同一个话题。
    lines.push(`（「${AI_SPEAKER_NICKNAME}」是你自己之前说的话，别重复，也别换个说法再说一遍。）`);
  }
  return lines.join('\n');
}

/** 计算成员兴趣标签的交集，供模型判断走共同话题还是热榜。 */
export function commonInterestTags(members: readonly MemberView[]): readonly string[] {
  const withTags = members.filter((m) => m.interestTags.length > 0);
  if (withTags.length < 2) {
    return withTags[0]?.interestTags ?? [];
  }
  const counts = new Map<string, number>();
  for (const member of withTags) {
    for (const tag of new Set(member.interestTags)) {
      counts.set(tag, (counts.get(tag) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .filter(([, count]) => count >= 2)
    .sort((a, b) => b[1] - a[1])
    .map(([tag]) => tag);
}

export function buildUserPrompt(request: GenerationRequest): string {
  const roster = request.members.map(describeMember).join('\n');
  const history = describeMessages(request.recentMessages);
  const shared = commonInterestTags(request.members);
  const topicLine =
    request.currentTopic === null
      ? '当前没有话题。'
      : `当前话题：${request.currentTopic.title}`;

  const base = [`房间成员：\n${roster}`, topicLine, `最近发言：\n${history}`];
  // 房间里是否已经出现过 AI 发言：决定这一轮是「抛第一个话题」还是「换话题」。
  const hadAiTurn = request.recentMessages.some(
    (message) => message.authorId === AI_SPEAKER_AUTHOR_ID,
  );

  switch (request.purpose) {
    case 'topic': {
      // 已经聊过话题时不再围绕共同兴趣检索：同一批兴趣关键词只会反复捞出同一类话题
      // （真实会话里连问三次都在电影上）。改用热榜，先保证换到别的领域。
      const hint = hadAiTurn
        ? '房间里已经抛过话题了。这次不要再用共同兴趣标签检索，改用 get_hot_list ' +
          '从热榜里挑一条与最近话题不同领域的内容。'
        : shared.length > 0
          ? `成员的共同兴趣标签：${shared.join('、')}。请用 search_zhihu_topic 检索话题，` +
            `关键词要围绕这些兴趣构造成能引出个人经历的问句，不要只填标签本身。`
          : '成员兴趣没有交集。请用 get_hot_list 取热榜中适合破冰的话题。';
      const asked = request.prompt?.trim() ?? '';
      const askLine =
        asked.length === 0 ? [] : [`${request.caller?.nickname ?? '房主'} 对你说：${asked}`];
      return [
        ...base,
        ...askLine,
        hint,
        '工具会直接返回一条已选定的话题，你照它用一句话抛给房间，让大家容易接话，不要自己另选或编造话题。',
        '不要选最近已经聊过、或你自己之前已经提过的方向；换话题要真的换（换领域、换场景或换提问角度），' +
          '不要只把上一轮的话改个说法。如果最近发言里你已经抛过话题，这次必须换到完全不同的领域' +
          '（比如电影换到旅行、吃饭、工作、童年），拿不准就改用 get_hot_list 从热榜里挑一个别的方向。',
      ].join('\n\n');
    }
    case 'invitation': {
      const target = request.invitedMember;
      const name = target === null ? '某位成员' : target.nickname;
      const topicHint =
        request.currentTopic === null
          ? '当前话题'
          : `当前话题「${request.currentTopic.title}」`;
      return [
        ...base,
        `请邀请 ${name} 就${topicHint}分享具体的看法或经历。`,
        '务必把话题的具体内容点出来，让 ' + name + ' 清楚在聊什么、可以从哪个角度接；' +
          '不要只说「聊聊这个话题」这种笼统的话。',
        '可以在结尾用一句简短的话说明不想说也没关系，但这句不要超过十个字，也不要占掉话题。不要调用任何工具。',
      ].join('\n\n');
    }
    case 'reply': {
      const asked = request.prompt?.trim() ?? '';
      const caller = request.caller?.nickname ?? '房主';
      const ask = asked.length > 0 ? `${caller} 对你说：${asked}` : `${caller} 请你说点什么。`;
      return [
        ...base,
        ask,
        '先判断对方要你做什么，再照着做：',
        '· 问事实，或问一部作品、一个人物、一个事件、一个概念是什么、讲了什么 → ' +
          '先用 search_zhihu_knowledge 查资料，再用自己的话一两句回答；' +
          '查不到就直接说没查到，不要凭印象编。回答完不要又强行抛一个话题。',
        '· 让你总结刚才聊的 → 用一两句概括大家聊到的点，可以点成员名字。',
        '· 让你出主意，比如破冰活动、小游戏、玩点什么、怎么不冷场 → 给一个马上能开始的具体做法，' +
          '说清第一步谁做什么。',
        '· 让你找话题、换话题、接一句冷场的话 → 用 search_zhihu_topic 或 get_hot_list 找，' +
          '把话题讲具体；如果之前已经给过话题，就换一个领域（比如电影换到旅行、吃饭、工作），' +
          '不要换个说法说同一件事，拿不准就用 get_hot_list。',
        '· 只是随口聊一句 → 直接回应。',
        '不要用大段客套或铺垫占掉篇幅，也不要编造资料里没有的细节。',
      ].join('\n\n');
    }
    default: {
      const exhaustive: never = request.purpose;
      return exhaustive;
    }
  }
}
