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

export function ChatFeed({ messages }: ChatFeedProps) {
  return (
    <div className="flex min-h-0 flex-1 flex-col justify-end gap-2.5 overflow-y-auto pb-1 no-scrollbar">
      {messages.map((message) => {
        if (message.kind === 'ai') {
          const pending = message.status === 'streaming'
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
                <p className="mt-0.5 text-[14.5px] leading-relaxed text-[#314a43]">
                  {message.text}
                  {pending && <span className="ml-0.5 inline-block h-4 w-0.5 animate-pulse bg-sage-deep align-[-2px]" />}
                </p>
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
  )
}
