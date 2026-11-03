import { useSyncExternalStore } from 'react'
import type {
  ActiveMember,
  Invocation,
  MemberMessage,
  Message,
  Room,
  ServerMessage,
  SnapshotData,
} from '../shared/api/types'

export interface RoomState {
  ready: boolean
  closed: boolean
  /** 本人的 membership 结束方式：被移出 / 主动退出 */
  selfEnded: 'removed' | 'left' | null
  self: SnapshotData['self'] | null
  room: Room | null
  members: ActiveMember[]
  messages: Message[]
  invocations: Invocation[]
  cursor: number
}

export const emptyState: RoomState = {
  ready: false,
  closed: false,
  selfEnded: null,
  self: null,
  room: null,
  members: [],
  messages: [],
  invocations: [],
  cursor: 0,
}

/** 占位数始终跟着成员列表走，避免侧栏显示旧数字 */
function withOccupied(room: Room | null, occupied: number): Room | null {
  if (!room) return room
  return room.occupiedSlots === occupied ? room : { ...room, occupiedSlots: occupied }
}

type Action =
  | { type: 'snapshot'; data: SnapshotData; cursor: number }
  | { type: 'event'; event: ServerMessage }
  | { type: 'local-message'; message: MemberMessage }
  | { type: 'member-updated'; member: ActiveMember }
  | { type: 'member-added'; member: ActiveMember }
  | { type: 'member-removed'; membershipId: string }
  | { type: 'self-override'; self: SnapshotData['self'] }
  | { type: 'reset' }

function sortMessages(messages: Message[]): Message[] {
  const key = (m: Message) =>
    m.kind === 'member' ? m.createdSequence : m.startedSequence
  return [...messages].sort((a, b) => key(a) - key(b))
}

function upsertMessage(messages: Message[], next: Message): Message[] {
  const index = messages.findIndex((m) => m.id === next.id)
  if (index === -1) return sortMessages([...messages, next])
  const copy = [...messages]
  copy[index] = next
  return copy
}

function reduceEvent(state: RoomState, event: ServerMessage): RoomState {
  switch (event.type) {
    case 'room.snapshot':
      return {
        ready: true,
        closed: false,
        selfEnded: null,
        self: event.data.self,
        room: event.data.room,
        members: event.data.members,
        messages: sortMessages(event.data.messages),
        invocations: event.data.invocations,
        cursor: event.cursor,
      }
    case 'message.created':
      return {
        ...state,
        messages: upsertMessage(state.messages, event.data.message),
        cursor: Math.max(state.cursor, event.sequence),
      }
    case 'topic.changed':
      return state.room
        ? {
            ...state,
            room: { ...state.room, currentTopic: event.data.topic },
            cursor: Math.max(state.cursor, event.sequence),
          }
        : state
    case 'member.joined':
    case 'member.updated': {
      const exists = state.members.some((m) => m.id === event.data.member.id)
      const members = exists
        ? state.members.map((m) =>
            m.id === event.data.member.id ? event.data.member : m,
          )
        : [...state.members, event.data.member]
      return {
        ...state,
        members,
        room: withOccupied(state.room, members.length),
        cursor: Math.max(state.cursor, event.sequence),
      }
    }
    case 'member.presence.changed':
      return {
        ...state,
        members: state.members.map((m) =>
          m.membership?.id === event.data.membershipId
            ? {
                ...m,
                membership: m.membership
                  ? {
                      ...m.membership,
                      presence: event.data.presence,
                      recoveryExpiresAt: event.data.recoveryExpiresAt,
                    }
                  : m.membership,
              }
            : m,
        ),
        cursor: Math.max(state.cursor, event.sequence),
      }
    case 'member.left':
    case 'member.removed': {
      const members = state.members.filter(
        (m) => m.membership?.id !== event.data.membershipId,
      )
      // 本人的 membership 结束就是这次入房结束，不能只删名片
      const selfEnded =
        state.self?.membershipId === event.data.membershipId
          ? event.type === 'member.removed'
            ? 'removed'
            : 'left'
          : state.selfEnded
      return {
        ...state,
        members,
        room: withOccupied(state.room, members.length),
        selfEnded,
        cursor: Math.max(state.cursor, event.sequence),
      }
    }
    case 'ai.reply.started':
    case 'ai.reply.completed':
    case 'ai.reply.failed':
    case 'ai.reply.cancelled': {
      const invocation = event.data.invocation
      const exists = invocation && state.invocations.some((item) => item.id === invocation.id)
      return {
        ...state,
        messages: upsertMessage(state.messages, event.data.reply),
        invocations: invocation
          ? exists
            ? state.invocations.map((item) => (item.id === invocation.id ? invocation : item))
            : [...state.invocations, invocation]
          : state.invocations,
        cursor: Math.max(state.cursor, event.sequence),
      }
    }
    case 'ai.reply.delta': {
      const index = state.messages.findIndex(
        (m) => m.kind === 'ai' && m.id === event.data.replyId,
      )
      if (index === -1) return state
      const current = state.messages[index]
      if (current.kind !== 'ai') return state
      const next: Message = { ...current, text: current.text + event.data.textDelta }
      return {
        ...state,
        messages: upsertMessage(state.messages, next),
        cursor: Math.max(state.cursor, event.sequence),
      }
    }
    case 'ai.invocation.updated': {
      const next = event.data.invocation
      const exists = state.invocations.some((item) => item.id === next.id)
      return {
        ...state,
        invocations: exists
          ? state.invocations.map((item) => (item.id === next.id ? next : item))
          : [...state.invocations, next],
        cursor: Math.max(state.cursor, event.sequence),
      }
    }
    case 'room.updated':
      return state.room
        ? {
            ...state,
            room: {
              ...state.room,
              status: event.data.status,
              hostRecoveryExpiresAt: event.data.hostRecoveryExpiresAt,
            },
            cursor: Math.max(state.cursor, event.sequence),
          }
        : state
    case 'room.closed':
      return {
        ...state,
        closed: true,
        cursor: Math.max(state.cursor, event.sequence),
      }
    default:
      return state
  }
}

function reducer(state: RoomState, action: Action): RoomState {
  switch (action.type) {
    case 'snapshot':
      return {
        ready: true,
        closed: false,
        selfEnded: null,
        self: action.data.self,
        room: action.data.room,
        members: action.data.members,
        messages: sortMessages(action.data.messages),
        invocations: action.data.invocations,
        cursor: action.cursor,
      }
    case 'event':
      return reduceEvent(state, action.event)
    case 'local-message':
      // 本地即时反馈：只归并消息，游标必须由快照和已处理的 WS 事件推进
      return {
        ...state,
        messages: upsertMessage(state.messages, action.message),
      }
    case 'member-updated':
      return {
        ...state,
        members: state.members.map((member) =>
          member.id === action.member.id ? action.member : member,
        ),
      }
    case 'member-added':
      if (state.members.some((member) => member.id === action.member.id)) return state
      return {
        ...state,
        members: [...state.members, action.member],
        room: withOccupied(state.room, state.members.length + 1),
      }
    case 'self-override':
      return { ...state, self: action.self }
    case 'member-removed': {
      const members = state.members.filter(
        (member) => member.membership?.id !== action.membershipId,
      )
      return {
        ...state,
        members,
        room: withOccupied(state.room, members.length),
      }
    }
    case 'reset':
      return emptyState
    default:
      return state
  }
}

let state: RoomState = emptyState
const listeners = new Set<() => void>()

function emit() {
  for (const listener of listeners) listener()
}

export function dispatch(action: Action) {
  const next = reducer(state, action)
  if (next === state) return
  state = next
  emit()
}

export function dispatchEvent(event: ServerMessage) {
  dispatch({ type: 'event', event })
}

/**
 * 统一入口：快照总是整体替换；增量事件只接受比当前游标更新的序号。
 * 跳号正常（可见性过滤会跳），重复序号直接丢弃。
 */
export function applyServerMessage(message: ServerMessage) {
  if (message.type === 'room.snapshot') {
    dispatch({ type: 'snapshot', data: message.data, cursor: message.cursor })
    return
  }
  if (message.sequence <= getRoomState().cursor) return
  dispatch({ type: 'event', event: message })
}

export function getRoomState(): RoomState {
  return state
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function useRoomState(): RoomState {
  return useSyncExternalStore(subscribe, getRoomState, getRoomState)
}
