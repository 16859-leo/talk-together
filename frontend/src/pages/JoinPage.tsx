import { useEffect, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { JoinForm, type JoinValues } from '../features/join/JoinForm'
import { getClientConfig } from '../shared/api/client'
import type { ValidationPolicy } from '../shared/api/types'
import { Avatar } from '../shared/ui/Avatar'

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

/** 入房页：用契约的 client-config 做校验约束；真实 POST 待接后端。 */
export default function JoinPage() {
  const { roomId = 'room_demo' } = useParams()
  const [search] = useSearchParams()
  const navigate = useNavigate()
  const [policy, setPolicy] = useState<ValidationPolicy | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const inviteCode = search.get('inviteCode')
  const hostName = roomId === 'room_demo' ? '小林' : roomId

  useEffect(() => {
    let alive = true
    getClientConfig().then((config) => {
      if (alive) setPolicy(config.validation)
    })
    return () => {
      alive = false
    }
  }, [])

  function handleSubmit(_values: JoinValues) {
    setSubmitting(true)
    // TODO(api): POST /rooms/{roomId}/members（bootstrapToken + clientRequestId）
    window.setTimeout(() => {
      setSubmitting(false)
      navigate(`/rooms/${roomId}`, { replace: true })
    }, 400)
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
            小林 在房间里等你。填好名字和兴趣，我们就能开始聊。
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
            {inviteCode && <span className="text-faint">· 邀请码已识别</span>}
          </p>
        </section>

        <section>
          <JoinForm
            policy={policy ?? FALLBACK_POLICY}
            submitting={submitting}
            serverError={null}
            fieldErrors={{}}
            onSubmit={handleSubmit}
          />
        </section>
      </div>
    </div>
  )
}
