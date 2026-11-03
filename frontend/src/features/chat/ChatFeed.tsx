import { useEffect, useRef } from 'react'
import type { Message } from '../../shared/api/types'
import { Avatar } from '../../shared/ui/Avatar'
import { personColor } from '../../shared/ui/personColor'

interface ChatFeedProps {
  messages: Message[]
}

function timeLabel(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}

/** AI 回复的收尾状态文案：失败/取消要明确说出来，别让半截文字冒充完整回答。 */
function aiStateNote(message: Extract<Message, { kind: 'ai' }>): string | null {
  if (message.status === 'failed') {
    return message.error?.message ? `生成失败：${message.error.message}` : '生成失败'
  }
  if (message.status === 'cancelled') return '已取消，这条没生成完'
  return null
}

export function ChatFeed({ messages }: ChatFeedProps) {
  const scrollerRef = useRef<HTMLDivElement>(null)

  // 新消息进来时贴到底部；历史消息仍可向上滚动查看
  useEffect(() => {
    const node = scrollerRef.current
    if (node) node.scrollTop = node.scrollHeight
  }, [messages.length, messages[messages.length - 1]?.id])

  if (messages.length === 0) {
    return (
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-1.5 text-center">
        <p className="text-[13.5px] text-muted">还没有人开口</p>
        <p className="text-[12px] text-faint">
          先说一句「大家好」，或者让房主叫导播起个话题。
        </p>
      </div>
    )
  }

  return (
    <div
      ref={scrollerRef}
      className="min-h-0 flex-1 overflow-y-auto pb-1 no-scrollbar"
    >
      <div className="flex min-h-full flex-col justify-end gap-2.5">
        {messages.map((message) => {
          if (message.kind === 'ai') {
            const pending = message.status === 'streaming'
            const note = aiStateNote(message)
            const empty = message.text.trim().length === 0
            return (
              <div key={message.id} className="w-full">
                <div className="max-w-[70ch] rounded-[22px_22px_8px_22px] border-[1.5px] border-dashed border-[rgba(95,165,147,.6)] bg-card px-4 py-2.5">
                  <div className="flex items-baseline gap-2">
                    <span className="rounded-full bg-[rgba(124,185,168,.45)] px-2 text-[10.5px] font-bold tracking-[.08em] text-[#33524a]">
                      AI
                    </span>
                    <span className="text-[13px] font-semibold text-[#3f6156]">导播</span>
                    {message.caller && (
                      <span className="text-[11.5px] text-muted">回应 {message.caller.nickname}</span>
                    )}
                    <span className="text-[11.5px] text-muted">{timeLabel(message.createdAt)}</span>
                  </div>
                  {empty && note ? (
                    <p className="mt-0.5 text-[13.5px] italic leading-relaxed text-[#7d6a55]">
                      {note}
                    </p>
                  ) : (
                    <p className="mt-0.5 text-[14.5px] leading-relaxed text-[#314a43]">
                      {message.text}
                      {pending && (
                        <span className="ml-0.5 inline-block h-4 w-0.5 animate-pulse bg-sage-deep align-[-2px]" />
                      )}
                    </p>
                  )}
                  {note && !empty && (
                    <p className="mt-1 text-[11.5px] text-[#8a5a34]">· {note}</p>
                  )}
                </div>
              </div>
            )
          }

          const color = personColor(message.author.memberId)
          return (
            <div key={message.id} className="grid grid-cols-[36px_minmax(0,1fr)] items-start gap-2.5">
              <Avatar memberId={message.author.memberId} nickname={message.author.nickname} size={36} />
              <div
                className="max-w-[64ch] justify-self-start rounded-[20px_20px_20px_8px] border px-3.5 py-2"
                style={{
                  background: color.c2,
                  borderColor: `${color.c1}40`,
                  boxShadow: '0 1px 4px rgba(124,185,168,.1)',
                }}
              >
                <div className="flex items-baseline gap-2">
                  <span className="text-[13px] font-semibold" style={{ color: color.c3 }}>
                    {message.author.nickname}
                  </span>
                  <span className="text-[11.5px] text-muted">{timeLabel(message.createdAt)}</span>
                </div>
                <p className="mt-0.5 text-[14px] leading-relaxed text-[#443a2d]">{message.text}</p>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
