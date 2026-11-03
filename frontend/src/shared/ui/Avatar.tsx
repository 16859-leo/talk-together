import { personColor } from './personColor'

interface AvatarProps {
  memberId: string
  nickname: string
  size?: number
  muted?: boolean
}

export function Avatar({ memberId, nickname, size = 36, muted = false }: AvatarProps) {
  const color = personColor(memberId)
  const glyph = /[\u4e00-\u9fa5]/.test(nickname)
    ? nickname.slice(-1)
    : nickname.slice(0, 1).toUpperCase()
  return (
    <span
      aria-hidden="true"
      className="grid shrink-0 place-items-center border-[1.5px] font-medium"
      style={{
        width: size,
        height: size,
        fontSize: Math.round(size * 0.36),
        color: muted ? 'var(--color-muted)' : color.c3,
        background: muted ? 'transparent' : color.c2,
        borderColor: muted ? '#c3a683' : color.c1,
        borderStyle: muted ? 'dashed' : 'solid',
        borderRadius: '52% 48% 45% 55% / 48% 52% 48% 52%',
      }}
    >
      {glyph}
    </span>
  )
}
