import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { X } from 'lucide-react'
import { useDialogFocus } from './useDialogFocus'

interface ScenarioNameDialogProps {
  open: boolean
  title: string
  description: ReactNode
  confirmLabel: string
  initialName: string
  existingNames: string[]
  failureMessage: string
  inputId?: string
  icon: ReactNode
  onClose: () => void
  onSubmit: (name: string) => boolean
}

const MAX_LENGTH = 40

/** 场景命名对话框：创建与重命名共用，含重名校验与焦点陷阱。 */
export function ScenarioNameDialog(props: ScenarioNameDialogProps) {
  const {
    open,
    title,
    description,
    confirmLabel,
    initialName,
    existingNames,
    failureMessage,
    inputId = 'scenario-name',
    icon,
    onClose,
    onSubmit,
  } = props

  const [name, setName] = useState(initialName)
  const [touched, setTouched] = useState(false)
  const [failed, setFailed] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const { panelRef, closeRef } = useDialogFocus(open, onClose)
  const initialRef = useRef(initialName)
  initialRef.current = initialName

  useEffect(() => {
    if (!open) return
    setName(initialRef.current)
    setTouched(false)
    setFailed(false)
    const timer = window.setTimeout(() => {
      inputRef.current?.focus()
      inputRef.current?.select()
    }, 30)
    return () => window.clearTimeout(timer)
  }, [open])

  if (!open) return null

  const trimmed = name.trim()
  const duplicate =
    trimmed.length > 0 && existingNames.some((item) => item.trim() === trimmed)
  const empty = trimmed.length === 0
  const showError = duplicate || (empty && touched) || failed
  const message = duplicate
    ? '已存在同名场景，请换一个名称。'
    : empty
      ? '请输入场景名称。'
      : failed
        ? failureMessage
        : '名称不能为空，且不能与现有场景重复。'
  const disabled = empty || duplicate

  const submit = () => {
    setTouched(true)
    if (disabled) return
    const ok = onSubmit(trimmed)
    if (!ok) {
      setFailed(true)
      return
    }
    closeRef.current()
  }

  return (
    <div className="modal-backdrop" onMouseDown={() => closeRef.current()}>
      <div
        ref={panelRef}
        className="modal-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${inputId}-title`}
        aria-describedby={`${inputId}-desc`}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="modal-head">
          <span className="modal-icon" aria-hidden="true">
            {icon}
          </span>
          <div className="modal-head-text">
            <h2 className="modal-title" id={`${inputId}-title`}>
              {title}
            </h2>
            <p className="modal-desc" id={`${inputId}-desc`}>
              {description}
            </p>
          </div>
          <button
            className="btn btn-icon modal-close"
            type="button"
            onClick={() => closeRef.current()}
            aria-label="关闭"
          >
            <X size={16} strokeWidth={1.5} />
          </button>
        </header>

        <form
          onSubmit={(event) => {
            event.preventDefault()
            submit()
          }}
        >
          <label className="modal-label" htmlFor={inputId}>
            场景名称
          </label>
          <input
            id={inputId}
            ref={inputRef}
            className={`modal-input${showError ? ' has-error' : ''}`}
            value={name}
            maxLength={MAX_LENGTH}
            placeholder="例如：退款工单专项"
            autoComplete="off"
            aria-invalid={showError}
            aria-describedby={`${inputId}-hint`}
            onChange={(event) => {
              setName(event.target.value)
              setFailed(false)
            }}
            onBlur={() => setTouched(true)}
          />
          <div className="modal-hint-row">
            <span
              id={`${inputId}-hint`}
              className={showError ? 'modal-error' : 'modal-hint'}
              aria-live="polite"
            >
              {message}
            </span>
            <span className="modal-count mono">
              {name.length}/{MAX_LENGTH}
            </span>
          </div>
          <div className="modal-actions">
            <button className="btn btn-ghost" type="button" onClick={() => closeRef.current()}>
              取消
            </button>
            <button className="btn btn-primary" type="submit" disabled={disabled}>
              {confirmLabel}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
