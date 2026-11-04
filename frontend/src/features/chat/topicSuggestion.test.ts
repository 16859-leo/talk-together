import { describe, expect, it } from 'vitest'
import type { Invocation, Message } from '../../shared/api/types'
import { isAutoTopicReply, splitFeeds } from './topicSuggestion'

const AT = '2026-11-04T10:00:00.000Z'

function airReply(overrides: Record<string, unknown> = {}): Message {
  return {
    kind: 'ai',
    id: 'reply_1',
    invocationId: 'inv_1',
    caller: null,
    triggerMessageId: null,
    purpose: 'topic',
    invitedMember: null,
    text: '你们最近一次说走就走的旅行是去哪？',
    status: 'streaming',
    startedSequence: 3,
    createdAt: AT,
    updatedAt: AT,
    error: null,
    ...overrides,
  } as unknown as Message
}

function invocation(overrides: Record<string, unknown> = {}): Invocation {
  return {
    id: 'inv_1',
    source: 'automatic',
    caller: null,
    triggerMessageId: null,
    clientRequestId: null,
    status: 'running',
    queuePosition: null,
    replyId: 'reply_1',
    createdAt: AT,
    createdSequence: 2,
    startedAt: AT,
    finishedAt: null,
    expiresAt: null,
    error: null,
    ...overrides,
  } as unknown as Invocation
}

function memberMessage(overrides: Record<string, unknown> = {}): Message {
  return {
    kind: 'member',
    id: 'message_1',
    author: { memberId: 'member_1', nickname: '小林' },
    text: '在呢',
    clientRequestId: 'client_1',
    createdAt: AT,
    createdSequence: 1,
    ...overrides,
  } as unknown as Message
}

describe('自动话题建议条', () => {
  it('冷场自动补的话题从聊天记录里拆出来，按流式状态实时刷新', () => {
    const feeds = splitFeeds(
      [memberMessage(), airReply({ text: '你们最近一次' })],
      [invocation()],
    )

    expect(feeds.chat).toHaveLength(1)
    expect(feeds.chat[0]?.kind).toBe('member')
    expect(feeds.suggestion).toEqual({
      replyId: 'reply_1',
      text: '你们最近一次',
      streaming: true,
      startedAt: AT,
    })
  })

  it('房主 @AI 要的话题仍是对话消息，不进建议条', () => {
    const feeds = splitFeeds(
      [airReply({ purpose: 'topic' })],
      [invocation({ source: 'host' })],
    )

    expect(feeds.chat).toHaveLength(1)
    expect(feeds.suggestion).toBeNull()
  })

  it('自动邀答是点名对某个成员说的，仍留在聊天记录', () => {
    const feeds = splitFeeds([airReply({ purpose: 'invitation' })], [invocation()])

    expect(feeds.chat).toHaveLength(1)
    expect(feeds.suggestion).toBeNull()
  })

  it('多条自动话题只展示最新一条，旧的不占聊天记录', () => {
    const feeds = splitFeeds(
      [
        airReply({ id: 'reply_1', invocationId: 'inv_1', startedSequence: 3, text: '旧话题' }),
        airReply({ id: 'reply_2', invocationId: 'inv_2', startedSequence: 5, text: '新话题' }),
      ],
      [invocation(), invocation({ id: 'inv_2', replyId: 'reply_2' })],
    )

    expect(feeds.chat).toHaveLength(0)
    expect(feeds.suggestion?.replyId).toBe('reply_2')
    expect(feeds.suggestion?.text).toBe('新话题')
  })

  it('生成完成后 streaming 为 false，建议条不再显示动画', () => {
    const feeds = splitFeeds(
      [airReply({ status: 'completed' })],
      [invocation({ status: 'completed' })],
    )

    expect(feeds.suggestion?.streaming).toBe(false)
  })

  it('自动话题生成失败时整条不展示，避免出现空建议条', () => {
    const feeds = splitFeeds(
      [airReply({ status: 'failed', text: '' })],
      [invocation({ status: 'failed' })],
    )

    expect(feeds.chat).toHaveLength(0)
    expect(feeds.suggestion).toBeNull()
  })

  it('拿不到 invocation 时按对话消息处理，宁可留在聊天记录也不误吞', () => {
    const feeds = splitFeeds([airReply()], [])
    expect(feeds.chat).toHaveLength(1)
    expect(feeds.suggestion).toBeNull()
  })

  it('isAutoTopicReply 只认「自动 + 选题」', () => {
    const reply = airReply() as Extract<Message, { kind: 'ai' }>
    expect(isAutoTopicReply(reply, [invocation()])).toBe(true)
    expect(isAutoTopicReply(reply, [invocation({ source: 'host' })])).toBe(false)
    expect(
      isAutoTopicReply(
        airReply({ purpose: 'invitation' }) as Extract<Message, { kind: 'ai' }>,
        [invocation()],
      ),
    ).toBe(false)
  })
})
