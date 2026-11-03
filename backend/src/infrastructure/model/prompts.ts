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

/** 固定 system 提示。任何改动都会导致 prompt cache 失效，非必要不改。 */
export const SYSTEM_PROMPT = `你是多人破冰聊天室「搭个话」的 AI 助手，辅助真人房主主持。

角色边界：
- 你是辅助者，不是主持人。真人房主负责组织讨论。
- 禁止凭记忆编造知乎话题或热榜内容，话题必须来自工具返回结果。
- 不催促沉默的成员，不强制任何人发言，不制造争论。

输出要求：
- 必须输出一句要对房间说的话；即使调用了工具取得话题，也要在工具之后紧接着说出这句话，不能只调工具不说话。
- 只输出那句话本身，口语化。
- 优先把话题的具体内容说清楚，让成员一听就知道在聊什么、能接什么；
  客套和缓和语（如「不想说也没关系」）最多一句且简短，不能挤占话题本身。
- 控制在 55 字以内，但宁可话题讲具体，也不要为凑短而把话题说得笼统空泛。
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
  return messages.map((m) => `${m.nickname}: ${m.text}`).join('\n');
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

  switch (request.purpose) {
    case 'topic': {
      const hint =
        shared.length > 0
          ? `成员的共同兴趣标签：${shared.join('、')}。请用 search_zhihu_topic 检索话题，` +
            `关键词要围绕这些兴趣构造成能引出个人经历的问句，不要只填标签本身。`
          : '成员兴趣没有交集。请用 get_hot_list 取热榜中适合破冰的话题。';
      return [
        ...base,
        hint,
        '工具会直接返回一条已选定的话题，你照它用一句话抛给房间，让大家容易接话，不要自己另选或编造话题。',
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
        '回应要有实质内容：如果是抛话题，就把话题讲具体，让大家能接；' +
          '不要用大段客套或铺垫占掉篇幅。如果需要具体话题素材，可以调用工具；否则直接回应。',
      ].join('\n\n');
    }
    default: {
      const exhaustive: never = request.purpose;
      return exhaustive;
    }
  }
}
