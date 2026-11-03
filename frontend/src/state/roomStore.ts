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
  self: null,
  room: null,
  members: [],
  messages: [],
  invocations: [],
  cursor: 0,
}

type Action =
  | { type: 'snapshot'; data: SnapshotData; cursor: number }
  | { type: 'event'; event: ServerMessage }
  | { type: 'local-message'; message: MemberMessage }
  | { type: 'member-updated'; member: ActiveMember }
  | { type: 'member-removed'; membershipId: string }
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
      return {
        ...state,
        members: exists
          ? state.members.map((m) =>
              m.id === event.data.member.id ? event.data.member : m,
            )
          : [...state.members, event.data.member],
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
    case 'member.removed':
      return {
        ...state,
        members: state.members.filter(
          (m) => m.membership?.id !== event.data.membershipId,
        ),
        cursor: Math.max(state.cursor, event.sequence),
      }
    case 'ai.reply.started':
    case 'ai.reply.completed':
    case 'ai.reply.failed':
    case 'ai.reply.cancelled':
      return {
        ...state,
        messages: upsertMessage(state.messages, event.data.reply),
        cursor: Math.max(state.cursor, event.sequence),
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
      return {
        ...state,
        messages: upsertMessage(state.messages, action.message),
        cursor: Math.max(state.cursor, action.message.createdSequence),
      }
    case 'member-updated':
      return {
        ...state,
        members: state.members.map((member) =>
          member.id === action.member.id ? action.member : member,
        ),
      }
    case 'member-removed':
      return {
        ...state,
        members: state.members.filter(
          (member) => member.membership?.id !== action.membershipId,
        ),
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
