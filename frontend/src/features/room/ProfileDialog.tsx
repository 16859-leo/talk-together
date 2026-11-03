import type { ReactNode } from 'react'
import type { ValidationPolicy } from '../../shared/api/types'
import { ProfileForm, type JoinValues } from '../join/ProfileForm'

interface ProfileDialogProps {
  open: boolean
  title: string
  description: string
  policy: ValidationPolicy
  initial: JoinValues
  submitting: boolean
  serverError: string | null
  fieldErrors: Record<string, string>
  submitLabel: string
  submitNote: ReactNode
  onClose: () => void
  onSubmit: (values: JoinValues) => void | Promise<void>
}

/** 改资料用的弹层，表单本身和入房页共用。 */
export function ProfileDialog({
  open,
  title,
  description,
  policy,
  initial,
  submitting,
  serverError,
  fieldErrors,
  submitLabel,
  submitNote,
  onClose,
  onSubmit,
}: ProfileDialogProps) {
  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center overflow-y-auto bg-[rgba(58,50,38,.26)] px-4 py-8 backdrop-blur-[4px]"
      onClick={onClose}
    >
      <div className="w-full max-w-[520px]" onClick={(event) => event.stopPropagation()}>
        <div className="mb-3 text-center">
          <h3 className="text-[17px] font-bold text-[#33291d]">{title}</h3>
          <p className="mt-1 text-[12.5px] text-muted">{description}</p>
        </div>
        <ProfileForm
          policy={policy}
          submitting={submitting}
          serverError={serverError}
          fieldErrors={fieldErrors}
          submitLabel={submitLabel}
          submitNote={submitNote}
          initial={initial}
          onSubmit={onSubmit}
        />
        <div className="mt-3 text-center">
          <button
            type="button"
            onClick={onClose}
            className="rounded-full px-4 py-1.5 text-[12.5px] text-muted hover:text-ink"
          >
            取消
          </button>
        </div>
      </div>
    </div>
  )
}
