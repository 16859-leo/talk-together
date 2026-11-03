import { useEffect, useState } from 'react'
import QRCode from 'qrcode'

interface InviteDialogProps {
  open: boolean
  joinPath: string
  onClose: () => void
}

/** 用真实的邀请地址生成二维码，和「复制链接」用的是同一个 url。 */
function QrCode({ value }: { value: string }) {
  const [svg, setSvg] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    QRCode.toString(value, { type: 'svg', margin: 0, errorCorrectionLevel: 'M' })
      .then((markup) => {
        if (alive) setSvg(markup)
      })
      .catch(() => {
        if (alive) setSvg(null)
      })
    return () => {
      alive = false
    }
  }, [value])

  if (!svg) {
    return <div className="grid h-full w-full place-items-center text-[11px] text-faint">二维码生成中…</div>
  }

  return (
    <div
      className="h-full w-full [&>svg]:h-full [&>svg]:w-full"
      // 内容来自本端的 qrcode 序列化结果，不含用户输入以外的标记
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  )
}

export function InviteDialog({ open, joinPath, onClose }: InviteDialogProps) {
  const [copied, setCopied] = useState(false)
  const [copyFailed, setCopyFailed] = useState(false)
  const url = `${window.location.origin}${joinPath}`

  useEffect(() => {
    if (!open) {
      setCopied(false)
      setCopyFailed(false)
    }
  }, [open])

  if (!open) return null

  async function copy() {
    setCopyFailed(false)
    try {
      // 非安全来源没有 clipboard API，直接走失败分支提示手动复制
      if (!navigator.clipboard?.writeText) throw new Error('clipboard unavailable')
      await navigator.clipboard.writeText(url)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1600)
    } catch {
      setCopied(false)
      setCopyFailed(true)
    }
  }

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
          <QrCode value={url} />
        </div>
        <div className="flex items-center gap-2 overflow-hidden rounded-xl border border-rule bg-[#f2ead8] px-2.5 py-2 font-mono text-[11px] text-muted">
          <input
            readOnly
            value={url}
            onFocus={(event) => event.currentTarget.select()}
            className="min-w-0 flex-1 bg-transparent text-left outline-none"
          />
        </div>
        {copyFailed && (
          <p className="mt-2 text-[11.5px] text-brick">
            这个环境不让写剪贴板，选中上面的链接手动复制吧
          </p>
        )}
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
            onClick={() => void copy()}
            className="flex-1 rounded-2xl bg-sage-deep py-2.5 text-[13px] font-semibold text-white"
          >
            {copied ? '已复制' : '复制链接'}
          </button>
        </div>
      </div>
    </div>
  )
}
