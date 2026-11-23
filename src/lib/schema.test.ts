import { describe, expect, it } from 'vitest'
import { parseScenario } from './schema'

const base = {
  id: 's',
  name: '场景',
  model: 'jev-latest',
}

const apiNode = {
  id: 'n1',
  title: '步骤',
  state: '内容',
  questions: { q: { type: 'noul', instructions: '' } },
  position: { x: 0, y: 0 },
  includeUpstream: true,
}

const logicNode = {
  id: 'n2',
  kind: 'logic',
  title: '门',
  outputs: [{ id: 'flag', expression: '{{n1.q.noul}} > 0.5' }],
  position: { x: 0, y: 200 },
}

describe('parseScenario', () => {
  it('restores legacy scenarios without a node kind', () => {
    const parsed = parseScenario({
      ...base,
      nodes: [apiNode],
      edges: [],
    })
    expect(parsed.error).toBeUndefined()
    const node = parsed.scenario?.nodes[0]
    expect(node?.id).toBe('n1')
    expect(node?.kind).toBeUndefined()
    if (node && node.kind !== 'logic') {
      expect(node.state).toBe('内容')
    }
  })

  it('keeps logic nodes and edge conditions intact', () => {
    const parsed = parseScenario({
      ...base,
      nodes: [apiNode, logicNode],
      edges: [
        { id: 'e1', source: 'n1', target: 'n2' },
        {
          id: 'e2',
          source: 'n2',
          target: 'n1',
          when: { output: 'flag', equals: false },
        },
      ],
    })
    expect(parsed.error).toBeUndefined()
    const logic = parsed.scenario?.nodes[1]
    expect(logic?.kind).toBe('logic')
    if (logic?.kind === 'logic') {
      expect(logic.outputs).toEqual([{ id: 'flag', expression: '{{n1.q.noul}} > 0.5' }])
    }
    expect(parsed.scenario?.edges[1].when).toEqual({ output: 'flag', equals: false })
    expect(parsed.scenario?.edges[0].when).toBeUndefined()
  })

  it('rejects malformed logic nodes', () => {
    const parsed = parseScenario({
      ...base,
      nodes: [{ id: 'n2', kind: 'logic', title: '门', position: { x: 0, y: 0 } }],
      edges: [],
    })
    expect(parsed.scenario).toBeUndefined()
    expect(parsed.error).toBeTruthy()
  })

  it('accepts any expression text and leaves checking to validation', () => {
    const parsed = parseScenario({
      ...base,
      nodes: [
        {
          ...logicNode,
          outputs: [{ id: 'flag', expression: '这不是表达式' }],
        },
      ],
      edges: [],
    })
    expect(parsed.error).toBeUndefined()
  })

  it('keeps structured graph output across import and export', () => {
    const graph = {
      kind: 'group',
      id: 'g1',
      op: 'and',
      negated: false,
      items: [
        {
          kind: 'compare',
          id: 'c1',
          op: '>',
          negated: false,
          left: { kind: 'ref', path: 'n1.q.noul' },
          right: { kind: 'number', text: '0.5' },
        },
      ],
    }
    const input = {
      ...base,
      nodes: [
        apiNode,
        {
          ...logicNode,
          outputs: [{ id: 'flag', expression: 'stale', graph, mode: 'graph' }],
        },
      ],
      edges: [],
    }
    const parsed = parseScenario(input)
    expect(parsed.error).toBeUndefined()
    const output = parsed.scenario?.nodes[1]
    if (output?.kind !== 'logic') throw new Error('shape')
    expect(output.outputs[0].graph).toEqual(graph)
    expect(output.outputs[0].expression).toBe('{{n1.q.noul}} > 0.5')

    const again = parseScenario(parsed.scenario)
    expect(again.scenario).toEqual(parsed.scenario)
  })

  it('drops a malformed graph and falls back to text', () => {
    const parsed = parseScenario({
      ...base,
      nodes: [
        apiNode,
        {
          ...logicNode,
          outputs: [
            {
              id: 'flag',
              expression: '1 > 0',
              graph: { kind: 'nope' },
              mode: 'graph',
            },
          ],
        },
      ],
      edges: [],
    })
    expect(parsed.error).toBeUndefined()
    const output = parsed.scenario?.nodes[1]
    if (output?.kind !== 'logic') throw new Error('shape')
    expect(output.outputs[0].graph).toBeUndefined()
    expect(output.outputs[0].mode).toBe('text')
    expect(output.outputs[0].expression).toBe('1 > 0')
  })
})
