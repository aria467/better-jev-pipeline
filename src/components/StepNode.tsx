import { memo } from 'react'
import { Handle, Position, type Node, type NodeProps } from '@xyflow/react'
import {
  AlertTriangle,
  Check,
  Circle,
  CircleSlash,
  Loader2,
  RefreshCw,
} from 'lucide-react'
import { collectLogicRefs } from '../lib/logic'
import { isLogicNode } from '../lib/types'
import type {
  NodeStatus,
  Question,
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
    for (const ref of collectLogicRefs(output.expression)) refs.add(ref)
  }
  return [
    '逻辑',
    refs.size > 0 ? `输入 ×${refs.size}` : null,
    `输出 ×${node.outputs.length}`,
  ].filter((chip): chip is string => chip !== null)
}

function buildChips(questions: Record<string, Question>): string[] {
  const counts = { choice: 0, score: 0, noul: 0 }
  for (const question of Object.values(questions)) {
    if (question.type === 'choice') counts.choice += 1
    else if (question.type === 'score') counts.score += 1
    else if (question.type === 'noul') counts.noul += 1
  }
  const chips = [
    counts.choice > 0 ? `choice ×${counts.choice}` : null,
    counts.score > 0 ? `score ×${counts.score}` : null,
    counts.noul > 0 ? `noul ×${counts.noul}` : null,
  ]
  return chips.filter((chip): chip is string => chip !== null)
}

function formatScoreValue(score: number): string {
  return Number.isInteger(score) ? String(score) : score.toFixed(1)
}

function buildLogicSummary(result?: RunRecord): string[] {
  if (!result || result.status !== 'success' || !result.outputs) return []
  return Object.entries(result.outputs)
    .slice(0, 2)
    .map(([id, value]) => `${id} · ${value ? '真' : '假'}`)
}

function buildSummary(node: StepNodeModel, result?: RunRecord): string[] {
  if (isLogicNode(node)) return buildLogicSummary(result)
  const answers = result?.status === 'success' ? result.response?.answers : undefined
  if (!answers) return []

  const choiceLines: string[] = []
  const noulLines: string[] = []
  const scoreLines: string[] = []

  for (const [questionId, answer] of Object.entries(answers)) {
    if (answer.type === 'choice') {
      const probability = answer.probabilities?.[answer.choice]
      const percent = Number.isFinite(probability)
        ? Math.round((probability as number) * 100)
        : Math.round(answer.confidence * 100)
      choiceLines.push(`${questionId} · ${answer.choice} ${percent}%`)
    } else if (answer.type === 'noul') {
      const value = Number.isFinite(answer.noul) ? answer.noul : 0
      noulLines.push(`${questionId} · ${value >= 0.5 ? '是' : '否'} ${value.toFixed(2)}`)
    } else if (answer.type === 'score') {
      const question = node.questions[questionId]
      const total =
        question?.type === 'score'
          ? question.levels.length
          : Object.keys(answer.legend ?? {}).length
      scoreLines.push(`${questionId} · ${formatScoreValue(answer.score)} / ${total || 10}`)
    }
  }

  return [...choiceLines, ...noulLines, ...scoreLines].slice(0, 2)
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
  const chips = logic ? buildLogicChips(node) : buildChips(node.questions)
  const summary = buildSummary(node, result)
  const metrics = buildMetrics(result, logic)

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
        position={Position.Top}
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

        {chips.length > 0 && (
          <div className="step-chips">
            {chips.map((chip) => (
              <span className="step-chip" key={chip}>
                {chip}
              </span>
            ))}
          </div>
        )}

        {summary.length > 0 && (
          <div className="step-summary">
            {summary.map((line) => (
              <div className="step-summary-line" key={line} title={line}>
                {line}
              </div>
            ))}
          </div>
        )}

        <footer className="step-foot">
          <span className={`step-state step-state--${meta.tone}`}>{meta.label}</span>
          <span className="step-metrics mono">{metrics}</span>
        </footer>
      </article>
      <Handle
        type="source"
        position={Position.Bottom}
        className="step-handle"
        isConnectable={isConnectable}
      />
    </>
  )
}

export default memo(StepNodeView)
