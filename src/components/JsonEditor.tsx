import { useEffect, useRef } from 'react'
import type { JSX } from 'react'
import { basicSetup } from 'codemirror'
import { EditorView } from '@codemirror/view'
import { EditorState } from '@codemirror/state'
import type { Extension } from '@codemirror/state'
import { json, jsonParseLinter } from '@codemirror/lang-json'
import { lintGutter, linter } from '@codemirror/lint'
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language'
import { tags } from '@lezer/highlight'
import './json.css'

const jsonHighlightStyle = HighlightStyle.define([
  { tag: tags.propertyName, color: '#1d4ed8' },
  { tag: tags.string, color: '#0f7b63' },
  { tag: tags.number, color: '#b45309' },
  { tag: tags.bool, color: '#7c3aed', fontWeight: '500' },
  { tag: tags.null, color: '#94a7bb' },
  { tag: tags.punctuation, color: '#60758c' },
  { tag: tags.separator, color: '#60758c' },
  { tag: tags.brace, color: '#60758c' },
  { tag: tags.invalid, color: '#b42318' },
])

const jsonEditorTheme = EditorView.theme(
  {
    '&': {
      height: '100%',
      backgroundColor: '#ffffff',
      color: '#12233a',
      fontSize: '12.5px',
    },
    '&.cm-focused': {
      outline: 'none',
    },
    '.cm-scroller': {
      fontFamily: 'var(--font-mono)',
      lineHeight: '1.65',
    },
    '.cm-content': {
      padding: '8px 0',
      caretColor: '#2563eb',
    },
    '.cm-line': {
      padding: '0 12px',
    },
    '.cm-gutters': {
      backgroundColor: '#fbfdff',
      color: '#94a7bb',
      border: 'none',
      borderRight: '1px solid #dfe8f4',
    },
    '.cm-lineNumbers .cm-gutterElement': {
      padding: '0 8px 0 10px',
      minWidth: '32px',
      fontSize: '11px',
    },
    '.cm-activeLine': {
      backgroundColor: 'rgba(219, 234, 254, 0.42)',
    },
    '.cm-activeLineGutter': {
      backgroundColor: 'rgba(219, 234, 254, 0.5)',
      color: '#1d4ed8',
    },
    '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection': {
      backgroundColor: 'rgba(147, 197, 253, 0.42)',
    },
    '.cm-cursor, .cm-dropCursor': {
      borderLeftColor: '#2563eb',
    },
    '.cm-lintRange-error': {
      textDecoration: 'underline wavy #b42318',
    },
    '.cm-tooltip': {
      border: '1px solid #dfe8f4',
      borderRadius: '7px',
      backgroundColor: '#ffffff',
      boxShadow: '0 8px 24px rgba(37, 99, 235, 0.07)',
    },
  },
  { dark: false },
)

export function JsonEditor(props: {
  value: string
  onChange?: (next: string) => void
  height?: number
  readOnly?: boolean
  ariaLabel?: string
}): JSX.Element {
  const { value, onChange, height = 260, readOnly = false, ariaLabel } = props
  const hostRef = useRef<HTMLDivElement | null>(null)
  const viewRef = useRef<EditorView | null>(null)
  const onChangeRef = useRef(onChange)
  const readOnlyRef = useRef(readOnly)
  const lastValueRef = useRef(value)
  const applyingExternalRef = useRef(false)

  onChangeRef.current = onChange
  readOnlyRef.current = readOnly
  lastValueRef.current = value

  useEffect(() => {
    const host = hostRef.current
    if (!host) return

    const extensions: Extension[] = [
      basicSetup,
      json(),
      linter(jsonParseLinter()),
      syntaxHighlighting(jsonHighlightStyle),
      jsonEditorTheme,
      EditorView.lineWrapping,
      EditorView.updateListener.of((update) => {
        if (!update.docChanged) return
        const next = update.state.doc.toString()
        lastValueRef.current = next
        if (!applyingExternalRef.current) onChangeRef.current?.(next)
      }),
    ]

    if (readOnly) {
      extensions.push(EditorState.readOnly.of(true), EditorView.editable.of(false))
    } else {
      extensions.push(lintGutter())
    }

    if (ariaLabel) {
      extensions.push(EditorView.contentAttributes.of({ 'aria-label': ariaLabel }))
    }

    const state = EditorState.create({
      doc: lastValueRef.current,
      extensions,
    })
    const view = new EditorView({ state, parent: host })
    viewRef.current = view

    return () => {
      view.destroy()
      viewRef.current = null
    }
  }, [readOnly, ariaLabel])

  useEffect(() => {
    const view = viewRef.current
    if (!view) return
    const current = view.state.doc.toString()
    if (current === value) return
    if (view.hasFocus && !readOnlyRef.current) return
    applyingExternalRef.current = true
    try {
      view.dispatch({
        changes: { from: 0, to: current.length, insert: value },
      })
    } finally {
      applyingExternalRef.current = false
    }
  }, [value])

  return (
    <div
      ref={hostRef}
      className={`json-editor${readOnly ? ' json-editor-readonly' : ''}`}
      style={{ height }}
    />
  )
}
