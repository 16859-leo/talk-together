import { ApiError } from '../api/client'
import { createConnectionTicket } from '../api/room'
import type { ServerMessage } from '../api/types'

export type StreamStatus = 'ticketing' | 'connecting' | 'live' | 'reconnecting' | 'closed' | 'failed'

/** 这些错误重试也没用：本次入房已经结束，交给页面切终态。 */
const FATAL_CODES = new Set([
  'MEMBER_REMOVED',
  'MEMBERSHIP_INACTIVE',
  'MEMBERSHIP_CHANGED',
  'MEMBER_CREDENTIAL_INVALID',
  'ROOM_UNAVAILABLE',
  'INVITATION_INVALID',
])

export function isFatalStreamError(code: string | undefined): boolean {
  return code !== undefined && FATAL_CODES.has(code)
}

interface StreamOptions {
  roomId: string
  credential: string
  membershipId: string
  signal: AbortSignal
  onStatus: (status: StreamStatus, detail?: string) => void
  onMessage: (message: ServerMessage) => void
  /** 领票返回终态错误：不再重连，页面据此结束入房 */
  onFatal?: (error: ApiError) => void
}

/**
 * 领票 → 建连 → 收首帧快照 → 持续收事件。
 * 断线后重新领票重连（票是一次性的），退避 0.5s → 5s；
 * 只有可恢复的错误才重试，资格类错误直接上报。
 */
export function openRoomStream(options: StreamOptions): () => void {
  const { roomId, credential, membershipId, signal, onStatus, onMessage, onFatal } = options
  let socket: WebSocket | null = null
  let timer: number | undefined
  let attempt = 0
  let stopped = false

  function stop() {
    stopped = true
    if (timer !== undefined) window.clearTimeout(timer)
    if (socket) {
      socket.onclose = null
      socket.close(1000, 'leave')
      socket = null
    }
  }

  function scheduleRetry() {
    if (stopped) return
    const delay = Math.min(500 * 2 ** attempt, 5000)
    attempt += 1
    onStatus('reconnecting')
    timer = window.setTimeout(() => void connect(), delay)
  }

  async function connect() {
    if (stopped) return
    try {
      onStatus(attempt === 0 ? 'ticketing' : 'reconnecting')
      const ticket = await createConnectionTicket(roomId, { credential, membershipId })
      if (stopped) return

      onStatus('connecting')
      socket = new WebSocket(ticket.webSocketUrl)

      socket.onopen = () => {
        attempt = 0
        onStatus('live')
      }

      socket.onmessage = (event: MessageEvent<string>) => {
        try {
          onMessage(JSON.parse(event.data) as ServerMessage)
        } catch {
          /* 坏帧直接丢弃，不让一帧脏数据打断整条连接 */
        }
      }

      socket.onclose = () => {
        if (stopped) return
        // 正常关闭也走重连：只有组件卸载才算真正结束，
        // 房间真的关掉时后端会先发 room.closed 事件。
        scheduleRetry()
      }
    } catch (error) {
      if (stopped) return

      if (error instanceof ApiError && isFatalStreamError(error.code)) {
        stop()
        onStatus('closed')
        onFatal?.(error)
        return
      }

      const detail = error instanceof ApiError ? error.message : '连接失败'
      onStatus('failed', detail)
      scheduleRetry()
    }
  }

  const onAbort = () => stop()
  signal.addEventListener('abort', onAbort)
  void connect()

  return () => {
    signal.removeEventListener('abort', onAbort)
    stop()
  }
}
