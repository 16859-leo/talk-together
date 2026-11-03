import type {
  AIReplyRecord,
  InvocationRecord,
  MemberMessageRecord,
  MemberRecord,
  RoomRecord,
  TopicRecord,
} from '../domain/room.ts';
import { occupiedSlots } from '../domain/room.ts';

/**
 * 领域记录到线上载荷的唯一转换处。
 *
 * 契约要求返回对象不随意省字段，`null` 表示没有对应值，不与空字符串或空数组
 * 混用，因此这里逐字段显式输出。
 */

const author = (room: RoomRecord, memberId: string | null) => {
  if (memberId === null) return null;
  const member = room.members.get(memberId);
  if (!member) return null;
  return { memberId: member.id, nickname: member.profile.nickname };
};

export const wireProfile = (member: MemberRecord) => ({
  nickname: member.profile.nickname,
  interestTags: [...member.profile.interestTags],
  bio: member.profile.bio,
});

export const wireMembership = (member: MemberRecord) =>
  member.membership === null
    ? null
    : {
        id: member.membership.id,
        joinedSequence: member.membership.joinedSequence,
        joinedAt: member.membership.joinedAt,
        presence: member.membership.presence,
        recoveryExpiresAt: member.membership.recoveryExpiresAt,
      };

export const wireMember = (member: MemberRecord) => ({
  id: member.id,
  role: member.role,
  profile: wireProfile(member),
  membership: wireMembership(member),
});

export const wireTopic = (topic: TopicRecord) => ({
  id: topic.id,
  title: topic.title,
  content: topic.content,
  kind: topic.kind,
  sourceLabel: topic.sourceLabel,
  sourceUrl: topic.sourceUrl,
  publishedAt: topic.publishedAt,
});

export const wireRoom = (room: RoomRecord) => ({
  id: room.id,
  hostMemberId: room.hostMemberId,
  capacity: room.capacity,
  occupiedSlots: occupiedSlots(room),
  status: room.status,
  hostRecoveryExpiresAt: room.hostRecoveryExpiresAt,
  currentTopic: room.currentTopic === null ? null : wireTopic(room.currentTopic),
  invitation: {
    inviteCode: room.inviteCode,
    joinPath: `/join/${room.id}?inviteCode=${room.inviteCode}`,
  },
});

export const wireMessage = (room: RoomRecord, message: MemberMessageRecord) => ({
  kind: 'member' as const,
  id: message.id,
  author: author(room, message.authorId) ?? { memberId: message.authorId, nickname: message.authorId },
  text: message.text,
  clientRequestId: message.clientRequestId,
  createdAt: message.createdAt,
  createdSequence: message.createdSequence,
});

export const wireInvocation = (room: RoomRecord, invocation: InvocationRecord) => ({
  id: invocation.id,
  source: invocation.source,
  caller: author(room, invocation.callerMemberId),
  triggerMessageId: invocation.triggerMessageId,
  clientRequestId: invocation.clientRequestId,
  status: invocation.status,
  queuePosition: invocation.queuePosition,
  replyId: invocation.replyId,
  createdAt: invocation.createdAt,
  createdSequence: invocation.createdSequence,
  startedAt: invocation.startedAt,
  finishedAt: invocation.finishedAt,
  expiresAt: invocation.expiresAt,
  error: invocation.error,
});

export const wireReply = (room: RoomRecord, reply: AIReplyRecord) => ({
  kind: 'ai' as const,
  id: reply.id,
  invocationId: reply.invocationId,
  caller: author(room, reply.callerMemberId),
  triggerMessageId: reply.triggerMessageId,
  purpose: reply.purpose,
  invitedMember: author(room, reply.invitedMemberId),
  text: reply.text,
  status: reply.status,
  startedSequence: reply.startedSequence,
  createdAt: reply.createdAt,
  updatedAt: reply.updatedAt,
  error: reply.error,
});
