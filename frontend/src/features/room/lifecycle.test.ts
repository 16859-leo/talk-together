import { describe, expect, it } from 'vitest'
import { FATAL_STREAM_CODES, resolveTerminal } from './lifecycle'

describe('终态判定', () => {
  it('被移出：清身份，不给重新加入入口', () => {
    const outcome = resolveTerminal({ kind: 'removed' })
    expect(outcome.identity).toBe('clear')
    expect(outcome.rejoinable).toBe(false)
    expect(outcome.title).toContain('移出')
  })

  it('主动退出 / 入房结束：保留身份，可以重新加入', () => {
    for (const reason of [{ kind: 'left' as const }, { kind: 'fatal' as const, code: 'MEMBERSHIP_INACTIVE' }]) {
      const outcome = resolveTerminal(reason)
      expect(outcome.identity).toBe('keep')
      expect(outcome.rejoinable).toBe(true)
    }
  })

  it('关房与凭证失效都清身份', () => {
    expect(resolveTerminal({ kind: 'closed' }).identity).toBe('clear')
    expect(resolveTerminal({ kind: 'fatal', code: 'MEMBER_CREDENTIAL_INVALID' }).identity).toBe(
      'clear',
    )
    expect(resolveTerminal({ kind: 'fatal', code: 'ROOM_UNAVAILABLE' }).identity).toBe('clear')
  })

  it('未知码按「入房结束」处理，但不会误判成不可恢复', () => {
    const outcome = resolveTerminal({ kind: 'fatal', code: 'SOMETHING_NEW' })
    expect(outcome.identity).toBe('keep')
    expect(FATAL_STREAM_CODES.has('SOMETHING_NEW')).toBe(false)
  })

  it('连接层与页面用同一份终态码集合', () => {
    expect([...FATAL_STREAM_CODES].sort()).toEqual(
      [
        'INVITATION_INVALID',
        'MEMBER_CREDENTIAL_INVALID',
        'MEMBER_REMOVED',
        'MEMBERSHIP_CHANGED',
        'MEMBERSHIP_INACTIVE',
        'ROOM_UNAVAILABLE',
      ].sort(),
    )
  })
})
