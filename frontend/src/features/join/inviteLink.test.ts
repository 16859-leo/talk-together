import { describe, expect, it } from 'vitest'
import { parseInviteLink } from './inviteLink'

const ORIGIN = 'http://127.0.0.1:5174'

describe('parseInviteLink', () => {
  it('完整邀请链接解析成站内路径', () => {
    expect(
      parseInviteLink(
        'http://127.0.0.1:5174/join/room_abc?inviteCode=deadbeefdeadbeefdeadbeefdeadbeef',
        ORIGIN,
      ),
    ).toBe('/join/room_abc?inviteCode=deadbeefdeadbeefdeadbeefdeadbeef')
  })

  it('只贴路径也认，允许首尾空格和尾斜杠', () => {
    expect(parseInviteLink('  /join/room_abc?inviteCode=xyz  ', ORIGIN)).toBe(
      '/join/room_abc?inviteCode=xyz',
    )
    expect(parseInviteLink('http://127.0.0.1:5174/join/room_abc/?inviteCode=xyz', ORIGIN)).toBe(
      '/join/room_abc?inviteCode=xyz',
    )
  })

  it('不合法输入返回 null', () => {
    expect(parseInviteLink('', ORIGIN)).toBeNull()
    expect(parseInviteLink('随便一句话', ORIGIN)).toBeNull()
    expect(parseInviteLink('http://127.0.0.1:5174/rooms/room_abc', ORIGIN)).toBeNull()
    expect(parseInviteLink('http://127.0.0.1:5174/join/room_abc', ORIGIN)).toBeNull()
    expect(parseInviteLink('http://127.0.0.1:5174/join/room_abc?inviteCode=', ORIGIN)).toBeNull()
  })

  it('保留其它查询参数', () => {
    expect(parseInviteLink('/join/room_abc?inviteCode=xyz&from=wx', ORIGIN)).toBe(
      '/join/room_abc?inviteCode=xyz&from=wx',
    )
  })
})
