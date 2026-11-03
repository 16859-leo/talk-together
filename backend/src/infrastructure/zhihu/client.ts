/**
 * 知乎开放平台客户端。
 *
 * 经官方 zhihu-cli 调用，凭证由 CLI 从系统密钥链或 ZHIHU_ACCESS_SECRET 读取，
 * 本模块不接触、不记录、不转发任何密钥（后端计划 #4 第 317 节）。
 *
 * 实测额度：站内搜索 5000/天、热榜 100/天、问题发现 100/天。
 * 知乎直答不在此处使用——实测连续 3 次快速调用即 429 且无 Tool Calls，
 * 主模型另经 infrastructure/model 接入。
 */

import { execFile } from 'node:child_process';
import type { ZhihuContentSource, ZhihuHotItem, ZhihuSearchItem } from './types.ts';
import { CapabilityError } from './types.ts';

export interface ZhihuClientOptions {
  /** zhihu-cli 可执行文件绝对路径。 */
  readonly binaryPath: string;
  /** 单次调用超时。低于应用层 30 秒生成期限，留出编排余量。 */
  readonly timeoutMs?: number;
}

interface CliEnvelope<T> {
  readonly Code: number;
  readonly Message: string;
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

/** 服务端业务码：30001 频率限制、30002 配额耗尽。 */
const RATE_LIMITED_CODE = 30001;
const QUOTA_EXHAUSTED_CODE = 30002;

export class ZhihuCliClient implements ZhihuContentSource {
  readonly #binaryPath: string;
  readonly #timeoutMs: number;

  constructor(options: ZhihuClientOptions) {
    this.#binaryPath = options.binaryPath;
    this.#timeoutMs = options.timeoutMs ?? 15_000;
  }

  async searchZhihu(
    keyword: string,
    count: number,
    signal?: AbortSignal,
  ): Promise<readonly ZhihuSearchItem[]> {
    // CLI 约束：search zhihu 单次最多 10 条且无分页。
    const bounded = Math.max(1, Math.min(count, 10));
    const data = await this.#run<SearchData>(
      ['search', 'zhihu', '--query', keyword, '--count', String(bounded)],
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
    const data = await this.#run<HotData>(['hot', '--limit', String(bounded)], signal);
    return (data.Items ?? []).flatMap((item) => {
      const title = item.Title?.trim() ?? '';
      const url = item.Url?.trim() ?? '';
      if (title.length === 0 || url.length === 0) return [];
      return [{ title, summary: item.Summary?.trim() ?? '', url }];
    });
  }

  #run<T>(args: readonly string[], signal?: AbortSignal): Promise<T> {
    if (signal?.aborted === true) {
      return Promise.reject(new CapabilityError('AI_CANCELLED', '调用已取消'));
    }

    return new Promise<T>((resolve, reject) => {
      const child = execFile(
        this.#binaryPath,
        [...args],
        { timeout: this.#timeoutMs, maxBuffer: 8 * 1024 * 1024, windowsHide: true },
        (error, stdout) => {
          if (signal?.aborted === true) {
            reject(new CapabilityError('AI_CANCELLED', '调用已取消'));
            return;
          }
          if (error !== null) {
            // execFile 在超时时以 SIGTERM 结束子进程。
            const killed = (error as NodeJS.ErrnoException & { killed?: boolean }).killed === true;
            reject(
              killed
                ? new CapabilityError('AI_TIMEOUT', '知乎接口调用超时', { cause: error })
                : new CapabilityError('AI_UNAVAILABLE', '知乎接口不可用', { cause: error }),
            );
            return;
          }

          let envelope: CliEnvelope<T>;
          try {
            envelope = JSON.parse(stdout) as CliEnvelope<T>;
          } catch (cause) {
            reject(new CapabilityError('AI_PROVIDER_ERROR', '知乎接口返回无法解析', { cause }));
            return;
          }

          if (envelope.Code === RATE_LIMITED_CODE) {
            reject(
              new CapabilityError('AI_RATE_LIMITED', '知乎接口频率限制', { retryAfterMs: 60_000 }),
            );
            return;
          }
          if (envelope.Code === QUOTA_EXHAUSTED_CODE) {
            reject(new CapabilityError('AI_RATE_LIMITED', '知乎接口当日配额耗尽'));
            return;
          }
          if (envelope.Code !== 0) {
            reject(
              new CapabilityError(
                'AI_PROVIDER_ERROR',
                `知乎接口返回错误码 ${envelope.Code}`,
              ),
            );
            return;
          }

          resolve(envelope.Data);
        },
      );

      const onAbort = (): void => {
        child.kill();
      };
      signal?.addEventListener('abort', onAbort, { once: true });
      child.once('close', () => signal?.removeEventListener('abort', onAbort));
    });
  }
}
