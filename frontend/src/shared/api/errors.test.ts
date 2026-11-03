import { describe, expect, it } from 'vitest'
import { errorText } from './errors'

describe('错误码文案', () => {
  it('契约里的码都有中文提示', () => {
    expect(errorText('ROOM_FULL', 'fallback')).toBe('房间坐满了，等有人退出再来')
    expect(errorText('NICKNAME_TAKEN', 'fallback')).toBe('这个昵称已经有人用了，换一个吧')
    expect(errorText('MESSAGE_RATE_LIMITED', 'fallback')).toBe('发得太快了，缓一下再发')
    expect(errorText('AI_QUEUE_FULL', 'fallback')).toBe('AI 队列满了，这条没排队')
    expect(errorText('CONNECTION_TICKET_EXPIRED', 'fallback')).toBe('连接票据过期了，正在重连')
  })

  it('网络自造的码也有文案', () => {
    expect(errorText('NETWORK', 'fallback')).toBe('网络不太稳，稍后再试')
  })

  it('未知码回落到接口给的 message', () => {
    expect(errorText('SOMETHING_NEW', '服务端自定义文案')).toBe('服务端自定义文案')
    expect(errorText(undefined, '兜底')).toBe('兜底')
  })
})
