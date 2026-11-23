import { useCallback, useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import type { JSX } from 'react'
import { useReactFlow, useViewport } from '@xyflow/react'
import { X } from 'lucide-react'
import { useStudio } from '../lib/store'
import { isLogicNode } from '../lib/types'
import { collectVariables } from '../lib/variables'
import type { Question } from '../lib/types'
import { QuestionCard } from './QuestionCard'
import './inspector.css'

const POPOVER_WIDTH = 380
const NODE_CARD_WIDTH = 300
const GAP = 16
const EDGE = 12

function clamp(value: number, min: number, max: number): number {
  if (max < min) return min
  return Math.max(min, Math.min(max, value))
}

export function QuestionPopover(): JSX.Element | null {
  const editor = useStudio((state) => state.questionEditor)
  const scenario = useStudio((state) => state.scenario)
  const results = useStudio((state) => state.results)
  const updateQuestions = useStudio((state) => state.updateQuestions)
  const openQuestionEditor = useStudio((state) => state.openQuestionEditor)
  const closeQuestionEditor = useStudio((state) => state.closeQuestionEditor)

  const { flowToScreenPosition } = useReactFlow()
  const viewport = useViewport()
  const layerRef = useRef<HTMLDivElement>(null)
  const panelRef = useRef<HTMLElement>(null)

  const node = editor
    ? scenario.nodes.find((item) => item.id === editor.nodeId)
    : undefined
  const apiNode = node && !isLogicNode(node) ? node : null
  const question =
    apiNode && editor ? apiNode.questions[editor.questionId] : undefined
  const apiQuestion = question && question.type !== 'box' ? question : undefined

  const variables = useMemo(
    () => (apiNode ? collectVariables(apiNode.id, scenario, results) : []),
    [apiNode, scenario, results],
  )

  // 节点或问题被外部删除（检查器里删除、切换场景等）时收起弹层。
  useEffect(() => {
    if (editor && !apiQuestion) closeQuestionEditor()
  }, [editor, apiQuestion, closeQuestionEditor])

  const reposition = useCallback(() => {
    const layer = layerRef.current
    const panel = panelRef.current
    if (!layer || !panel || !node) return
    const layerRect = layer.getBoundingClientRect()
    const panelRect = panel.getBoundingClientRect()
    if (layerRect.width === 0 || layerRect.height === 0) return

    // flowToScreenPosition 返回的是视口坐标，换算到弹层容器内。
    const point = flowToScreenPosition(node.position)
    const x = point.x - layerRect.left
    const y = point.y - layerRect.top
    const nodeWidth = NODE_CARD_WIDTH * viewport.zoom
    let left = x - panelRect.width - GAP
    if (left < EDGE) left = x + nodeWidth + GAP
    left = clamp(left, EDGE, Math.max(EDGE, layerRect.width - panelRect.width - EDGE))

    const top = clamp(
      y,
      EDGE,
      Math.max(EDGE, layerRect.height - panelRect.height - EDGE),
    )

    panel.style.transform = `translate(${Math.round(left)}px, ${Math.round(top)}px)`
  }, [flowToScreenPosition, node, viewport.x, viewport.y, viewport.zoom])

  useLayoutEffect(() => {
    reposition()
  }, [reposition, apiQuestion])

  useEffect(() => {
    if (!editor) return
    const layer = layerRef.current
    if (!layer) return
    const observer = new ResizeObserver(() => reposition())
    observer.observe(layer)
    window.addEventListener('resize', reposition)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', reposition)
    }
  }, [editor, reposition])

  useEffect(() => {
    if (!editor) return
    panelRef.current?.focus()
  }, [editor])

  useEffect(() => {
    if (!editor) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.isComposing || event.key !== 'Escape') return
      // 问题 ID 输入框自带 Escape 撤销，交给它先处理。
      const target = event.target as HTMLElement | null
      if (target?.closest?.('.insp-q-id')) return
      closeQuestionEditor()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [editor, closeQuestionEditor])

  if (!editor || !apiNode || !apiQuestion) return null

  const questionId = editor.questionId

  const handleChange = (next: Question) => {
    updateQuestions(apiNode.id, { ...apiNode.questions, [questionId]: next })
  }

  const handleRename = (nextId: string) => {
    const entries = Object.entries(apiNode.questions).map(([id, item]) =>
      id === questionId ? ([nextId, item] as const) : ([id, item] as const),
    )
    updateQuestions(apiNode.id, Object.fromEntries(entries))
    openQuestionEditor(apiNode.id, nextId)
  }

  const handleDelete = () => {
    const next = { ...apiNode.questions }
    delete next[questionId]
    updateQuestions(apiNode.id, next)
    closeQuestionEditor()
  }

  return (
    <div
      ref={layerRef}
      className="qv-layer"
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
    >
      <aside
        ref={panelRef}
        className="qv-pop"
        role="dialog"
        aria-modal="false"
        aria-label={`编辑问题 ${questionId}`}
        tabIndex={-1}
        style={{ width: POPOVER_WIDTH }}
      >
        <header className="qv-head">
          <span className="qv-head-title">编辑问题</span>
          <span className="qv-head-path mono" title={`${apiNode.id} · ${questionId}`}>
            {apiNode.id} · {questionId}
          </span>
          <button
            type="button"
            className="qv-close"
            aria-label="关闭问题编辑"
            title="关闭（也可以点击画布空白）"
            onClick={closeQuestionEditor}
          >
            <X size={14} strokeWidth={1.5} aria-hidden="true" />
          </button>
        </header>
        <div className="qv-body">
          <QuestionCard
            key={`${apiNode.id}:${questionId}`}
            id={questionId}
            question={apiQuestion}
            existingIds={Object.keys(apiNode.questions)}
            variables={variables}
            onChange={handleChange}
            onRename={handleRename}
            onDelete={handleDelete}
          />
        </div>
      </aside>
    </div>
  )
}
