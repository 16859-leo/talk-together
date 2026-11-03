import type { ErrorCode } from './types'

/**
 * 契约里的 29 个业务错误码 → 用户能看懂的一句话。
 * 联调时如果后端加了新码，这里会回落到接口给的 message，
 * 但不会再出现空白或英文原文。
 */
export const ERROR_TEXT: Record<ErrorCode, string> = {
  VALIDATION_ERROR: '有些内容不符合要求，看看标红的地方',
  MEMBER_CREDENTIAL_INVALID: '身份凭证失效了，重新从邀请链接进来',
  MEMBERSHIP_INACTIVE: '这次入房已经失效',
  MEMBERSHIP_CHANGED: '这次入房已经结束，刷新页面重新进来',
  MEMBER_REMOVED: '你被移出了这个房间',
  HOST_REQUIRED: '只有房主能做这件事',
  HOST_PROTECTED: '房主不能被移出',
  ROOM_UNAVAILABLE: '房间不存在，或者已经关闭了',
  MEMBER_NOT_FOUND: '这个成员已经不在房间里了',
  INVITATION_INVALID: '邀请链接无效或已经失效',
  ROOM_FULL: '房间坐满了，等有人退出再来',
  NICKNAME_TAKEN: '这个昵称已经有人用了，换一个吧',
  IDEMPOTENCY_CONFLICT: '这次发送的标识和内容对不上，刷新后再试',
  IDEMPOTENCY_CONTEXT_EXPIRED: '上次发送属于更早的入房，需要重新发送',
  BOOTSTRAP_CONFLICT: '入房凭证已经用过了，重新提交一次就好',
  MESSAGE_RATE_LIMITED: '发得太快了，缓一下再发',
  IP_RATE_LIMITED: '当前网络请求太快，稍等一会儿',
  AI_RATE_LIMITED: 'AI 调用太频繁，稍后再让导播接话',
  AI_QUEUE_FULL: 'AI 队列满了，这条没排队',
  AI_UNAVAILABLE: 'AI 暂时不可用，聊天照常',
  AI_QUEUE_TIMEOUT: 'AI 排队超时，这条没生成',
  AI_TIMEOUT: 'AI 生成超时了',
  AI_PROVIDER_ERROR: 'AI 服务出错了',
  AI_CANCELLED: '这次 AI 调用被取消了',
  CONNECTION_TICKET_INVALID: '连接票据无效，正在重连',
  CONNECTION_TICKET_EXPIRED: '连接票据过期了，正在重连',
  CONNECTION_TICKET_USED: '连接票据已经用过，正在重连',
  SERVICE_UNAVAILABLE: '服务暂时不可用，稍后再试',
  INTERNAL_ERROR: '请求没完成，稍后再试',
}

/** 网络层自造的码（契约里没有），单独放这里。 */
export const LOCAL_ERROR_TEXT: Record<string, string> = {
  NETWORK: '网络不太稳，稍后再试',
}

export function errorText(code: string | undefined, fallback: string): string {
  if (!code) return fallback
  return (
    LOCAL_ERROR_TEXT[code] ??
    (ERROR_TEXT as Record<string, string>)[code] ??
    fallback
  )
}
