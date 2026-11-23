import { parentsOf } from './graph'
import { buildValueScope } from './scope'
import { resolveString, resolveValue } from './template'
import type { TemplateError } from './template'
import type {
  ApiQuestion,
  ApiStepNode,
  JsonObject,
  JsonValue,
  Question,
  RunRecord,
  Scenario,
  StateValue,
  SystemOneRequest,
} from './types'

const isObject = (value: unknown): value is JsonObject =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

export function questionsToApi(questions: Record<string, Question>): Record<string, ApiQuestion> {
  const out: Record<string, ApiQuestion> = {}
  for (const [id, question] of Object.entries(questions)) {
    if (question.type === 'choice') {
      const criteria: Record<string, string | null> = {}
      for (const option of question.options) {
        const name = option.name.trim()
        if (name) criteria[name] = option.description.trim() || null
      }
      out[id] = {
        type: 'choice',
        ...(question.instructions.trim() ? { instructions: question.instructions } : {}),
        criteria,
      }
    } else if (question.type === 'score') {
      out[id] = {
        type: 'score',
        ...(question.instructions.trim() ? { instructions: question.instructions } : {}),
        criteria: question.levels.map((level) =>
          level.description?.trim()
            ? { label: level.label, description: level.description }
            : level.label,
        ),
      }
    } else if (question.type === 'noul') {
      const criteria = question.criteria
      const hasCriteria = Boolean(criteria?.true?.trim() || criteria?.false?.trim())
      out[id] = {
        type: 'noul',
        ...(question.instructions.trim() ? { instructions: question.instructions } : {}),
        ...(hasCriteria
          ? { criteria: { true: criteria?.true, false: criteria?.false } }
          : {}),
      }
    } else {
      out[id] = {
        type: 'box',
        ...(question.instructions.trim() ? { instructions: question.instructions } : {}),
      }
    }
  }
  return out
}

export function questionsFromApi(input: Record<string, ApiQuestion>): Record<string, Question> {
  const out: Record<string, Question> = {}
  for (const [id, question] of Object.entries(input)) {
    if (question.type === 'choice') {
      out[id] = {
        type: 'choice',
        instructions: question.instructions ?? '',
        options: Object.entries(question.criteria ?? {}).map(([name, description]) => ({
          name,
          description: typeof description === 'string' ? description : '',
        })),
      }
    } else if (question.type === 'score') {
      out[id] = {
        type: 'score',
        instructions: question.instructions ?? '',
        levels: (question.criteria ?? []).map((item) => {
          if (typeof item === 'string') return { label: item }
          return {
            label: item.label ?? item.description ?? '',
            ...(item.description ? { description: item.description } : {}),
          }
        }),
      }
    } else if (question.type === 'noul') {
      out[id] = {
        type: 'noul',
        instructions: question.instructions ?? '',
        ...(question.criteria ? { criteria: question.criteria } : {}),
      }
    } else {
      out[id] = { type: 'box', instructions: question.instructions ?? '' }
    }
  }
  return out
}

function upstreamFromParents(
  node: ApiStepNode,
  scenario: Scenario,
  results: Record<string, RunRecord>,
): Record<string, JsonValue> {
  const upstream: Record<string, JsonValue> = {}
  for (const parentId of parentsOf(node.id, scenario.edges)) {
    const record = results[parentId]
    if (record?.status !== 'success') continue
    const parent = scenario.nodes.find((item) => item.id === parentId)
    if (record.response) {
      upstream[parentId] = {
        title: parent?.title ?? parentId,
        answers: record.response.answers as unknown as JsonObject,
        usage: record.response.usage,
      }
    } else if (record.outputs) {
      upstream[parentId] = {
        title: parent?.title ?? parentId,
        outputs: record.outputs,
      }
    }
  }
  return upstream
}

function applyUpstream(state: StateValue, upstream: Record<string, JsonValue>): StateValue {
  if (Object.keys(upstream).length === 0) return state
  if (typeof state === 'string') return { text: state, upstream }
  if (Array.isArray(state)) return { items: state, upstream }
  const existing = isObject(state.upstream) ? state.upstream : {}
  return { ...state, upstream: { ...existing, ...upstream } }
}

export interface BuildRequestOptions {
  scenario: Scenario
  node: ApiStepNode
  results: Record<string, RunRecord>
}

export interface BuiltRequest {
  request: SystemOneRequest
  errors: TemplateError[]
  hasUpstream: boolean
}

export function buildRequest({ scenario, node, results }: BuildRequestOptions): BuiltRequest {
  const errors: TemplateError[] = []
  const scope = buildValueScope(node.id, scenario, results)

  const stateResolved = resolveValue(node.state as JsonValue, scope)
  errors.push(...stateResolved.errors)

  const questions: Record<string, ApiQuestion> = {}
  for (const [id, question] of Object.entries(node.questions)) {
    const instructions = resolveString(question.instructions, scope, errors)
    if (question.type === 'choice') {
      const criteria: Record<string, string | null> = {}
      for (const option of question.options) {
        const name = String(resolveString(option.name, scope, errors)).trim()
        const description = option.description
          ? String(resolveString(option.description, scope, errors)).trim()
          : ''
        if (name) criteria[name] = description || null
      }
      questions[id] = {
        type: 'choice',
        ...(String(instructions).trim() ? { instructions: String(instructions) } : {}),
        criteria,
      }
    } else if (question.type === 'score') {
      const criteria = question.levels.map((level) => {
        const label = String(resolveString(level.label, scope, errors))
        if (level.description?.trim()) {
          return {
            label,
            description: String(resolveString(level.description, scope, errors)),
          }
        }
        return label
      })
      questions[id] = {
        type: 'score',
        ...(String(instructions).trim() ? { instructions: String(instructions) } : {}),
        criteria,
      }
    } else if (question.type === 'noul') {
      const hasCriteria = Boolean(question.criteria?.true?.trim() || question.criteria?.false?.trim())
      questions[id] = {
        type: 'noul',
        ...(String(instructions).trim() ? { instructions: String(instructions) } : {}),
        ...(hasCriteria ? { criteria: question.criteria } : {}),
      }
    } else {
      questions[id] = {
        type: 'box',
        ...(String(instructions).trim() ? { instructions: String(instructions) } : {}),
      }
    }
  }

  const upstream = node.includeUpstream
    ? upstreamFromParents(node, scenario, results)
    : {}

  const request: SystemOneRequest = {
    model: scenario.model,
    state: applyUpstream(stateResolved.value as StateValue, upstream),
    questions,
  }

  return { request, errors, hasUpstream: Object.keys(upstream).length > 0 }
}
