import { request } from './client'
import type {
  ConnectionTicketData,
  RoomEntryData,
  SendMessageData,
  SendMessageBody,
} from './types'

export interface Auth {
  credential: string
  membershipId: string
}

/** 每个标签页、每次重连都要单独领票；票据短效且只能消费一次。 */
export async function createConnectionTicket(
  roomId: string,
  auth: Auth,
): Promise<ConnectionTicketData> {
  return request<ConnectionTicketData>(`/rooms/${roomId}/connection-tickets`, {
    method: 'POST',
    credential: auth.credential,
    membershipId: auth.membershipId,
  })
}

export async function sendMessage(
  roomId: string,
  body: SendMessageBody,
  auth: Auth,
): Promise<SendMessageData> {
  return request<SendMessageData>(`/rooms/${roomId}/messages`, {
    method: 'POST',
    body,
    credential: auth.credential,
    membershipId: auth.membershipId,
  })
}

export interface JoinBody {
  clientRequestId: string
  bootstrapToken: string
  inviteCode?: string
  profile: { nickname: string; interestTags: string[]; bio?: string }
}

export async function joinRoom(roomId: string, body: JoinBody): Promise<RoomEntryData> {
  return request<RoomEntryData>(`/rooms/${roomId}/members`, { method: 'POST', body })
}

export interface CreateRoomBody {
  clientRequestId: string
  bootstrapToken: string
  profile: { nickname: string; interestTags: string[]; bio?: string }
}

export async function createRoom(body: CreateRoomBody): Promise<RoomEntryData> {
  return request<RoomEntryData>('/rooms', { method: 'POST', body })
}
