export interface RoomSession {
  credential: string
  /** 为空表示这次入房已结束，但成员凭证仍然有效，可以原身份重新加入 */
  membershipId?: string
  memberId: string
  /** 本地先记住资料，快照没带上自己时也能先把「我」画出来 */
  nickname?: string
  interestTags?: string[]
  role?: 'host' | 'member'
  /** 服务端下发的加入地址，重新加入时带上它就不缺 inviteCode */
  joinPath?: string
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

/**
 * 只要求「凭证 + memberId」：membership 结束但身份还在的会话必须能读出来，
 * 否则原身份重新加入的分支永远接不住。
 */
export function loadSession(roomId: string): RoomSession | null {
  try {
    const raw = localStorage.getItem(sessionKey(roomId))
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<RoomSession>
    if (!parsed.credential || !parsed.memberId) return null
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

/** 这次入房结束了，但成员凭证还在：只摘掉 membership，保留可复用的身份。 */
export function clearMembership(roomId: string) {
  const session = loadSession(roomId)
  if (!session) return
  saveSession(roomId, { ...session, membershipId: undefined })
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
 * 跨标签页串行化同一次入房：同一房间的提交排队执行，
 * 后到的标签页在锁内会看到前一个标签页存下的会话，直接复用。
 */
export async function withJoinLock<T>(roomId: string, task: () => Promise<T>): Promise<T> {
  const locks = (navigator as Navigator & { locks?: LockManager }).locks
  if (locks?.request) {
    return locks.request(`tt-join:${roomId}`, task)
  }
  // 没有 Web Locks 时退化成 localStorage 租约
  const key = `tt:${roomId}:join-lock`
  const mine = `${Date.now()}-${Math.random().toString(16).slice(2)}`
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const raw = localStorage.getItem(key)
    const holder = raw ? (JSON.parse(raw) as { owner: string; at: number }) : null
    if (!holder || Date.now() - holder.at > 8000) {
      localStorage.setItem(key, JSON.stringify({ owner: mine, at: Date.now() }))
      try {
        return await task()
      } finally {
        localStorage.removeItem(key)
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 150))
  }
  return task()
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
