/**
 * 终态的唯一判定入口：把「为什么结束」映射成「给用户看什么」和「身份怎么处理」。
 * 页面只消费这里的结论，不再各自决定清不清凭证。
 */
export type TerminalReason =
  | { kind: 'removed' }
  | { kind: 'left' }
  | { kind: 'closed' }
  | { kind: 'fatal'; code: string }

export interface TerminalOutcome {
  title: string
  detail: string
  /** keep = 只摘 membership，保留可复用的身份；clear = 身份也失效了 */
  identity: 'keep' | 'clear'
  /** 是否还值得提供「用原身份重新加入」入口 */
  rejoinable: boolean
}

const REMOVED: TerminalOutcome = {
  title: '你被移出了这个房间',
  detail: '房主结束了你的入场，可以等下一次邀请。',
  identity: 'clear',
  rejoinable: false,
}

const LEFT: TerminalOutcome = {
  title: '这次入房已经结束',
  detail: '从邀请链接重新进来就好。',
  identity: 'keep',
  rejoinable: true,
}

const CLOSED: TerminalOutcome = {
  title: '房间已经关闭',
  detail: '房主关掉了房间，聊天和资料都不会保留。',
  identity: 'clear',
  rejoinable: false,
}

const BY_CODE: Record<string, TerminalOutcome> = {
  MEMBER_REMOVED: REMOVED,
  MEMBERSHIP_INACTIVE: LEFT,
  MEMBERSHIP_CHANGED: {
    ...LEFT,
    detail: '你用同一个身份重新进过一次房，刷新页面即可。',
  },
  ROOM_UNAVAILABLE: {
    title: '房间已经关闭',
    detail: '房主关掉了房间，聊天和资料都不会保留。',
    identity: 'clear',
    rejoinable: false,
  },
  MEMBER_CREDENTIAL_INVALID: {
    title: '身份凭证失效了',
    detail: '从邀请链接重新进来，会给你一个新的身份。',
    identity: 'clear',
    rejoinable: false,
  },
  INVITATION_INVALID: {
    title: '邀请链接无效',
    detail: '这个链接已经失效了，找房主重新要一个。',
    identity: 'clear',
    rejoinable: false,
  },
}

export function resolveTerminal(reason: TerminalReason): TerminalOutcome {
  if (reason.kind === 'removed') return REMOVED
  if (reason.kind === 'left') return LEFT
  if (reason.kind === 'closed') return CLOSED
  return BY_CODE[reason.code] ?? { ...LEFT, rejoinable: true }
}

/** 终态码是否可以由连接层直接终止（其余按可重试处理）。 */
export const FATAL_STREAM_CODES = new Set([
  'MEMBER_REMOVED',
  'MEMBERSHIP_INACTIVE',
  'MEMBERSHIP_CHANGED',
  'MEMBER_CREDENTIAL_INVALID',
  'ROOM_UNAVAILABLE',
  'INVITATION_INVALID',
])
