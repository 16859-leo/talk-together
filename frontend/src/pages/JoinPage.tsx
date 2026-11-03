import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { ProfileForm, type JoinValues } from '../features/join/ProfileForm'
import {
  canReplayPending,
  isDefinitiveFailure,
  toJoinBody,
  toPendingJoin,
} from '../features/join/joinRequest'
import { ApiError, getClientConfig } from '../shared/api/client'
import { errorText } from '../shared/api/errors'
import { joinRoom } from '../shared/api/room'
import type { ValidationPolicy } from '../shared/api/types'
import { DEMO_INVITE_PATH } from '../state/demo'
import {
  JoinLockTimeout,
  clearBootstrap,
  clearPendingJoin,
  clearSession,
  loadBootstrap,
  loadPendingJoin,
  loadSession,
  savePendingJoin,
  saveSession,
  withJoinLock,
  type PendingJoin,
  type RoomSession,
} from '../state/session'

const FALLBACK_POLICY: ValidationPolicy = {
  nickname: { minLength: 1, maxLength: null },
  interestTag: { minLength: 1, maxLength: null },
  bio: { minLength: 0, maxLength: null },
  message: { minLength: 1, maxLength: null },
  interestTags: { minItems: 1, maxItems: null },
}


export default function JoinPage() {
  const { roomId = 'room_demo' } = useParams()
  const [search] = useSearchParams()
  const navigate = useNavigate()
  const [policy, setPolicy] = useState<ValidationPolicy | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const [existing, setExisting] = useState(false)
  /** 成员凭证还在、但这次入房已经结束：可以原身份重新加入 */
  const [staleSession, setStaleSession] = useState<RoomSession | null>(null)
  /** 上一次入房可能已被服务端受理：允许显式放弃 */
  const [conflict, setConflict] = useState(false)
  /** 上一次入房结果未知、且这次资料不同：先确认原请求，不要自动覆盖 */
  const [pendingBlock, setPendingBlock] = useState<PendingJoin | null>(null)
  const [lastValues, setLastValues] = useState<JoinValues | null>(null)

  const inviteCode = search.get('inviteCode') ?? ''
  const codeMissing = inviteCode.length === 0
  const codeTruncated = !codeMissing && inviteCode.length < 32
  const linkBroken = codeMissing || codeTruncated
  const hostName = roomId === 'room_demo' ? '小林' : roomId

  useEffect(() => {
    let alive = true
    getClientConfig().then((config) => {
      if (alive) setPolicy(config.validation)
    })
    const saved = loadSession(roomId)
    setExisting(Boolean(saved?.membershipId))
    setStaleSession(saved && !saved.membershipId ? saved : null)
    return () => {
      alive = false
    }
  }, [roomId])

  async function handleSubmit(values: JoinValues) {
    setSubmitting(true)
    setError(null)
    setFieldErrors({})
    setConflict(false)
    setLastValues(values)

    try {
      // 同一房间的入房提交跨标签页串行：后提交的标签页在锁内会看到前一个的结果
      await withJoinLock(roomId, async () => {
        const saved = loadSession(roomId)
        // 别人已经建好身份了就直接复用；只有凭证、没有 membership 时走原身份重新加入
        if (saved?.membershipId) {
          navigate(`/rooms/${roomId}`, { replace: true })
          return
        }

        // 上一次结果未知时，不能用新资料覆盖原请求：先让用户确认原请求的结果
        const stored = loadPendingJoin(roomId)
        const replay = canReplayPending(stored, values, inviteCode)
        if (stored && !replay) {
          setPendingBlock(stored)
          setError('上一次入房还在确认中，先用原资料确认结果')
          return
        }

        const bootstrap = loadBootstrap(roomId)
        const body = replay && stored
          ? toJoinBody(stored)
          : {
              clientRequestId: saved ? crypto.randomUUID() : bootstrap.clientRequestId,
              bootstrapToken: saved ? undefined : bootstrap.token,
              inviteCode,
              profile: {
                nickname: values.nickname,
                interestTags: values.interestTags,
                bio: values.bio,
              },
            }
        if (!replay) savePendingJoin(roomId, toPendingJoin(body))

        let data
        try {
          data = await joinRoom(roomId, body, saved ? { credential: saved.credential } : undefined)
        } catch (caught) {
          // 另一个标签页刚用同一份 bootstrap 成功：直接采用它的结果，别再匿名新建
          if (caught instanceof ApiError && caught.code === 'BOOTSTRAP_CONFLICT') {
            const again = loadSession(roomId)
            if (again?.membershipId) {
              navigate(`/rooms/${roomId}`, { replace: true })
              return
            }
          }
          throw caught
        }

        const membership = data.member.membership
        if (!membership) {
          throw new ApiError({
            code: 'MEMBERSHIP_INACTIVE',
            status: 403,
            message: '这次入房没有生效',
          })
        }

        saveSession(roomId, {
          credential: data.memberCredential,
          membershipId: membership.id,
          memberId: data.member.id,
          nickname: body.profile.nickname,
          interestTags: body.profile.interestTags,
          role: data.member.role,
          joinPath: data.room.invitation.joinPath,
        })
        clearPendingJoin(roomId)
        clearBootstrap(roomId)
        navigate(`/rooms/${roomId}`, { replace: true })
      })
    } catch (caught) {
      if (caught instanceof JoinLockTimeout) {
        setError(caught.message)
      } else if (caught instanceof ApiError) {
        if (caught.fieldErrors.length > 0) {
          setFieldErrors(
            Object.fromEntries(caught.fieldErrors.map((item) => [item.path, item.message])),
          )
        }
        if (caught.code === 'BOOTSTRAP_CONFLICT') {
          // 保留这次的请求：可能是上一次已经成功，只是没拿到回执
          setConflict(true)
          setError('上一次入房可能已经成功，但没收到回执')
        } else {
          // 服务端已经明确拒绝，这次请求不再重放
          if (isDefinitiveFailure(caught.code)) clearPendingJoin(roomId)
          setError(errorText(caught.code, caught.message))
        }
      } else {
        setError('没进去，稍后再试')
      }
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="page-bg paper min-h-screen">
      <div className="relative z-10 mx-auto grid min-h-screen max-w-[1300px] items-center gap-12 px-6 py-10 lg:grid-cols-[minmax(0,46fr)_minmax(0,54fr)] lg:px-12">
        <section>
          <div className="mb-7 flex items-center gap-2.5 text-[22px] font-bold tracking-wide">
            <span className="h-4 w-4 rounded-full bg-sage" />
            搭个话
          </div>
          <h1 className="text-[36px] font-bold leading-[1.24] tracking-tight text-[#33291d] sm:text-[44px]">
            <span className="relative inline-block">
              进来坐坐，
              <svg
                viewBox="0 0 300 10"
                preserveAspectRatio="none"
                aria-hidden="true"
                className="absolute -bottom-2.5 left-0.5 h-3.5 w-full overflow-visible"
              >
                <path
                  d="M2 7 C 60 2, 110 9, 160 5 S 250 2, 298 6"
                  fill="none"
                  stroke="#5fa593"
                  strokeWidth={3.4}
                  strokeLinecap="round"
                  opacity={0.6}
                />
              </svg>
            </span>
            <br />
            就差你了
          </h1>
          <p className="mt-4 max-w-[34ch] text-[14.5px] leading-relaxed text-ink-2">
            {hostName} 在房间里等你。填好名字和兴趣，我们就能开始聊。
          </p>

          <div className="mt-6 flex flex-wrap items-center gap-2.5 text-[13px] text-muted">
            <b className="font-semibold text-ink">{hostName} 的房间</b>
            <span>·</span>
            <span>最多 5 人</span>
            <span>·</span>
            <span>人满会提示坐不下</span>
          </div>

          <p className="mt-4 flex items-center gap-2 text-[12.5px] text-muted">
            <i className="block h-1.5 w-1.5 rounded-full bg-coral" />
            填完资料就能进去，同一浏览器会沿用这次身份
            {!linkBroken && <span className="text-faint">· 邀请码已识别</span>}
            {codeMissing && <span className="text-brick">· 这个地址没有邀请码</span>}
            {codeTruncated && <span className="text-brick">· 邀请码看起来不完整</span>}
          </p>
        </section>

        <section>
          {pendingBlock ? (
            <div className="rounded-[34px] border-[1.5px] border-rule bg-paper px-8 py-9 text-center shadow-[0_26px_50px_-30px_rgba(92,64,51,.45)]">
              <h2 className="text-[17px] font-bold text-[#33291d]">上一次入房还在确认中</h2>
              <p className="mt-1.5 text-[12.5px] leading-relaxed text-muted">
                上次提交的「{pendingBlock.profile.nickname}」还没拿到结果。先用同一份资料确认一次；
                如果确实没进去，再放弃它、用现在的资料重新入房。
              </p>
              <div className="mt-5 flex flex-wrap justify-center gap-2.5">
                <button
                  type="button"
                  disabled={submitting}
                  onClick={() => void handleSubmit(pendingBlock.profile)}
                  className="rounded-2xl bg-sage-deep px-6 py-2.5 text-[13px] font-semibold text-white disabled:opacity-60"
                >
                  {submitting ? '确认中…' : '用原资料重试'}
                </button>
                <button
                  type="button"
                  disabled={submitting}
                  onClick={() => {
                    clearPendingJoin(roomId)
                    clearBootstrap(roomId)
                    setPendingBlock(null)
                    const next = lastValues ?? pendingBlock.profile
                    void handleSubmit(next)
                  }}
                  className="rounded-2xl border-[1.5px] border-[rgba(96,166,150,.5)] px-6 py-2.5 text-[13px] text-ink-2 disabled:opacity-60"
                >
                  放弃原请求
                </button>
              </div>
              {error && <p className="mt-3 text-[11.5px] text-brick">{error}</p>}
            </div>
          ) : conflict ? (
            <div className="rounded-[34px] border-[1.5px] border-rule bg-paper px-8 py-9 text-center shadow-[0_26px_50px_-30px_rgba(92,64,51,.45)]">
              <h2 className="text-[17px] font-bold text-[#33291d]">上一次入房可能已经成功</h2>
              <p className="mt-1.5 text-[12.5px] leading-relaxed text-muted">
                服务端说这次的凭证已经用过了。先用同一份资料再确认一次；如果确实没进去，再换新身份。
              </p>
              <div className="mt-5 flex flex-wrap justify-center gap-2.5">
                <button
                  type="button"
                  disabled={submitting}
                  onClick={() => lastValues && void handleSubmit(lastValues)}
                  className="rounded-2xl bg-sage-deep px-6 py-2.5 text-[13px] font-semibold text-white disabled:opacity-60"
                >
                  {submitting ? '确认中…' : '重试确认'}
                </button>
                <button
                  type="button"
                  disabled={submitting}
                  onClick={() => {
                    clearPendingJoin(roomId)
                    clearBootstrap(roomId)
                    setConflict(false)
                    if (lastValues) void handleSubmit(lastValues)
                  }}
                  className="rounded-2xl border-[1.5px] border-[rgba(96,166,150,.5)] px-6 py-2.5 text-[13px] text-ink-2 disabled:opacity-60"
                >
                  放弃，换新身份
                </button>
              </div>
              {error && <p className="mt-3 text-[11.5px] text-brick">{error}</p>}
            </div>
          ) : staleSession && !linkBroken ? (
            <div className="rounded-[34px] border-[1.5px] border-rule bg-paper px-8 py-9 text-center shadow-[0_26px_50px_-30px_rgba(92,64,51,.45)]">
              <h2 className="text-[17px] font-bold text-[#33291d]">这次入房已经结束</h2>
              <p className="mt-1.5 text-[12.5px] leading-relaxed text-muted">
                你的身份还在（{staleSession.nickname ?? '原来的你'}），可以用它重新占一个座位。
              </p>
              {error && (
                <p className="mt-3 rounded-xl bg-[rgba(177,105,74,.12)] px-3 py-2 text-[12px] text-brick">
                  {error}
                </p>
              )}
              <div className="mt-5 flex flex-wrap justify-center gap-2.5">
                <button
                  type="button"
                  disabled={submitting}
                  onClick={() =>
                    void handleSubmit({
                      nickname: staleSession.nickname ?? '我',
                      interestTags: staleSession.interestTags ?? ['随便聊聊'],
                      bio: '',
                    })
                  }
                  className="rounded-2xl bg-sage-deep px-6 py-2.5 text-[13px] font-semibold text-white disabled:opacity-60"
                >
                  {submitting ? '正在重新加入…' : '用原身份重新加入'}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    // 保留凭证，只是换成表单里重新填写资料
                    setStaleSession(null)
                    setExisting(false)
                  }}
                  className="rounded-2xl border-[1.5px] border-[rgba(96,166,150,.5)] px-6 py-2.5 text-[13px] text-ink-2"
                >
                  改资料后重新加入
                </button>
                <button
                  type="button"
                  onClick={() => {
                    clearSession(roomId)
                    clearBootstrap(roomId)
                    clearPendingJoin(roomId)
                    setStaleSession(null)
                    setExisting(false)
                  }}
                  className="rounded-2xl border-[1.5px] border-[rgba(96,166,150,.5)] px-6 py-2.5 text-[13px] text-ink-2"
                >
                  换个身份
                </button>
              </div>
            </div>
          ) : existing ? (
            <div className="rounded-[34px] border-[1.5px] border-rule bg-paper px-8 py-9 text-center shadow-[0_26px_50px_-30px_rgba(92,64,51,.45)]">
              <h2 className="text-[17px] font-bold text-[#33291d]">你已经在这个房间里了</h2>
              <p className="mt-1.5 text-[12.5px] text-muted">刷新或换标签页都不会变成新成员。</p>
              <div className="mt-5 flex justify-center gap-2.5">
                <Link
                  to={`/rooms/${roomId}`}
                  className="rounded-2xl bg-sage-deep px-6 py-2.5 text-[13px] font-semibold text-white"
                >
                  回到房间
                </Link>
                <button
                  type="button"
                  onClick={() => {
                    clearSession(roomId)
                    clearBootstrap(roomId)
                    setExisting(false)
                  }}
                  className="rounded-2xl border-[1.5px] border-[rgba(96,166,150,.5)] px-6 py-2.5 text-[13px] text-ink-2"
                >
                  换个身份重新加入
                </button>
              </div>
            </div>
          ) : linkBroken ? (
            <div className="rounded-[34px] border-[1.5px] border-rule bg-paper px-8 py-9 shadow-[0_26px_50px_-30px_rgba(92,64,51,.45)]">
              <h2 className="text-[17px] font-bold text-[#33291d]">邀请链接不完整</h2>
              <p className="mt-1.5 text-[12.5px] leading-relaxed text-muted">
                {codeMissing
                  ? '这个地址里没有邀请码。请用房主发来的完整链接，或者扫他分享的二维码。'
                  : '链接里的邀请码被截断了，让房主重新发一次就好。'}
              </p>
              <div className="mt-5 flex flex-wrap justify-center gap-2.5">
                <Link
                  to={DEMO_INVITE_PATH}
                  className="rounded-2xl bg-sage-deep px-6 py-2.5 text-[13px] font-semibold text-white"
                >
                  用演示邀请链接进入
                </Link>
                <Link
                  to="/"
                  className="rounded-2xl border-[1.5px] border-[rgba(96,166,150,.5)] px-6 py-2.5 text-[13px] text-ink-2"
                >
                  回首页
                </Link>
              </div>
            </div>
          ) : (
            <ProfileForm
              policy={policy ?? FALLBACK_POLICY}
              submitting={submitting}
              serverError={error}
              fieldErrors={fieldErrors}
              submitLabel="加入房间"
              submitNote={
                <>
                  进房后可以随时改资料，
                  <br />
                  关房后聊天与资料不再保留。
                </>
              }
              onSubmit={handleSubmit}
            />
          )}
        </section>
      </div>
    </div>
  )
}
