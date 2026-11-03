import { beforeEach, describe, expect, it } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import type { ServerMessage } from '../shared/api/types'
import { applyServerMessage, dispatch, getRoomState, type RoomState } from './roomStore'

interface Scenario {
  description: string
  viewer: { memberId: string; membershipId: string; role: 'host' | 'member' }
  frames: { atMs: number; message: ServerMessage }[]
  expectedReplies?: Record<string, { status: string; text: string }>
  forbiddenReplyIds?: string[]
  forbiddenMessageIds?: string[]
  close?: { code: number; reason?: string }
}

const DIR = join(process.cwd(), '..', 'contracts', 'examples', 'ws')
const FILES = readdirSync(DIR)
  .filter((file) => file.endsWith('.json'))
  .sort()

function load(file: string): Scenario {
  return JSON.parse(readFileSync(join(DIR, file), 'utf8')) as Scenario
}

function findReply(state: RoomState, id: string) {
  const message = state.messages.find((item) => item.kind === 'ai' && item.id === id)
  return message && message.kind === 'ai' ? message : null
}

beforeEach(() => {
  dispatch({ type: 'reset' })
})

describe('ws 场景回放', () => {
  it.each(FILES)('%s', (file: string) => {
    const scenario = load(file)

    // 每个场景都以快照开场，且快速快照的游标先落地
    expect(scenario.frames[0]?.message.type).toBe('room.snapshot')

    for (const frame of scenario.frames) {
      applyServerMessage(frame.message)
    }

    const state = getRoomState()
    expect(state.ready).toBe(true)
    expect(state.self?.memberId).toBe(scenario.viewer.memberId)
    expect(state.self?.role).toBe(scenario.viewer.role)

    // 终态与文本回填
    for (const [id, expected] of Object.entries(scenario.expectedReplies ?? {})) {
      const reply = findReply(state, id)
      expect(reply, `缺少回复 ${id}`).not.toBeNull()
      expect(reply?.status).toBe(expected.status)
      expect(reply?.text).toBe(expected.text)
    }

    // 入房前已开始的回复整条不可见
    for (const id of scenario.forbiddenReplyIds ?? []) {
      expect(findReply(state, id), `不该出现回复 ${id}`).toBeNull()
    }
    for (const id of scenario.forbiddenMessageIds ?? []) {
      expect(
        state.messages.some((item) => item.id === id),
        `不该出现消息 ${id}`,
      ).toBe(false)
    }

    // 游标推进到本场景的最大序号
    const sequences = scenario.frames
      .map((frame) => frame.message)
      .flatMap((message) => ('sequence' in message ? [message.sequence] : []))
    if (sequences.length > 0) {
      expect(state.cursor).toBe(Math.max(...sequences))
    }

    // 同一序号重复到达不重复应用
    const before = state.messages.length
    for (const frame of scenario.frames) {
      applyServerMessage(frame.message)
    }
    expect(getRoomState().messages.length).toBe(before)
  })
})

describe('状态归并细节', () => {
  const scenario = load('host-stream.json')
  const snapshot = scenario.frames[0].message

  it('快照整体替换状态', () => {
    dispatch({ type: 'reset' })
    if (snapshot.type !== 'room.snapshot') throw new Error('fixture 首帧不是快照')
    applyServerMessage(snapshot)
    const state = getRoomState()
    expect(state.members.map((m) => m.id)).toEqual(
      snapshot.data.members.map((m) => m.id),
    )
    expect(state.cursor).toBe(snapshot.cursor)
  })

  it('快照之后序号更小的迟到事件被丢弃', () => {
    if (snapshot.type !== 'room.snapshot') throw new Error('fixture 首帧不是快照')
    applyServerMessage(snapshot)
    const topicEvent = scenario.frames
      .map((frame) => frame.message)
      .find((message) => message.type === 'topic.changed')
    if (!topicEvent || topicEvent.type !== 'topic.changed') throw new Error('缺少话题事件')

    // 先正常应用一次
    applyServerMessage(topicEvent)
    expect(getRoomState().room?.currentTopic?.title).toBe(topicEvent.data.topic.title)

    // 同一条再来一遍（序号不大于游标）不应改变状态
    const before = getRoomState()
    applyServerMessage(topicEvent)
    expect(getRoomState()).toBe(before)
  })

  it('AI 增量只追加到同一条回复', () => {
    if (snapshot.type !== 'room.snapshot') throw new Error('fixture 首帧不是快照')
    applyServerMessage(snapshot)

    const started = scenario.frames
      .map((frame) => frame.message)
      .find((message) => message.type === 'ai.reply.started')
    if (!started || started.type !== 'ai.reply.started') throw new Error('缺少 started 事件')
    applyServerMessage(started)

    const replyId = started.data.reply.id
    const deltas = scenario.frames
      .map((frame) => frame.message)
      .filter(
        (message): message is Extract<ServerMessage, { type: 'ai.reply.delta' }> =>
          message.type === 'ai.reply.delta' && message.data.replyId === replyId,
      )
    expect(deltas.length).toBeGreaterThan(0)
    for (const delta of deltas) applyServerMessage(delta)

    const replies = getRoomState().messages.filter(
      (message) => message.kind === 'ai' && message.id === replyId,
    )
    expect(replies).toHaveLength(1)
    const reply = replies[0]
    expect(reply.kind === 'ai' ? reply.text : '').toBe(
      deltas.map((delta) => delta.data.textDelta).join(''),
    )
  })
})
