import { ancestorsOf, findCycle } from './graph'
import { checkLogicExpression, refTypeInScenario } from './logic'
import { extractRefs } from './template'
import { isLogicNode } from './types'
import type { JsonValue, Scenario, StepNode } from './types'

export interface NodeIssue {
  nodeId: string
  message: string
  severity: 'error' | 'warning'
}

export interface ScenarioIssues {
  issues: NodeIssue[]
  byNode: Record<string, string[]>
  cycle: string[] | null
  errorCount: number
}

const QUESTION_ID = /^[A-Za-z0-9_-]+$/

function validateLogicOutputs(
  scenario: Scenario,
  node: Extract<StepNode, { kind: 'logic' }>,
  add: (message: string, severity?: 'error' | 'warning') => void,
): void {
  if (node.outputs.length === 0) add('至少需要一个输出')
  const ancestors = ancestorsOf(node.id, scenario.edges)
  const resolveRef = (path: string) => refTypeInScenario(scenario, path)
  const ids = new Set<string>()

  for (const output of node.outputs) {
    const id = output.id.trim()
    if (!id) add('输出 ID 不能为空')
    else if (!QUESTION_ID.test(id)) add(`输出 ID「${id}」只能包含字母、数字、下划线和连字符`)
    else if (ids.has(id)) add(`输出 ID「${id}」重复`)
    else ids.add(id)

    const label = id || '(未命名)'
    if (!output.expression.trim()) {
      add(`输出「${label}」的表达式为空`)
      continue
    }

    const checked = checkLogicExpression(output.expression, resolveRef)
    if ('error' in checked) add(`输出「${label}」：${checked.error.message}`)

    for (const ref of checked.refs) {
      const parts = ref.split('.')
      const ownerId = parts[0]
      const key = parts[1]
      if (!ownerId || !key) {
        add(`表达式引用 {{${ref}}} 格式应为 {{节点.输出}} 或 {{节点.问题.字段}}`)
        continue
      }
      const owner = scenario.nodes.find((item) => item.id === ownerId)
      if (!owner) {
        add(`表达式引用 {{${ref}}} 指向不存在的节点 ${ownerId}`)
        continue
      }
      if (ownerId === node.id) {
        add(`表达式引用 {{${ref}}} 不能引用自身`)
        continue
      }
      if (!ancestors.has(ownerId)) {
        add(`表达式引用 {{${ref}}} 的 ${ownerId} 不是该节点的上游，请先连线`)
      }
    }
  }
}

export function validateNode(scenario: Scenario, node: StepNode): NodeIssue[] {
  const issues: NodeIssue[] = []
  const add = (message: string, severity: 'error' | 'warning' = 'error') =>
    issues.push({ nodeId: node.id, message, severity })

  if (!node.title.trim()) add('节点标题为空', 'warning')

  if (isLogicNode(node)) {
    validateLogicOutputs(scenario, node, add)
    return issues
  }

  if (!node.state || (typeof node.state === 'string' && !node.state.trim())) {
    add('state 为空')
  }

  const entries = Object.entries(node.questions)
  if (entries.length === 0) add('至少需要一个问题')

  for (const [id, question] of entries) {
    if (!id.trim()) add('问题 ID 不能为空')
    else if (!QUESTION_ID.test(id)) add(`问题 ID「${id}」只能包含字母、数字、下划线和连字符`)
    if (!question.instructions.trim()) add(`问题「${id}」缺少 instructions`, 'warning')

    if (question.type === 'choice') {
      if (question.options.length === 0) add(`choice 问题「${id}」至少需要一个选项`)
      if (question.options.length > 255) add(`choice 问题「${id}」最多 255 个选项`)
      const names = new Set<string>()
      for (const option of question.options) {
        const name = option.name.trim()
        if (!name) add(`choice 问题「${id}」存在空选项名`)
        else if (names.has(name)) add(`choice 问题「${id}」选项「${name}」重复`)
        else names.add(name)
      }
    }

    if (question.type === 'score') {
      if (question.levels.length === 0) add(`score 问题「${id}」至少需要一个等级`)
      if (question.levels.length > 10) add(`score 问题「${id}」最多 10 个等级`)
      if (question.levels.length === 1) add(`score 问题「${id}」只有一个等级，模型无法区分程度`, 'warning')
      for (const level of question.levels) {
        if (!level.label.trim()) add(`score 问题「${id}」存在空等级描述`)
      }
    }
  }

  const ancestors = ancestorsOf(node.id, scenario.edges)
  const values: JsonValue[] = [node.state as JsonValue]
  for (const question of Object.values(node.questions)) {
    values.push(question.instructions)
    if (question.type === 'choice') {
      for (const option of question.options) values.push(option.name, option.description)
    }
    if (question.type === 'score') {
      for (const level of question.levels) values.push(level.label, level.description ?? '')
    }
  }
  for (const ref of new Set(extractRefs(values))) {
    const [nodeId, questionId] = ref.split('.')
    const owner = scenario.nodes.find((item) => item.id === nodeId)
    if (!nodeId || !questionId) {
      add(`模板 {{${ref}}} 需要写成 {{节点.问题}} 或 {{节点.问题.字段}}`)
      continue
    }
    if (!owner) {
      add(`模板 {{${ref}}} 引用了不存在的节点 ${nodeId}`)
      continue
    }
    if (nodeId === node.id) {
      add(`模板 {{${ref}}} 不能引用自身`)
      continue
    }
    if (!ancestors.has(nodeId)) {
      add(`模板 {{${ref}}} 引用的 ${nodeId} 不是该节点的上游，请先连线`)
      continue
    }
    if (isLogicNode(owner)) {
      if (ref.split('.').length > 2) {
        add(`模板 {{${ref}}} 中 ${nodeId}.${questionId} 是布尔输出，没有下级字段`)
      } else if (!owner.outputs.some((output) => output.id === questionId)) {
        add(`模板 {{${ref}}} 引用了 ${nodeId} 中不存在的输出 ${questionId}`)
      }
      continue
    }
    if (!(questionId in owner.questions)) {
      add(`模板 {{${ref}}} 引用了 ${nodeId} 中不存在的问题 ${questionId}`)
    }
  }

  return issues
}

export function validateScenario(scenario: Scenario): ScenarioIssues {
  const issues: NodeIssue[] = []
  const ids = new Set<string>()
  for (const node of scenario.nodes) {
    if (ids.has(node.id)) issues.push({ nodeId: node.id, message: `节点 ID「${node.id}」重复`, severity: 'error' })
    ids.add(node.id)
  }
  for (const edge of scenario.edges) {
    if (!ids.has(edge.source) || !ids.has(edge.target)) {
      issues.push({
        nodeId: edge.target,
        message: `连线 ${edge.source} → ${edge.target} 指向不存在的节点`,
        severity: 'error',
      })
    }
    if (!edge.when) continue
    const source = scenario.nodes.find((node) => node.id === edge.source)
    if (!source || !isLogicNode(source)) {
      issues.push({
        nodeId: edge.target,
        message: `连线 ${edge.source} → ${edge.target} 的条件只能由逻辑步的输出决定`,
        severity: 'error',
      })
      continue
    }
    if (!source.outputs.some((output) => output.id === edge.when?.output)) {
      issues.push({
        nodeId: edge.target,
        message: `连线 ${edge.source} → ${edge.target} 的条件引用了不存在的输出 ${edge.when.output}`,
        severity: 'error',
      })
    }
  }
  for (const node of scenario.nodes) issues.push(...validateNode(scenario, node))

  const cycle = findCycle(scenario.nodes, scenario.edges)
  if (cycle) {
    issues.push({
      nodeId: cycle[0],
      message: `依赖关系成环：${cycle.join(' → ')}`,
      severity: 'error',
    })
  }

  const byNode: Record<string, string[]> = {}
  for (const issue of issues) {
    if (issue.severity !== 'error') continue
    ;(byNode[issue.nodeId] ??= []).push(issue.message)
  }
  return {
    issues,
    byNode,
    cycle,
    errorCount: issues.filter((issue) => issue.severity === 'error').length,
  }
}
