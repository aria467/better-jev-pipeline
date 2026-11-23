import { describe, expect, it, vi } from 'vitest'
import { executeOrder } from './runner'
import type { ApiStepNode, Scenario } from './types'

const callSystemOne = vi.fn()

vi.mock('./api', () => ({
  callSystemOne: (...args: unknown[]) => callSystemOne(...args),
}))

function apiNode(id: string, title = id): ApiStepNode {
  return {
    id,
    title,
    state: '内容',
    includeUpstream: false,
    position: { x: 0, y: 0 },
    questions: { q1: { type: 'noul', instructions: '是否？' } },
  }
}

const success = {
  ok: true as const,
  data: {
    model: 'test',
    answers: { q1: { type: 'noul' as const, noul: 0.9 } },
    usage: { input_tokens: 10, output_tokens: 0 },
  },
}

async function run(scenario: Scenario, order: string[]) {
  return executeOrder({
    scenario,
    order,
    seed: {},
    signal: new AbortController().signal,
    onRecord: () => {},
    onRunning: () => {},
  })
}

describe('executeOrder', () => {
  it('evaluates logic steps locally and gates conditional edges', async () => {
    callSystemOne.mockReset()
    callSystemOne.mockResolvedValue(success)

    const scenario: Scenario = {
      id: 'r',
      name: 'r',
      model: 'jev-latest',
      nodes: [
        {
          id: 'l1',
          kind: 'logic',
          title: '门',
          position: { x: 0, y: 0 },
          outputs: [
            { id: 'yes', expression: '1 > 0' },
            { id: 'no', expression: '1 < 0' },
          ],
        },
        apiNode('a_true', '真分支'),
        apiNode('a_skip', '应跳过'),
        apiNode('a_false', '假分支'),
      ],
      edges: [
        { id: 'e1', source: 'l1', target: 'a_true', when: { output: 'yes', equals: true } },
        { id: 'e2', source: 'l1', target: 'a_skip', when: { output: 'no', equals: true } },
        { id: 'e3', source: 'l1', target: 'a_false', when: { output: 'no', equals: false } },
      ],
    }

    const outcome = await run(scenario, ['l1', 'a_true', 'a_skip', 'a_false'])
    const results = outcome.results

    expect(results.l1.status).toBe('success')
    expect(results.l1.outputs).toEqual({ yes: true, no: false })
    expect(results.l1.ms).toBeTypeOf('number')

    expect(results.a_true.status).toBe('success')
    expect(results.a_false.status).toBe('success')
    expect(results.a_skip.status).toBe('skipped')
    expect(results.a_skip.note).toContain('条件')
    expect(results.a_skip.note).toContain('l1.no = 真')

    expect(callSystemOne).toHaveBeenCalledTimes(2)
  })

  it('fails the logic node and skips descendants when an output cannot resolve', async () => {
    callSystemOne.mockReset()
    callSystemOne.mockResolvedValue(success)

    const scenario: Scenario = {
      id: 'r',
      name: 'r',
      model: 'jev-latest',
      nodes: [
        {
          id: 'l1',
          kind: 'logic',
          title: '门',
          position: { x: 0, y: 0 },
          outputs: [{ id: 'bad', expression: '{{l1.missing}} > 1' }],
        },
        apiNode('a1'),
      ],
      edges: [{ id: 'e1', source: 'l1', target: 'a1' }],
    }

    const outcome = await run(scenario, ['l1', 'a1'])
    expect(outcome.results.l1.status).toBe('error')
    expect(outcome.results.l1.error?.code).toBe('logic_error')
    expect(outcome.results.a1.status).toBe('skipped')
    expect(outcome.results.a1.note).toContain('未成功')
    expect(callSystemOne).not.toHaveBeenCalled()
  })

  it('reports template errors before calling the API', async () => {
    callSystemOne.mockReset()
    callSystemOne.mockResolvedValue(success)

    const root = apiNode('n1', '上游')
    const downstream = apiNode('n2', '下游')
    downstream.state = { value: '{{n1.q1.nope}}' }

    const scenario: Scenario = {
      id: 'r',
      name: 'r',
      model: 'jev-latest',
      nodes: [root, downstream],
      edges: [{ id: 'e1', source: 'n1', target: 'n2' }],
    }

    const outcome = await run(scenario, ['n1', 'n2'])
    expect(outcome.results.n1.status).toBe('success')
    expect(outcome.results.n2.status).toBe('error')
    expect(outcome.results.n2.error?.code).toBe('template_error')
    expect(callSystemOne).toHaveBeenCalledTimes(1)
  })

  it('skips descendants when an API call fails', async () => {
    callSystemOne.mockReset()
    callSystemOne.mockResolvedValue({
      ok: false,
      status: 500,
      code: 'server_error',
      message: 'boom',
    })

    const scenario: Scenario = {
      id: 'r',
      name: 'r',
      model: 'jev-latest',
      nodes: [apiNode('n1'), apiNode('n2')],
      edges: [{ id: 'e1', source: 'n1', target: 'n2' }],
    }

    const outcome = await run(scenario, ['n1', 'n2'])
    expect(outcome.results.n1.status).toBe('error')
    expect(outcome.results.n2.status).toBe('skipped')
    expect(callSystemOne).toHaveBeenCalledTimes(1)
  })
})

describe('chained logic steps', () => {
  it('passes boolean outputs between logic steps', async () => {
    callSystemOne.mockReset()
    const scenario: Scenario = {
      id: 'chain',
      name: 'chain',
      model: 'jev-latest',
      nodes: [
        {
          id: 'l1',
          kind: 'logic',
          title: '第一层',
          position: { x: 0, y: 0 },
          outputs: [{ id: 'yes', expression: '1 > 0' }],
        },
        {
          id: 'l2',
          kind: 'logic',
          title: '第二层',
          position: { x: 0, y: 200 },
          outputs: [{ id: 'both', expression: '{{l1.yes}} AND 2 > 1' }],
        },
      ],
      edges: [{ id: 'e1', source: 'l1', target: 'l2' }],
    }

    const outcome = await run(scenario, ['l1', 'l2'])
    expect(outcome.results.l1.outputs).toEqual({ yes: true })
    expect(outcome.results.l2.status).toBe('success')
    expect(outcome.results.l2.outputs).toEqual({ both: true })
    expect(callSystemOne).not.toHaveBeenCalled()
  })
})
