/**
 * 端到端冒烟测试：按 DAG 顺序真实调用本地 studio 服务，
 * 验证模板解析、上游注入与 Jev 响应结构。
 *
 * 用法：先 `pnpm dev:server`，再 `pnpm smoke`。
 */
import { setTimeout as delay } from 'node:timers/promises'
import { parentsOf, topoOrder } from '../src/lib/graph'
import { PRESETS } from '../src/lib/presets'
import { buildRequest } from '../src/lib/request'
import type { RunRecord, SystemOneResponse } from '../src/lib/types'

const base = process.env.STUDIO_URL || 'http://127.0.0.1:8791'
const scenario = PRESETS[0]
const results: Record<string, RunRecord> = {}

async function main() {
  for (let attempt = 0; attempt < 15; attempt += 1) {
    try {
      const health = await fetch(`${base}/api/health`)
      if (health.ok) break
    } catch {
      // server not up yet
    }
    await delay(500)
  }

  const order = topoOrder(scenario.nodes, scenario.edges)
  console.log(`scenario: ${scenario.name} · order: ${order.join(' → ')}`)

  for (const id of order) {
    const node = scenario.nodes.find((item) => item.id === id)!
    const failed = parentsOf(id, scenario.edges).find(
      (parent) => results[parent]?.status !== 'success',
    )
    if (failed) {
      console.log(`- ${id} skipped (parent ${failed})`)
      continue
    }
    const built = buildRequest({ scenario, node, results })
    if (built.errors.length) {
      throw new Error(`${id} templates: ${built.errors.map((item) => item.message).join('; ')}`)
    }
    const started = Date.now()
    const res = await fetch(`${base}/api/systemone`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(built.request),
    })
    const text = await res.text()
    if (!res.ok) throw new Error(`${id} HTTP ${res.status}: ${text.slice(0, 400)}`)
    const response = JSON.parse(text) as SystemOneResponse
    results[id] = {
      nodeId: id,
      status: 'success',
      request: built.request,
      response,
      ms: Date.now() - started,
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
    }
    const summary = Object.entries(response.answers)
      .map(([qid, answer]) => {
        if (answer.type === 'choice') return `${qid}=${answer.choice}(${answer.confidence.toFixed(2)})`
        if (answer.type === 'noul') return `${qid}=${answer.noul.toFixed(2)}`
        if (answer.type === 'score') return `${qid}=${answer.score.toFixed(2)}`
        return qid
      })
      .join('  ')
    console.log(
      `- ${id} ${node.title}  ${Date.now() - started}ms  ${response.usage.input_tokens} tok  ${summary}`,
    )
  }

  const state = results.n4?.request?.state as Record<string, unknown> | undefined
  if (state) {
    console.log('n4 resolved state:', JSON.stringify(state, null, 2))
  }
  const total = Object.values(results).reduce((sum, record) => sum + (record.inputTokens ?? 0), 0)
  console.log(`total input tokens: ${total} · cost $${((total * 42) / 1e9).toFixed(8)}`)
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
