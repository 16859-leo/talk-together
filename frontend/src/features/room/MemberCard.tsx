import type { ActiveMember } from '../../shared/api/types'
import { Avatar } from '../../shared/ui/Avatar'
import { personColor } from '../../shared/ui/personColor'

interface MemberCardProps {
  member: ActiveMember
  isSelf: boolean
  canRemove?: boolean
  onRemove?: (member: ActiveMember) => void
  /** 外部传入的「现在」，让倒计时每秒会走 */
  now?: number
}

function countdown(iso: string | null, now: number): string | null {
  if (!iso) return null
  const left = new Date(iso).getTime() - now
  if (left <= 0) return '0:00'
  const seconds = Math.floor(left / 1000)
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
}

export function MemberCard({ member, isSelf, canRemove, onRemove, now = Date.now() }: MemberCardProps) {
  const color = personColor(member.id)
  const presence = member.membership?.presence ?? 'connecting'
  const offline = presence === 'offline'
  const left = offline ? countdown(member.membership?.recoveryExpiresAt ?? null, now) : null

  return (
    <div
      className="group relative flex w-full items-start gap-2.5 rounded-2xl border-[1.5px] px-3 py-2.5 transition-transform duration-500 hover:-translate-y-0.5"
      style={{
        borderColor: offline ? 'rgba(192,127,80,.55)' : color.c1,
        borderStyle: offline ? 'dashed' : 'solid',
        background: offline ? 'transparent' : color.c2,
        boxShadow: isSelf ? `0 0 0 3px ${color.c1}22` : undefined,
      }}
    >
      <Avatar memberId={member.id} nickname={member.profile.nickname} size={32} muted={offline} />
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5">
          <span className="text-[13.5px] font-semibold" style={{ color: color.c3 }}>
            {member.profile.nickname}
          </span>
          {member.role === 'host' && (
            <span
              className="rounded-full px-1.5 text-[10px] font-semibold text-white"
              style={{ background: color.c1 }}
            >
              房主
            </span>
          )}
          {isSelf && <span className="text-[10px] text-muted">你</span>}
        </span>
        <span className="mt-1 flex flex-wrap gap-1">
          {member.profile.interestTags.map((tag) => (
            <span
              key={tag}
              className="rounded-full border px-2 text-[11px] leading-[1.7]"
              style={{
                color: color.c3,
                background: 'rgba(255,253,247,.9)',
                borderColor: `${color.c1}44`,
              }}
            >
              {tag}
            </span>
          ))}
        </span>
      </span>
      <span className="absolute right-2.5 top-2.5 flex items-center gap-1.5 text-[10px] text-muted">
        {offline ? (left ?? '掉线') : '在线'}
        <i
          className="block h-1.5 w-1.5 rounded-full"
          style={{
            background: offline ? 'transparent' : color.c1,
            border: offline ? '1.5px solid var(--color-coral)' : undefined,
          }}
        />
      </span>

      {canRemove && onRemove && (
        <button
          type="button"
          onClick={() => onRemove(member)}
          className="absolute bottom-2 right-2.5 rounded-full border border-[rgba(177,105,74,.35)] bg-[rgba(255,253,247,.9)] px-2 py-0.5 text-[10.5px] text-brick opacity-0 transition-opacity duration-300 focus-visible:opacity-100 group-hover:opacity-100"
        >
          移出
        </button>
      )}
    </div>
  )
}
