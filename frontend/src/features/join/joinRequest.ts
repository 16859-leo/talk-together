import type { JoinBody } from '../../shared/api/room'
import type { PendingJoin } from '../../state/session'

export interface JoinProfileInput {
  nickname: string
  interestTags: string[]
  bio: string
}

/**
 * 服务端的 JoinRoomRequest 是 additionalProperties: false，
 * 本地附加的字段（at、pending 标记等）绝不能进请求体。
 */
export function toJoinBody(pending: PendingJoin): JoinBody {
  return {
    clientRequestId: pending.clientRequestId,
    bootstrapToken: pending.bootstrapToken,
    inviteCode: pending.inviteCode,
    profile: {
      nickname: pending.profile.nickname,
      interestTags: [...pending.profile.interestTags],
      bio: pending.profile.bio,
    },
  }
}

/** 保存前统一成契约字段，避免以后再往里面塞本地元数据。 */
export function toPendingJoin(body: JoinBody, at = Date.now()): PendingJoin {
  return {
    clientRequestId: body.clientRequestId,
    bootstrapToken: body.bootstrapToken,
    inviteCode: body.inviteCode,
    profile: {
      nickname: body.profile.nickname,
      interestTags: [...body.profile.interestTags],
      bio: body.profile.bio ?? '',
    },
    at,
  }
}

function sameProfile(a: JoinProfileInput, b: JoinProfileInput): boolean {
  return (
    a.nickname === b.nickname &&
    a.bio === b.bio &&
    a.interestTags.length === b.interestTags.length &&
    a.interestTags.every((tag, index) => tag === b.interestTags[index])
  )
}

/**
 * 只有「上一次结果未知、且这次提交的内容完全一致」才允许重放同一个请求；
 * 用户改了资料就必须重新发起，否则后端的幂等会把旧资料还回来。
 */
export function canReplayPending(
  pending: PendingJoin | null,
  values: JoinProfileInput,
  inviteCode: string,
): boolean {
  if (!pending) return false
  if ((pending.inviteCode ?? '') !== inviteCode) return false
  return sameProfile(pending.profile, values)
}

/**
 * 明确的业务失败说明这次提交已经被服务端拒绝，pending 不该再复用；
 * 只有 BOOTSTRAP_CONFLICT 表示「可能已受理」，需要保留。
 */
export function isDefinitiveFailure(code: string | undefined): boolean {
  if (!code) return false
  // 这几个都代表「结果未知」：请求可能已经被服务端受理，pending 必须留着
  const unknown = new Set(['BOOTSTRAP_CONFLICT', 'SERVICE_UNAVAILABLE', 'INTERNAL_ERROR', 'NETWORK'])
  return !unknown.has(code)
}
