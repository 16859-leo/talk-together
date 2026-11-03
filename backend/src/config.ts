import { randomBytes, randomUUID } from 'node:crypto';

/**
 * 本项目的运行参数。
 *
 * 契约明确 Q33–Q38 的建议数值不是产品默认值，因此这些阈值由后端选定，
 * 并且必须通过协议对外声明：长度约束经 `client-config` 返回，限频与排队
 * 相关数值经错误载荷的 `retryAfterMs`、`Invocation.queuePosition` 与
 * `expiresAt` 返回，前端不预设任何数值。
 */
export interface Config {
  readonly host: string;
  readonly port: number;
  /** 对外可见的 WebSocket 基地址，用于拼 `ConnectionTicketData.webSocketUrl`。 */
  readonly publicWsOrigin: string;
  /** 允许的前端来源；用于 CORS。 */
  readonly corsOrigins: readonly string[] | true;

  /** 每房人数上限。契约把 Room.capacity 锁定为常量 5，不可配置。 */
  readonly roomCapacity: 5;
  /** 掉线保留名额的时长，PRD 固定 60 秒。 */
  readonly recoveryMs: number;
  /** 房主掉线到关房的时长，PRD 固定 60 秒。 */
  readonly hostRecoveryMs: number;

  /** 资料与消息的长度约束，原样对外声明。 */
  readonly validation: {
    readonly nickname: { minLength: number; maxLength: number | null };
    readonly interestTag: { minLength: number; maxLength: number | null };
    readonly bio: { minLength: number; maxLength: number | null };
    readonly message: { minLength: number; maxLength: number | null };
    readonly interestTags: { minItems: number; maxItems: number | null };
  };

  /** 单成员消息限频：窗口内最多发送多少条。 */
  readonly messageRate: { readonly windowMs: number; readonly max: number };
  /** AI 队列长度上限；超出返回 rejected 回执而不撤销聊天。 */
  readonly aiQueueLimit: number;
  /** 单次 AI 生成期限，对外经 `Invocation.expiresAt` 声明。 */
  readonly aiRunMs: number;
  /** 排队等待上限，超时的调用直接进入 failed。 */
  readonly aiQueueWaitMs: number;
  /** 连接票据有效期。 */
  readonly ticketMs: number;

  /**
   * 冷场判定与自动触发参数。
   *
   * 判据：房间内最后一条「成员消息」之后的静默时长。AI 自身发言不重置计时，
   * 因为 AI 补话的目的正是引出成员发言；若 AI 发言也重置，冷场会被自己掩盖。
   */
  readonly idle: {
    /** 静默达到该时长触发自动选题。 */
    readonly topicMs: number;
    /** 自动选题后继续静默达到该时长触发随机邀答。 */
    readonly invitationMs: number;
    /** 调度器轮询间隔。 */
    readonly tickMs: number;
    /** 房间至少有多少名在线成员才自动补话，避免对着空房说话。 */
    readonly minMembers: number;
  };
}

export const defaultConfig: Config = {
  host: '127.0.0.1',
  port: 4000,
  publicWsOrigin: 'ws://127.0.0.1:4000',
  corsOrigins: true,

  roomCapacity: 5,
  recoveryMs: 60_000,
  hostRecoveryMs: 60_000,

  validation: {
    nickname: { minLength: 1, maxLength: 20 },
    interestTag: { minLength: 1, maxLength: 12 },
    bio: { minLength: 0, maxLength: 200 },
    message: { minLength: 1, maxLength: 500 },
    interestTags: { minItems: 1, maxItems: 8 },
  },

  messageRate: { windowMs: 10_000, max: 10 },
  aiQueueLimit: 3,
  aiRunMs: 30_000,
  aiQueueWaitMs: 60_000,
  ticketMs: 30_000,

  idle: {
    topicMs: 45_000,
    invitationMs: 30_000,
    tickMs: 5_000,
    minMembers: 2,
  },
};

/** 契约的 `Secret`：`^[A-Za-z0-9_-]{32,}$`。 */
export const newSecret = (): string => randomBytes(48).toString('base64url');

/** 契约的 `Id`：`^[A-Za-z0-9_-]+$`。 */
export const newId = (prefix: string): string => `${prefix}_${randomBytes(9).toString('base64url')}`;

/** 契约的 `ClientRequestId`：uuid。 */
export const newRequestId = (): string => randomUUID();

/** 契约的 `Time`：必须以 `Z` 结尾的 ISO 时间。 */
export const isoTime = (at: number = Date.now()): string => new Date(at).toISOString();
