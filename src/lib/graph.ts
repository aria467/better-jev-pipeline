import type { Edge, StepNode } from './types'

type NodeLike = Pick<StepNode, 'id' | 'position'>

export function parentsOf(id: string, edges: Edge[]): string[] {
  return edges.filter((edge) => edge.target === id).map((edge) => edge.source)
}

export function childrenOf(id: string, edges: Edge[]): string[] {
  return edges.filter((edge) => edge.source === id).map((edge) => edge.target)
}

export function ancestorsOf(id: string, edges: Edge[]): Set<string> {
  const seen = new Set<string>()
  const stack = [...parentsOf(id, edges)]
  while (stack.length) {
    const next = stack.pop()!
    if (seen.has(next)) continue
    seen.add(next)
    stack.push(...parentsOf(next, edges))
  }
  return seen
}

export function descendantsOf(id: string, edges: Edge[]): Set<string> {
  const seen = new Set<string>()
  const stack = [...childrenOf(id, edges)]
  while (stack.length) {
    const next = stack.pop()!
    if (seen.has(next)) continue
    seen.add(next)
    stack.push(...childrenOf(next, edges))
  }
  return seen
}

export function wouldCreateCycle(edges: Edge[], source: string, target: string): boolean {
  if (source === target) return true
  if (ancestorsOf(source, edges).has(target)) return true
  return false
}

export function topoOrder(nodes: NodeLike[], edges: Edge[]): string[] {
  const ids = nodes.map((node) => node.id)
  const indegree = new Map(ids.map((id) => [id, 0]))
  for (const edge of edges) {
    if (indegree.has(edge.target)) indegree.set(edge.target, (indegree.get(edge.target) ?? 0) + 1)
  }
  const position = new Map(nodes.map((node) => [node.id, node.position]))
  const rank = (id: string) => {
    const p = position.get(id)
    return p ? p.y * 10_000 + p.x : Number.MAX_SAFE_INTEGER
  }
  const ready = ids.filter((id) => (indegree.get(id) ?? 0) === 0).sort((a, b) => rank(a) - rank(b))
  const order: string[] = []
  while (ready.length) {
    const id = ready.shift()!
    order.push(id)
    for (const child of childrenOf(id, edges)) {
      const left = (indegree.get(child) ?? 0) - 1
      indegree.set(child, left)
      if (left === 0) {
        ready.push(child)
        ready.sort((a, b) => rank(a) - rank(b))
      }
    }
  }
  return order
}

export function findCycle(nodes: NodeLike[], edges: Edge[]): string[] | null {
  const order = topoOrder(nodes, edges)
  if (order.length === nodes.length) return null

  const state = new Map<string, 0 | 1 | 2>()
  const stack: string[] = []
  let cycle: string[] | null = null

  const visit = (id: string) => {
    if (cycle) return
    const current = state.get(id) ?? 0
    if (current === 1) {
      const start = stack.indexOf(id)
      cycle = [...stack.slice(start), id]
      return
    }
    if (current === 2) return
    state.set(id, 1)
    stack.push(id)
    for (const child of childrenOf(id, edges)) visit(child)
    stack.pop()
    state.set(id, 2)
  }

  for (const node of nodes) visit(node.id)
  return cycle
}

export function sortedByExecution(nodes: StepNode[], order: string[]): StepNode[] {
  const map = new Map(nodes.map((node) => [node.id, node]))
  return order.map((id) => map.get(id)).filter((node): node is StepNode => Boolean(node))
}
