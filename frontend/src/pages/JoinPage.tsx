import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { JoinForm, type JoinValues } from '../features/join/JoinForm'
import { ApiError, getClientConfig } from '../shared/api/client'
import { joinRoom } from '../shared/api/room'
import type { ValidationPolicy } from '../shared/api/types'
import { Avatar } from '../shared/ui/Avatar'
import { DEMO_INVITE_PATH } from '../state/demo'
import { clearBootstrap, loadBootstrap, loadSession, saveSession } from '../state/session'

const FALLBACK_POLICY: ValidationPolicy = {
  nickname: { minLength: 1, maxLength: null },
  interestTag: { minLength: 1, maxLength: null },
  bio: { minLength: 0, maxLength: null },
  message: { minLength: 1, maxLength: null },
  interestTags: { minItems: 1, maxItems: null },
}

const FACES = [
  { id: 'member_host', initial: '林' },
  { id: 'member_zhou', initial: '周' },
  { id: 'member_lan', initial: '岚' },
  { id: 'member_mi', initial: '米' },
]

const ERROR_TEXT: Record<string, string> = {
  VALIDATION_ERROR: '资料没通过校验；如果都填好了，看看邀请码是否完整',
  ROOM_FULL: '房间坐满了，等有人退出再来',
  NICKNAME_TAKEN: '这个昵称已经有人用了，换一个吧',
  INVITATION_INVALID: '邀请链接无效或已经失效',
  ROOM_UNAVAILABLE: '房间不存在，或者已经关闭了',
  MEMBER_REMOVED: '你被移出了这个房间，不能再加入',
  BOOTSTRAP_CONFLICT: '这次入房的凭证已经用掉了，重新提交一次就好',
  SERVICE_UNAVAILABLE: '服务暂时不可用，稍后再试',
  NETWORK: '网络不太稳，稍后再试',
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
    setExisting(Boolean(loadSession(roomId)))
    return () => {
      alive = false
    }
  }, [roomId])

  async function handleSubmit(values: JoinValues) {
    setSubmitting(true)
    setError(null)
    setFieldErrors({})

    const bootstrap = loadBootstrap(roomId)
    try {
      const data = await joinRoom(roomId, {
        clientRequestId: bootstrap.clientRequestId,
        bootstrapToken: bootstrap.token,
        inviteCode,
        profile: {
          nickname: values.nickname,
          interestTags: values.interestTags,
          bio: values.bio,
        },
      })

      const membership = data.member.membership
      if (!membership) {
        throw new ApiError({ code: 'MEMBERSHIP_INACTIVE', status: 403, message: '这次入房没有生效' })
      }

      saveSession(roomId, {
        credential: data.memberCredential,
        membershipId: membership.id,
        memberId: data.member.id,
      })
      clearBootstrap(roomId)
      navigate(`/rooms/${roomId}`, { replace: true })
    } catch (caught) {
      if (caught instanceof ApiError) {
        if (caught.code === 'BOOTSTRAP_CONFLICT') {
          clearBootstrap(roomId)
        }
        if (caught.fieldErrors.length > 0) {
          setFieldErrors(
            Object.fromEntries(caught.fieldErrors.map((item) => [item.path, item.message])),
          )
        }
        setError(ERROR_TEXT[caught.code] ?? caught.message)
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
            <span>5 人上限</span>
            <span>·</span>
            <span>已到 4 人</span>
          </div>

          <div className="mt-4 flex">
            {FACES.map((face, index) => (
              <span key={face.id} className={index > 0 ? '-ml-3' : ''}>
                <Avatar memberId={face.id} nickname={face.initial} size={46} />
              </span>
            ))}
            <span className="-ml-3 grid h-[46px] w-[46px] place-items-center rounded-[52%_48%_45%_55%/48%_52%_48%_52%] border-[1.5px] border-dashed border-[rgba(139,115,85,.35)] bg-[rgba(255,253,247,.5)] text-[16px] text-muted">
              +
            </span>
          </div>

          <p className="mt-4 flex items-center gap-2 text-[12.5px] text-muted">
            <i className="block h-1.5 w-1.5 rounded-full bg-coral" />
            还差 1 个人，人满就锁座
            {!linkBroken && <span className="text-faint">· 邀请码已识别</span>}
            {codeMissing && <span className="text-brick">· 这个地址没有邀请码</span>}
            {codeTruncated && <span className="text-brick">· 邀请码看起来不完整</span>}
          </p>
        </section>

        <section>
          {existing ? (
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
                  onClick={() => setExisting(false)}
                  className="rounded-2xl border-[1.5px] border-[rgba(96,166,150,.5)] px-6 py-2.5 text-[13px] text-ink-2"
                >
                  换一个昵称
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
            <JoinForm
              policy={policy ?? FALLBACK_POLICY}
              submitting={submitting}
              serverError={error}
              fieldErrors={fieldErrors}
              onSubmit={handleSubmit}
            />
          )}
        </section>
      </div>
    </div>
  )
}
