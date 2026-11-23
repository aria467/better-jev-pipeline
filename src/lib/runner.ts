import { callSystemOne } from './api'
import { evaluateLogicOutputs } from './logic'
import { buildRequest } from './request'
import { buildValueScope, resolveScopeValue } from './scope'
import { isLogicNode } from './types'
import type { Edge, RunRecord, Scenario } from './types'

export interface ExecuteOptions {
  scenario: Scenario
  order: string[]
  seed: Record<string, RunRecord>
  signal: AbortSignal
  onRecord: (record: RunRecord) => void
  onRunning: (nodeId: string | null) => void
}

export interface ExecuteResult {
  results: Record<string, RunRecord>
  aborted: boolean
}

/**
 * 检查一个节点的入边：父节点必须成功，带条件的边还要求源逻辑步的输出满足条件。
 * 返回跳过原因；无返回表示全部放行。
 */
export function gateMiss(
  scenario: Scenario,
  results: Record<string, RunRecord>,
  edges: Edge[],
  nodeId: string,
): string | null {
  for (const edge of edges) {
    if (edge.target !== nodeId) continue
    const parentRecord = results[edge.source]
    if (parentRecord?.status !== 'success') {
      const parent = scenario.nodes.find((item) => item.id === edge.source)
      return `上游「${parent?.title ?? edge.source}」未成功`
    }
    if (!edge.when) continue
    const value = parentRecord.outputs?.[edge.when.output]
    const label = `${edge.source}.${edge.when.output} = ${edge.when.equals ? '真' : '假'}`
    if (value === undefined) return `条件「${label}」无法判定（上游没有该输出）`
    if (value !== edge.when.equals) return `条件「${label}」不满足`
  }
  return null
}

export async function executeOrder({
  scenario,
  order,
  seed,
  signal,
  onRecord,
  onRunning,
}: ExecuteOptions): Promise<ExecuteResult> {
  const results: Record<string, RunRecord> = { ...seed }
  let aborted = false

  const emit = (record: RunRecord) => {
    results[record.nodeId] = record
    onRecord(record)
  }

  for (const nodeId of order) {
    if (signal.aborted) {
      aborted = true
      break
    }
    const node = scenario.nodes.find((item) => item.id === nodeId)
    if (!node) continue

    const gateNote = gateMiss(scenario, results, scenario.edges, nodeId)
    if (gateNote) {
      emit({ nodeId, status: 'skipped', note: gateNote })
      continue
    }

    if (isLogicNode(node)) {
      const startedAt = Date.now()
      emit({ nodeId, status: 'running', startedAt })
      onRunning(nodeId)

      if (signal.aborted) {
        emit({ nodeId, status: 'skipped', note: '已停止' })
        aborted = true
        onRunning(null)
        break
      }

      try {
        const scope = buildValueScope(nodeId, scenario, results)
        const evaluation = evaluateLogicOutputs(node.outputs, (path) =>
          resolveScopeValue(scope, path),
        )
        const ms = Date.now() - startedAt
        if (evaluation.errors.length > 0) {
          emit({
            nodeId,
            status: 'error',
            startedAt,
            ms,
            error: { code: 'logic_error', message: evaluation.errors.join('；') },
          })
        } else {
          emit({
            nodeId,
            status: 'success',
            startedAt,
            ms,
            outputs: evaluation.outputs,
            inputs: evaluation.inputs,
          })
        }
      } catch (error) {
        emit({
          nodeId,
          status: 'error',
          startedAt,
          ms: Date.now() - startedAt,
          error: {
            code: 'logic_error',
            message: error instanceof Error ? error.message : String(error),
          },
        })
      }
      onRunning(null)
      continue
    }

    const built = buildRequest({ scenario, node, results })
    const startedAt = Date.now()
    if (built.errors.length > 0) {
      emit({
        nodeId,
        status: 'error',
        request: built.request,
        startedAt,
        ms: 0,
        error: {
          code: 'template_error',
          message: built.errors.map((item) => item.message).join('；'),
        },
      })
      continue
    }

    emit({
      nodeId,
      status: 'running',
      request: built.request,
      startedAt,
    })
    onRunning(nodeId)

    if (signal.aborted) {
      emit({ nodeId, status: 'skipped', note: '已停止' })
      aborted = true
      break
    }

    try {
      const outcome = await callSystemOne(built.request, signal)
      const ms = Date.now() - startedAt
      if (outcome.ok) {
        emit({
          nodeId,
          status: 'success',
          request: built.request,
          response: outcome.data,
          startedAt,
          ms,
          inputTokens: outcome.data.usage?.input_tokens ?? 0,
          outputTokens: outcome.data.usage?.output_tokens ?? 0,
        })
      } else {
        emit({
          nodeId,
          status: 'error',
          request: built.request,
          startedAt,
          ms,
          error: {
            status: outcome.status,
            code: outcome.code,
            message: outcome.message,
            hint: outcome.hint,
            detail: outcome.detail,
          },
        })
      }
    } catch (error) {
      if (signal.aborted) {
        emit({ nodeId, status: 'skipped', note: '已停止' })
        aborted = true
        break
      }
      emit({
        nodeId,
        status: 'error',
        request: built.request,
        startedAt,
        ms: Date.now() - startedAt,
        error: {
          code: 'network_error',
          message: error instanceof Error ? error.message : String(error),
        },
      })
    } finally {
      onRunning(null)
    }
  }

  return { results, aborted }
}
