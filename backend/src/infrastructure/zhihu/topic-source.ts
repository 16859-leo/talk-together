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

  /** 缓存命中时的轮转游标，让同一批热榜在多次调用间轮换起点。 */
  #hotRotation = 0;

  /**
   * 从候选列表中轮转取 limit 条，且每次调用都推进起点。
   * 只要池内有 2 条以上，连续调用返回的「第一条」就会不同 ——
   * 这是关键：模型工具通常请求较大的 limit（如 10），若只在 pool>limit 时
   * 才轮转，limit 覆盖整池就永远原样返回、第一条不变，导致话题重复。
   */
  #rotate(pool: readonly TopicCandidate[], limit: number): readonly TopicCandidate[] {
    if (pool.length <= 1) return pool;
    const start = this.#hotRotation % pool.length;
    this.#hotRotation += 1;
    const rotated = [...pool.slice(start), ...pool.slice(0, start)];
    return rotated.slice(0, limit);
  }

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

    // 共享上游请求不绑定任一调用者的 signal，避免某个房间取消连累其他等待者。
    let shared = this.#searchInFlight.get(key);
    if (shared === undefined) {
      shared = (async (): Promise<readonly TopicCandidate[]> => {
        this.#upstreamSearchCalls += 1;
        const items = await this.#source.searchZhihu(normalized, count);
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
      this.#searchInFlight.set(key, shared);
      // 请求结束即清理 in-flight，无论成败。缓存写入在各调用者侧按结果处理。
      shared.finally(() => {
        if (this.#searchInFlight.get(key) === shared) this.#searchInFlight.delete(key);
      }).catch(() => {});
    }

    // 每个调用者独立响应自己的取消，并对共享结果各自做降级。
    const outcome = await this.#awaitShared(shared, options.signal, () =>
      pickFallbackTopics(options.interestTags ?? [], count),
    );
    const value =
      !outcome.degraded && outcome.value.length > 0
        ? outcome.value
        : pickFallbackTopics(options.interestTags ?? [], count);

    // 只缓存上游真实返回的结果。降级话题是按「当前调用者兴趣」挑的，
    // 写进仅以关键词+数量为键的共享缓存会污染其他房间（且 10 分钟内不再访问上游）。
    if (!outcome.degraded && outcome.value.length > 0) {
      this.#searchCache.set(key, { value, expiresAt: this.#now() + this.#searchTtl });
    }
    return value;
  }

  /**
   * 等待共享上游请求，但只对「本调用者自己的」signal 响应取消；
   * 上游失败时走各自的降级回调，不把异常泄露给等待者。
   * 返回值带 degraded 标记，供调用方决定能否写入共享缓存。
   */
  async #awaitShared(
    shared: Promise<readonly TopicCandidate[]>,
    signal: AbortSignal | undefined,
    fallback: () => readonly TopicCandidate[],
  ): Promise<{ readonly value: readonly TopicCandidate[]; readonly degraded: boolean }> {
    if (signal?.aborted === true) throw new CapabilityError('AI_CANCELLED', '调用已取消');

    const cancelled = new Promise<never>((_, reject) => {
      if (signal === undefined) return;
      signal.addEventListener(
        'abort',
        () => reject(new CapabilityError('AI_CANCELLED', '调用已取消')),
        { once: true },
      );
    });

    try {
      return { value: await Promise.race([shared, cancelled]), degraded: false };
    } catch (error) {
      if (error instanceof CapabilityError && error.code === 'AI_CANCELLED') throw error;
      // PRD 第 7 节：知乎接口不可用时使用备用精选话题，基础聊天继续。
      return { value: fallback(), degraded: true };
    }
  }

  /**
   * 合并热榜候选与备用话题，组成足够大的轮换池。
   * 热榜话题排在前（时效性优先），备用话题补足多样性。
   */
  #mergePool(
    hot: readonly TopicCandidate[],
    interestTags: readonly string[],
  ): readonly TopicCandidate[] {
    const fallback = pickFallbackTopics(interestTags, 8);
    const seen = new Set<string>();
    const merged: TopicCandidate[] = [];
    for (const topic of [...hot, ...fallback]) {
      if (seen.has(topic.title)) continue;
      seen.add(topic.title);
      merged.push(topic);
    }
    return merged;
  }

  /**
   * 取热榜中适合破冰的话题（契约 Topic.kind = "popular"）。
   * 对应 PRD 5.3「兴趣差异较大时，选择当前知乎热榜上排名较高、适合破冰的话题」。
   */
  async getPopularTopics(
    options: { readonly limit?: number; readonly interestTags?: readonly string[]; readonly signal?: AbortSignal } = {},
  ): Promise<readonly TopicCandidate[]> {
    const limit = options.limit ?? 5;
    const tags = options.interestTags ?? [];
    const fallback = (): readonly TopicCandidate[] => pickFallbackTopics(tags, limit);

    const cached = this.#hotCache;
    if (cached !== null && cached.expiresAt > this.#now()) {
      return this.#rotate(this.#mergePool(cached.value, tags), limit);
    }

    // 共享上游请求不绑定任一调用者的 signal。缓存写入在共享任务内完成，
    // 保证只写一次，等待者直接复用。
    let shared = this.#hotInFlight;
    if (shared === null) {
      shared = (async (): Promise<readonly TopicCandidate[]> => {
        this.#upstreamHotCalls += 1;
        const items = await this.#source.getHotList(30);
        const screened = screenHotItems(items);
        const value = screened.accepted.flatMap<TopicCandidate>(({ item }) => {
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
        // 即使筛选后为空也缓存，避免反复打同一份不可用的热榜。
        this.#hotCache = { value, expiresAt: this.#now() + this.#hotTtl };
        return value;
      })();
      this.#hotInFlight = shared;
      shared.finally(() => {
        if (this.#hotInFlight === shared) this.#hotInFlight = null;
      }).catch(() => {});
    }

    const outcome = await this.#awaitShared(shared, options.signal, fallback);
    // 合并备用池扩充候选并轮换起点，保证多次调用话题有变化。
    return this.#rotate(this.#mergePool(outcome.value, tags), limit);
  }
}
