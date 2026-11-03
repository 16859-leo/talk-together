import { request } from './client'
import type {
  ClosedData,
  ConnectionTicketData,
  LeaveData,
  ProfilePatch,
  RemoveData,
  RoomEntryData,
  SelfData,
  SendMessageData,
  SendMessageBody,
  UpdateProfileData,
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

export interface ProfileInput {
  nickname: string
  interestTags: string[]
  bio?: string
}

export interface JoinBody {
  clientRequestId: string
  bootstrapToken: string
  inviteCode?: string
  profile: ProfileInput
}

/** 首次加入。已在房间里再次调用会复用原 membership（200）。 */
export async function joinRoom(roomId: string, body: JoinBody): Promise<RoomEntryData> {
  return request<RoomEntryData>(`/rooms/${roomId}/members`, { method: 'POST', body })
}

export interface CreateRoomBody {
  clientRequestId: string
  bootstrapToken: string
  profile: ProfileInput
}

export async function createRoom(body: CreateRoomBody): Promise<RoomEntryData> {
  return request<RoomEntryData>('/rooms', { method: 'POST', body })
}

/** 只带凭证，用来恢复本人身份与本次入房状态；已退出时 membership 为 null。 */
export async function getSelf(roomId: string, credential: string): Promise<SelfData> {
  return request<SelfData>(`/rooms/${roomId}/members/me`, { credential })
}

export async function leaveRoom(roomId: string, auth: Auth): Promise<LeaveData> {
  return request<LeaveData>(`/rooms/${roomId}/members/me`, {
    method: 'DELETE',
    credential: auth.credential,
    membershipId: auth.membershipId,
  })
}

/** 房主移出成员；被移出的临时身份不能再加入当前房间。 */
export async function removeMember(
  roomId: string,
  memberId: string,
  auth: Auth,
): Promise<RemoveData> {
  return request<RemoveData>(`/rooms/${roomId}/members/${memberId}`, {
    method: 'DELETE',
    credential: auth.credential,
    membershipId: auth.membershipId,
  })
}

/** 房主关闭房间：后端先终结在途调用，再广播 room.closed。 */
export async function closeRoom(roomId: string, auth: Auth): Promise<ClosedData> {
  return request<ClosedData>(`/rooms/${roomId}`, {
    method: 'DELETE',
    credential: auth.credential,
    membershipId: auth.membershipId,
  })
}

/** 改自己的公开资料；改成什么由服务端归一化后回传。 */
export async function updateSelf(
  roomId: string,
  patch: ProfilePatch,
  auth: Auth,
): Promise<UpdateProfileData> {
  return request<UpdateProfileData>(`/rooms/${roomId}/members/me`, {
    method: 'PATCH',
    body: patch,
    credential: auth.credential,
    membershipId: auth.membershipId,
  })
}
