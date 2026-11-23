import type { Answer, JsonValue } from './types'

export interface TemplateNodeScope {
  title: string
  answers: Record<string, Answer>
  /** 逻辑步的命名布尔输出，例如 {{n3.risk}}。 */
  outputs?: Record<string, boolean>
}

export interface TemplateScope {
  nodes: Record<string, TemplateNodeScope>
}

export interface TemplateError {
  path: string
  message: string
}

export interface ResolveResult {
  value: JsonValue
  errors: TemplateError[]
}

const TEMPLATE = /\{\{\s*([^{}\s]+?)\s*\}\}/gu
const EXACT = /^\s*\{\{\s*([^{}\s]+?)\s*\}\}\s*$/u

const isObject = (value: unknown): value is Record<string, JsonValue> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

export function extractRefs(value: JsonValue): string[] {
  const refs: string[] = []
  const visit = (current: JsonValue) => {
    if (typeof current === 'string') {
      for (const match of current.matchAll(TEMPLATE)) refs.push(match[1])
      return
    }
    if (Array.isArray(current)) {
      current.forEach(visit)
      return
    }
    if (isObject(current)) Object.values(current).forEach(visit)
  }
  visit(value)
  return refs
}

export function lookupPath(scope: TemplateScope, path: string): { value?: JsonValue; error?: TemplateError } {
  const parts = path.split('.').filter(Boolean)
  if (parts.length < 2) {
    return { error: { path, message: '引用格式应为 {{节点.问题}} 或 {{节点.问题.字段}}' } }
  }
  const [nodeId, questionId, ...rest] = parts
  const node = scope.nodes[nodeId]
  if (!node) {
    return { error: { path, message: `找不到上游节点 ${nodeId} 的结果` } }
  }
  if (node.outputs && questionId in node.outputs) {
    if (rest.length > 0) {
      return { error: { path, message: `${nodeId}.${questionId} 是布尔输出，没有下级字段` } }
    }
    return { value: node.outputs[questionId] }
  }
  const answer = node.answers[questionId]
  if (!answer) {
    return { error: { path, message: `节点「${node.title}」没有问题 ${questionId} 的结果` } }
  }
  let current: JsonValue = answer as unknown as JsonValue
  for (const key of rest) {
    if (!isObject(current) || !(key in current)) {
      return {
        error: { path, message: `「${node.title}」的 ${questionId} 结果中没有字段 ${key}` },
      }
    }
    current = current[key]
  }
  return { value: current }
}

function stringify(value: JsonValue): string {
  if (typeof value === 'string') return value
  return JSON.stringify(value)
}

export function resolveString(
  input: string,
  scope: TemplateScope,
  errors: TemplateError[],
): JsonValue {
  const exact = input.match(EXACT)
  if (exact) {
    const found = lookupPath(scope, exact[1])
    if (found.error) {
      errors.push(found.error)
      return input
    }
    return found.value as JsonValue
  }
  return input.replace(TEMPLATE, (raw, path: string) => {
    const found = lookupPath(scope, path)
    if (found.error) {
      errors.push(found.error)
      return raw
    }
    return stringify(found.value as JsonValue)
  })
}

export function resolveValue(value: JsonValue, scope: TemplateScope): ResolveResult {
  const errors: TemplateError[] = []
  const visit = (current: JsonValue): JsonValue => {
    if (typeof current === 'string') return resolveString(current, scope, errors)
    if (Array.isArray(current)) return current.map(visit)
    if (isObject(current)) {
      const next: Record<string, JsonValue> = {}
      for (const [key, child] of Object.entries(current)) next[key] = visit(child)
      return next
    }
    return current
  }
  return { value: visit(value), errors }
}

export function buildScope(
  nodes: Array<{
    id: string
    title: string
    answers?: Record<string, Answer>
    outputs?: Record<string, boolean>
  }>,
): TemplateScope {
  return {
    nodes: Object.fromEntries(
      nodes.map((node) => [
        node.id,
        {
          title: node.title,
          answers: node.answers ?? {},
          ...(node.outputs ? { outputs: node.outputs } : {}),
        },
      ]),
    ),
  }
}
