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

/** 已发出但还没拿到凭证的入房请求：正文原样保存，重试时逐字节复用。 */
export interface PendingJoin {
  clientRequestId: string
  bootstrapToken?: string
  inviteCode?: string
  profile: { nickname: string; interestTags: string[]; bio: string }
  at: number
}

function sessionKey(roomId: string) {
  return `tt:${roomId}:session`
}

function bootstrapKey(roomId: string) {
  return `tt:${roomId}:bootstrap`
}

function pendingJoinKey(roomId: string) {
  return `tt:${roomId}:pending-join`
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

export function loadPendingJoin(roomId: string): PendingJoin | null {
  try {
    const raw = localStorage.getItem(pendingJoinKey(roomId))
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<PendingJoin>
    if (!parsed.clientRequestId || !parsed.profile) return null
    return parsed as PendingJoin
  } catch {
    return null
  }
}

export function savePendingJoin(roomId: string, pending: Omit<PendingJoin, 'at'>) {
  try {
    localStorage.setItem(pendingJoinKey(roomId), JSON.stringify({ ...pending, at: Date.now() }))
  } catch {
    /* 忽略 */
  }
}

export function clearPendingJoin(roomId: string) {
  try {
    localStorage.removeItem(pendingJoinKey(roomId))
  } catch {
    /* 忽略 */
  }
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
export class JoinLockTimeout extends Error {
  constructor() {
    super('另一个标签页正在入房，稍后再试')
    this.name = 'JoinLockTimeout'
  }
}

/**
 * 跨标签页串行入房。没有 Web Locks 时用 localStorage 租约：
 * 拿到锁后定期续租，等不到锁就抛 JoinLockTimeout——绝不无锁执行。
 */
export async function withJoinLock<T>(
  roomId: string,
  task: () => Promise<T>,
  timeoutMs = 20000,
): Promise<T> {
  const locks = (navigator as Navigator & { locks?: LockManager }).locks
  if (locks?.request) {
    return locks.request(`tt-join:${roomId}`, task)
  }

  const key = `tt:${roomId}:join-lock`
  const mine = `${Date.now()}-${Math.random().toString(16).slice(2)}`
  const deadline = Date.now() + timeoutMs

  const readHolder = () => {
    const raw = localStorage.getItem(key)
    if (!raw) return null
    try {
      return JSON.parse(raw) as { owner: string; at: number }
    } catch {
      return null
    }
  }

  while (Date.now() < deadline) {
    const holder = readHolder()
    if (!holder || holder.owner === mine || Date.now() - holder.at > 8000) {
      localStorage.setItem(key, JSON.stringify({ owner: mine, at: Date.now() }))
      const renew = setInterval(() => {
        if (readHolder()?.owner === mine) {
          localStorage.setItem(key, JSON.stringify({ owner: mine, at: Date.now() }))
        }
      }, 2000)
      try {
        return await task()
      } finally {
        clearInterval(renew)
        if (readHolder()?.owner === mine) localStorage.removeItem(key)
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 150))
  }

  throw new JoinLockTimeout()
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
