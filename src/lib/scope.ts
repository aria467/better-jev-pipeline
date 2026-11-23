import { ancestorsOf } from './graph'
import { lookupPath } from './template'
import type { TemplateScope } from './template'
import type { JsonValue, RunRecord, Scenario } from './types'

/**
 * 汇总某节点所有祖先中运行成功的值：
 * - API 节点的 answers（choice / score / noul）；
 * - 逻辑步的命名布尔输出。
 * 供请求模板解析与逻辑表达式求值共用。
 */
export function buildValueScope(
  nodeId: string,
  scenario: Scenario,
  results: Record<string, RunRecord>,
): TemplateScope {
  const allowed = ancestorsOf(nodeId, scenario.edges)
  const nodes: TemplateScope['nodes'] = {}

  for (const [id, record] of Object.entries(results)) {
    if (!allowed.has(id) || record.status !== 'success') continue
    const owner = scenario.nodes.find((node) => node.id === id)
    if (!owner) continue
    const answers = record.response?.answers ?? {}
    const outputs = record.outputs
    if (Object.keys(answers).length === 0 && !outputs) continue
    nodes[id] = {
      title: owner.title,
      answers,
      ...(outputs ? { outputs } : {}),
    }
  }

  return { nodes }
}

export function resolveScopeValue(
  scope: TemplateScope,
  path: string,
): { value?: JsonValue; error?: string } {
  const found = lookupPath(scope, path)
  if (found.error) return { error: found.error.message }
  return { value: found.value }
}
