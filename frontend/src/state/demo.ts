import type {
  ActiveMember,
  Invocation,
  MemberMessage,
  Message,
  Room,
  SnapshotData,
  Topic,
} from '../shared/api/types'

const NOW = '2026-11-03T13:41:00.000Z'
const RECOVERY_ENDS_AT = new Date(Date.now() + 42_000).toISOString()

/** 演示用的邀请码：契约里的 Secret 是 64 位十六进制。 */
export const DEMO_INVITE_CODE =
  'ff3a0000000000000000000000000000000000000000000000000000000000'
export const DEMO_INVITE_PATH = `/join/room_demo?inviteCode=${DEMO_INVITE_CODE}`

function member(params: {
  id: string
  role: 'host' | 'member'
  nickname: string
  tags: string[]
  joinedSequence: number
  presence?: 'online' | 'offline'
  recoveryExpiresAt?: string | null
}): ActiveMember {
  const { id, role, nickname, tags, joinedSequence } = params
  return {
    id,
    role,
    profile: { nickname, interestTags: tags, bio: '' },
    membership: {
      id: `membership_${id.replace('member_', '')}`,
      joinedSequence,
      joinedAt: NOW,
      presence: params.presence ?? 'online',
      recoveryExpiresAt: params.recoveryExpiresAt ?? null,
    },
  }
}

const topic: Topic = {
  id: 'topic_movie',
  title: '最近大家看过什么好电影？',
  content: '从彼此的兴趣里挑一个能接上的开头，聊不下去再换。',
  kind: 'common',
  sourceLabel: 'AI 导播整理 · 备用精选',
  sourceUrl: null,
  publishedAt: NOW,
}

const room: Room = {
  id: 'room_demo',
  hostMemberId: 'member_host',
  capacity: 5,
  occupiedSlots: 5,
  status: 'open',
  hostRecoveryExpiresAt: null,
  currentTopic: topic,
  invitation: {
    inviteCode: DEMO_INVITE_CODE,
    joinPath: DEMO_INVITE_PATH,
  },
}

const members: ActiveMember[] = [
  member({ id: 'member_host', role: 'host', nickname: '小林', tags: ['阅读', '电影'], joinedSequence: 1 }),
  member({ id: 'member_zhou', role: 'member', nickname: '小周', tags: ['旅行', '扫街'], joinedSequence: 2 }),
  member({ id: 'member_lan', role: 'member', nickname: '阿岚', tags: ['摄影', '咖啡'], joinedSequence: 3 }),
  member({
    id: 'member_chen',
    role: 'member',
    nickname: '老陈',
    tags: ['游戏', '足球'],
    joinedSequence: 4,
    presence: 'offline',
    recoveryExpiresAt: RECOVERY_ENDS_AT,
  }),
  member({ id: 'member_mi', role: 'member', nickname: '米米', tags: ['烘焙', '猫'], joinedSequence: 5 }),
]

function msg(
  id: string,
  author: { memberId: string; nickname: string },
  text: string,
  sequence: number,
  at: string,
): MemberMessage {
  return {
    id,
    kind: 'member',
    author,
    text,
    clientRequestId: `00000000-0000-4000-8000-${String(sequence).padStart(12, '0')}`,
    createdAt: at,
    createdSequence: sequence,
  }
}

const messages: Message[] = [
  msg('m1', { memberId: 'member_host', nickname: '小林' }, '大家平时周末都怎么过？我最近有点两点一线。', 1, '2026-11-03T13:41:00.000Z'),
  msg('m2', { memberId: 'member_zhou', nickname: '小周' }, '我一般会出门拍点东西，最近在学扫街，拍废一堆。', 2, '2026-11-03T13:42:00.000Z'),
  msg('m3', { memberId: 'member_lan', nickname: '阿岚' }, '周末基本泡在咖啡店，写点东西，顺便观察别人点的什么。', 3, '2026-11-03T13:43:00.000Z'),
  msg('m4', { memberId: 'member_mi', nickname: '米米' }, '我在家烤东西，烤箱一开就是一下午。', 4, '2026-11-03T13:44:00.000Z'),
  msg('m5', { memberId: 'member_host', nickname: '小林' }, '@AI 帮我们找一个更好聊的话题', 5, '2026-11-03T13:45:00.000Z'),
  {
    id: 'reply_1',
    kind: 'ai',
    invocationId: 'inv_1',
    caller: { memberId: 'member_host', nickname: '小林' },
    triggerMessageId: 'm5',
    purpose: 'topic',
    invitedMember: null,
    text: '最近大家看过什么好电影？',
    status: 'streaming',
    startedSequence: 6,
    createdAt: '2026-11-03T13:46:00.000Z',
    updatedAt: '2026-11-03T13:46:00.000Z',
    error: null,
  },
  msg('m7', { memberId: 'member_zhou', nickname: '小周' }, '这话题好，我先说：上周看了《周处除三害》，后劲有点大。', 7, '2026-11-03T13:46:30.000Z'),
  msg('m8', { memberId: 'member_mi', nickname: '米米' }, '那我也补一个：最近在重看《海街日记》。', 8, '2026-11-03T13:47:00.000Z'),
]

const invocations: Invocation[] = [
  {
    id: 'inv_1',
    source: 'host',
    caller: { memberId: 'member_host', nickname: '小林' },
    triggerMessageId: 'm5',
    clientRequestId: null,
    status: 'running',
    queuePosition: null,
    replyId: 'reply_1',
    createdAt: '2026-11-03T13:45:00.000Z',
    createdSequence: 5,
    startedAt: '2026-11-03T13:46:00.000Z',
    finishedAt: null,
    expiresAt: null,
    error: null,
  },
]

export const demoSnapshot: SnapshotData = {
  self: {
    memberId: 'member_host',
    membershipId: 'membership_host',
    role: 'host',
    joinedSequence: 1,
  },
  room,
  members,
  messages,
  invocations,
}

export const demoCursor = 8
