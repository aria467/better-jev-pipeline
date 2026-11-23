import type {
  Answer,
  ApiStepNode,
  JsonValue,
  LogicStepNode,
  Question,
  RunRecord,
  ScoreAnswer,
} from './types'

/** 卡片里每个问题最多展示的行数。 */
export const CARD_ROW_LIMIT = 4
/** 逻辑步卡片最多展示的输出行数。 */
export const LOGIC_ROW_LIMIT = 6

export interface CardRow {
  label: string
  /** null 表示尚未运行、没有数值。 */
  percent: number | null
  chosen?: boolean
}

export interface QuestionCardView {
  id: string
  type: 'choice' | 'score' | 'noul'
  rows: CardRow[]
  /** 超出展示上限的行数。 */
  overflow: number
  confidence: number | null
  /** score 的紧凑分数，如 `1.50 / 2`。 */
  scoreText?: string
  /** noul 的 P(是)，null 表示没有数值。 */
  noulPercent?: number | null
  hasAnswer: boolean
}

export interface LogicOutputRow {
  id: string
  /** null 表示尚未运行。 */
  value: boolean | null
}

export function formatPercent(value: number): string {
  const percent = value * 100
  const rounded = Math.round(percent)
  const text = Math.abs(percent - rounded) < 0.05 ? String(rounded) : percent.toFixed(1)
  return `${text}%`
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value))
}

function answersOf(result?: RunRecord): Record<string, Answer> | undefined {
  if (!result) return undefined
  if (result.status !== 'success' && result.status !== 'stale') return undefined
  return result.response?.answers
}

function legendLabel(value: JsonValue | undefined, fallback: string): string {
  if (typeof value === 'string') return value
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const record = value as Record<string, JsonValue>
    if (typeof record.label === 'string') return record.label
    if (typeof record.description === 'string') return record.description
  }
  return fallback
}

function scoreLevelOrder(answer: ScoreAnswer): string[] {
  return Object.keys(answer.probabilities).sort((a, b) => {
    const left = Number(a)
    const right = Number(b)
    if (Number.isFinite(left) && Number.isFinite(right)) return left - right
    return 0
  })
}

function capRows(rows: CardRow[]): { rows: CardRow[]; overflow: number } {
  if (rows.length <= CARD_ROW_LIMIT) return { rows, overflow: 0 }
  return { rows: rows.slice(0, CARD_ROW_LIMIT), overflow: rows.length - CARD_ROW_LIMIT }
}

function choiceView(
  id: string,
  question: Extract<Question, { type: 'choice' }> | null,
  answer: Extract<Answer, { type: 'choice' }> | null,
): QuestionCardView {
  const configured = question?.options.map((option) => option.name) ?? []
  let rows: CardRow[]
  if (answer) {
    const entries = Object.entries(answer.probabilities).sort((a, b) => b[1] - a[1])
    rows =
      entries.length > 0
        ? entries.map(([label, percent]) => ({
            label,
            percent,
            chosen: label === answer.choice,
          }))
        : configured.map((label) => ({ label, percent: null }))
  } else {
    rows = configured.map((label) => ({ label, percent: null }))
  }

  const capped = capRows(rows)
  return {
    id,
    type: 'choice',
    rows: capped.rows,
    overflow: capped.overflow,
    confidence: answer?.confidence ?? null,
    hasAnswer: Boolean(answer),
  }
}

function scoreView(
  id: string,
  question: Extract<Question, { type: 'score' }> | null,
  answer: Extract<Answer, { type: 'score' }> | null,
): QuestionCardView {
  const configured = question?.levels.map((level) => level.label) ?? []
  let rows: CardRow[]
  let scoreText: string | undefined

  if (answer) {
    const keys = scoreLevelOrder(answer)
    rows =
      keys.length > 0
        ? keys.map((key) => ({
            label: legendLabel(answer.legend?.[key], key),
            percent: answer.probabilities[key] ?? 0,
          }))
        : configured.map((label) => ({ label, percent: null }))
    const levelCount =
      keys.length || Object.keys(answer.legend ?? {}).length || configured.length
    scoreText = `${answer.score.toFixed(2)} / ${Math.max(0, levelCount - 1)}`
  } else {
    rows = configured.map((label) => ({ label, percent: null }))
  }

  const capped = capRows(rows)
  return {
    id,
    type: 'score',
    rows: capped.rows,
    overflow: capped.overflow,
    confidence: answer?.confidence ?? null,
    ...(scoreText ? { scoreText } : {}),
    hasAnswer: Boolean(answer),
  }
}

function noulView(
  id: string,
  answer: Extract<Answer, { type: 'noul' }> | null,
): QuestionCardView {
  return {
    id,
    type: 'noul',
    rows: [],
    overflow: 0,
    confidence: null,
    noulPercent: answer ? clamp01(answer.noul) : null,
    hasAnswer: Boolean(answer),
  }
}

function viewOfAnswer(id: string, answer: Answer): QuestionCardView | null {
  switch (answer.type) {
    case 'choice':
      return choiceView(id, null, answer)
    case 'score':
      return scoreView(id, null, answer)
    case 'noul':
      return noulView(id, answer)
    default:
      return null
  }
}

/** 把 API 节点与运行记录整理成卡片可渲染的问题块。 */
export function buildQuestionViews(node: ApiStepNode, result?: RunRecord): QuestionCardView[] {
  const answers = answersOf(result)
  const views: QuestionCardView[] = []

  for (const [id, question] of Object.entries(node.questions)) {
    if (question.type === 'box') continue
    const answer = answers?.[id]
    if (question.type === 'choice') {
      views.push(
        choiceView(id, question, answer?.type === 'choice' ? answer : null),
      )
    } else if (question.type === 'score') {
      views.push(
        scoreView(id, question, answer?.type === 'score' ? answer : null),
      )
    } else {
      views.push(noulView(id, answer?.type === 'noul' ? answer : null))
    }
  }

  // 旧场景里可能有不在配置中的问题，按答案补上。
  for (const [id, answer] of Object.entries(answers ?? {})) {
    if (node.questions[id]) continue
    const view = viewOfAnswer(id, answer)
    if (view) views.push(view)
  }

  return views
}

/** 逻辑步的布尔输出行。 */
export function buildLogicOutputRows(
  node: LogicStepNode,
  result?: RunRecord,
): LogicOutputRow[] {
  const outputs =
    result && (result.status === 'success' || result.status === 'stale')
      ? result.outputs
      : undefined
  const rows: LogicOutputRow[] = node.outputs.map((output) => ({
    id: output.id,
    value: outputs && output.id in outputs ? (outputs[output.id] ?? null) : null,
  }))
  for (const [id, value] of Object.entries(outputs ?? {})) {
    if (!node.outputs.some((output) => output.id === id)) {
      rows.push({ id, value })
    }
  }
  return rows
}
