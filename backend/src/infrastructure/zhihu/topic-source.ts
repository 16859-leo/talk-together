/**
 * 话题数据源门面。
 *
 * 对上层（工具编排）只暴露两个语义化方法，隐藏缓存、去重、筛选与回落细节。
 *
 * 额度保护（实测：热榜 100 次/天、搜索 5000 次/天）：
 *   - 热榜按房间间共享缓存，TTL 默认 15 分钟，100 次/天绰绰有余
 *   - 并发去重：同一时刻的重复请求合并为一次真实调用
 *   - 任一失败均回落备用话题池，保证基础聊天不受影响（PRD 第 7 节）
 */

import type { TopicCandidate, ZhihuContentSource } from './types.ts';
import { CapabilityError, isNonBlankText } from './types.ts';
import { screenHotItems, isIcebreakingTitle } from './screening.ts';
import { pickFallbackTopics } from './fallback.ts';

export interface TopicSourceOptions {
  /** 热榜缓存有效期。实测额度 100 次/天，建议不低于 15 分钟。 */
  readonly hotCacheTtlMs?: number;
  /** 搜索结果缓存有效期。额度 5000 次/天，较宽松。 */
  readonly searchCacheTtlMs?: number;
  /** 注入时间源，便于测试不依赖真实等待。 */
  readonly now?: () => number;
}

interface CacheEntry<T> {
  readonly value: T;
  readonly expiresAt: number;
}

/** 截断过长正文，避免把大段原文塞进模型上下文。 */
const MAX_CONTENT_LENGTH = 120;

function clip(text: string, max = MAX_CONTENT_LENGTH): string {
  const trimmed = text.trim().replace(/\s+/g, ' ');
  if (trimmed.length <= max) return trimmed;
  return `${trimmed.slice(0, max)}…`;
}

export class ZhihuTopicSource {
  readonly #source: ZhihuContentSource;
  readonly #hotTtl: number;
  readonly #searchTtl: number;
  readonly #now: () => number;

  #hotCache: CacheEntry<readonly TopicCandidate[]> | null = null;
  #hotInFlight: Promise<readonly TopicCandidate[]> | null = null;
  readonly #searchCache = new Map<string, CacheEntry<readonly TopicCandidate[]>>();
  readonly #searchInFlight = new Map<string, Promise<readonly TopicCandidate[]>>();

  /** 可观测计数，便于验证缓存确实生效。 */
  #upstreamHotCalls = 0;
  #upstreamSearchCalls = 0;

  constructor(source: ZhihuContentSource, options: TopicSourceOptions = {}) {
    this.#source = source;
    this.#hotTtl = options.hotCacheTtlMs ?? 15 * 60_000;
    this.#searchTtl = options.searchCacheTtlMs ?? 10 * 60_000;
    this.#now = options.now ?? Date.now;
  }

  get stats(): { readonly hotCalls: number; readonly searchCalls: number } {
    return { hotCalls: this.#upstreamHotCalls, searchCalls: this.#upstreamSearchCalls };
  }

  /**
   * 按关键词检索共同话题（契约 Topic.kind = "common"）。
   * 对应 PRD 5.3「根据成员主动填写的公开资料，优先寻找共同话题」。
   */
  async searchCommonTopics(
    keyword: string,
    options: { readonly count?: number; readonly interestTags?: readonly string[]; readonly signal?: AbortSignal } = {},
  ): Promise<readonly TopicCandidate[]> {
    const normalized = keyword.trim();
    const count = options.count ?? 5;
    if (normalized.length === 0) {
      return pickFallbackTopics(options.interestTags ?? [], count);
    }

    const key = `${normalized}::${count}`;
    const cached = this.#searchCache.get(key);
    if (cached !== undefined && cached.expiresAt > this.#now()) {
      return cached.value;
    }

    const existing = this.#searchInFlight.get(key);
    if (existing !== undefined) return existing;

    const task = (async (): Promise<readonly TopicCandidate[]> => {
      this.#upstreamSearchCalls += 1;
      const items = await this.#source.searchZhihu(normalized, count, options.signal);
      return items.flatMap<TopicCandidate>((item) => {
        // 搜索结果与热榜适用同一套适宜性标准：课程讲义、攻略、清单
        // 虽与关键词相关，但不是能让陌生人聊起来的话题。
        if (!isIcebreakingTitle(item.title).ok) return [];
        const content = clip(item.contentText.length > 0 ? item.contentText : item.title);
        if (!isNonBlankText(content)) return [];
        return [
          {
            title: clip(item.title, 60),
            content,
            kind: 'common',
            sourceLabel: item.authorName === null ? '知乎' : `知乎 · ${item.authorName}`,
            sourceUrl: item.url,
          },
        ];
      });
    })();

    this.#searchInFlight.set(key, task);
    try {
      const value = await task;
      if (value.length === 0) {
        return pickFallbackTopics(options.interestTags ?? [], count);
      }
      this.#searchCache.set(key, { value, expiresAt: this.#now() + this.#searchTtl });
      return value;
    } catch (error) {
      if (error instanceof CapabilityError && error.code === 'AI_CANCELLED') throw error;
      // PRD 第 7 节：知乎接口不可用时使用备用精选话题，基础聊天继续。
      return pickFallbackTopics(options.interestTags ?? [], count);
    } finally {
      this.#searchInFlight.delete(key);
    }
  }

  /**
   * 取热榜中适合破冰的话题（契约 Topic.kind = "popular"）。
   * 对应 PRD 5.3「兴趣差异较大时，选择当前知乎热榜上排名较高、适合破冰的话题」。
   */
  async getPopularTopics(
    options: { readonly limit?: number; readonly interestTags?: readonly string[]; readonly signal?: AbortSignal } = {},
  ): Promise<readonly TopicCandidate[]> {
    const limit = options.limit ?? 5;

    const cached = this.#hotCache;
    if (cached !== null && cached.expiresAt > this.#now()) {
      return cached.value.length > 0
        ? cached.value.slice(0, limit)
        : pickFallbackTopics(options.interestTags ?? [], limit);
    }

    if (this.#hotInFlight !== null) {
      const shared = await this.#hotInFlight;
      return shared.length > 0 ? shared.slice(0, limit) : pickFallbackTopics(options.interestTags ?? [], limit);
    }

    const task = (async (): Promise<readonly TopicCandidate[]> => {
      this.#upstreamHotCalls += 1;
      const items = await this.#source.getHotList(30, options.signal);
      const screened = screenHotItems(items);
      return screened.accepted.flatMap<TopicCandidate>(({ item }) => {
        const content = clip(item.summary.length > 0 ? item.summary : item.title);
        if (!isNonBlankText(content)) return [];
        return [
          {
            title: clip(item.title, 60),
            content,
            kind: 'popular',
            sourceLabel: '知乎热榜',
            sourceUrl: item.url,
          },
        ];
      });
    })();

    this.#hotInFlight = task;
    try {
      const value = await task;
      // 即使筛选后为空也缓存，避免反复打同一份不可用的热榜。
      this.#hotCache = { value, expiresAt: this.#now() + this.#hotTtl };
      return value.length > 0 ? value.slice(0, limit) : pickFallbackTopics(options.interestTags ?? [], limit);
    } catch (error) {
      if (error instanceof CapabilityError && error.code === 'AI_CANCELLED') throw error;
      return pickFallbackTopics(options.interestTags ?? [], limit);
    } finally {
      this.#hotInFlight = null;
    }
  }
}
