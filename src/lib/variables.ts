import { ancestorsOf } from './graph'
import { isLogicNode } from './types'
import type { RunRecord, Scenario } from './types'

export interface VariableGroup {
  nodeId: string
  title: string
  items: { label: string; template: string }[]
}

const SAFE_PATH_SEGMENT = /^[^\s.{}]+$/u

/** 汇总所有祖先节点（已成功运行）可引用的变量模板。 */
export function collectVariables(
  nodeId: string,
  scenario: Scenario,
  results: Record<string, RunRecord>,
): VariableGroup[] {
  const ancestors = ancestorsOf(nodeId, scenario.edges)
  const groups: VariableGroup[] = []

  for (const owner of scenario.nodes) {
    if (!ancestors.has(owner.id)) continue
    const record = results[owner.id]
    if (record?.status !== 'success') continue
    if (isLogicNode(owner)) {
      const outputs = record.outputs
      if (!outputs) continue
      const items: VariableGroup['items'] = Object.entries(outputs).map(
        ([outputId, value]) => ({
          label: `${outputId} · ${value ? '真' : '假'}`,
          template: `{{${owner.id}.${outputId}}}`,
        }),
      )
      if (items.length > 0) {
        groups.push({
          nodeId: owner.id,
          title: `${owner.title} · ${owner.id}`,
          items,
        })
      }
      continue
    }
    if (!record.response) continue
    const items: VariableGroup['items'] = []
    for (const [questionId, answer] of Object.entries(record.response.answers)) {
      const base = `${owner.id}.${questionId}`
      const push = (label: string, path: string) =>
        items.push({
          label: `${questionId} · ${label}`,
          template: `{{${path}}}`,
        })
      if (answer.type === 'choice') {
        push('choice', `${base}.choice`)
        push('confidence', `${base}.confidence`)
        for (const key of Object.keys(answer.probabilities ?? {})) {
          if (SAFE_PATH_SEGMENT.test(key)) {
            push(`${key} 概率`, `${base}.probabilities.${key}`)
          }
        }
      } else if (answer.type === 'score') {
        push('score', `${base}.score`)
        push('confidence', `${base}.confidence`)
        for (const key of Object.keys(answer.probabilities ?? {})) {
          if (SAFE_PATH_SEGMENT.test(key)) {
            push(`${key} 概率`, `${base}.probabilities.${key}`)
          }
        }
      } else if (answer.type === 'noul') {
        push('noul', `${base}.noul`)
      }
    }
    if (items.length > 0) {
      groups.push({
        nodeId: owner.id,
        title: `${owner.title} · ${owner.id}`,
        items,
      })
    }
  }

  return groups
}
