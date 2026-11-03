import { newId, isoTime, type Config } from '../config.ts';
import { AppError, type ErrorCode } from './errors.ts';

export interface Profile {
  nickname: string;
  interestTags: string[];
  bio: string;
}

export type Presence = 'connecting' | 'online' | 'offline';

export interface Membership {
  id: string;
  joinedSequence: number;
  joinedAt: string;
  presence: Presence;
  recoveryExpiresAt: string | null;
}

export interface MemberRecord {
  id: string;
  role: 'host' | 'member';
  profile: Profile;
  /** 当前入房；退出、被移出或恢复超时后为 null，但成员身份仍保留。 */
  membership: Membership | null;
  credential: string;
  removed: boolean;
}

export interface MemberMessageRecord {
  kind: 'member';
  id: string;
  authorId: string;
  /** 发布时所属的本次入房；幂等重试跨入房时不得重放旧正文。 */
  membershipId: string;
  text: string;
  clientRequestId: string;
  createdAt: string;
  createdSequence: number;
}

export type InvocationStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
export type ReplyStatus = 'streaming' | 'completed' | 'failed' | 'cancelled';
export type ReplyPurpose = 'reply' | 'topic' | 'invitation';

export interface InvocationRecord {
  id: string;
  source: 'host' | 'automatic';
  callerMemberId: string | null;
  triggerMessageId: string | null;
  clientRequestId: string | null;
  status: InvocationStatus;
  queuePosition: number | null;
  replyId: string | null;
  purpose: ReplyPurpose;
  invitedMemberId: string | null;
  createdAt: string;
  createdSequence: number;
  startedAt: string | null;
  finishedAt: string | null;
  expiresAt: string | null;
  error: { code: ErrorCode; message: string; retryAfterMs: number | null } | null;
  /** 排队等待超时定时器；开始执行后清除。 */
  queueTimer?: NodeJS.Timeout;
  /** 取消控制器，关房与超时通过它中断能力插件。 */
  controller?: AbortController;
}

export interface AIReplyRecord {
  kind: 'ai';
  id: string;
  invocationId: string;
  callerMemberId: string | null;
  triggerMessageId: string | null;
  purpose: ReplyPurpose;
  invitedMemberId: string | null;
  text: string;
  status: ReplyStatus;
  startedSequence: number;
  createdAt: string;
  updatedAt: string;
  error: { code: ErrorCode; message: string; retryAfterMs: number | null } | null;
}

export interface TopicRecord {
  id: string;
  title: string;
  content: string;
  kind: 'common' | 'popular';
  sourceLabel: string | null;
  sourceUrl: string | null;
  publishedAt: string;
}

export interface RoomRecord {
  id: string;
  hostMemberId: string;
  capacity: number;
  status: 'open' | 'host_reconnecting';
  hostRecoveryExpiresAt: string | null;
  currentTopic: TopicRecord | null;
  inviteCode: string;
  closed: boolean;
  /** 单调递增的房间事件序号；状态变更与取号在同一临界区完成。 */
  sequence: number;
  members: Map<string, MemberRecord>;
  messages: MemberMessageRecord[];
  replies: Map<string, AIReplyRecord>;
  invocations: Map<string, InvocationRecord>;
  /** AI 串行执行状态：同房间同时最多一个 running。 */
  running: string | null;
  queue: string[];
  /** 掉线恢复定时器，按 membershipId 记录。 */
  recoveryTimers: Map<string, NodeJS.Timeout>;
  /** 最后一条成员消息的时间戳，冷场判定的基准；AI 发言不更新它。 */
  lastMemberMessageAt: number;
  /** 当前话题是否已经发起过随机邀答；换话题时重置，保证每话题最多一次。 */
  invitedForCurrentTopic: boolean;
  /** 最近一次自动补话的时间戳，用于邀答的二级冷场判定。 */
  lastAutoAt: number;
}

/** 昵称归一化：去首尾空白并压缩内部空白，唯一性以此为准。 */
export const normalizeNickname = (value: string): string => value.trim().replace(/\s+/g, ' ');

/** 取下一个事件序号。调用方必须已经完成状态变更，保证取号与变更同序。 */
export const nextSequence = (room: RoomRecord): number => ++room.sequence;

/** 当前占用的名额：持有有效 membership 的成员数。离线在恢复期内仍占名额。 */
export const occupiedSlots = (room: RoomRecord): number =>
  [...room.members.values()].filter(member => member.membership !== null).length;

export const activeMembers = (room: RoomRecord): MemberRecord[] =>
  [...room.members.values()].filter(member => member.membership !== null);

export const host = (room: RoomRecord): MemberRecord | undefined => room.members.get(room.hostMemberId);

/** 房间内昵称唯一；只在持有 membership 的成员间比较。 */
export const assertNicknameAvailable = (room: RoomRecord, nickname: string, selfMemberId?: string): void => {
  const target = normalizeNickname(nickname);
  for (const member of activeMembers(room)) {
    if (member.id === selfMemberId) continue;
    if (normalizeNickname(member.profile.nickname) === target) {
      throw new AppError('NICKNAME_TAKEN', '昵称已被占用，请修改');
    }
  }
};

export const assertNotFull = (room: RoomRecord): void => {
  if (occupiedSlots(room) >= room.capacity) {
    throw new AppError('ROOM_FULL', '房间人数已满');
  }
};

export const createRoomRecord = (config: Config, inviteCode: string): RoomRecord => ({
  id: newId('room'),
  hostMemberId: '',
  capacity: config.roomCapacity,
  status: 'open',
  hostRecoveryExpiresAt: null,
  currentTopic: null,
  inviteCode,
  closed: false,
  sequence: 0,
  members: new Map(),
  messages: [],
  replies: new Map(),
  invocations: new Map(),
  running: null,
  queue: [],
  recoveryTimers: new Map(),
  lastMemberMessageAt: Date.now(),
  invitedForCurrentTopic: false,
  lastAutoAt: 0,
});

export const createMembership = (room: RoomRecord): Membership => ({
  id: newId('membership'),
  joinedSequence: nextSequence(room),
  joinedAt: isoTime(),
  presence: 'connecting',
  recoveryExpiresAt: null,
});
