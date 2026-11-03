/**
 * 备用精选话题池。
 *
 * 依据 PRD #1 第 7 节：「知乎接口不可用时，按原始 PRD 使用备用精选话题，
 * 基础聊天继续。」
 *
 * 实测动因：某日 30 条热榜经适宜性筛选后仅 1 条可用。热榜内容不可控，
 * 评委体验当天的热榜可能完全没有适合破冰的条目，因此备用池不是容灾兜底，
 * 而是常规路径的一部分。
 *
 * 话题取向遵循 PRD 5.3「以兴趣和日常经历为主；不主动追问敏感个人信息，
 * 不刻意制造争论」。
 */

import type { TopicCandidate } from './types.ts';

interface FallbackEntry {
  readonly title: string;
  readonly content: string;
  /** 关联兴趣标签，用于 common 选题时按成员兴趣匹配。 */
  readonly tags: readonly string[];
}

const FALLBACK_TOPICS: readonly FallbackEntry[] = [
  {
    title: '长大以后，你弥补了哪些小时候的遗憾？',
    content: '小时候想要却没得到的东西，长大后有没有补上？可以是一件玩具、一次旅行，或者一句话。',
    tags: ['生活', '回忆', '成长'],
  },
  {
    title: '最近有什么让你觉得「今天还不错」的小事？',
    content: '不用是大事。一杯好喝的咖啡、通勤路上的好天气、顺手帮了个忙，都算。',
    tags: ['生活', '日常'],
  },
  {
    title: '你的周末一般怎么过？',
    content: '是出门走走，还是在家待着？有没有什么固定的小习惯。',
    tags: ['生活', '日常', '休息'],
  },
  {
    title: '有什么你一直想学、但还没开始的事？',
    content: '乐器、语言、运动、手艺都可以。是什么拦住了？',
    tags: ['学习', '兴趣', '成长'],
  },
  {
    title: '最近看过什么让你想推荐给别人的电影或剧？',
    content: '不用是新片。打动你的点在哪里？',
    tags: ['电影', '娱乐', '兴趣'],
  },
  {
    title: '你有什么坚持了很久的小习惯？',
    content: '每天走一段路、睡前读几页书、固定周末做饭——这种。',
    tags: ['生活', '习惯', '运动'],
  },
  {
    title: '去过哪个地方，让你还想再去一次？',
    content: '可以是旅行目的地，也可以是家附近的小店。',
    tags: ['旅行', '生活', '美食'],
  },
  {
    title: '最近在听什么？',
    content: '歌单里反复播放的那首，或者最近发现的新东西。',
    tags: ['音乐', '兴趣', '娱乐'],
  },
  {
    title: '你做饭吗？有什么拿手的或者翻车的经历？',
    content: '从外卖到下厨，中间总有点故事。',
    tags: ['美食', '做饭', '生活'],
  },
  {
    title: '有养宠物吗，或者想养什么？',
    content: '猫狗、鱼、植物都算。有没有什么好笑的日常。',
    tags: ['宠物', '生活'],
  },
  {
    title: '最近读的书里，有哪句话让你记住了？',
    content: '不用完整复述，印象里的意思就行。',
    tags: ['读书', '兴趣', '学习'],
  },
  {
    title: '你平时怎么放松？',
    content: '累的时候有什么固定做法，打游戏、散步、睡觉都算。',
    tags: ['休息', '生活', '运动'],
  },
  {
    title: '有没有一次旅行或出行，过程比目的地更难忘？',
    content: '误点的火车、临时改的路线、路上遇到的人。',
    tags: ['旅行', '经历', '生活'],
  },
  {
    title: '你小时候最喜欢玩什么？',
    content: '现在回想还觉得有意思的那种。',
    tags: ['回忆', '童年', '游戏'],
  },
  {
    title: '如果多出一天假期，你最想拿它做什么？',
    content: '什么都不干也是一个答案。',
    tags: ['生活', '休息', '假期'],
  },
  {
    title: '有什么东西你用了很久、一直没换？',
    content: '一个杯子、一件衣服、一支笔——为什么留着。',
    tags: ['生活', '日常', '回忆'],
  },
  {
    title: '最近有尝试过什么新东西吗？',
    content: '新的店、新的运动、新的做法，结果怎么样。',
    tags: ['兴趣', '生活', '尝试'],
  },
  {
    title: '你怎么挑要看的电影或要读的书？',
    content: '看评分、听人推荐，还是随手撞上。',
    tags: ['电影', '读书', '兴趣'],
  },
  {
    title: '有什么运动是你能坚持下来的？',
    content: '或者试过但放弃了的，也可以聊聊原因。',
    tags: ['运动', '健身', '习惯'],
  },
  {
    title: '你住的地方附近，有什么值得一提的小店？',
    content: '常去的饭馆、咖啡店、书店都算。',
    tags: ['生活', '美食', '日常'],
  },
];

/** 按兴趣标签匹配备用话题，匹配不到则返回通用话题。 */
export function pickFallbackTopics(
  interestTags: readonly string[],
  limit: number,
): readonly TopicCandidate[] {
  const normalized = interestTags.map((tag) => tag.trim()).filter((tag) => tag.length > 0);

  const scored = FALLBACK_TOPICS.map((entry) => {
    let score = 0;
    for (const tag of normalized) {
      for (const entryTag of entry.tags) {
        if (entryTag.includes(tag) || tag.includes(entryTag)) {
          score += 1;
          break;
        }
      }
    }
    return { entry, score };
  });

  scored.sort((a, b) => b.score - a.score);

  const take = Math.max(1, Math.min(limit, FALLBACK_TOPICS.length));
  return scored.slice(0, take).map(({ entry, score }) => ({
    title: entry.title,
    content: entry.content,
    // 命中兴趣标签视为共同话题，否则按通用话题处理。
    kind: score > 0 ? ('common' as const) : ('popular' as const),
    sourceLabel: null,
    sourceUrl: null,
  }));
}

export const fallbackTopicCount = FALLBACK_TOPICS.length;
