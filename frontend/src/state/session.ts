export interface RoomSession {
  credential: string
  membershipId: string
  memberId: string
}

/** 凭证按房间保存在本地，关房或退出后清理。 */
function sessionKey(roomId: string) {
  return `tt:${roomId}:session`
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
 * 开发期占位：还没接入真实入房时，用一个固定身份连本地 Mock。
 * 接上 POST /rooms/{id}/members 后删掉这个函数。
 */
export function devSession(): RoomSession {
  return {
    credential: 'dev_credential_demo',
    membershipId: 'membership_host',
    memberId: 'member_host',
  }
}
