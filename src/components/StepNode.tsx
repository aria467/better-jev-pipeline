import { memo, useMemo } from 'react'
import { Handle, Position, type Node, type NodeProps } from '@xyflow/react'
import {
  AlertTriangle,
  Check,
  Circle,
  CircleSlash,
  Loader2,
  RefreshCw,
} from 'lucide-react'
import {
  LOGIC_ROW_LIMIT,
  buildLogicOutputRows,
  buildQuestionViews,
  formatPercent,
} from '../lib/card-view'
import { collectLogicRefs } from '../lib/logic'
import {
  collectBuilderRefs,
  isBuilderTree,
  logicOutputExpression,
} from '../lib/logic-builder'
import { useStudio } from '../lib/store'
import { isLogicNode } from '../lib/types'
import type {
  NodeStatus,
  RunRecord,
  StepNode as StepNodeModel,
} from '../lib/types'

export interface StepNodeData extends Record<string, unknown> {
  node: StepNodeModel
  index: number
  result?: RunRecord
  selected: boolean
}

interface StatusMeta {
  label: string
  tone: string
}

const STATUS_META: Record<NodeStatus, StatusMeta> = {
  idle: { label: '待运行', tone: 'idle' },
  waiting: { label: '待运行', tone: 'idle' },
  running: { label: '运行中', tone: 'running' },
  success: { label: '成功', tone: 'success' },
  error: { label: '失败', tone: 'error' },
  skipped: { label: '已跳过', tone: 'skipped' },
  stale: { label: '待更新', tone: 'stale' },
}

function StatusGlyph({ tone }: { tone: string }) {
  if (tone === 'running') {
    return <Loader2 size={14} strokeWidth={1.5} className="step-spin" aria-hidden="true" />
  }
  if (tone === 'success') {
    return <Check size={14} strokeWidth={1.5} aria-hidden="true" />
  }
  if (tone === 'error') {
    return <AlertTriangle size={14} strokeWidth={1.5} aria-hidden="true" />
  }
  if (tone === 'skipped') {
    return <CircleSlash size={14} strokeWidth={1.5} aria-hidden="true" />
  }
  if (tone === 'stale') {
    return <RefreshCw size={14} strokeWidth={1.5} aria-hidden="true" />
  }
  return <Circle size={14} strokeWidth={1.5} aria-hidden="true" />
}

function buildLogicChips(node: Extract<StepNodeModel, { kind: 'logic' }>): string[] {
  const refs = new Set<string>()
  for (const output of node.outputs) {
    const graph = output.graph && isBuilderTree(output.graph) ? output.graph : null
    const source = graph ? collectBuilderRefs(graph) : collectLogicRefs(logicOutputExpression(output))
    for (const ref of source) refs.add(ref)
  }
  return [
    '逻辑',
    refs.size > 0 ? `输入 ×${refs.size}` : null,
    `输出 ×${node.outputs.length}`,
  ].filter((chip): chip is string => chip !== null)
}

function barWidth(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return '0%'
  return `${Math.max(0, Math.min(100, value * 100))}%`
}

function confidenceText(value: number | null): string {
  return value === null ? '置信度 None' : `置信度 ${formatPercent(value)}`
}

function buildMetrics(result: RunRecord | undefined, logic: boolean): string {
  if (!result) return logic ? '本地计算' : '—'
  const parts: string[] = []
  if (typeof result.ms === 'number') parts.push(logic ? `本地 · ${result.ms} ms` : `耗时 ${result.ms} ms`)
  if (!logic && typeof result.inputTokens === 'number') {
    parts.push(`输入 ${result.inputTokens} tokens`)
  }
  return parts.length > 0 ? parts.join(' · ') : logic ? '本地计算' : '—'
}

function StepNodeView({ data, isConnectable }: NodeProps<Node<StepNodeData>>) {
  const { node, index, result, selected } = data
  const status = result?.status ?? 'idle'
  const meta = STATUS_META[status] ?? STATUS_META.idle
  const logic = isLogicNode(node)
  const chips = logic ? buildLogicChips(node) : []
  const metrics = buildMetrics(result, logic)
  const openQuestionEditor = useStudio((state) => state.openQuestionEditor)
  const editingQuestionId = useStudio((state) =>
    state.questionEditor?.nodeId === node.id ? state.questionEditor.questionId : null,
  )

  const questionViews = useMemo(
    () => (isLogicNode(node) ? [] : buildQuestionViews(node, result)),
    [node, result],
  )
  const outputRows = useMemo(
    () => (isLogicNode(node) ? buildLogicOutputRows(node, result) : []),
    [node, result],
  )
  const visibleOutputs = outputRows.slice(0, LOGIC_ROW_LIMIT)
  const hiddenOutputs = outputRows.length - visibleOutputs.length

  const cardClass = [
    'step-card',
    `step-card--${meta.tone}`,
    logic ? 'step-card--logic' : '',
    selected ? 'step-selected' : '',
    meta.tone === 'error' ? 'step-error' : '',
    meta.tone === 'skipped' || meta.tone === 'stale' ? 'step-muted' : '',
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <>
      <Handle
        type="target"
        position={Position.Left}
        className="step-handle"
        isConnectable={isConnectable}
      />
      <article
        className={cardClass}
        aria-label={`${logic ? '逻辑步' : '步骤'} ${index}，${node.title || '未命名步骤'}，${meta.label}`}
      >
        <header className="step-head">
          <span className="step-index mono">{String(index).padStart(2, '0')}</span>
          <h3 className="step-title" title={node.title}>
            {node.title || '未命名步骤'}
          </h3>
          <span className={`step-glyph step-glyph--${meta.tone}`} title={meta.label}>
            <StatusGlyph tone={meta.tone} />
          </span>
        </header>

        {logic && chips.length > 0 && (
          <div className="step-chips">
            {chips.map((chip) => (
              <span className="step-chip" key={chip}>
                {chip}
              </span>
            ))}
          </div>
        )}

        {!logic && questionViews.length > 0 && (
          <div className="step-q-list">
            {questionViews.map((view) => {
              const editing = editingQuestionId === view.id
              const noulPercent = view.noulPercent ?? null
              return (
                <button
                  type="button"
                  key={view.id}
                  className={`step-q nodrag${editing ? ' is-editing' : ''}`}
                  aria-haspopup="dialog"
                  aria-expanded={editing}
                  aria-label={`编辑问题 ${view.id}`}
                  title={`编辑问题 ${view.id}`}
                  onClick={() => openQuestionEditor(node.id, view.id)}
                >
                  <span className="step-q-head">
                    <span className="step-q-id mono">{view.id}</span>
                    <span className="step-q-type">{view.type}</span>
                  </span>

                  {view.type === 'noul' ? (
                    <>
                      <span className="step-q-noul mono">
                        P(是) = {noulPercent === null ? 'None' : noulPercent.toFixed(2)}
                      </span>
                      <span className="step-q-gauge">
                        <span
                          className="step-q-gauge-fill"
                          style={{ width: barWidth(noulPercent) }}
                        />
                        <span className="step-q-gauge-tick" aria-hidden="true" />
                        {noulPercent === null ? null : (
                          <span
                            className="step-q-gauge-marker"
                            style={{ left: barWidth(noulPercent) }}
                            aria-hidden="true"
                          />
                        )}
                      </span>
                      <span className="step-q-ends">
                        <span>否</span>
                        <span>是</span>
                      </span>
                    </>
                  ) : (
                    <>
                      {view.type === 'score' && (
                        <span className={`step-q-score mono${view.scoreText ? '' : ' is-none'}`}>
                          {view.scoreText ?? 'score None'}
                        </span>
                      )}
                      <span className="step-q-rows">
                        {view.rows.map((row) => (
                          <span
                            className={`step-q-row${row.chosen ? ' is-chosen' : ''}${row.percent === null ? ' is-none' : ''}`}
                            key={`${view.id}-${row.label}`}
                          >
                            <span className="step-q-name" title={row.label}>
                              {row.label}
                            </span>
                            <span className="step-q-track">
                              <span
                                className="step-q-fill"
                                style={{ width: barWidth(row.percent) }}
                              />
                            </span>
                            <span className="step-q-pct mono">
                              {row.percent === null ? 'None' : formatPercent(row.percent)}
                            </span>
                          </span>
                        ))}
                      </span>
                      {view.overflow > 0 && (
                        <span className="step-q-more">还有 {view.overflow} 项</span>
                      )}
                      <span className="step-q-foot">{confidenceText(view.confidence)}</span>
                    </>
                  )}
                </button>
              )
            })}
          </div>
        )}

        {logic && outputRows.length > 0 && (
          <div className="step-summary">
            {visibleOutputs.map((row) => (
              <div className="step-summary-line step-out-row" key={row.id}>
                <span className="step-out-name mono" title={row.id}>
                  {row.id}
                </span>
                <span
                  className={`step-out-badge step-out-badge--${row.value === null ? 'none' : row.value ? 'true' : 'false'}`}
                >
                  {row.value === null ? 'None' : row.value ? '真' : '假'}
                </span>
              </div>
            ))}
            {hiddenOutputs > 0 && (
              <div className="step-q-more">还有 {hiddenOutputs} 项</div>
            )}
          </div>
        )}

        <footer className="step-foot">
          <span className={`step-state step-state--${meta.tone}`}>{meta.label}</span>
          <span className="step-metrics mono">{metrics}</span>
        </footer>
      </article>
      <Handle
        type="source"
        position={Position.Right}
        className="step-handle"
        isConnectable={isConnectable}
      />
    </>
  )
}

export default memo(StepNodeView)
