import { useEffect, useRef } from 'react'
import { Trash2, X } from 'lucide-react'
import { useDialogFocus } from './useDialogFocus'

interface DeleteScenarioDialogProps {
  open: boolean
  name: string
  onClose: () => void
  onConfirm: () => void
}

/** 删除自定义场景前的确认对话框；默认聚焦「取消」，避免误删。 */
export function DeleteScenarioDialog(props: DeleteScenarioDialogProps) {
  const { open, name, onClose, onConfirm } = props
  const { panelRef, closeRef } = useDialogFocus(open, onClose)
  const cancelRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!open) return
    const timer = window.setTimeout(() => cancelRef.current?.focus(), 30)
    return () => window.clearTimeout(timer)
  }, [open])

  if (!open) return null

  return (
    <div className="modal-backdrop" onMouseDown={() => closeRef.current()}>
      <div
        ref={panelRef}
        className="modal-panel"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="delete-scenario-title"
        aria-describedby="delete-scenario-desc"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="modal-head">
          <span className="modal-icon modal-icon-danger" aria-hidden="true">
            <Trash2 size={17} strokeWidth={1.5} />
          </span>
          <div className="modal-head-text">
            <h2 className="modal-title" id="delete-scenario-title">
              删除场景
            </h2>
            <p className="modal-desc" id="delete-scenario-desc">
              「{name}」将从浏览器中移除，无法恢复。需要保留请先导出场景 JSON。
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

        <div className="modal-actions">
          <button
            ref={cancelRef}
            className="btn btn-ghost"
            type="button"
            onClick={() => closeRef.current()}
          >
            取消
          </button>
          <button className="btn btn-stop" type="button" onClick={onConfirm}>
            删除场景
          </button>
        </div>
      </div>
    </div>
  )
}
