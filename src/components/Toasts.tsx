import { AlertTriangle, Check, Info, X } from 'lucide-react'
import { useStudio } from '../lib/store'

export function Toasts() {
  const toasts = useStudio((state) => state.toasts)
  const dismiss = useStudio((state) => state.dismissToast)

  if (!toasts.length) return null

  return (
    <div className="toasts" role="status" aria-live="polite">
      {toasts.map((toast) => (
        <div className={`toast toast-${toast.kind}`} key={toast.id}>
          <span className="toast-icon">
            {toast.kind === 'error' ? (
              <AlertTriangle size={16} strokeWidth={1.5} />
            ) : toast.kind === 'success' ? (
              <Check size={16} strokeWidth={1.6} />
            ) : (
              <Info size={16} strokeWidth={1.5} />
            )}
          </span>
          <span className="toast-message">{toast.message}</span>
          <button className="toast-close" type="button" onClick={() => dismiss(toast.id)} title="关闭">
            <X size={14} strokeWidth={1.5} />
          </button>
        </div>
      ))}
    </div>
  )
}
