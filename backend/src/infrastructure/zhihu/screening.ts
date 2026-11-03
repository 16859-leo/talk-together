/**
 * 破冰适宜性筛选。
 *
 * 依据 PRD #1 第 5.3 节：「选择当前知乎热榜上排名较高、适合破冰的话题」
 *                      「话题以兴趣和日常经历为主；不主动追问敏感个人信息，不刻意制造争论」
 *
 * 实测动因：某日 30 条热榜中适合陌生人破冰的不足 5 条，其余为时政冲突、
 * 垂直门槛、行业数据类。若不筛选，自动选题会选出争议性话题。
 *
 * 注意边界：这里做的是「选题适宜性」，与 PRD 第 6 节「不建设内容审核或自动
 * 内容拦截功能」管辖的「用户消息审核」是不同对象 —— 本模块不检查任何成员
 * 发言，只决定 AI 主动抛出哪些话题。
 */

import type { ZhihuHotItem } from './types.ts';
import { isNonBlankText } from './types.ts';

/** 排除类别。命中任一即判为不适合破冰。 */
const EXCLUDE_PATTERNS: readonly { readonly reason: string; readonly pattern: RegExp }[] = [
  {
    reason: 'conflict',
    pattern: /冲突|争执|打人|殴|斗殴|插队|骚扰|霸凌|歧视|辱骂|纠纷|维权|索赔|诉讼|起诉|判决|立案|逮捕|刑拘|造假|作弊|欺诈|诈骗|曝光|翻车|塌房/,
  },
  {
    reason: 'politics',
    pattern: /选举|大选|议员|总统|政府|官方回应|当地回应|外交|制裁|关税|军事|导弹|战争|停火|谈判|主权|领土|两岸|涉台|涉港|涉疆/,
  },
  {
    reason: 'incident',
    pattern: /事故|坠落|坠机|车祸|火灾|爆炸|地震|洪水|台风|疫情|病例|死亡|身亡|遇难|失联|自杀|猝死|遗体|伤亡/,
  },
  {
    reason: 'market_data',
    pattern: /销量|财报|营收|净利|亏损|股价|市值|融资|估值|涨幅|跌幅|同比|环比|排名第[一二三]|榜首|腰斩|裁员|降薪|涨价|降价/,
  },
  {
    reason: 'vertical',
    pattern: /赛季|常规赛|季后赛|冠军赛|顺位|选秀|战术|阵容|版本更新|补丁|帧率|显卡|算力|架构|协议|内核|源码|论文|定理|公式|原理是什么/,
  },
  {
    reason: 'health_sensitive',
    pattern: /癌|肿瘤|猝死|抑郁|精神病|医保|手术|确诊|病情/,
  },
];

/** 偏好类别。命中越多排序越靠前，但不命中也不会被排除。 */
const PREFER_PATTERNS: readonly RegExp[] = [
  /你们|你有|有没有|你最|大家都|分享|聊聊|怎么看待自己/,
  /经历|故事|回忆|童年|小时候|第一次|印象最深|遗憾|习惯|爱好|兴趣/,
  /生活|日常|周末|假期|旅行|美食|做饭|宠物|电影|音乐|读书|运动|睡眠|通勤|租房/,
  /有趣|好玩|治愈|温暖|快乐|放松|惊喜/,
];

/** 提问式标题更容易接话。 */
const QUESTION_PATTERN = /[？?]$|吗[？?]?$|呢[？?]?$/;

/**
 * 资料贴特征。搜索结果中常见课程讲义、装备清单、选购攻略、品牌测评，
 * 它们与关键词高度相关但不是可以聊起来的话题。
 */
const MATERIAL_PATTERN =
  /第[一二三四五六七八九十\d]+讲|第[一二三四五六七八九十\d]+章|课程|讲义|教程|攻略|清单|指南|手册|测评|评测|推荐榜|排行榜|大全|入门|科普|知识点|干货|总结|笔记|汇总|盘点|品牌|选购|装备|参数|配置|\d{4}年版|CS\d{2,}|[A-Z]{2,}\d{3,}/;

/**
 * 过长标题通常是新闻陈述句。知乎提问式标题本身偏长，阈值取 60 字，
 * 过滤新闻摘要式长标题，同时不误杀正常提问。
 */
const MAX_TITLE_LENGTH = 60;

export interface ScreenedHotItem {
  readonly item: ZhihuHotItem;
  /** 原始热榜排名，从 1 开始。PRD 要求「排名较高」。 */
  readonly rank: number;
  readonly score: number;
}

export interface ScreenResult {
  readonly accepted: readonly ScreenedHotItem[];
  readonly rejected: readonly { readonly title: string; readonly reason: string }[];
}

/**
 * 判断单个标题是否适合破冰。供搜索结果复用同一套适宜性标准。
 *
 * 实测动因：搜索「摄影」会返回「UCB CS180/280A 计算机视觉与计算摄影 第三讲」
 * 这类课程讲义、装备清单、攻略贴，它们与关键词相关但不适合向陌生人抛出。
 */
export function isIcebreakingTitle(title: string): { readonly ok: boolean; readonly reason: string } {
  if (!isNonBlankText(title)) return { ok: false, reason: 'blank_title' };
  if (title.length > MAX_TITLE_LENGTH) return { ok: false, reason: 'too_long' };

  const excluded = EXCLUDE_PATTERNS.find((rule) => rule.pattern.test(title));
  if (excluded !== undefined) return { ok: false, reason: excluded.reason };

  if (MATERIAL_PATTERN.test(title)) return { ok: false, reason: 'material' };

  for (const pattern of PREFER_PATTERNS) {
    if (pattern.test(title)) return { ok: true, reason: 'preferred' };
  }
  return { ok: false, reason: 'not_icebreaking' };
}

/**
 * 筛选热榜条目。
 *
 * 采用白名单式：必须命中至少一个偏好类别才接受，而非仅排除黑名单。
 * 依据 PRD 5.3「话题以兴趣和日常经历为主」—— 与破冰无关的话题即使不涉敏，
 * 也不适合向陌生人抛出。宁可筛空回落备用话题池，也不抛出争议性或垂直话题。
 *
 * 排序由偏好得分主导，原始排名仅作同档微调，避免高排名的争议话题被选中。
 */
export function screenHotItems(items: readonly ZhihuHotItem[]): ScreenResult {
  const accepted: ScreenedHotItem[] = [];
  const rejected: { title: string; reason: string }[] = [];

  items.forEach((item, index) => {
    const title = item.title;

    if (!isNonBlankText(title)) {
      rejected.push({ title, reason: 'blank_title' });
      return;
    }
    if (title.length > MAX_TITLE_LENGTH) {
      rejected.push({ title, reason: 'too_long' });
      return;
    }

    const excluded = EXCLUDE_PATTERNS.find((rule) => rule.pattern.test(title));
    if (excluded !== undefined) {
      rejected.push({ title, reason: excluded.reason });
      return;
    }

    if (MATERIAL_PATTERN.test(title)) {
      rejected.push({ title, reason: 'material' });
      return;
    }

    let preference = 0;
    for (const pattern of PREFER_PATTERNS) {
      if (pattern.test(title)) preference += 1;
    }
    if (preference === 0) {
      rejected.push({ title, reason: 'not_icebreaking' });
      return;
    }

    // 偏好得分主导；提问式 +0.5；排名仅在前 10 名内给最多 0.3 的微调。
    let score = preference * 2;
    if (QUESTION_PATTERN.test(title)) score += 0.5;
    score += Math.max(0, 10 - index) * 0.03;

    accepted.push({ item, rank: index + 1, score });
  });

  accepted.sort((a, b) => (b.score !== a.score ? b.score - a.score : a.rank - b.rank));

  return { accepted, rejected };
}
