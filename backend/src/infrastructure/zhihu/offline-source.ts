/**
 * 没有 zhihu-cli 时的本地数据源。
 *
 * 用内置备用话题池冒充热榜与搜索：数据结构与真实来源一致，
 * 话题门面照常做筛选、轮转与缓存，因此不联网也能跑真实模型。
 * 来源标记为「本地话题库」，避免把内置内容伪装成知乎结果。
 */

import { pickFallbackTopics } from './fallback.ts';
import type { ZhihuContentSource, ZhihuHotItem, ZhihuSearchItem } from './types.ts';

/** 占位链接：契约的 sourceUrl 需要是合法 URI，但不能假装是知乎原文。 */
const LOCAL_URL = 'https://talk-together.local/topics';

export class OfflineContentSource implements ZhihuContentSource {
  async getHotList(limit: number): Promise<readonly ZhihuHotItem[]> {
    return pickFallbackTopics([], Math.min(Math.max(limit, 1), 20)).map((topic) => ({
      title: topic.title,
      summary: topic.content,
      url: LOCAL_URL,
    }));
  }

  async searchZhihu(keyword: string, count: number): Promise<readonly ZhihuSearchItem[]> {
    return pickFallbackTopics([keyword], Math.min(Math.max(count, 1), 20)).map((topic) => ({
      title: topic.title,
      contentText: topic.content,
      url: LOCAL_URL,
      authorName: '本地话题库',
    }));
  }
}
