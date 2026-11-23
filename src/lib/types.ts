import type { BuilderNode } from './logic-builder'

export type JsonPrimitive = string | number | boolean | null
export type JsonObject = { [key: string]: JsonValue }
export type JsonArray = JsonValue[]
export type JsonValue = JsonPrimitive | JsonObject | JsonArray

export type StateValue = string | JsonObject | JsonArray

export interface ChoiceOption {
  name: string
  description: string
}

export interface ScoreLevel {
  label: string
  description?: string
}

export type Question =
  | { type: 'noul'; instructions: string; criteria?: { true?: string; false?: string } }
  | { type: 'choice'; instructions: string; options: ChoiceOption[] }
  | { type: 'score'; instructions: string; levels: ScoreLevel[] }
  | { type: 'box'; instructions: string }

export type QuestionType = Question['type']

export interface LogicOutput {
  id: string
  /** 同步缓存与导出文本；graph 存在时由图形结构重新生成。 */
  expression: string
  /** 图形构建器的权威结构。 */
  graph?: BuilderNode
  /** UI 视图偏好；缺省视为 graph。文本编辑会清除 graph。 */
  mode?: 'graph' | 'text'
}

interface StepNodeBase {
  id: string
  title: string
  position: { x: number; y: number }
}

export interface ApiStepNode extends StepNodeBase {
  /** 缺省视为 api，兼容旧场景与导出。 */
  kind?: 'api'
  state: StateValue
  questions: Record<string, Question>
  includeUpstream: boolean
}

export interface LogicStepNode extends StepNodeBase {
  kind: 'logic'
  outputs: LogicOutput[]
}

export type StepNode = ApiStepNode | LogicStepNode

export function isLogicNode(node: StepNode): node is LogicStepNode {
  return node.kind === 'logic'
}

export function isApiNode(node: StepNode): node is ApiStepNode {
  return node.kind !== 'logic'
}

/** 逻辑步到下游连线的条件：源节点输出 equals 时放行；缺省表示总是放行。 */
export interface EdgeCondition {
  output: string
  equals: boolean
}

export interface Edge {
  id: string
  source: string
  target: string
  when?: EdgeCondition
}

export interface Scenario {
  id: string
  name: string
  description?: string
  model: string
  nodes: StepNode[]
  edges: Edge[]
}

export interface ApiNoulQuestion {
  type: 'noul'
  instructions?: string
  criteria?: { true?: string; false?: string }
}

export interface ApiChoiceQuestion {
  type: 'choice'
  instructions?: string
  criteria: Record<string, string | null>
}

export interface ApiScoreQuestion {
  type: 'score'
  instructions?: string
  criteria: Array<string | { label?: string; description?: string }>
}

export interface ApiBoxQuestion {
  type: 'box'
  instructions?: string
}

export type ApiQuestion = ApiNoulQuestion | ApiChoiceQuestion | ApiScoreQuestion | ApiBoxQuestion

export interface SystemOneRequest {
  model: string
  state: StateValue
  questions: Record<string, ApiQuestion>
}

export interface NoulAnswer {
  type: 'noul'
  noul: number
}

export interface ChoiceAnswer {
  type: 'choice'
  choice: string
  confidence: number
  probabilities: Record<string, number>
}

export interface ScoreAnswer {
  type: 'score'
  score: number
  confidence: number
  legend: Record<string, JsonValue>
  probabilities: Record<string, number>
}

export interface BoxAnswer {
  type: 'box'
  box: { top: number; bottom: number; left: number; right: number }
  confidence: number | null
}

export type Answer = NoulAnswer | ChoiceAnswer | ScoreAnswer | BoxAnswer

export interface SystemOneResponse {
  model: string
  answers: Record<string, Answer>
  usage: { input_tokens: number; output_tokens: number }
}

export type NodeStatus =
  | 'idle'
  | 'waiting'
  | 'running'
  | 'success'
  | 'error'
  | 'skipped'
  | 'stale'

export interface ApiErrorBody {
  error?: {
    code?: string
    message?: string
    hint?: string
  }
  detail?: unknown
}

export interface RunRecord {
  nodeId: string
  status: NodeStatus
  request?: SystemOneRequest
  response?: SystemOneResponse
  error?: {
    status?: number
    code: string
    message: string
    hint?: string
    detail?: JsonValue
  }
  startedAt?: number
  ms?: number
  inputTokens?: number
  outputTokens?: number
  note?: string
  /** 逻辑步的命名布尔输出。 */
  outputs?: Record<string, boolean>
  /** 逻辑步求值时实际引用的上游值，便于核对。 */
  inputs?: Record<string, JsonValue>
}

export interface Health {
  ok: boolean
  keyConfigured: boolean
  baseUrl: string
  proxyConfigured: boolean
  proxy: string | null
}

export interface ModelInfo {
  name: string
  description?: string
  release_date?: string
}
