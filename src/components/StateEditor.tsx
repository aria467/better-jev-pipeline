import { useEffect, useRef, useState } from 'react'
import type { JSX } from 'react'
import { X } from 'lucide-react'
import type { JsonArray, JsonObject, StateValue } from '../lib/types'
import { JsonEditor } from './JsonEditor'
import { VariableMenu } from './VariableMenu'
import type { VariableGroup } from './VariableMenu'

interface StateEditorProps {
  nodeId: string
  value: StateValue
  variables: VariableGroup[]
  onChange: (value: StateValue) => void
}

type Mode = 'text' | 'json'

function isStructured(value: unknown): value is JsonObject | JsonArray {
  return typeof value === 'object' && value !== null
}

function pretty(value: JsonObject | JsonArray): string {
  return JSON.stringify(value, null, 2)
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export function StateEditor({
  nodeId,
  value,
  variables,
  onChange,
}: StateEditorProps): JSX.Element {
  const [mode, setMode] = useState<Mode>(typeof value === 'string' ? 'text' : 'json')
  const [text, setText] = useState<string>(() =>
    typeof value === 'string' ? value : pretty(value),
  )
  const [jsonText, setJsonText] = useState<string>(() =>
    isStructured(value) ? pretty(value) : '',
  )
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    setText((previous) => {
      if (typeof value === 'string') return previous === value ? previous : value
      const next = pretty(value)
      return previous === next ? previous : next
    })
    if (isStructured(value)) {
      setJsonText((previous) => {
        try {
          if (JSON.stringify(JSON.parse(previous)) === JSON.stringify(value)) {
            return previous
          }
        } catch {
          // 草稿尚不可解析，直接采用外部值。
        }
        return pretty(value)
      })
    }
  }, [value])

  const switchToJson = () => {
    if (mode === 'json') return
    let next: JsonObject | JsonArray
    let wrapped = false
    try {
      const parsed: unknown = JSON.parse(text)
      if (!isStructured(parsed)) throw new Error('not structured')
      next = parsed
    } catch {
      next = { text }
      wrapped = true
    }
    setJsonText(pretty(next))
    setMode('json')
    setError(null)
    setNotice(
      wrapped ? '文本无法解析为对象或数组，已包装为 { "text": … }。' : null,
    )
    onChange(next)
  }

  const switchToText = () => {
    if (mode === 'text') return
    const nextText = typeof value === 'string' ? value : pretty(value)
    setText(nextText)
    setMode('text')
    setError(null)
    setNotice(null)
    if (typeof value !== 'string') onChange(nextText)
  }

  const handleTextChange = (next: string) => {
    setText(next)
    onChange(next)
  }

  const handleJsonChange = (next: string) => {
    setJsonText(next)
    try {
      const parsed: unknown = JSON.parse(next)
      if (!isStructured(parsed)) {
        setError('顶层需要是对象或数组')
        return
      }
      setError(null)
      onChange(parsed)
    } catch (caught) {
      setError(`JSON 解析失败：${messageOf(caught)}`)
    }
  }

  const formatJson = () => {
    try {
      const parsed: unknown = JSON.parse(jsonText)
      if (!isStructured(parsed)) {
        setError('顶层需要是对象或数组')
        return
      }
      setJsonText(pretty(parsed))
      setError(null)
      onChange(parsed)
    } catch (caught) {
      setError(`JSON 解析失败：${messageOf(caught)}`)
    }
  }

  const insertVariable = (template: string) => {
    if (mode === 'text') {
      const element = textareaRef.current
      const start = element?.selectionStart ?? text.length
      const end = element?.selectionEnd ?? start
      const next = `${text.slice(0, start)}${template}${text.slice(end)}`
      setText(next)
      setNotice(null)
      onChange(next)
      requestAnimationFrame(() => {
        const target = textareaRef.current
        if (!target) return
        target.focus()
        const cursor = start + template.length
        target.setSelectionRange(cursor, cursor)
      })
      return
    }
    const next = `${jsonText}${jsonText === '' || jsonText.endsWith('\n') ? '' : '\n'}${template}`
    setJsonText(next)
    setNotice('变量已追加到 JSON 末尾，请放进字符串中；也可以切到文本模式，在光标处插入。')
  }

  return (
    <section className="insp-editor" aria-label={`State 编辑器（节点 ${nodeId}）`}>
      <div className="insp-editor-head">
        <span className="insp-editor-title">状态</span>
        <div className="insp-editor-tools">
          <div className="insp-mode" role="group" aria-label="State 编辑模式">
            <button
              type="button"
              className={`insp-mode-btn${mode === 'text' ? ' is-active' : ''}`}
              aria-pressed={mode === 'text'}
              onClick={switchToText}
            >
              文本
            </button>
            <button
              type="button"
              className={`insp-mode-btn${mode === 'json' ? ' is-active' : ''}`}
              aria-pressed={mode === 'json'}
              onClick={switchToJson}
            >
              JSON
            </button>
          </div>
          <VariableMenu variables={variables} onInsert={insertVariable} />
        </div>
      </div>
      {notice ? (
        <div className="insp-notice">
          <span>{notice}</span>
          <button
            type="button"
            className="insp-notice-close"
            aria-label="关闭提示"
            onClick={() => setNotice(null)}
          >
            <X size={12} strokeWidth={1.5} aria-hidden="true" />
          </button>
        </div>
      ) : null}
      {mode === 'text' ? (
        <>
          <textarea
            ref={textareaRef}
            className="insp-textarea insp-state-text"
            rows={8}
            value={text}
            onChange={(event) => handleTextChange(event.target.value)}
            placeholder="输入发送给 Jev 的 state 文本，或使用变量插入上游结果。"
            spellCheck={false}
            aria-label={`State 文本（节点 ${nodeId}）`}
          />
          <div className="insp-editor-foot">
            <span className="insp-hint">
              字符串会原样作为 state 发送；开启上游注入时会包装为 {'{ text, upstream }'}。
            </span>
          </div>
        </>
      ) : (
        <>
          <JsonEditor
            value={jsonText}
            onChange={handleJsonChange}
            height={224}
            ariaLabel={`State JSON（节点 ${nodeId}）`}
          />
          {error ? <p className="insp-error-text">{error}</p> : null}
          <div className="insp-editor-foot">
            <span className="insp-hint">只有合法的对象或数组会写入 store。</span>
            <div className="insp-editor-actions">
              <button type="button" className="insp-link-btn" onClick={formatJson}>
                格式化
              </button>
            </div>
          </div>
        </>
      )}
    </section>
  )
}
