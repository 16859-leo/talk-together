import { beforeEach, describe, expect, it, vi } from 'vitest'
import { clearMembership, clearSession, loadSession, saveSession } from './session'

const store = new Map<string, string>()

vi.stubGlobal('localStorage', {
  getItem: (key: string) => store.get(key) ?? null,
  setItem: (key: string, value: string) => {
    store.set(key, value)
  },
  removeItem: (key: string) => {
    store.delete(key)
  },
})

beforeEach(() => {
  store.clear()
})

describe('会话读取', () => {
  it('membership 结束的会话仍然读得出来', () => {
    saveSession('room_demo', {
      credential: 'cred',
      memberId: 'member_guest',
      nickname: '小周',
    })
    const session = loadSession('room_demo')
    expect(session).not.toBeNull()
    expect(session?.credential).toBe('cred')
    expect(session?.membershipId).toBeUndefined()
  })

  it('没有凭证或 memberId 才算无效', () => {
    saveSession('room_demo', { credential: '', memberId: 'member_guest' })
    expect(loadSession('room_demo')).toBeNull()
    saveSession('room_demo', { credential: 'cred', memberId: '' })
    expect(loadSession('room_demo')).toBeNull()
  })

  it('clearMembership 只摘 membership，保留可复用的身份', () => {
    saveSession('room_demo', {
      credential: 'cred',
      membershipId: 'membership_guest',
      memberId: 'member_guest',
      nickname: '小周',
    })
    clearMembership('room_demo')
    const session = loadSession('room_demo')
    expect(session?.credential).toBe('cred')
    expect(session?.memberId).toBe('member_guest')
    expect(session?.membershipId).toBeUndefined()
    expect(session?.nickname).toBe('小周')
  })

  it('clearSession 才把身份整个删掉', () => {
    saveSession('room_demo', { credential: 'cred', membershipId: 'm', memberId: 'member_guest' })
    clearSession('room_demo')
    expect(loadSession('room_demo')).toBeNull()
  })
})
