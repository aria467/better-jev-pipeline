import { useEffect, useRef, useState } from 'react'
import type { JSX } from 'react'
import { Check, ChevronRight, Copy, Download } from 'lucide-react'
import type { JsonArray, JsonObject, JsonPrimitive, JsonValue } from '../lib/types'
import './json.css'

const STRING_LIMIT = 200
const PATH_SEPARATOR = '\u0000'

function isContainer(value: JsonValue): value is JsonObject | JsonArray {
  return typeof value === 'object' && value !== null
}

function entriesOf(container: JsonObject | JsonArray): Array<[string, JsonValue]> {
  return Object.entries(container) as Array<[string, JsonValue]>
}

function joinPath(parent: string, key: string): string {
  return `${parent}${PATH_SEPARATOR}${key}`
}

function initialExpanded(value: JsonValue, maxDepth: number): Set<string> {
  const expanded = new Set<string>()
  if (!isContainer(value)) return expanded
  for (const [key, child] of entriesOf(value)) {
    collectExpanded(child, maxDepth, joinPath('root', key), 0, expanded)
  }
  return expanded
}

function collectExpanded(
  value: JsonValue,
  maxDepth: number,
  path: string,
  depth: number,
  out: Set<string>,
): void {
  if (!isContainer(value)) return
  if (depth >= maxDepth) return
  const entries = entriesOf(value)
  if (entries.length === 0) return
  out.add(path)
  for (const [key, child] of entries) {
    collectExpanded(child, maxDepth, joinPath(path, key), depth + 1, out)
  }
}

function collectAll(value: JsonValue, path: string, out: Set<string>): void {
  if (!isContainer(value)) return
  const entries = entriesOf(value)
  if (entries.length === 0) return
  out.add(path)
  for (const [key, child] of entries) {
    collectAll(child, joinPath(path, key), out)
  }
}

function allExpanded(value: JsonValue): Set<string> {
  const expanded = new Set<string>()
  if (!isContainer(value)) return expanded
  for (const [key, child] of entriesOf(value)) {
    collectAll(child, joinPath('root', key), expanded)
  }
  return expanded
}

function PrimitiveValue(props: { value: JsonPrimitive }): JSX.Element {
  const { value } = props
  if (typeof value === 'string') {
    const full = JSON.stringify(value)
    const truncated = full.length > STRING_LIMIT
    return (
      <span
        className="json-tree-value json-value-string"
        title={truncated ? full : undefined}
      >
        {truncated ? `${full.slice(0, STRING_LIMIT)}…` : full}
      </span>
    )
  }
  if (typeof value === 'number') {
    return (
      <span className="json-tree-value json-value-number">
        {Number.isFinite(value) ? String(value) : 'null'}
      </span>
    )
  }
  if (typeof value === 'boolean') {
    return <span className="json-tree-value json-value-boolean">{String(value)}</span>
  }
  return <span className="json-tree-value json-value-null">null</span>
}

function containerSummary(value: JsonObject | JsonArray): string {
  const count = entriesOf(value).length
  if (Array.isArray(value)) return count === 0 ? '[]' : `[${count}]`
  return count === 0 ? '{}' : `{${count}}`
}

function TreeRows(props: {
  value: JsonValue
  depth: number
  parentPath: string
  expanded: Set<string>
  onToggle: (path: string) => void
}): JSX.Element {
  const { value, depth, parentPath, expanded, onToggle } = props

  if (!isContainer(value)) {
    return (
      <div className="json-tree-row" style={{ paddingLeft: depth * 16 }}>
        <span className="json-tree-toggle json-tree-toggle-empty" aria-hidden="true" />
        <PrimitiveValue value={value} />
      </div>
    )
  }

  const entries = entriesOf(value)
  const isArray = Array.isArray(value)

  if (entries.length === 0) {
    return (
      <div className="json-tree-row" style={{ paddingLeft: depth * 16 }}>
        <span className="json-tree-toggle json-tree-toggle-empty" aria-hidden="true" />
        <span className="json-tree-empty">{isArray ? '[]' : '{}'}</span>
      </div>
    )
  }

  return (
    <>
      {entries.map(([key, child]) => {
        const path = joinPath(parentPath, key)
        const childIsContainer = isContainer(child)
        const childCount = childIsContainer ? entriesOf(child).length : 0
        const expandable = childIsContainer && childCount > 0
        const open = expandable && expanded.has(path)
        return (
          <div className="json-tree-node" key={path}>
            <div className="json-tree-row" style={{ paddingLeft: depth * 16 }}>
              {expandable ? (
                <button
                  type="button"
                  className={`json-tree-toggle${open ? ' json-tree-toggle-open' : ''}`}
                  aria-expanded={open}
                  aria-label={open ? `折叠 ${key}` : `展开 ${key}`}
                  onClick={() => onToggle(path)}
                >
                  <ChevronRight size={13} strokeWidth={1.5} />
                </button>
              ) : (
                <span className="json-tree-toggle json-tree-toggle-empty" aria-hidden="true" />
              )}
              <span className={isArray ? 'json-tree-index' : 'json-tree-key'}>{key}</span>
              <span className="json-tree-colon">:</span>
              {childIsContainer ? (
                <span
                  className={`json-tree-summary${childCount === 0 ? ' json-tree-summary-empty' : ''}`}
                >
                  {containerSummary(child)}
                </span>
              ) : (
                <PrimitiveValue value={child} />
              )}
            </div>
            {open ? (
              <TreeRows
                value={child}
                depth={depth + 1}
                parentPath={path}
                expanded={expanded}
                onToggle={onToggle}
              />
            ) : null}
          </div>
        )
      })}
    </>
  )
}

export function JsonTree(props: {
  value: JsonValue
  defaultExpandDepth?: number
  maxHeight?: number
  toolbar?: boolean
}): JSX.Element {
  const { value, defaultExpandDepth = 2, maxHeight, toolbar = false } = props
  const [expanded, setExpanded] = useState<Set<string>>(() =>
    initialExpanded(value, defaultExpandDepth),
  )
  const [copied, setCopied] = useState(false)
  const resetRef = useRef({ value, depth: defaultExpandDepth })
  const copyTimerRef = useRef<number | null>(null)

  useEffect(() => {
    const previous = resetRef.current
    if (previous.value !== value || previous.depth !== defaultExpandDepth) {
      resetRef.current = { value, depth: defaultExpandDepth }
      setExpanded(initialExpanded(value, defaultExpandDepth))
    }
  }, [value, defaultExpandDepth])

  useEffect(
    () => () => {
      if (copyTimerRef.current !== null) window.clearTimeout(copyTimerRef.current)
    },
    [],
  )

  const toggle = (path: string) => {
    setExpanded((previous) => {
      const next = new Set(previous)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
  }

  const copyJson = async () => {
    try {
      if (!navigator.clipboard?.writeText) return
      await navigator.clipboard.writeText(JSON.stringify(value, null, 2))
      setCopied(true)
      if (copyTimerRef.current !== null) window.clearTimeout(copyTimerRef.current)
      copyTimerRef.current = window.setTimeout(() => setCopied(false), 1500)
    } catch {
      // 剪贴板不可用时保持静默。
    }
  }

  const downloadJson = () => {
    const blob = new Blob([JSON.stringify(value, null, 2)], {
      type: 'application/json',
    })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')
    anchor.href = url
    anchor.download = `jev-json-${stamp}.json`
    anchor.style.display = 'none'
    document.body.appendChild(anchor)
    anchor.click()
    anchor.remove()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="json-tree">
      {toolbar ? (
        <div className="json-tree-toolbar">
          <button
            type="button"
            className="json-tree-btn"
            onClick={() => setExpanded(allExpanded(value))}
          >
            展开全部
          </button>
          <button
            type="button"
            className="json-tree-btn"
            onClick={() => setExpanded(new Set<string>())}
          >
            折叠全部
          </button>
          <button type="button" className="json-tree-btn" onClick={copyJson}>
            {copied ? (
              <Check size={13} strokeWidth={1.5} aria-hidden="true" />
            ) : (
              <Copy size={13} strokeWidth={1.5} aria-hidden="true" />
            )}
            {copied ? '已复制' : '复制 JSON'}
          </button>
          <button type="button" className="json-tree-btn" onClick={downloadJson}>
            <Download size={13} strokeWidth={1.5} aria-hidden="true" />
            下载 .json
          </button>
        </div>
      ) : null}
      <div
        className="json-tree-body"
        style={maxHeight !== undefined ? { maxHeight } : undefined}
      >
        <TreeRows
          value={value}
          depth={0}
          parentPath="root"
          expanded={expanded}
          onToggle={toggle}
        />
      </div>
    </div>
  )
}
