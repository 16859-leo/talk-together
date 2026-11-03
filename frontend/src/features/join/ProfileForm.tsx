import { useState, type ReactNode } from 'react'
import type { ValidationPolicy } from '../../shared/api/types'

export interface JoinValues {
  nickname: string
  interestTags: string[]
  bio: string
}

interface ProfileFormProps {
  policy: ValidationPolicy
  submitting: boolean
  serverError: string | null
  fieldErrors: Record<string, string>
  submitLabel: string
  submitNote: ReactNode
  initial?: JoinValues
  onSubmit: (values: JoinValues) => void | Promise<void>
}

const SUGGESTIONS = ['电影', '旅行', '咖啡', '摄影', '游戏', '烘焙', '猫']

/** 昵称 + 兴趣标签 + 简介，加入房间和创建房间共用。 */
export function ProfileForm({
  policy,
  submitting,
  serverError,
  fieldErrors,
  submitLabel,
  submitNote,
  initial,
  onSubmit,
}: ProfileFormProps) {
  const [nickname, setNickname] = useState(initial?.nickname ?? '')
  const [tags, setTags] = useState<string[]>(initial?.interestTags ?? [])
  const [tagDraft, setTagDraft] = useState('')
  const [bio, setBio] = useState(initial?.bio ?? '')
  const [touched, setTouched] = useState(false)

  const nicknameTooShort = nickname.trim().length < (policy.nickname.minLength ?? 1)
  const tagsTooFew = tags.length < (policy.interestTags.minItems ?? 1)
  const invalid = nicknameTooShort || tagsTooFew

  /**
   * 标签完全自由：可以点常用词，也可以自己打。
   * 支持一次粘贴/输入多个（逗号、顿号、空格分隔），并按契约的上限截断。
   */
  function addTag(raw: string) {
    const parts = raw
      .split(/[,，、\s]+/)
      .map((item) => item.trim())
      .filter(Boolean)
    if (parts.length === 0) {
      setTagDraft('')
      return
    }
    setTags((prev) => {
      const limit = policy.interestTags.maxItems ?? Number.POSITIVE_INFINITY
      const next = [...prev]
      for (const part of parts) {
        if (next.length >= limit) break
        if (!next.includes(part)) next.push(part)
      }
      return next
    })
    setTagDraft('')
  }

  return (
    <form
      className="relative rounded-[34px] border-[1.5px] border-rule bg-paper px-8 pb-7 pt-8 shadow-[0_26px_50px_-30px_rgba(92,64,51,.45)]"
      onSubmit={(event) => {
        event.preventDefault()
        setTouched(true)
        if (invalid) return
        onSubmit({ nickname: nickname.trim(), interestTags: tags, bio: bio.trim() })
      }}
    >
      <div className="mb-4">
        <label className="mb-1.5 flex items-baseline gap-1.5 text-[12.5px] text-muted" htmlFor="nickname">
          <b className="text-[13px] font-semibold text-ink">昵称</b>
          <span className="text-[12px] text-brick">必填</span>
          <span>· 房间里不能重名</span>
        </label>
        <input
          id="nickname"
          value={nickname}
          onChange={(event) => setNickname(event.target.value)}
          onBlur={() => setTouched(true)}
          placeholder="别人怎么叫你？"
          maxLength={policy.nickname.maxLength ?? undefined}
          className={`w-full rounded-[14px] border-[1.5px] bg-card px-3.5 py-2.5 text-[14px] text-ink-2 outline-none transition-shadow placeholder:text-faint focus:border-[rgba(96,166,150,.7)] focus:shadow-[0_0_0_4px_rgba(124,185,168,.14)] ${
            touched && nicknameTooShort ? 'border-[rgba(163,71,31,.55)]' : 'border-rule'
          }`}
        />
        {touched && nicknameTooShort && (
          <p className="mt-1 text-[11.5px] text-brick">
            {fieldErrors['/profile/nickname'] ?? '起个名字才能进去'}
          </p>
        )}
      </div>

      <div className="mb-4">
        <label className="mb-1.5 flex items-baseline gap-1.5 text-[12.5px] text-muted" htmlFor="tag-draft">
          <b className="text-[13px] font-semibold text-ink">兴趣标签</b>
          <span className="text-[12px] text-brick">必填</span>
          <span>· 至少一个，自己写的也算</span>
        </label>
        <div
          className={`flex min-h-[46px] flex-wrap items-center gap-1.5 rounded-[14px] border-[1.5px] bg-card px-2.5 py-2 transition-shadow focus-within:border-[rgba(96,166,150,.7)] focus-within:shadow-[0_0_0_4px_rgba(124,185,168,.14)] ${
            touched && tagsTooFew ? 'border-[rgba(163,71,31,.55)]' : 'border-rule'
          }`}
        >
          {tags.map((tag) => (
            <span
              key={tag}
              className="inline-flex items-center gap-1.5 rounded-full border border-[rgba(79,143,130,.4)] bg-[#e4f0ea] py-0.5 pl-2.5 pr-1.5 text-[12px] text-[#2f5f56]"
            >
              {tag}
              <button
                type="button"
                aria-label={`删除 ${tag}`}
                onClick={() => setTags((prev) => prev.filter((item) => item !== tag))}
                className="text-[13px] leading-none text-[#6f8f86]"
              >
                ×
              </button>
            </span>
          ))}
          <input
            id="tag-draft"
            value={tagDraft}
            onChange={(event) => setTagDraft(event.target.value)}
            onKeyDown={(event) => {
              // 中文输入法选词时的回车不算提交
              if (event.nativeEvent.isComposing) return
              if (event.key === 'Enter') {
                event.preventDefault()
                addTag(tagDraft)
              } else if (event.key === '，' || event.key === ',') {
                event.preventDefault()
                addTag(`${tagDraft}${event.key}`)
              } else if (event.key === 'Backspace' && tagDraft.length === 0 && tags.length > 0) {
                setTags((prev) => prev.slice(0, -1))
              }
            }}
            placeholder="自己写一个，回车添加"
            className="min-w-[120px] flex-1 bg-transparent px-0.5 py-1 text-[13.5px] text-ink-2 outline-none placeholder:text-faint"
          />
          {tagDraft.trim().length > 0 && (
            <button
              type="button"
              onClick={() => addTag(tagDraft)}
              className="shrink-0 rounded-full border border-dashed border-[rgba(96,166,150,.6)] px-2.5 py-0.5 text-[11.5px] text-[#3f6156] transition-colors hover:bg-[rgba(124,185,168,.16)]"
            >
              + 添加
            </button>
          )}
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <span className="text-[11px] text-faint">常用</span>
          {SUGGESTIONS.filter((item) => !tags.includes(item)).map((item) => (
            <button
              key={item}
              type="button"
              onClick={() => addTag(item)}
              className="rounded-full border border-dashed border-[rgba(139,115,85,.35)] px-2.5 py-0.5 text-[11.5px] text-muted transition-colors hover:border-[rgba(96,166,150,.5)] hover:bg-[rgba(124,185,168,.16)] hover:text-[#3f6156]"
            >
              {item}
            </button>
          ))}
        </div>
        {touched && tagsTooFew && (
          <p className="mt-1 text-[11.5px] text-brick">
            {fieldErrors['/profile/interestTags'] ?? '至少填一个兴趣，自己写的也行'}
          </p>
        )}
      </div>

      <div className="mb-5">
        <label className="mb-1.5 flex items-baseline gap-1.5 text-[12.5px] text-muted" htmlFor="bio">
          <b className="text-[13px] font-semibold text-ink">个人简介</b>
          <span className="text-[11.5px] text-faint">可选</span>
          <span>· 写一句也可以</span>
        </label>
        <textarea
          id="bio"
          value={bio}
          onChange={(event) => setBio(event.target.value)}
          maxLength={policy.bio.maxLength ?? undefined}
          placeholder="比如：最近在读科幻，周末喜欢做饭——写不写都行，空着也没关系。"
          className="h-[76px] w-full resize-none rounded-[14px] border-[1.5px] border-rule bg-card px-3.5 py-2.5 text-[13.5px] leading-relaxed text-ink-2 outline-none transition-shadow placeholder:text-faint focus:border-[rgba(96,166,150,.7)] focus:shadow-[0_0_0_4px_rgba(124,185,168,.14)]"
        />
      </div>

      {serverError && (
        <p className="mb-3 rounded-xl bg-[rgba(177,105,74,.12)] px-3 py-2 text-[12px] text-brick">
          {serverError}
        </p>
      )}

      <div className="flex items-center gap-3.5">
        <button
          type="submit"
          disabled={submitting}
          className="rounded-2xl bg-sage-deep px-7 py-3 text-[14px] font-semibold text-white shadow-[0_10px_22px_-12px_rgba(95,165,147,.9)] transition-all hover:bg-[#549c8b] disabled:opacity-60"
        >
          {submitting ? '稍等…' : submitLabel}
        </button>
        <p className="text-[11.5px] leading-relaxed text-muted">{submitNote}</p>
      </div>
    </form>
  )
}
