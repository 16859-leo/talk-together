import { useEffect, useRef, useState } from 'react'

interface ComposerProps {
  canMention: boolean
  disabled?: boolean
  onSend: (text: string, mentions: 'ai'[]) => void
}

export function Composer({ canMention, disabled, onSend }: ComposerProps) {
  const [value, setValue] = useState('')
  const [showMention, setShowMention] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    setShowMention(canMention && value.endsWith('@'))
  }, [value, canMention])

  function submit() {
    const text = value.trim()
    if (!text || disabled) return
    onSend(text, canMention && /@AI/i.test(text) ? ['ai'] : [])
    setValue('')
    setShowMention(false)
  }

  function pickMention() {
    setValue((prev) => prev.replace(/@$/, '@AI '))
    setShowMention(false)
    inputRef.current?.focus()
  }

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

      <div className="flex items-center gap-2 border-t-[1.5px] border-[rgba(90,74,58,.45)] pt-2.5">
        <input
          ref={inputRef}
          value={value}
          disabled={disabled}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault()
              submit()
            }
          }}
          placeholder={canMention ? '说点什么，输入 @ 可以让导播接一句' : '说点什么'}
          className="min-w-0 flex-1 bg-transparent px-0.5 py-1.5 text-[14px] text-ink-2 outline-none placeholder:text-faint disabled:opacity-60"
        />
        <button
          type="button"
          onClick={submit}
          disabled={disabled || value.trim().length === 0}
          className="rounded-[13px] bg-sage-deep px-5 py-2 text-[13px] font-semibold text-white shadow-soft transition-colors hover:bg-[#549c8b] disabled:opacity-50"
        >
          发送
        </button>
      </div>

      <div className="mt-1.5 flex justify-between text-[11px] text-muted">
        <span>{canMention ? '仅房主可以调用 AI' : '成员不能主动调用 AI'}</span>
        <span>Enter 发送 · Shift + Enter 换行</span>
      </div>
    </div>
  )
}
