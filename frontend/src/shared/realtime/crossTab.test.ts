import { describe, expect, it } from 'vitest'
import { canReuseRequestId, crossTabAction, isSameEpoch } from './crossTab'

describe('跨标签页动作', () => {
  it('left 只结束本次入房，closed 才清身份', () => {
    expect(crossTabAction('left')).toBe('clear-membership')
    expect(crossTabAction('closed')).toBe('clear-session')
    expect(crossTabAction('whatever')).toBeNull()
    expect(crossTabAction(undefined)).toBeNull()
  })
})

describe('发送重试键', () => {
  const draft = { id: 'req-1', text: '打大家', mentions: [] as string[] }

  it('正文和提及都一致才复用请求 ID', () => {
    expect(canReuseRequestId(draft, '打大家', [])).toBe(true)
    expect(canReuseRequestId(draft, '打大家', ['ai'])).toBe(false)
    expect(canReuseRequestId(draft, '换了话', [])).toBe(false)
    expect(canReuseRequestId(null, '打大家', [])).toBe(false)
  })

  it('提及顺序不同也视为不同请求', () => {
    const two = { id: 'r', text: 't', mentions: ['ai', 'x'] }
    expect(canReuseRequestId(two, 't', ['ai', 'x'])).toBe(true)
    expect(canReuseRequestId(two, 't', ['x', 'ai'])).toBe(false)
  })
})

describe('房间上下文令牌', () => {
  const epoch = { roomId: 'room_a', token: 1 }

  it('房间或令牌变化后，旧回执不再生效', () => {
    expect(isSameEpoch({ roomId: 'room_a', token: 1 }, epoch)).toBe(true)
    expect(isSameEpoch({ roomId: 'room_a', token: 2 }, epoch)).toBe(false)
    expect(isSameEpoch({ roomId: 'room_b', token: 1 }, epoch)).toBe(false)
  })
})
