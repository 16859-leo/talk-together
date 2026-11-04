import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { MemberCard } from '../features/room/MemberCard'
import { ChatFeed } from '../features/chat/ChatFeed'
import { Composer } from '../features/chat/Composer'
import { TopicSuggestionBar } from '../features/chat/TopicSuggestionBar'
import { splitFeeds } from '../features/chat/topicSuggestion'
import { GameShelf } from '../features/games/GameShelf'
import {
  loadActiveGame,
  saveActiveGame,
  type ActiveGame,
  type GameDefinition,
} from '../features/games/catalog'
import { InviteDialog } from '../features/room/InviteDialog'
import { ProfileDialog } from '../features/room/ProfileDialog'
import type { JoinValues } from '../features/join/ProfileForm'
import { ApiError, getClientConfig } from '../shared/api/client'
import { closeRoom, getSelf, leaveRoom, removeMember, sendMessage, updateSelf } from '../shared/api/room'
import type { ActiveMember, MemberMessage, ValidationPolicy } from '../shared/api/types'
import { openRoomStream, type StreamStatus } from '../shared/realtime/connection'
import { demoCursor, demoSnapshot } from '../state/demo'
import { applyServerMessage, dispatch, useRoomState } from '../state/roomStore'
import {
    clearMembership,
    clearSession,
    devSession,
    loadSession,
    saveSession,
    type RoomSession,
  } from '../state/session'
import { formatLeft, useNow } from '../shared/ui/useNow'
import {
  FATAL_STREAM_CODES,
  resolveTerminal,
  type TerminalReason,
} from '../features/room/lifecycle'
import {
  canReuseRequestId,
  crossTabAction,
  expireEpoch,
  isSameEpoch,
  openRoomChannel,
  type CrossTabEvent,
  type OutgoingDraft,
  type RoomChannel,
  type RoomEpoch,
} from '../shared/realtime/crossTab'

const FALLBACK_POLICY: ValidationPolicy = {
  nickname: { minLength: 1, maxLength: null },
  interestTag: { minLength: 1, maxLength: null },
  bio: { minLength: 0, maxLength: null },
  message: { minLength: 1, maxLength: null },
  interestTags: { minItems: 1, maxItems: null },
}

const STATUS_TEXT: Record<StreamStatus, string | null> = {
  ticketing: '连接中…',
  connecting: '连接中…',
  live: null,
  reconnecting: '重连中…',
  closed: '房间已关闭',
  failed: '连接不上服务器',
}



export default function RoomPage() {
  const { roomId = '' } = useParams()
  const navigate = useNavigate()
  const state = useRoomState()
  const [menuOpen, setMenuOpen] = useState(false)
  const [inviteOpen, setInviteOpen] = useState(false)
  const [leaveOpen, setLeaveOpen] = useState(false)
  const [status, setStatus] = useState<StreamStatus>('ticketing')
  const [notice, setNotice] = useState<string | null>(null)
  const [ended, setEnded] = useState<{ title: string; detail: string } | null>(null)
  const [removeTarget, setRemoveTarget] = useState<ActiveMember | null>(null)
  const [removing, setRemoving] = useState(false)
  const [profileOpen, setProfileOpen] = useState(false)
  const [profileBusy, setProfileBusy] = useState(false)
  const [profileError, setProfileError] = useState<string | null>(null)
  const [profileFieldErrors, setProfileFieldErrors] = useState<Record<string, string>>({})
  const [policy, setPolicy] = useState<ValidationPolicy>(FALLBACK_POLICY)
  /** 限频冷却截止时间，交给 Composer 倒计时并禁用发送 */
  const [cooldownUntil, setCooldownUntil] = useState<number | null>(null)
  /** 用户收起过的自动话题建议；来了新的一条会重新显示 */
  const [dismissedSuggestionId, setDismissedSuggestionId] = useState<string | null>(null)
  /** 房主当前开的游戏；轮次由后端管，这里只记「开没开」并按房间存进会话存储 */
  const [activeGame, setActiveGame] = useState<ActiveGame | null>(() => loadActiveGame(roomId))
  /** 进入终态后不再建连、不再归并事件 */
  const [terminal, setTerminal] = useState(false)
  const pendingSend = useRef<OutgoingDraft | null>(null)
  /** 房间上下文令牌：切换房间或卸载后，旧回执不再写入 */
  const epochRef = useRef<RoomEpoch>({ roomId, token: 0 })
  const channelRef = useRef<RoomChannel | null>(null)

  // 会话放进 state：改完资料要立刻更新，否则「补自己」的逻辑会用旧昵称盖回去
  const [session, setSession] = useState<RoomSession | null>(
    () => loadSession(roomId) ?? (import.meta.env.DEV ? devSession() : null),
  )

  // 切换房间或离开时清空单例状态，别把上一个房间的聊天带过来
  useEffect(() => {
    epochRef.current = { roomId, token: epochRef.current.token + 1 }
    dispatch({ type: 'reset' })
    setSession(loadSession(roomId) ?? (import.meta.env.DEV ? devSession() : null))
    setEnded(null)
    setNotice(null)
    setTerminal(false)
    setActiveGame(loadActiveGame(roomId))
    return () => {
      // 卸载后旧回执必须失效：新组件用的是另一个 ref，只递增 token 不够
      epochRef.current = expireEpoch(epochRef.current)
      dispatch({ type: 'reset' })
    }
  }, [roomId])

  /** 只有 membership 还在，才谈得上调用房间级接口 */
  const activeSession =
    session?.membershipId !== undefined
      ? ({ credential: session.credential, membershipId: session.membershipId } as {
          credential: string
          membershipId: string
        })
      : null

  // 改资料弹层的校验约束和入房页同源
  useEffect(() => {
    let alive = true
    getClientConfig()
      .then((config) => {
        if (alive) setPolicy(config.validation)
      })
      .catch(() => {
        /* 用兜底策略，不阻塞改资料 */
      })
    return () => {
      alive = false
    }
  }, [])

  // 只有开发态才用本地快照兜底；生产里必须等真实快照。
  useEffect(() => {
    if (!import.meta.env.DEV) return
    if (!state.ready) {
      dispatch({ type: 'snapshot', data: demoSnapshot, cursor: demoCursor })
    }
  }, [state.ready])

  /** 终态统一出口：决定文案与身份去留，并停掉连接、清空房间数据 */
  function endWith(reason: TerminalReason) {
    const outcome = resolveTerminal(reason)
    // 终态页不会卸载 RoomPage：必须显式作废令牌，挡住迟到的 HTTP 回执
    epochRef.current = expireEpoch(epochRef.current)
    setTerminal(true)
    if (outcome.identity === 'clear') clearSession(roomId)
    else clearMembership(roomId)
    setSession(null)
    dispatch({ type: 'reset' })
    setEnded({ title: outcome.title, detail: outcome.detail })
  }

  // 快照的 self 与本地凭证不一致只可能是 Mock：开发态以本地为准，
  // 联调时信任服务端并在控制台提示，别把真实问题藏起来。
  useEffect(() => {
    if (!state.ready || !state.self || !session) return
    if (state.self.memberId === session.memberId) return
    if (!import.meta.env.DEV) {
      console.warn('[identity] 快照的 self 与本地凭证不一致', {
        snapshot: state.self.memberId,
        local: session.memberId,
      })
      return
    }
    dispatch({
      type: 'self-override',
      self: {
        memberId: session.memberId,
        membershipId: session.membershipId ?? '',
        role: session.role ?? 'member',
        joinedSequence: state.self.joinedSequence,
      },
    })
  }, [state.ready, state.self, session])

  // 快照里没有「我」的时候（后端没回推、或 Mock 固定数据），先把本人补进名单。
  useEffect(() => {
    if (!state.ready || !state.self || !session?.nickname) return
    // 等 self-override 生效后再动名单，否则会拿快照里的别人当自己
    if (state.self.memberId !== session.memberId) return
    const selfId = state.self.memberId
    const existing = state.members.find((member) => member.id === selfId)

    if (!existing) {
      dispatch({
        type: 'member-added',
        member: {
          id: selfId,
          role: state.self.role,
          profile: {
            nickname: session.nickname,
            interestTags: session.interestTags ?? [],
            bio: '',
          },
          membership: {
            id: state.self.membershipId,
            joinedSequence: state.self.joinedSequence,
            joinedAt: new Date().toISOString(),
            presence: 'online',
            recoveryExpiresAt: null,
          },
        },
      })
      return
    }

    // 名单里有这个 id，但昵称对不上：只可能是 Mock 的固定成员，
    // 开发态用本地填的资料覆盖；联调时以服务端归一化后的资料为准。
    if (import.meta.env.DEV && existing.profile.nickname !== session.nickname) {
      dispatch({
        type: 'member-updated',
        member: {
          ...existing,
          profile: {
            nickname: session.nickname,
            interestTags: session.interestTags ?? existing.profile.interestTags,
            bio: existing.profile.bio,
          },
        },
      })
    }
  }, [state.ready, state.self, state.members, session])

  // 同一浏览器的多个标签页共享身份：退出或关房时要一起结束
  useEffect(() => {
    const channel = openRoomChannel({
      roomId: roomId || 'room_demo',
      onEvent: (event: CrossTabEvent) => {
        const action = crossTabAction(event)
        if (action === 'clear-membership') clearMembership(roomId)
        if (action === 'clear-session') clearSession(roomId)
        navigate('/')
      },
    })
    channelRef.current = channel
    return () => {
      channelRef.current = null
      channel.close()
    }
  }, [roomId, navigate])

  // 本人的 membership 结束（被移出 / 主动退出）同样要切终态
  useEffect(() => {
    if (!state.selfEnded) return
    setTerminal(true)
    endWith({ kind: state.selfEnded })
  }, [state.selfEnded, roomId])

  // 有身份但没有 membership：说明这次入房已经结束，直接给终态页（刷新后也能看到）
  useEffect(() => {
    if (!session || session.membershipId || ended || terminal) return
    endWith({ kind: 'left' })
  }, [session, ended])

  // room.closed 是本次连接的最后一个业务事件：直接切终态并清凭证。
  useEffect(() => {
    if (!state.closed) return
    endWith({ kind: 'closed' })
  }, [state.closed, roomId])

  // 恢复身份：凭证还有效就继续，入房已结束就给出终态。
  useEffect(() => {
    if (!session) return undefined
    let alive = true
    getSelf(roomId, session.credential)
      .then((data) => {
        if (!alive) return
        if (!data.member.membership) {
          // 成员凭证仍然有效，只是这次入房结束了：保留身份，支持原身份重新加入
          endWith({ kind: 'left' })
        }
      })
      .catch((error: unknown) => {
        if (!alive || !(error instanceof ApiError)) return
        if (FATAL_STREAM_CODES.has(error.code)) {
          endWith({ kind: 'fatal', code: error.code })
        }
      })
    return () => {
      alive = false
    }
  }, [roomId, session?.credential, session?.membershipId])

  // 领票 → 建连 → 首帧快照 → 事件流。
  useEffect(() => {
    if (!activeSession || terminal) return undefined
    const controller = new AbortController()
    const close = openRoomStream({
      roomId: roomId || 'room_demo',
      credential: activeSession.credential,
      membershipId: activeSession.membershipId,
      signal: controller.signal,
      onStatus: (next, detail) => {
        setStatus(next)
        if (next === 'failed' && detail) setNotice(detail)
      },
      onMessage: applyServerMessage,
      onFatal: (error) => endWith({ kind: 'fatal', code: error.code }),
    })
    return () => {
      controller.abort()
      close()
    }
    // 改昵称不应该重建连接，只跟凭证和终态走
  }, [roomId, session?.credential, session?.membershipId, terminal])

  useEffect(() => {
    if (!menuOpen) return undefined
    function onDocClick() {
      setMenuOpen(false)
    }
    document.addEventListener('click', onDocClick)
    return () => document.removeEventListener('click', onDocClick)
  }, [menuOpen])

  // 快照带了邀请地址就补进会话，重新加入时不会缺 inviteCode
  useEffect(() => {
    if (terminal) return
    const joinPath = state.room?.invitation.joinPath
    if (!session || !joinPath || session.joinPath === joinPath) return
    const next = { ...session, joinPath }
    saveSession(roomId, next)
    setSession(next)
  }, [state.room?.invitation.joinPath, session, roomId])

  const self = state.self
  const selfMember = useMemo(
    () => state.members.find((m) => m.id === self?.memberId),
    [state.members, self?.memberId],
  )
  // 房间名跟房主走，不跟着「我」变
  const hostMember = useMemo(
    () => state.members.find((m) => m.id === state.room?.hostMemberId) ?? state.members[0],
    [state.members, state.room?.hostMemberId],
  )
  const canMention = self?.role === 'host'
  const onlineCount = state.members.filter((m) => m.membership?.presence !== 'offline').length
  const capacity = state.room?.capacity ?? 5
  const now = useNow()
  const hostLeft = formatLeft(state.room?.hostRecoveryExpiresAt ?? null, now)
  const hostReconnecting = state.room?.status === 'host_reconnecting'
  const reconnecting = status === 'reconnecting' || status === 'failed'
  // 发送走 REST，和 WS 通不通没关系：只有房间关了才禁止输入。
  const composerDisabled = state.closed
  const statusText = STATUS_TEXT[status]
  const runningInvocation = state.invocations.find((item) => item.status === 'running')
  const queuedCount = state.invocations.filter((item) => item.status === 'queued').length
  // 冷场自动补的话题不进聊天记录，单独一条实时建议显示在输入框上方。
  const { chat: chatMessages, suggestion } = splitFeeds(state.messages, state.invocations)
  const visibleSuggestion =
    suggestion !== null && suggestion.replyId !== dismissedSuggestionId ? suggestion : null

  async function handleSend(text: string, mentions: 'ai'[]): Promise<boolean> {
    if (!session || !activeSession) {
      setNotice('这次入房已经结束，重新进房后才能发言')
      return false
    }
    setNotice(null)

    const reuse = canReuseRequestId(pendingSend.current, text, mentions)
      ? pendingSend.current?.id
      : null
    const clientRequestId = reuse ?? crypto.randomUUID()
    const capturedEpoch = epochRef.current

    try {
      const data = await sendMessage(
        roomId || 'room_demo',
        { clientRequestId, text, mentions },
        activeSession,
      )
      // 已经切走房间：这条回执不能再写进当前房间
      if (!isSameEpoch(epochRef.current, capturedEpoch)) return false
      pendingSend.current = null
      // Mock 或后端回执可能带着别人的示例数据：对不上就用本地这条兜底
      const echoed = data.message
      // 只按作者判断：正文被服务端归一化（去空格等）属于正常，
      // 服务端回的才是权威版本；作者不是我就说明是 Mock 的固定示例。
      const usable = echoed.author.memberId === session.memberId
      const own: MemberMessage = usable
        ? echoed
        : {
            ...echoed,
            id: `local_${echoed.id}_${Date.now()}`,
            text,
            author: {
              memberId: session.memberId,
              nickname: selfMember?.profile.nickname ?? echoed.author.nickname,
            },
            createdAt: new Date().toISOString(),
            createdSequence: Math.max(echoed.createdSequence, state.cursor + 1),
          }

      dispatch({ type: 'local-message', message: own })
      if (data.ai.status === 'rejected') {
        setNotice(`AI 没受理：${data.ai.error.message}`)
      } else if (data.ai.status === 'ignored') {
        setNotice('普通成员的 @AI 会被忽略，文字照常发出')
      }
      return true
    } catch (error) {
      // 已经切走房间：失败回执也不能影响当前房间（提示、重试状态、终态都不行）
      if (!isSameEpoch(epochRef.current, capturedEpoch)) return false
      if (!(error instanceof ApiError)) {
        setNotice('发送失败，稍后再试')
        return false
      }

      // 网络问题：记住这次的 ID 便于重试；只有开发态才假装发出去
      if (error.status === 0) {
        pendingSend.current = { id: clientRequestId, text, mentions }
        if (!import.meta.env.DEV) {
          setNotice('没发出去，检查网络后再试一次')
          return false
        }
        if (self && selfMember) {
          const fallback: MemberMessage = {
            id: `local_${Date.now()}`,
            kind: 'member',
            author: { memberId: self.memberId, nickname: selfMember.profile.nickname },
            text,
            clientRequestId,
            createdAt: new Date().toISOString(),
            createdSequence: state.cursor + 1,
          }
          dispatch({ type: 'local-message', message: fallback })
        }
        setNotice('后端未连接，这条只存在本地')
        return true
      }

      const retryable = error.status === 429 || error.status >= 500
      pendingSend.current = retryable ? { id: clientRequestId, text, mentions } : null

      if (FATAL_STREAM_CODES.has(error.code)) {
        endWith({ kind: 'fatal', code: error.code })
        return false
      }

      if (error.retryAfterMs) {
        setCooldownUntil(Date.now() + error.retryAfterMs)
        setNotice(`${error.message}（${Math.ceil(error.retryAfterMs / 1000)} 秒后可再试）`)
        return false
      }
      setNotice(error.message)
      return false
    }
  }

  // 游戏按钮就是替房主发一条 @AI 的话；轮次推进由后端按文本识别，前端只记开没开。
  async function startGame(game: GameDefinition): Promise<void> {
    const ok = await handleSend(game.startText, ['ai'])
    if (!ok) return
    const next: ActiveGame = { gameId: game.id }
    setActiveGame(next)
    saveActiveGame(roomId, next)
  }

  async function advanceGame(game: GameDefinition): Promise<void> {
    await handleSend(game.nextText, ['ai'])
  }

  async function stopGame(game: GameDefinition): Promise<void> {
    const ok = await handleSend(game.stopText, ['ai'])
    if (!ok) return
    setActiveGame(null)
    saveActiveGame(roomId, null)
  }

  async function handleLeave() {
    if (session) {
      try {
        // 房主的「退出」等价于关房，走单独接口更明确
        if (!activeSession) return
        if (canMention) await closeRoom(roomId || 'room_demo', activeSession)
        else await leaveRoom(roomId || 'room_demo', activeSession)
      } catch (error) {
        // 关房/退出没被服务端确认，就别同步这个结果，留给用户重试
        if (canMention) {
          setNotice(
            error instanceof ApiError
              ? `没关掉：${error.message}，房间还在，稍后再试一次`
              : '没关掉，房间还在，稍后再试一次',
          )
          return
        }
      }
    }
    setLeaveOpen(false)
    if (canMention) clearSession(roomId)
    else clearMembership(roomId)
    channelRef.current?.publish(canMention ? 'closed' : 'left')
    navigate('/')
  }

  async function handleRemove() {
    if (!removeTarget || !session) return
    setRemoving(true)
    try {
      if (!activeSession) return
      await removeMember(roomId || 'room_demo', removeTarget.id, activeSession)
      if (removeTarget.membership) {
        dispatch({ type: 'member-removed', membershipId: removeTarget.membership.id })
      }
      setNotice(`已移出 ${removeTarget.profile.nickname}`)
    } catch (error) {
      setNotice(error instanceof ApiError ? error.message : '没移出成功，稍后再试')
    } finally {
      setRemoving(false)
      setRemoveTarget(null)
    }
  }

  async function handleSaveProfile(values: JoinValues) {
    if (!session || !activeSession) return
    const capturedEpoch = epochRef.current
    setProfileBusy(true)
    setProfileError(null)
    setProfileFieldErrors({})
    try {
      const data = await updateSelf(
        roomId || 'room_demo',
        {
          nickname: values.nickname,
          interestTags: values.interestTags,
          bio: values.bio,
        },
        activeSession,
      )

      // 已经切走房间或进入终态：这条回执不能改动当前会话
      if (!isSameEpoch(epochRef.current, capturedEpoch)) return

      // 回执对不上（Mock 固定示例）时，用本地这份兜底，别让界面弹回旧资料
      const echoed = data.member
      const mine = state.members.find((member) => member.id === session.memberId)
      const sameShape =
        echoed.id === session.memberId &&
        echoed.profile.nickname === values.nickname &&
        echoed.profile.interestTags.join('/') === values.interestTags.join('/')

      const next = sameShape || !import.meta.env.DEV
        ? echoed
        : {
            ...(mine ?? echoed),
            id: session.memberId,
            profile: {
              nickname: values.nickname,
              interestTags: values.interestTags,
              bio: values.bio,
            },
          }

      dispatch({ type: 'member-updated', member: next })
      // 本地身份也一起更新，否则「补自己」的那段逻辑会用旧昵称覆盖回去
      const nextSession = {
        ...session,
        nickname: values.nickname,
        interestTags: values.interestTags,
      }
      saveSession(roomId, nextSession)
      setSession(nextSession)
      setProfileOpen(false)
      setNotice('资料已更新，房间里的人都看到了')
    } catch (error) {
      if (!isSameEpoch(epochRef.current, capturedEpoch)) return
      if (error instanceof ApiError) {
        setProfileError(error.message)
        if (error.fieldErrors.length > 0) {
          setProfileFieldErrors(
            Object.fromEntries(error.fieldErrors.map((item) => [item.path, item.message])),
          )
        }
      } else {
        setProfileError('保存失败，稍后再试')
      }
    } finally {
      setProfileBusy(false)
    }
  }

  // 没有凭证又直接打开了房间地址：给一个明确出口，别停在加载页
  if (!session && !ended) {
    return (
      <div className="page-bg paper grid min-h-screen place-items-center px-6">
        <div className="relative z-10 w-full max-w-[440px] rounded-[32px] border-[1.5px] border-rule bg-paper px-8 py-10 text-center shadow-[0_30px_60px_-34px_rgba(92,64,51,.45)]">
          <h1 className="text-[20px] font-bold text-[#33291d]">还没加入这个房间</h1>
          <p className="mt-2 text-[13px] leading-relaxed text-ink-2">
            这个地址只对拿到邀请的人开放。从房主发你的邀请链接进来，或者先开一个自己的房间。
          </p>
          <div className="mt-6 flex justify-center gap-2.5">
            <button
              type="button"
              onClick={() => navigate('/')}
              className="rounded-2xl border-[1.5px] border-[rgba(96,166,150,.5)] px-5 py-2.5 text-[13px] text-ink-2"
            >
              回到首页
            </button>
            <button
              type="button"
              onClick={() => navigate('/create')}
              className="rounded-2xl bg-sage-deep px-5 py-2.5 text-[13px] font-semibold text-white"
            >
              开一个房间
            </button>
          </div>
        </div>
      </div>
    )
  }

  // 内存里的会话可能已经被清空，但 localStorage 里还留着可复用的身份
  const recoverable = (() => {
    const saved = loadSession(roomId)
    return saved && !saved.membershipId ? saved : null
  })()

  if (ended) {
    return (
      <div className="page-bg paper grid min-h-screen place-items-center px-6">
        <div className="relative z-10 w-full max-w-[440px] rounded-[32px] border-[1.5px] border-rule bg-paper px-8 py-10 text-center shadow-[0_30px_60px_-34px_rgba(92,64,51,.45)]">
          <h1 className="text-[20px] font-bold text-[#33291d]">{ended.title}</h1>
          <p className="mt-2 text-[13px] leading-relaxed text-ink-2">{ended.detail}</p>
          <div className="mt-6 flex justify-center gap-2.5">
            <button
              type="button"
              onClick={() => navigate('/')}
              className="rounded-2xl border-[1.5px] border-[rgba(96,166,150,.5)] px-6 py-2.5 text-[13px] text-ink-2"
            >
              回到首页
            </button>
            {recoverable && (
              <button
                type="button"
                onClick={() =>
                  navigate(
                    recoverable?.joinPath ??
                      state.room?.invitation.joinPath ??
                      `/join/${roomId}`,
                  )
                }
                className="rounded-2xl bg-sage-deep px-6 py-2.5 text-[13px] font-semibold text-white"
              >
                用原身份重新加入
              </button>
            )}
          </div>
        </div>
      </div>
    )
  }

  if (!state.ready) {
    return <div className="page-bg grid h-screen place-items-center text-muted">正在进房间…</div>
  }

  return (
    <div className="page-bg paper min-h-screen">
      <div className="relative z-10 mx-auto flex min-h-screen max-w-[1440px] flex-col px-5 py-5 lg:h-screen lg:min-h-0 lg:px-8 lg:py-6">
        <header className="flex shrink-0 items-center gap-3">
          <div className="flex items-center gap-2 text-[21px] font-bold tracking-wide">
            <span className="h-2.5 w-2.5 rounded-full bg-sage" />
            搭个话
          </div>
          <div className="flex items-center gap-2.5 text-[13px] text-ink-2">
            <span className="font-medium text-ink">
              {hostMember?.profile.nickname ?? '房间'} 的房间
            </span>
            <span className="rounded-full border border-rule px-2.5 py-0.5 text-[12px]">
              {state.members.length} / {capacity}
            </span>
            <span className="hidden items-center gap-1.5 sm:flex">
              <i
                className={`block h-1.5 w-1.5 rounded-full ${
                  status === 'live' ? 'bg-sage' : 'bg-coral'
                }`}
              />
              {statusText ?? `${onlineCount} 人在线`}
            </span>
          </div>
          <div className="flex-1" />
          <div className="relative">
            <button
              type="button"
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              aria-label="房间菜单"
              onClick={(event) => {
                event.stopPropagation()
                setMenuOpen((open) => !open)
              }}
              className="grid h-9 w-9 place-items-center rounded-xl border-[1.5px] border-[rgba(96,166,150,.55)] bg-paper text-ink-2 transition-colors hover:bg-card"
            >
              ⋯
            </button>
            {menuOpen && (
              <div
                role="menu"
                onClick={(event) => event.stopPropagation()}
                className="absolute right-0 top-11 z-30 w-[196px] rounded-[18px] border-[1.5px] border-rule bg-paper p-1.5 shadow-[0_18px_34px_rgba(92,64,51,.18)]"
              >
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setMenuOpen(false)
                    setInviteOpen(true)
                  }}
                  className="block w-full rounded-xl px-3 py-2 text-left text-[13px] text-ink-2 hover:bg-[rgba(124,185,168,.16)]"
                >
                  邀请
                </button>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setMenuOpen(false)
                    setProfileError(null)
                    setProfileFieldErrors({})
                    setProfileOpen(true)
                  }}
                  className="block w-full rounded-xl px-3 py-2 text-left text-[13px] text-ink-2 hover:bg-[rgba(124,185,168,.16)]"
                >
                  改我的资料
                </button>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setMenuOpen(false)
                    setLeaveOpen(true)
                  }}
                  className="block w-full rounded-xl px-3 py-2 text-left text-[13px] text-brick hover:bg-[rgba(124,185,168,.16)]"
                >
                  {canMention ? '关闭房间' : '退出房间'}
                </button>
              </div>
            )}
          </div>
        </header>

        <main className="mt-4 grid min-h-0 flex-1 gap-4 lg:grid-cols-[minmax(0,1fr)_392px] lg:gap-5">
          <section className="flex min-h-[520px] flex-col rounded-[34px_38px_32px_40px] border border-rule-soft bg-paper p-5 shadow-soft lg:min-h-0">
            {hostReconnecting && (
              <div className="mb-2.5 flex items-start gap-2 rounded-2xl border border-[rgba(192,127,80,.45)] bg-[rgba(232,168,124,.16)] px-3.5 py-2 text-[12px] leading-relaxed text-[#8a5a34]">
                <span className="mt-[6px] block h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-coral" />
                <span>
                  房主掉线了，座位保留
                  {hostLeft !== null ? ` ${hostLeft} 秒` : ''}
                  ，超时会自动关房；这期间新的自动话题和邀答暂停。
                </span>
              </div>
            )}
            {reconnecting && (
              <div className="mb-2.5 flex items-center gap-2 rounded-2xl border border-[rgba(124,185,168,.4)] bg-[rgba(124,185,168,.12)] px-3.5 py-2 text-[12px] text-[#3f6156]">
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-sage-deep" />
                {status === 'failed' ? '连接不上服务器，正在重试…' : '连接断了，正在重连…'}
              </div>
            )}
            <h2 className="pb-2.5 text-[16px] font-bold">聊天</h2>
            <hr className="rule" />
            <ChatFeed messages={chatMessages} />
            {visibleSuggestion !== null && (
              <TopicSuggestionBar
                suggestion={visibleSuggestion}
                onDismiss={() => setDismissedSuggestionId(visibleSuggestion.replyId)}
              />
            )}
            <Composer
              canMention={canMention}
              disabled={composerDisabled}
              cooldownUntil={cooldownUntil}
              onSend={handleSend}
            />
            {notice && (
              <p className="mt-1 rounded-lg bg-[rgba(177,105,74,.1)] px-3 py-1.5 text-[11.5px] text-brick">
                {notice}
              </p>
            )}
          </section>

          <aside className="flex min-h-0 flex-col gap-4 overflow-y-auto rounded-[38px_32px_40px_34px] border border-rule-soft bg-paper p-5 shadow-soft no-scrollbar">
            {/* 游戏按钮只给房主：点下去等于房主发一条 @AI，AI 负责主持 */}
            {canMention && !state.closed && (
              <GameShelf
                active={activeGame}
                disabled={composerDisabled}
                onStart={(game) => {
                  void startGame(game)
                }}
                onNext={(game) => {
                  void advanceGame(game)
                }}
                onStop={(game) => {
                  void stopGame(game)
                }}
              />
            )}
            <div>
              <div className="mb-2.5 flex items-center justify-between">
                <h2 className="text-[16px] font-bold">一桌五人</h2>
                <span className="rounded-full border border-rule px-2.5 py-0.5 text-[12px] text-ink-2">
                  {state.members.length} / {capacity}
                </span>
              </div>
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-1">
                {state.members.map((member) => (
                  <MemberCard
                    key={member.id}
                    member={member}
                    isSelf={member.id === self?.memberId}
                    now={now}
                    canRemove={
                      Boolean(canMention) && member.role !== 'host' && member.id !== self?.memberId
                    }
                    onRemove={setRemoveTarget}
                  />
                ))}
              </div>
            </div>

            <hr className="rule" />

            <div>
              <div className="mb-2 flex items-center justify-between">
                <h2 className="text-[16px] font-bold">AI 导播</h2>
                <span className="flex items-center gap-1.5 text-[12px] text-[#3f6156]">
                  <i
                    className={`h-1.5 w-1.5 rounded-full ${
                      runningInvocation ? 'animate-pulse bg-sage-deep' : 'bg-sage'
                    }`}
                  />
                  {runningInvocation ? '生成中' : queuedCount > 0 ? '排队中' : '待命'}
                </span>
              </div>
              <p className="text-[15px] font-bold leading-snug text-[#33524a]">
                {runningInvocation
                  ? `回应 ${runningInvocation.caller?.nickname ?? '房主'} · ${
                      runningInvocation.source === 'automatic' ? '冷场补话' : '房主调用'
                    }`
                  : queuedCount > 0
                    ? `还有 ${queuedCount} 个调用在排队`
                    : '在听，不插话'}
              </p>
              {queuedCount > 0 && runningInvocation && (
                <div className="mt-2 inline-flex rounded-full bg-[rgba(124,185,168,.16)] px-3 py-1 text-[12px] text-[#42645a]">
                  后面还有 {queuedCount} 项
                </div>
              )}
            </div>

            <hr className="rule" />

            <div className="pb-1">
              <h2 className="mb-1.5 text-[16px] font-bold">房间</h2>
              <Row label="房间号" value={roomId || 'room_demo'} />
              <Row
                label="名额"
                value={`${state.room?.occupiedSlots ?? state.members.length} / ${capacity}`}
              />
              <p className="mt-4 border-t border-dashed border-rule pt-3 text-[11.5px] leading-relaxed text-muted">
                关房后，聊天与成员资料不再保留。
              </p>
            </div>
          </aside>
        </main>
      </div>

      <InviteDialog
        open={inviteOpen}
        joinPath={state.room?.invitation.joinPath ?? '/join/room_demo'}
        onClose={() => setInviteOpen(false)}
      />

      {leaveOpen && (
        <div
          className="fixed inset-0 z-50 grid place-items-center bg-[rgba(58,50,38,.26)] backdrop-blur-[4px]"
          onClick={() => setLeaveOpen(false)}
        >
          <div
            className="w-[360px] rounded-[28px] border-[1.5px] border-rule bg-paper px-6 py-6 text-center shadow-[0_30px_60px_-24px_rgba(92,64,51,.5)]"
            onClick={(event) => event.stopPropagation()}
          >
            <h3 className="text-[16px] font-bold text-[#33291d]">要退出这个房间吗？</h3>
            <p className="mt-1.5 text-[12.5px] leading-relaxed text-muted">
              {canMention ? '房主退出会关闭房间。' : '座位会让出来，这次入房的聊天也不会保留。'}
            </p>
            <div className="mt-5 flex gap-2.5">
              <button
                type="button"
                onClick={() => setLeaveOpen(false)}
                className="flex-1 rounded-2xl border-[1.5px] border-[rgba(96,166,150,.5)] py-2.5 text-[13px] text-ink-2"
              >
                再想想
              </button>
              <button
                type="button"
                onClick={() => void handleLeave()}
                className="flex-1 rounded-2xl bg-brick py-2.5 text-[13px] font-semibold text-white"
              >
                {canMention ? '关闭房间' : '退出房间'}
              </button>
            </div>
          </div>
        </div>
      )}

      {removeTarget && (
        <div
          className="fixed inset-0 z-50 grid place-items-center bg-[rgba(58,50,38,.26)] backdrop-blur-[4px]"
          onClick={() => setRemoveTarget(null)}
        >
          <div
            className="w-[360px] rounded-[28px] border-[1.5px] border-rule bg-paper px-6 py-6 text-center shadow-[0_30px_60px_-24px_rgba(92,64,51,.5)]"
            onClick={(event) => event.stopPropagation()}
          >
            <h3 className="text-[16px] font-bold text-[#33291d]">
              把 {removeTarget.profile.nickname} 移出房间？
            </h3>
            <p className="mt-1.5 text-[12.5px] leading-relaxed text-muted">
              他会立刻离开，这个身份不能再加回当前房间。
            </p>
            <div className="mt-5 flex gap-2.5">
              <button
                type="button"
                onClick={() => setRemoveTarget(null)}
                className="flex-1 rounded-2xl border-[1.5px] border-[rgba(96,166,150,.5)] py-2.5 text-[13px] text-ink-2"
              >
                再想想
              </button>
              <button
                type="button"
                disabled={removing}
                onClick={() => void handleRemove()}
                className="flex-1 rounded-2xl bg-brick py-2.5 text-[13px] font-semibold text-white disabled:opacity-60"
              >
                {removing ? '处理中…' : '移出'}
              </button>
            </div>
          </div>
        </div>
      )}

      <ProfileDialog
        open={profileOpen}
        title="改我的资料"
        description="改完房间里的人立刻能看到，也会用于之后选话题。"
        policy={policy}
        initial={{
          nickname: selfMember?.profile.nickname ?? '',
          interestTags: selfMember?.profile.interestTags ?? [],
          bio: selfMember?.profile.bio ?? '',
        }}
        submitting={profileBusy}
        serverError={profileError}
        fieldErrors={profileFieldErrors}
        submitLabel="保存"
        submitNote={
          <>
            昵称在房间里唯一，
            <br />
            重复的话会被拒绝。
          </>
        }
        onClose={() => setProfileOpen(false)}
        onSubmit={handleSaveProfile}
      />
    </div>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between py-1 text-[12.5px] text-muted">
      <span>{label}</span>
      <span className="font-medium text-ink">{value}</span>
    </div>
  )
}
