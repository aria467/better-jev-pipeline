import { describe, expect, it } from 'vitest'
import { ancestorsOf, findCycle, topoOrder, wouldCreateCycle } from './graph'
import type { Edge, StepNode } from './types'

const node = (id: string, y: number): StepNode => ({
  id,
  title: id,
  state: '',
  questions: {},
  position: { x: 0, y },
  includeUpstream: true,
})

const nodes = [node('a', 0), node('b', 100), node('c', 200), node('d', 300)]
const edges: Edge[] = [
  { id: '1', source: 'a', target: 'b' },
  { id: '2', source: 'a', target: 'c' },
  { id: '3', source: 'b', target: 'd' },
  { id: '4', source: 'c', target: 'd' },
]

describe('topoOrder', () => {
  it('orders by dependencies then position', () => {
    expect(topoOrder(nodes, edges)).toEqual(['a', 'b', 'c', 'd'])
  })

  it('detects cycles', () => {
    const cyclic = [...edges, { id: '5', source: 'd', target: 'a' }]
    expect(findCycle(nodes, cyclic)).not.toBeNull()
    expect(topoOrder(nodes, cyclic)).toHaveLength(0)
  })
})

describe('ancestorsOf', () => {
  it('collects transitive parents', () => {
    expect([...ancestorsOf('d', edges)].sort()).toEqual(['a', 'b', 'c'])
  })
})

describe('wouldCreateCycle', () => {
  it('rejects self loops and back edges', () => {
    expect(wouldCreateCycle(edges, 'a', 'a')).toBe(true)
    expect(wouldCreateCycle(edges, 'd', 'a')).toBe(true)
    expect(wouldCreateCycle(edges, 'a', 'd')).toBe(false)
  })
})
