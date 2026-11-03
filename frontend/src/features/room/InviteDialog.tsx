import { useEffect, useState } from 'react'

interface InviteDialogProps {
  open: boolean
  joinPath: string
  onClose: () => void
}

/** 二维码先用一个确定性的占位图，接入后换成真实 joinPath 生成的码。 */
function QrPlaceholder() {
  const size = 25
  const cell = 6
  const seedRef = { value: 20261103 }
  const rnd = () => {
    seedRef.value = (seedRef.value * 1103515245 + 12345) & 0x7fffffff
    return seedRef.value / 0x7fffffff
  }
  const cells: string[] = []
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const inFinder = (x < 8 && y < 8) || (x > size - 9 && y < 8) || (x < 8 && y > size - 9)
      if (!inFinder && rnd() > 0.52) {
        cells.push(`M${x * cell} ${y * cell}h${cell}v${cell}h-${cell}z`)
      }
    }
  }
  const finder = (fx: number, fy: number) =>
    `M${fx * cell} ${fy * cell}h${7 * cell}v${7 * cell}h-${7 * cell}z` +
    `M${(fx + 1) * cell} ${(fy + 1) * cell}h${5 * cell}v${5 * cell}h-${5 * cell}z`

  return (
    <svg viewBox={`0 0 ${size * cell} ${size * cell}`} className="h-full w-full" shapeRendering="crispEdges">
      <rect width={size * cell} height={size * cell} fill="#fffdf7" />
      <path d={cells.join('')} fill="#3a3226" />
      <path d={finder(0, 0) + finder(size - 7, 0) + finder(0, size - 7)} fill="#3a3226" fillRule="evenodd" />
    </svg>
  )
}

export function InviteDialog({ open, joinPath, onClose }: InviteDialogProps) {
  const [copied, setCopied] = useState(false)
  const url = `${window.location.origin}${joinPath}`

  useEffect(() => {
    if (!open) setCopied(false)
  }, [open])

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-[rgba(58,50,38,.26)] backdrop-blur-[4px]"
      onClick={onClose}
    >
      <div
        className="w-[372px] rounded-[30px] border-[1.5px] border-rule bg-paper px-6 pb-5 pt-6 text-center shadow-[0_30px_60px_-24px_rgba(92,64,51,.5)]"
        onClick={(event) => event.stopPropagation()}
      >
        <h3 className="text-[17px] font-bold text-[#33291d]">邀请朋友进来</h3>
        <p className="mt-1 text-[12.5px] text-muted">扫一下，或者把链接发给他</p>
        <div className="mx-auto my-4 h-[190px] w-[190px] rounded-[18px] border border-rule bg-card p-2.5">
          <QrPlaceholder />
        </div>
        <div className="flex items-center gap-2 overflow-hidden rounded-xl border border-rule bg-[#f2ead8] px-2.5 py-2 font-mono text-[11px] text-muted">
          <span className="flex-1 truncate text-left">{url}</span>
        </div>
        <div className="mt-4 flex gap-2.5">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 rounded-2xl border-[1.5px] border-[rgba(96,166,150,.5)] py-2.5 text-[13px] text-ink-2"
          >
            关闭
          </button>
          <button
            type="button"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(url)
              } catch {
                /* 剪贴板不可用时保持静默，链接仍然可见可复制 */
              }
              setCopied(true)
              window.setTimeout(() => setCopied(false), 1600)
            }}
            className="flex-1 rounded-2xl bg-sage-deep py-2.5 text-[13px] font-semibold text-white"
          >
            {copied ? '已复制' : '复制链接'}
          </button>
        </div>
      </div>
    </div>
  )
}
