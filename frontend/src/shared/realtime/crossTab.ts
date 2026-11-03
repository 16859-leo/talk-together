import type { ActiveMember, MemberMessage } from '../api/types'

/**
 * 跨标签页事件：同一房间共享身份，退出/关房要一起结束。
 * 只传事件类型，不传凭证，避免把敏感数据丢进广播频道。
 */
export type CrossTabEvent = 'left' | 'closed'

export type CrossTabAction = 'clear-membership' | 'clear-session'

/** 退出只结束本次入房，关房才让身份失效。 */
export function crossTabAction(event: string | undefined): CrossTabAction | null {
  if (event === 'left') return 'clear-membership'
  if (event === 'closed') return 'clear-session'
  return null
}

interface RoomChannelOptions {
  roomId: string
  onEvent: (event: CrossTabEvent) => void
}

export interface RoomChannel {
  publish: (event: CrossTabEvent) => void
  close: () => void
}

/** 订阅本房间的广播，并返回广播句柄；环境不支持时安静降级。 */
export function openRoomChannel({ roomId, onEvent }: RoomChannelOptions): RoomChannel {
  if (typeof BroadcastChannel === 'undefined') {
    return { publish: () => {}, close: () => {} }
  }
  const channel = new BroadcastChannel(`tt:${roomId}`)
  channel.onmessage = (message: MessageEvent<{ type?: string }>) => {
    const action = crossTabAction(message.data?.type)
    if (action) onEvent(message.data?.type as CrossTabEvent)
  }
  return {
    publish: (event: CrossTabEvent) => {
      channel.postMessage({ type: event })
    },
    close: () => channel.close(),
  }
}

/** 广播一次本地事件；返回是否真的发出去（供测试与降级判断）。 */
export function publishRoomEvent(channel: BroadcastChannel | null, event: CrossTabEvent): boolean {
  if (!channel) return false
  channel.postMessage({ type: event })
  return true
}

/**
 * 出站消息的重试键：正文和结构化提及都必须一致，
 * 否则同一个 clientRequestId 会带着不同请求体触发 IDEMPOTENCY_CONFLICT。
 */
export interface OutgoingDraft {
  id: string
  text: string
  mentions: readonly string[]
}

export function canReuseRequestId(
  previous: OutgoingDraft | null,
  text: string,
  mentions: readonly string[],
): boolean {
  if (!previous) return false
  if (previous.text !== text) return false
  if (previous.mentions.length !== mentions.length) return false
  return previous.mentions.every((mention, index) => mention === mentions[index])
}

/** 房间切换 / 卸载后，迟到的回执不能再写进新房间。 */
export interface RoomEpoch {
  roomId: string
  token: number
}

export function isSameEpoch(current: RoomEpoch, captured: RoomEpoch): boolean {
  return current.roomId === captured.roomId && current.token === captured.token
}

/** 回执里的消息是否属于当前这次入房。 */
export function belongsToRoom(
  message: MemberMessage,
  selfMemberId: string | undefined,
  room: { id: string } | null,
  roomId: string,
): boolean {
  if (!room || room.id !== roomId) return false
  if (!selfMemberId) return false
  return message.author.memberId === selfMemberId || message.kind === 'member'
}

/** 成员列表里是否已经有这个人（用于乐观补名片前判重）。 */
export function hasMember(members: ActiveMember[], memberId: string | undefined): boolean {
  return Boolean(memberId) && members.some((member) => member.id === memberId)
}
