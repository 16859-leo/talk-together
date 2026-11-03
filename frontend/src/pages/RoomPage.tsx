import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { MemberCard } from '../features/room/MemberCard'
import { ChatFeed } from '../features/chat/ChatFeed'
import { Composer } from '../features/chat/Composer'
import { InviteDialog } from '../features/room/InviteDialog'
import { ProfileDialog } from '../features/room/ProfileDialog'
import type { JoinValues } from '../features/join/ProfileForm'
import { ApiError, getClientConfig } from '../shared/api/client'
import { getSelf, leaveRoom, removeMember, sendMessage, updateSelf } from '../shared/api/room'
import type { ActiveMember, MemberMessage, ValidationPolicy } from '../shared/api/types'
import { openRoomStream, type StreamStatus } from '../shared/realtime/connection'
import { demoCursor, demoSnapshot } from '../state/demo'
import { applyServerMessage, dispatch, useRoomState } from '../state/roomStore'
import { clearSession, devSession, loadSession, type RoomSession } from '../state/session'
import { formatLeft, useNow } from '../shared/ui/useNow'

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

const END_TEXT: Record<string, { title: string; detail: string }> = {
  MEMBER_REMOVED: { title: '你被移出了这个房间', detail: '房主结束了你的入场，可以等下一次邀请。' },
  ROOM_UNAVAILABLE: { title: '房间已经关闭', detail: '房主关掉了房间，聊天和资料都不会保留。' },
  MEMBERSHIP_INACTIVE: { title: '这次入房已经结束', detail: '从邀请链接重新进来就好。' },
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
  const pendingSend = useRef<{ id: string; text: string } | null>(null)

  const session = useMemo<RoomSession | null>(
    () => loadSession(roomId) ?? (import.meta.env.DEV ? devSession() : null),
    [roomId],
  )

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

  // 后端未接时先用本地快照撑起界面；收到 WS 快照会被整体替换。
  useEffect(() => {
    if (!state.ready) {
      dispatch({ type: 'snapshot', data: demoSnapshot, cursor: demoCursor })
    }
  }, [state.ready])

  // room.closed 是本次连接的最后一个业务事件：直接切终态并清凭证。
  useEffect(() => {
    if (!state.closed) return
    clearSession(roomId)
    setEnded({ title: '房间已经关闭', detail: '房主关掉了房间，聊天和资料都不会保留。' })
  }, [state.closed, roomId])

  // 恢复身份：凭证还有效就继续，入房已结束就给出终态。
  useEffect(() => {
    if (!session) return undefined
    let alive = true
    getSelf(roomId, session.credential)
      .then((data) => {
        if (!alive) return
        if (!data.member.membership) {
          clearSession(roomId)
          setEnded(END_TEXT.MEMBERSHIP_INACTIVE)
        }
      })
      .catch((error: unknown) => {
        if (!alive || !(error instanceof ApiError)) return
        const text = END_TEXT[error.code]
        if (text) {
          clearSession(roomId)
          setEnded(text)
        }
      })
    return () => {
      alive = false
    }
  }, [roomId, session])

  // 领票 → 建连 → 首帧快照 → 事件流。
  useEffect(() => {
    if (!session) return undefined
    const controller = new AbortController()
    const close = openRoomStream({
      roomId: roomId || 'room_demo',
      credential: session.credential,
      membershipId: session.membershipId,
      signal: controller.signal,
      onStatus: (next, detail) => {
        setStatus(next)
        if (next === 'failed' && detail) setNotice(detail)
      },
      onMessage: applyServerMessage,
    })
    return () => {
      controller.abort()
      close()
    }
  }, [roomId, session])

  useEffect(() => {
    if (!menuOpen) return undefined
    function onDocClick() {
      setMenuOpen(false)
    }
    document.addEventListener('click', onDocClick)
    return () => document.removeEventListener('click', onDocClick)
  }, [menuOpen])

  const self = state.self
  const selfMember = useMemo(
    () => state.members.find((m) => m.id === self?.memberId),
    [state.members, self?.memberId],
  )
  const canMention = self?.role === 'host'
  const onlineCount = state.members.filter((m) => m.membership?.presence !== 'offline').length
  const capacity = state.room?.capacity ?? 5
  const now = useNow()
  const hostLeft = formatLeft(state.room?.hostRecoveryExpiresAt ?? null, now)
  const hostReconnecting = state.room?.status === 'host_reconnecting'
  const reconnecting = status === 'reconnecting' || status === 'failed'
  const composerDisabled = status === 'reconnecting' || status === 'failed' || status === 'closed'
  const statusText = STATUS_TEXT[status]

  async function handleSend(text: string, mentions: 'ai'[]): Promise<boolean> {
    if (!session) {
      setNotice('还没加入这个房间')
      return false
    }
    setNotice(null)

    const reuse = pendingSend.current?.text === text ? pendingSend.current.id : null
    const clientRequestId = reuse ?? crypto.randomUUID()

    try {
      const data = await sendMessage(
        roomId || 'room_demo',
        { clientRequestId, text, mentions },
        session,
      )
      pendingSend.current = null
      dispatch({ type: 'local-message', message: data.message })
      if (data.ai.status === 'rejected') {
        setNotice(`AI 没受理：${data.ai.error.message}`)
      } else if (data.ai.status === 'ignored') {
        setNotice('普通成员的 @AI 会被忽略，文字照常发出')
      }
      return true
    } catch (error) {
      if (!(error instanceof ApiError)) {
        setNotice('发送失败，稍后再试')
        return false
      }

      // 网络问题：保留本地输入体验，同时记住这次的 ID 便于重试
      if (error.status === 0) {
        pendingSend.current = { id: clientRequestId, text }
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
      pendingSend.current = retryable ? { id: clientRequestId, text } : null

      const terminal = END_TEXT[error.code]
      if (terminal) {
        clearSession(roomId)
        setEnded(terminal)
        return false
      }

      const wait = error.retryAfterMs
        ? `（${Math.ceil(error.retryAfterMs / 1000)} 秒后可再试）`
        : ''
      setNotice(`${error.message}${wait}`)
      return false
    }
  }

  async function handleLeave() {
    setLeaveOpen(false)
    if (session) {
      try {
        await leaveRoom(roomId || 'room_demo', session)
      } catch {
        /* 退出失败也把本地收干净，避免卡在房间里 */
      }
    }
    clearSession(roomId)
    navigate('/')
  }

  async function handleRemove() {
    if (!removeTarget || !session) return
    setRemoving(true)
    try {
      await removeMember(roomId || 'room_demo', removeTarget.id, session)
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
    if (!session) return
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
        session,
      )
      dispatch({ type: 'member-updated', member: data.member })
      setProfileOpen(false)
      setNotice('资料已更新，房间里的人都看到了')
    } catch (error) {
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

  if (ended) {
    return (
      <div className="page-bg paper grid min-h-screen place-items-center px-6">
        <div className="relative z-10 w-full max-w-[440px] rounded-[32px] border-[1.5px] border-rule bg-paper px-8 py-10 text-center shadow-[0_30px_60px_-34px_rgba(92,64,51,.45)]">
          <h1 className="text-[20px] font-bold text-[#33291d]">{ended.title}</h1>
          <p className="mt-2 text-[13px] leading-relaxed text-ink-2">{ended.detail}</p>
          <button
            type="button"
            onClick={() => navigate('/')}
            className="mt-6 rounded-2xl bg-sage-deep px-6 py-2.5 text-[13px] font-semibold text-white"
          >
            回到首页
          </button>
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
              {selfMember?.profile.nickname ?? '房间'} 的房间
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
            <ChatFeed messages={state.messages} />
            <Composer canMention={canMention} disabled={composerDisabled} onSend={handleSend} />
            {notice && (
              <p className="mt-1 rounded-lg bg-[rgba(177,105,74,.1)] px-3 py-1.5 text-[11.5px] text-brick">
                {notice}
              </p>
            )}
          </section>

          <aside className="flex min-h-0 flex-col gap-4 overflow-y-auto rounded-[38px_32px_40px_34px] border border-rule-soft bg-paper p-5 shadow-soft no-scrollbar">
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
                  <i className="h-1.5 w-1.5 rounded-full bg-sage" />
                  正在生成
                </span>
              </div>
              <p className="text-[16px] font-bold leading-snug text-[#33524a]">
                回应 {selfMember?.profile.nickname ?? '房主'}，正在换话题
              </p>
              <div className="mt-2 inline-flex rounded-full bg-[rgba(124,185,168,.16)] px-3 py-1 text-[12px] text-[#42645a]">
                后面还有 1 项 · 阿岚
              </div>
            </div>

            <hr className="rule" />

            <div className="pb-1">
              <h2 className="mb-1.5 text-[16px] font-bold">房间</h2>
              <Row label="房间号" value={roomId || 'room_demo'} />
              <Row label="名额" value={`${capacity} 人 · 已满`} />
              <Row label="开始于" value="21:32" />
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
