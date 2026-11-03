import { useEffect, useMemo, useState } from 'react'
import { useParams } from 'react-router-dom'
import { MemberCard } from '../features/room/MemberCard'
import { ChatFeed } from '../features/chat/ChatFeed'
import { Composer } from '../features/chat/Composer'
import { InviteDialog } from '../features/room/InviteDialog'
import { demoCursor, demoSnapshot } from '../state/demo'
import { dispatch, useRoomState } from '../state/roomStore'
import type { MemberMessage } from '../shared/api/types'

export default function RoomPage() {
  const { roomId = '' } = useParams()
  const state = useRoomState()
  const [menuOpen, setMenuOpen] = useState(false)
  const [inviteOpen, setInviteOpen] = useState(false)
  const [leaveOpen, setLeaveOpen] = useState(false)

  // TODO(wire-ws): 换成先领票、连 WS、用 room.snapshot 初始化。
  useEffect(() => {
    if (!state.ready) {
      dispatch({ type: 'snapshot', data: demoSnapshot, cursor: demoCursor })
    }
  }, [state.ready])

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

  function handleSend(text: string) {
    if (!self || !selfMember) return
    const message: MemberMessage = {
      id: `local_${Date.now()}`,
      kind: 'member',
      author: { memberId: self.memberId, nickname: selfMember.profile.nickname },
      text,
      clientRequestId: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
      createdSequence: state.cursor + 1,
    }
    dispatch({ type: 'local-message', message })
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
              <i className="block h-1.5 w-1.5 rounded-full bg-sage" />
              {onlineCount} 人在线
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
                    setLeaveOpen(true)
                  }}
                  className="block w-full rounded-xl px-3 py-2 text-left text-[13px] text-brick hover:bg-[rgba(124,185,168,.16)]"
                >
                  退出房间
                </button>
              </div>
            )}
          </div>
        </header>

        <main className="mt-4 grid min-h-0 flex-1 gap-4 lg:grid-cols-[minmax(0,1fr)_392px] lg:gap-5">
          <section className="flex min-h-[520px] flex-col rounded-[34px_38px_32px_40px] border border-rule-soft bg-paper p-5 shadow-soft lg:min-h-0">
            <h2 className="pb-2.5 text-[16px] font-bold">聊天</h2>
            <hr className="rule" />
            <ChatFeed messages={state.messages} />
            <Composer canMention={canMention} onSend={handleSend} />
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
                onClick={() => setLeaveOpen(false)}
                className="flex-1 rounded-2xl bg-brick py-2.5 text-[13px] font-semibold text-white"
              >
                退出房间
              </button>
            </div>
          </div>
        </div>
      )}
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
