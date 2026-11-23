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
})
