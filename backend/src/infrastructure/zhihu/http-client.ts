/**
 * 知乎开放平台 HTTP 客户端。
 *
 * 直接调用 developer.zhihu.com 的数据接口，替代本地 zhihu-cli 子进程：
 *   GET /api/v1/content/zhihu_search?Query=&Count=   站内搜索（≤10 条）
 *   GET /api/v1/content/hot_list?Limit=             热榜（≤30 条）
 *
 * 鉴权：Authorization: Bearer <access_secret> + X-Request-Timestamp（秒级）。
 * 密钥只经构造函数注入，本模块不落盘、不记录、不转发。
 *
 * 实测额度：站内搜索 5000/天；热榜另有额度，均可用 /api/v1/quota 查询。
 */

import type { ZhihuContentSource, ZhihuHotItem, ZhihuSearchItem } from './types.ts';
import { CapabilityError } from './types.ts';

export interface ZhihuHttpClientOptions {
  /** 个人中心获取的 Access Secret。 */
  readonly accessSecret: string;
  /** 接口域名，默认 https://developer.zhihu.com */
  readonly baseUrl?: string;
  /** 单次请求超时，低于应用层 30 秒生成期限。 */
  readonly timeoutMs?: number;
  /** 注入 fetch，便于测试。 */
  readonly fetchImpl?: typeof fetch;
}

interface Envelope<T> {
  readonly Code: number;
  readonly Message?: string;
  readonly Data: T;
}

interface SearchData {
  readonly Items?: readonly {
    readonly Title?: string;
    readonly ContentText?: string;
    readonly Url?: string;
    readonly AuthorName?: string;
  }[];
}

interface HotData {
  readonly Items?: readonly {
    readonly Title?: string;
    readonly Summary?: string;
    readonly Url?: string;
  }[];
}

/** 服务端业务码：0 成功、20001 鉴权失败、30001 频率限制、90001 内部错误。 */
const OK_CODE = 0;
const AUTH_FAILED_CODE = 20001;
const RATE_LIMITED_CODE = 30001;
const QUOTA_EXHAUSTED_CODE = 30002;

const DEFAULT_BASE_URL = 'https://developer.zhihu.com';

export class ZhihuHttpClient implements ZhihuContentSource {
  readonly #accessSecret: string;
  readonly #baseUrl: string;
  readonly #timeoutMs: number;
  readonly #fetch: typeof fetch;

  constructor(options: ZhihuHttpClientOptions) {
    if (options.accessSecret.length === 0) {
      throw new Error('ZhihuHttpClient 需要 accessSecret');
    }
    this.#accessSecret = options.accessSecret;
    this.#baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, '');
    this.#timeoutMs = options.timeoutMs ?? 10_000;
    this.#fetch = options.fetchImpl ?? fetch;
  }

  async searchZhihu(
    keyword: string,
    count: number,
    signal?: AbortSignal,
  ): Promise<readonly ZhihuSearchItem[]> {
    const bounded = Math.max(1, Math.min(count, 10));
    const data = await this.#get<SearchData>(
      '/api/v1/content/zhihu_search',
      { Query: keyword, Count: String(bounded) },
      signal,
    );
    return (data.Items ?? []).flatMap((item) => {
      const title = item.Title?.trim() ?? '';
      const url = item.Url?.trim() ?? '';
      if (title.length === 0 || url.length === 0) return [];
      return [
        {
          title,
          contentText: item.ContentText?.trim() ?? '',
          url,
          authorName: item.AuthorName?.trim() || null,
        },
      ];
    });
  }

  async getHotList(limit: number, signal?: AbortSignal): Promise<readonly ZhihuHotItem[]> {
    const bounded = Math.max(1, Math.min(limit, 30));
    const data = await this.#get<HotData>(
      '/api/v1/content/hot_list',
      { Limit: String(bounded) },
      signal,
    );
    return (data.Items ?? []).flatMap((item) => {
      const title = item.Title?.trim() ?? '';
      const url = item.Url?.trim() ?? '';
      if (title.length === 0 || url.length === 0) return [];
      return [{ title, summary: item.Summary?.trim() ?? '', url }];
    });
  }

  async #get<T>(
    path: string,
    query: Record<string, string>,
    signal?: AbortSignal,
  ): Promise<T> {
    const external = signal;
    if (external?.aborted === true) {
      throw new CapabilityError('AI_CANCELLED', '调用已取消');
    }

    const url = new URL(`${this.#baseUrl}${path}`);
    for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.#timeoutMs);
    const onAbort = (): void => controller.abort();
    external?.addEventListener('abort', onAbort, { once: true });

    try {
      const response = await this.#fetch(url, {
        method: 'GET',
        headers: {
          authorization: `Bearer ${this.#accessSecret}`,
          'x-request-timestamp': String(Math.floor(Date.now() / 1000)),
          'content-type': 'application/json',
          accept: 'application/json',
        },
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new CapabilityError('AI_UNAVAILABLE', `知乎接口不可用（HTTP ${response.status}）`);
      }

      let envelope: Envelope<T>;
      try {
        envelope = (await response.json()) as Envelope<T>;
      } catch (cause) {
        throw new CapabilityError('AI_PROVIDER_ERROR', '知乎接口返回无法解析', { cause });
      }

      if (envelope.Code === RATE_LIMITED_CODE || envelope.Code === QUOTA_EXHAUSTED_CODE) {
        throw new CapabilityError('AI_RATE_LIMITED', '知乎接口频率限制或配额耗尽', {
          retryAfterMs: 60_000,
        });
      }
      if (envelope.Code === AUTH_FAILED_CODE) {
        throw new CapabilityError('AI_UNAVAILABLE', '知乎接口鉴权失败，请检查 Access Secret');
      }
      if (envelope.Code !== OK_CODE) {
        throw new CapabilityError(
          'AI_PROVIDER_ERROR',
          `知乎接口返回错误码 ${envelope.Code}${envelope.Message ? `：${envelope.Message}` : ''}`,
        );
      }

      return envelope.Data;
    } catch (error) {
      if (error instanceof CapabilityError) throw error;
      if (external !== undefined && external.aborted) {
        throw new CapabilityError('AI_CANCELLED', '调用已取消');
      }
      const aborted = (error as { name?: string }).name === 'AbortError';
      throw aborted
        ? new CapabilityError('AI_TIMEOUT', '知乎接口调用超时', { cause: error })
        : new CapabilityError('AI_UNAVAILABLE', '知乎接口不可用', { cause: error });
    } finally {
      clearTimeout(timer);
      external?.removeEventListener('abort', onAbort);
    }
  }
}
