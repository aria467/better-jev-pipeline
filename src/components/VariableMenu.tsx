import { useEffect, useRef, useState } from 'react'
import type { JSX } from 'react'
import { Braces } from 'lucide-react'
import type { VariableGroup } from '../lib/variables'

export type { VariableGroup } from '../lib/variables'

interface VariableMenuProps {
  variables: VariableGroup[]
  onInsert: (template: string) => void
  label?: string
  disabled?: boolean
}

export function VariableMenu({
  variables,
  onInsert,
  label = '变量',
  disabled = false,
}: VariableMenuProps): JSX.Element {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const available = variables.some((group) => group.items.length > 0)
  const isDisabled = disabled || !available

  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        setOpen(false)
      }
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  useEffect(() => {
    if (isDisabled) setOpen(false)
  }, [isDisabled])

  return (
    <div className="insp-varmenu" ref={rootRef}>
      <button
        type="button"
        className="insp-var-trigger"
        onClick={() => setOpen((value) => !value)}
        disabled={isDisabled}
        aria-haspopup="menu"
        aria-expanded={open}
        title={isDisabled ? '上游还没有运行结果' : '插入上游运行结果变量'}
      >
        <Braces size={13} strokeWidth={1.5} aria-hidden="true" />
        <span>{label}</span>
      </button>
      {open && !isDisabled ? (
        <div className="insp-var-pop" role="menu">
          {variables
            .filter((group) => group.items.length > 0)
            .map((group) => (
              <div className="insp-var-group" key={group.nodeId}>
                <div className="insp-var-group-title">{group.title}</div>
                {group.items.map((item) => (
                  <button
                    type="button"
                    role="menuitem"
                    className="insp-var-item"
                    key={`${group.nodeId}-${item.template}`}
                    onClick={() => {
                      onInsert(item.template)
                      setOpen(false)
                    }}
                  >
                    <span className="insp-var-item-label">{item.label}</span>
                    <code className="insp-var-item-code">{item.template}</code>
                  </button>
                ))}
              </div>
            ))}
        </div>
      ) : null}
    </div>
  )
}
