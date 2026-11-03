/**
 * 领域与应用层统一抛出的错误。
 *
 * 协议层负责把它映射为 HTTP 状态码与契约里的稳定业务 `code`；
 * 领域层和应用层不感知 HTTP。
 */
export type ErrorCode =
  | 'VALIDATION_ERROR'
  | 'MEMBER_CREDENTIAL_INVALID'
  | 'MEMBERSHIP_INACTIVE'
  | 'MEMBERSHIP_CHANGED'
  | 'MEMBER_REMOVED'
  | 'HOST_REQUIRED'
  | 'HOST_PROTECTED'
  | 'ROOM_UNAVAILABLE'
  | 'MEMBER_NOT_FOUND'
  | 'INVITATION_INVALID'
  | 'ROOM_FULL'
  | 'NICKNAME_TAKEN'
  | 'IDEMPOTENCY_CONFLICT'
  | 'IDEMPOTENCY_CONTEXT_EXPIRED'
  | 'BOOTSTRAP_CONFLICT'
  | 'MESSAGE_RATE_LIMITED'
  | 'IP_RATE_LIMITED'
  | 'AI_RATE_LIMITED'
  | 'AI_QUEUE_FULL'
  | 'AI_UNAVAILABLE'
  | 'AI_QUEUE_TIMEOUT'
  | 'AI_TIMEOUT'
  | 'AI_PROVIDER_ERROR'
  | 'AI_CANCELLED'
  | 'CONNECTION_TICKET_INVALID'
  | 'CONNECTION_TICKET_EXPIRED'
  | 'CONNECTION_TICKET_USED'
  | 'SERVICE_UNAVAILABLE'
  | 'INTERNAL_ERROR';

export interface FieldError {
  readonly path: string;
  readonly message: string;
}

/** 每个业务错误对应的 HTTP 状态码，与 OpenAPI 的 `x-error-codes` 保持一致。 */
const statusByCode: Record<ErrorCode, number> = {
  VALIDATION_ERROR: 400,
  MEMBER_CREDENTIAL_INVALID: 401,
  MEMBERSHIP_INACTIVE: 403,
  MEMBERSHIP_CHANGED: 409,
  MEMBER_REMOVED: 403,
  HOST_REQUIRED: 403,
  HOST_PROTECTED: 403,
  ROOM_UNAVAILABLE: 404,
  MEMBER_NOT_FOUND: 404,
  INVITATION_INVALID: 404,
  ROOM_FULL: 409,
  NICKNAME_TAKEN: 409,
  IDEMPOTENCY_CONFLICT: 409,
  IDEMPOTENCY_CONTEXT_EXPIRED: 409,
  BOOTSTRAP_CONFLICT: 409,
  MESSAGE_RATE_LIMITED: 429,
  IP_RATE_LIMITED: 429,
  AI_RATE_LIMITED: 429,
  AI_QUEUE_FULL: 503,
  AI_UNAVAILABLE: 503,
  AI_QUEUE_TIMEOUT: 504,
  AI_TIMEOUT: 504,
  AI_PROVIDER_ERROR: 502,
  AI_CANCELLED: 409,
  CONNECTION_TICKET_INVALID: 401,
  CONNECTION_TICKET_EXPIRED: 401,
  CONNECTION_TICKET_USED: 401,
  SERVICE_UNAVAILABLE: 503,
  INTERNAL_ERROR: 500,
};

export interface AppErrorOptions {
  readonly fieldErrors?: readonly FieldError[];
  readonly retryAfterMs?: number | null;
  /** 覆盖默认状态码；仅用于同一 code 在不同操作下状态不同的场景。 */
  readonly status?: number;
}

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly fieldErrors: readonly FieldError[];
  readonly retryAfterMs: number | null;

  constructor(code: ErrorCode, message: string, options: AppErrorOptions = {}) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.status = options.status ?? statusByCode[code];
    this.fieldErrors = options.fieldErrors ?? [];
    this.retryAfterMs = options.retryAfterMs ?? null;
  }
}

export const fail = (code: ErrorCode, message: string, options?: AppErrorOptions): never => {
  throw new AppError(code, message, options);
};

/** AI 失败载荷只需要 code/message/retryAfterMs，与契约的 `Failure` 对应。 */
export const toFailure = (error: unknown): { code: ErrorCode; message: string; retryAfterMs: number | null } => {
  if (error instanceof AppError) {
    return { code: error.code, message: error.message, retryAfterMs: error.retryAfterMs };
  }
  return { code: 'AI_UNAVAILABLE', message: 'AI 能力暂时不可用', retryAfterMs: null };
};
