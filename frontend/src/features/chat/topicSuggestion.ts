/**
 * 把「冷场时 AI 自动补的话题」从聊天记录里拆出来。
 *
 * 自动话题是 AI 主动垫的一句，不是对谁说的，塞进对话流会和真人发言混在一起，
 * 看起来像 AI 在插话。这里按 invocation.source 区分：
 * - source === 'automatic' 且 purpose === 'topic' → 话题建议条（输入框上方，实时刷新）
 * - 其余（房主 @AI 要的话题、普通回复、邀答）→ 正常聊天消息
 */

import type { Invocation, Message } from '../../shared/api/types'

type AIReplyMessage = Extract<Message, { kind: 'ai' }>

export interface TopicSuggestion {
  readonly replyId: string
  readonly text: string
  /** 还在生成中：建议条要跟着增量实时刷新 */
  readonly streaming: boolean
  readonly startedAt: string
}

export interface ChatFeeds {
  readonly chat: Message[]
  readonly suggestion: TopicSuggestion | null
}

/** 自动冷场补话产生的话题回复。房主主动要的话题仍算对话。 */
export function isAutoTopicReply(
  reply: AIReplyMessage,
  invocations: readonly Invocation[],
): boolean {
  if (reply.purpose !== 'topic') return false
  return invocations.some(
    (invocation) => invocation.id === reply.invocationId && invocation.source === 'automatic',
  )
}

/**
 * 拆成「聊天记录」和「最新一条自动话题」。
 *
 * 只取最新一条：建议条是实时状态栏，不是历史列表；旧的自然被新的替换。
 */
export function splitFeeds(
  messages: readonly Message[],
  invocations: readonly Invocation[],
): ChatFeeds {
  const chat: Message[] = []
  let latest: AIReplyMessage | null = null

  for (const message of messages) {
    if (message.kind === 'ai' && isAutoTopicReply(message, invocations)) {
      latest = message
      continue
    }
    chat.push(message)
  }

  return {
    chat,
    suggestion:
      latest === null || latest.status === 'failed' || latest.status === 'cancelled'
        ? null
        : {
            replyId: latest.id,
            text: latest.text,
            streaming: latest.status === 'streaming',
            startedAt: latest.createdAt,
          },
  }
}
