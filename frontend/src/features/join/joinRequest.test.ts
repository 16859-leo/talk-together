import { describe, expect, it } from 'vitest'
import {
  canReplayPending,
  isDefinitiveFailure,
  toJoinBody,
  toPendingJoin,
} from './joinRequest'
import type { PendingJoin } from '../../state/session'

const pending: PendingJoin = {
  clientRequestId: 'req-1',
  bootstrapToken: 'dddd',
  inviteCode: 'ffff',
  profile: { nickname: '小周', interestTags: ['旅行'], bio: 'hi' },
  at: 1700000000000,
}

describe('入房请求体', () => {
  it('重放时只带契约字段，不把本地 at 发出去', () => {
    const body = toJoinBody(pending)
    expect(Object.keys(body).sort()).toEqual(
      ['bootstrapToken', 'clientRequestId', 'inviteCode', 'profile'].sort(),
    )
    expect(Object.keys(body.profile).sort()).toEqual(['bio', 'interestTags', 'nickname'])
    expect('at' in body).toBe(false)
  })

  it('落盘时保留 at 供本地判断，但请求体不含它', () => {
    const record = toPendingJoin(
      {
        clientRequestId: 'req-2',
        bootstrapToken: 'b',
        inviteCode: 'c',
        profile: { nickname: '阿澄', interestTags: ['滑板'], bio: '' },
      },
      123,
    )
    expect(record.at).toBe(123)
    expect(toJoinBody(record)).not.toHaveProperty('at')
  })
})

describe('pending 复用规则', () => {
  const values = { nickname: '小周', interestTags: ['旅行'], bio: 'hi' }

  it('内容与邀请码一致才允许重放', () => {
    expect(canReplayPending(pending, values, 'ffff')).toBe(true)
    expect(canReplayPending(pending, { ...values, nickname: '小周2' }, 'ffff')).toBe(false)
    expect(canReplayPending(pending, values, 'other')).toBe(false)
    expect(canReplayPending(null, values, 'ffff')).toBe(false)
  })

  it('标签顺序不同也算改了资料', () => {
    expect(
      canReplayPending(
        { ...pending, profile: { ...pending.profile, interestTags: ['旅行', '咖啡'] } },
        { ...values, interestTags: ['咖啡', '旅行'] },
        'ffff',
      ),
    ).toBe(false)
  })

  it('只有结果未知的错误才保留 pending', () => {
    expect(isDefinitiveFailure('NICKNAME_TAKEN')).toBe(true)
    expect(isDefinitiveFailure('VALIDATION_ERROR')).toBe(true)
    expect(isDefinitiveFailure('ROOM_FULL')).toBe(true)
    expect(isDefinitiveFailure('BOOTSTRAP_CONFLICT')).toBe(false)
    // 网络失败时请求可能已经被受理，pending 必须留着
    expect(isDefinitiveFailure('NETWORK')).toBe(false)
    expect(isDefinitiveFailure('SERVICE_UNAVAILABLE')).toBe(false)
    expect(isDefinitiveFailure(undefined)).toBe(false)
  })
})
