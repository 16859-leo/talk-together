/**
 * 知乎内容数据源的类型与错误定义。
 *
 * 错误码口径按后端计划 #4 第 78-90 节：
 *   本模块只抛 AI_UNAVAILABLE / AI_PROVIDER_ERROR / AI_TIMEOUT / AI_CANCELLED / AI_RATE_LIMITED
 *   不抛 AI_QUEUE_FULL / AI_QUEUE_TIMEOUT（由应用层产出）
 *   契约枚举中没有 AI_BUSY
 */

/** 本模块允许抛出的错误码，是契约 29 个错误码的子集。 */
export type CapabilityErrorCode =
  | 'AI_UNAVAILABLE'
  | 'AI_PROVIDER_ERROR'
  | 'AI_TIMEOUT'
  | 'AI_CANCELLED'
  | 'AI_RATE_LIMITED';

/** 抛给应用层的错误。应用层据此发布 ai.reply.failed 并保留已输出文字。 */
export class CapabilityError extends Error {
  readonly code: CapabilityErrorCode;
  /** 限频场景下的建议重试间隔，对应契约 Failure.retryAfterMs。 */
  readonly retryAfterMs: number | null;

  constructor(
    code: CapabilityErrorCode,
    message: string,
    options?: { readonly retryAfterMs?: number; readonly cause?: unknown },
  ) {
    super(message, options?.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'CapabilityError';
    this.code = code;
    this.retryAfterMs = options?.retryAfterMs ?? null;
  }
}

/**
 * 话题候选。字段与契约 Topic 对齐，但不含由应用层生成的 id 与 publishedAt。
 * title 与 content 对应契约的 NonBlankText（minLength 1 + pattern "\S"），
 * 本模块必须保证非空白，否则应用层发布时 Schema 校验会失败。
 */
export interface TopicCandidate {
  readonly title: string;
  readonly content: string;
  readonly kind: 'common' | 'popular';
  readonly sourceLabel: string | null;
  readonly sourceUrl: string | null;
}

/** 知乎搜索返回的单条内容。 */
export interface ZhihuSearchItem {
  readonly title: string;
  readonly contentText: string;
  readonly url: string;
  readonly authorName: string | null;
}

/**
 * 资料检索返回的单条摘要，供模型回答事实性问题（不是话题候选）。
 * 与话题候选的区别：不做破冰适宜性筛选，保留原文摘要与来源链接。
 */
export interface KnowledgeSnippet {
  readonly title: string;
  readonly snippet: string;
  readonly url: string;
}

/** 知乎热榜返回的单条内容。 */
export interface ZhihuHotItem {
  readonly title: string;
  readonly summary: string;
  readonly url: string;
}

/** 数据源接口。装配入口注入实现，便于测试替换。 */
export interface ZhihuContentSource {
  searchZhihu(keyword: string, count: number, signal?: AbortSignal): Promise<readonly ZhihuSearchItem[]>;
  getHotList(limit: number, signal?: AbortSignal): Promise<readonly ZhihuHotItem[]>;
}

/** 契约 NonBlankText 校验：非空且含非空白字符。 */
export function isNonBlankText(value: string): boolean {
  return value.length > 0 && /\S/.test(value);
}
