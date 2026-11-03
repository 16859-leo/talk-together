import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  JoinLockTimeout,
  clearMembership,
  clearPendingJoin,
  clearSession,
  loadPendingJoin,
  loadSession,
  savePendingJoin,
  saveSession,
  withJoinLock,
} from './session'

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
  // Node 也自带 navigator.locks，这里强制走 localStorage 租约分支
  vi.stubGlobal('navigator', {})
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

describe('待确认的入房请求', () => {
  it('正文原样存取，成功后能清掉', () => {
    savePendingJoin('room_demo', {
      clientRequestId: 'req-1',
      bootstrapToken: 'token',
      inviteCode: 'code',
      profile: { nickname: '小周', interestTags: ['旅行'], bio: '' },
    })
    const pending = loadPendingJoin('room_demo')
    expect(pending?.clientRequestId).toBe('req-1')
    expect(pending?.profile.nickname).toBe('小周')

    clearPendingJoin('room_demo')
    expect(loadPendingJoin('room_demo')).toBeNull()
  })
})

describe('入房锁', () => {
  it('锁被占用时不会无锁执行', async () => {
    // 别的标签页刚拿到锁
    store.set(
      'tt:room_demo:join-lock',
      JSON.stringify({ owner: 'other-tab', at: Date.now() }),
    )
    let ran = false
    await expect(
      withJoinLock(
        'room_demo',
        async () => {
          ran = true
        },
        300,
      ),
    ).rejects.toBeInstanceOf(JoinLockTimeout)
    expect(ran).toBe(false)
  })

  it('锁过期后可以接手', async () => {
    store.set(
      'tt:room_demo:join-lock',
      JSON.stringify({ owner: 'other-tab', at: Date.now() - 30_000 }),
    )
    const result = await withJoinLock('room_demo', async () => 'done', 2000)
    expect(result).toBe('done')
  })
})
