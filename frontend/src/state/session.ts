export interface RoomSession {
  credential: string
  /** 为空表示这次入房已结束，但成员凭证仍然有效，可以原身份重新加入 */
  membershipId?: string
  memberId: string
  /** 本地先记住资料，快照没带上自己时也能先把「我」画出来 */
  nickname?: string
  interestTags?: string[]
  role?: 'host' | 'member'
}

/** 首次提交用的引导凭证：同一房间、同一次入房重试时复用，成功后清理。 */
export interface PendingBootstrap {
  token: string
  clientRequestId: string
}

function sessionKey(roomId: string) {
  return `tt:${roomId}:session`
}

function bootstrapKey(roomId: string) {
  return `tt:${roomId}:bootstrap`
}

function randomHex(bytes: number): string {
  const buffer = new Uint8Array(bytes)
  crypto.getRandomValues(buffer)
  return Array.from(buffer, (b) => b.toString(16).padStart(2, '0')).join('')
}

export function loadSession(roomId: string): RoomSession | null {
  try {
    const raw = localStorage.getItem(sessionKey(roomId))
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<RoomSession>
    if (!parsed.credential || !parsed.membershipId || !parsed.memberId) return null
    return parsed as RoomSession
  } catch {
    return null
  }
}

export function saveSession(roomId: string, session: RoomSession) {
  try {
    localStorage.setItem(sessionKey(roomId), JSON.stringify(session))
  } catch {
    /* 隐私模式下写不进去时，本次会话仍然可用 */
  }
}

export function clearSession(roomId: string) {
  try {
    localStorage.removeItem(sessionKey(roomId))
  } catch {
    /* 忽略 */
  }
}

/**
 * 取本次入房的引导凭证：已存在就复用，保证重试和并行标签页拿到同一份。
 * 成功后必须 clearBootstrap，否则下次入房会被服务端判成 BOOTSTRAP_CONFLICT。
 */
export function loadBootstrap(roomId: string): PendingBootstrap {
  try {
    const raw = localStorage.getItem(bootstrapKey(roomId))
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<PendingBootstrap>
      if (parsed.token && parsed.clientRequestId) return parsed as PendingBootstrap
    }
  } catch {
    /* 读不出来就重建一份 */
  }
  const fresh: PendingBootstrap = {
    token: randomHex(32),
    clientRequestId: crypto.randomUUID(),
  }
  try {
    localStorage.setItem(bootstrapKey(roomId), JSON.stringify(fresh))
  } catch {
    /* 忽略 */
  }
  return fresh
}

export function clearBootstrap(roomId: string) {
  try {
    localStorage.removeItem(bootstrapKey(roomId))
  } catch {
    /* 忽略 */
  }
}

/**
 * 开发期占位：还没走真实入房时，用一个固定身份连本地 Mock。
 * 真实入房接上后，生产构建里不会走到这里。
 */
export function devSession(): RoomSession {
  return {
    credential: 'dev_credential_demo',
    membershipId: 'membership_host',
    memberId: 'member_host',
  }
}
