import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ProfileForm, type JoinValues } from '../features/join/ProfileForm'
import { ApiError, getClientConfig } from '../shared/api/client'
import { createRoom } from '../shared/api/room'
import type { ValidationPolicy } from '../shared/api/types'
import { clearBootstrap, loadBootstrap, saveSession } from '../state/session'

const FALLBACK_POLICY: ValidationPolicy = {
  nickname: { minLength: 1, maxLength: null },
  interestTag: { minLength: 1, maxLength: null },
  bio: { minLength: 0, maxLength: null },
  message: { minLength: 1, maxLength: null },
  interestTags: { minItems: 1, maxItems: null },
}

const ERROR_TEXT: Record<string, string> = {
  VALIDATION_ERROR: '资料没通过校验，看看标红的输入框',
  SERVICE_UNAVAILABLE: '服务暂时不可用，稍后再试',
  NETWORK: '网络不太稳，稍后再试',
}

export default function CreatePage() {
  const navigate = useNavigate()
  const [policy, setPolicy] = useState<ValidationPolicy | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})

  useEffect(() => {
    let alive = true
    getClientConfig().then((config) => {
      if (alive) setPolicy(config.validation)
    })
    return () => {
      alive = false
    }
  }, [])

  async function handleSubmit(values: JoinValues) {
    setSubmitting(true)
    setError(null)
    setFieldErrors({})

    // 创建也走引导凭证，保证重复提交不会开出两个房间
    const bootstrap = loadBootstrap('create')

    try {
      const data = await createRoom({
        clientRequestId: bootstrap.clientRequestId,
        bootstrapToken: bootstrap.token,
        profile: {
          nickname: values.nickname,
          interestTags: values.interestTags,
          bio: values.bio,
        },
      })

      const membership = data.member.membership
      if (!membership) {
        throw new ApiError({ code: 'MEMBERSHIP_INACTIVE', status: 403, message: '房间没建成' })
      }

      saveSession(data.room.id, {
        credential: data.memberCredential,
        membershipId: membership.id,
        memberId: data.member.id,
      })
      clearBootstrap('create')
      navigate(`/rooms/${data.room.id}`, { replace: true })
    } catch (caught) {
      if (caught instanceof ApiError) {
        if (caught.fieldErrors.length > 0) {
          setFieldErrors(
            Object.fromEntries(caught.fieldErrors.map((item) => [item.path, item.message])),
          )
        }
        setError(ERROR_TEXT[caught.code] ?? caught.message)
      } else {
        setError('房间没建成，稍后再试')
      }
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="page-bg paper min-h-screen">
      <div className="relative z-10 mx-auto grid min-h-screen max-w-[1300px] items-center gap-12 px-6 py-10 lg:grid-cols-[minmax(0,46fr)_minmax(0,54fr)] lg:px-12">
        <section>
          <Link
            to="/"
            className="mb-7 inline-flex items-center gap-2.5 text-[22px] font-bold tracking-wide"
          >
            <span className="h-4 w-4 rounded-full bg-sage" />
            搭个话
          </Link>
          <h1 className="text-[36px] font-bold leading-[1.24] tracking-tight text-[#33291d] sm:text-[44px]">
            开一桌，
            <br />
            等人来聊
          </h1>
          <p className="mt-4 max-w-[34ch] text-[14.5px] leading-relaxed text-ink-2">
            你是这桌的房主。填好名字和兴趣，建完就能把链接发给朋友。
          </p>

          <ul className="mt-7 space-y-3 text-[13.5px] text-ink-2">
            {[
              ['一桌最多五人', '人满了就锁座，掉线还能保留 60 秒座位'],
              ['冷场有人接', 'AI 导播会看上下文补话题，不抢话'],
              ['关房就散场', '聊天与公开资料不保留，不用收拾'],
            ].map(([title, detail]) => (
              <li key={title} className="flex gap-3">
                <span className="mt-[7px] block h-1.5 w-1.5 shrink-0 rounded-full bg-sage" />
                <span>
                  <b className="font-semibold text-ink">{title}</b>
                  <span className="text-muted"> · {detail}</span>
                </span>
              </li>
            ))}
          </ul>
        </section>

        <section>
          <ProfileForm
            policy={policy ?? FALLBACK_POLICY}
            submitting={submitting}
            serverError={error}
            fieldErrors={fieldErrors}
            submitLabel="创建房间"
            submitNote={
              <>
                创建后你就是房主，
                <br />
                可以把邀请链接发给朋友。
              </>
            }
            onSubmit={handleSubmit}
          />
        </section>
      </div>
    </div>
  )
}
