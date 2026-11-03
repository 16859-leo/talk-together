import { useEffect, useRef, useState } from 'react'
import { formatLeft, useNow } from '../../shared/ui/useNow'

interface ComposerProps {
  canMention: boolean
  disabled?: boolean
  /** 服务端限频给出的冷却截止时间 */
  cooldownUntil?: number | null
  onSend: (text: string, mentions: 'ai'[]) => Promise<boolean>
}

export function Composer({ canMention, disabled, cooldownUntil, onSend }: ComposerProps) {
  const [value, setValue] = useState('')
  const [showMention, setShowMention] = useState(false)
  const [sending, setSending] = useState(false)
  /** 只有显式从提及菜单里选了 AI 才算结构化提及，正文里出现 @AI 不算 */
  const [mentionPicked, setMentionPicked] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const now = useNow(1000)

  const cooling = cooldownUntil !== null && cooldownUntil !== undefined && cooldownUntil > now
  const cooldownLeft = cooling ? formatLeft(new Date(cooldownUntil).toISOString(), now) : null

  useEffect(() => {
    setShowMention(canMention && !mentionPicked && value.endsWith('@'))
  }, [value, canMention, mentionPicked])

  async function submit() {
    const text = value.trim()
    if (!text || disabled || sending || cooling) return
    const mentions: 'ai'[] = canMention && mentionPicked ? ['ai'] : []
    const pickedMention = mentionPicked
    setSending(true)
    // 这条草稿已经发出去，提及状态跟着草稿一起结束；
    // 之后粘贴进来的内容属于新草稿，不能继承这次的 AI 提及
    setValue('')
    setMentionPicked(false)
    setShowMention(false)
    const ok = await onSend(text, mentions)
    setSending(false)
    if (ok) return
    // 失败时只在输入框还空着的时候补回原文；用户已经在写下一句就别覆盖
    const current = inputRef.current?.value ?? ''
    const restore = current.trim().length === 0
    setValue(restore ? text : current)
    // 提及只跟原文一起还原：新草稿不能继承上一条的 AI 提及
    if (restore && pickedMention) setMentionPicked(true)
    inputRef.current?.focus()
  }

  function pickMention() {
    setValue((prev) => prev.replace(/@$/, '@AI '))
    setMentionPicked(true)
    setShowMention(false)
    inputRef.current?.focus()
  }

  const sendDisabled = disabled || sending || cooling || value.trim().length === 0

  return (
    <div className="relative shrink-0 pt-3">
      {showMention && (
        <button
          type="button"
          onClick={pickMention}
          className="absolute bottom-16 left-0 z-20 flex items-baseline gap-2 rounded-2xl border-[1.5px] border-rule bg-paper px-3.5 py-2 text-left shadow-lift"
        >
          <span className="text-[13px] font-semibold text-[#3f6156]">AI 导播</span>
          <span className="text-[11.5px] text-muted">让导播接一句</span>
        </button>
      )}

      <div className="mt-3 flex items-center gap-2 rounded-[16px] border-[1.5px] border-rule bg-card py-1.5 pl-3.5 pr-1.5 transition-shadow focus-within:border-[rgba(96,166,150,.7)] focus-within:shadow-[0_0_0_4px_rgba(124,185,168,.14)]">
        <input
          ref={inputRef}
          value={value}
          disabled={disabled || cooling}
          onChange={(event) => {
            const next = event.target.value
            setValue(next)
            if (mentionPicked && !next.includes('@AI')) setMentionPicked(false)
          }}
          onKeyDown={(event) => {
            // 中文输入法选词时的回车不算发送
            if (event.nativeEvent.isComposing) return
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault()
              void submit()
            }
          }}
          placeholder={
            cooling && cooldownLeft !== null
              ? `发得太快了，${cooldownLeft} 秒后再发`
              : canMention
                ? '说点什么，输入 @ 可以让导播接一句'
                : '说点什么'
          }
          className="min-w-0 flex-1 bg-transparent py-1.5 text-[14px] text-ink-2 outline-none placeholder:text-faint disabled:opacity-60"
        />
        <button
          type="button"
          onClick={() => void submit()}
          disabled={sendDisabled}
          className="rounded-[12px] bg-sage-deep px-5 py-2 text-[13px] font-semibold text-white shadow-soft transition-colors hover:bg-[#549c8b] disabled:opacity-50"
        >
          {sending ? '发送中…' : cooling && cooldownLeft !== null ? `${cooldownLeft}s` : '发送'}
        </button>
      </div>
    </div>
  )
}
