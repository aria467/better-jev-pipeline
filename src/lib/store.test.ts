import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_SCENARIO, PRESETS } from './presets'
import type { Scenario } from './types'

const memory = new Map<string, string>()
vi.stubGlobal('localStorage', {
  getItem: (key: string) => memory.get(key) ?? null,
  setItem: (key: string, value: string) => {
    memory.set(key, value)
  },
  removeItem: (key: string) => {
    memory.delete(key)
  },
})

const { useStudio } = await import('./store')

const created = () => useStudio.getState().customScenarios[0] as Scenario

beforeEach(() => {
  vi.useFakeTimers()
  memory.clear()
  useStudio.setState({
    scenario: structuredClone(DEFAULT_SCENARIO),
    customScenarios: [],
    selectedId: 'n1',
    results: {},
    running: false,
    runningId: null,
    logOpen: false,
    toasts: [],
  })
})

afterEach(() => {
  vi.useRealTimers()
})

describe('renameScenario', () => {
  it('renames the active custom scenario in place', () => {
    useStudio.getState().createScenario('草稿场景')
    const id = useStudio.getState().scenario.id
    expect(useStudio.getState().renameScenario(id, '正式场景')).toBe(true)
    expect(useStudio.getState().scenario.name).toBe('正式场景')
    expect(created().name).toBe('正式场景')
    expect(created().id).toBe(id)
  })

  it('rejects duplicate and empty names, leaving state untouched', () => {
    useStudio.getState().createScenario('我的场景')
    const id = useStudio.getState().scenario.id
    expect(useStudio.getState().renameScenario(id, '简历初筛')).toBe(false)
    expect(useStudio.getState().renameScenario(id, '   ')).toBe(false)
    expect(useStudio.getState().scenario.name).toBe('我的场景')
  })

  it('refuses to rename built-in templates', () => {
    expect(useStudio.getState().renameScenario('support-triage', '改名')).toBe(false)
    expect(useStudio.getState().scenario.name).toBe(DEFAULT_SCENARIO.name)
  })

  it('keeps the active custom scenario name in sync when renaming another one', () => {
    useStudio.getState().createScenario('第一个场景')
    const first = useStudio.getState().scenario.id
    useStudio.getState().createScenario('第二个场景')
    const second = useStudio.getState().scenario.id
    expect(useStudio.getState().renameScenario(first, '第一个场景改名')).toBe(true)
    expect(useStudio.getState().scenario.id).toBe(second)
    expect(useStudio.getState().scenario.name).toBe('第二个场景')
    expect(useStudio.getState().customScenarios.map((item) => item.name)).toEqual([
      '第一个场景改名',
      '第二个场景',
    ])
  })

  it('leaves presets untouched in the custom list', () => {
    useStudio.getState().createScenario('我的场景')
    const names = useStudio.getState().customScenarios.map((item) => item.name)
    expect(names).not.toContain(PRESETS[0].name)
  })
})

describe('deleteScenario', () => {
  it('removes an inactive custom scenario and keeps the active one', () => {
    useStudio.getState().createScenario('要删除的场景')
    const doomed = useStudio.getState().scenario.id
    useStudio.getState().createScenario('保留的场景')
    const kept = useStudio.getState().scenario.id
    expect(useStudio.getState().deleteScenario(doomed)).toBe(true)
    expect(useStudio.getState().scenario.id).toBe(kept)
    expect(useStudio.getState().customScenarios.map((item) => item.id)).toEqual([kept])
  })

  it('falls back to the support template when deleting the active scenario', () => {
    useStudio.getState().createScenario('当前场景')
    const id = useStudio.getState().scenario.id
    expect(useStudio.getState().deleteScenario(id)).toBe(true)
    expect(useStudio.getState().scenario.id).toBe(DEFAULT_SCENARIO.id)
    expect(useStudio.getState().scenario.nodes).toHaveLength(DEFAULT_SCENARIO.nodes.length)
    expect(useStudio.getState().customScenarios).toEqual([])
    expect(useStudio.getState().results).toEqual({})
  })

  it('refuses to delete built-in templates', () => {
    expect(useStudio.getState().deleteScenario('support-triage')).toBe(false)
    expect(useStudio.getState().scenario.id).toBe(DEFAULT_SCENARIO.id)
  })

  it('blocks deletions while a run is in progress', () => {
    useStudio.getState().createScenario('运行中的场景')
    const id = useStudio.getState().scenario.id
    useStudio.setState({ running: true })
    expect(useStudio.getState().deleteScenario(id)).toBe(false)
    expect(useStudio.getState().customScenarios).toHaveLength(1)
  })
})

describe('logic nodes and edge conditions', () => {
  it('creates a logic node and edits its outputs', () => {
    const id = useStudio.getState().addNode('logic')
    const node = useStudio.getState().scenario.nodes.find((item) => item.id === id)
    expect(node?.kind).toBe('logic')
    if (node?.kind === 'logic') {
      expect(node.outputs).toEqual([{ id: 'out1', expression: '' }])
    }

    useStudio.getState().updateOutputs(id, [{ id: 'flag', expression: '1 > 0' }])
    const updated = useStudio.getState().scenario.nodes.find((item) => item.id === id)
    if (updated?.kind === 'logic') {
      expect(updated.outputs).toEqual([{ id: 'flag', expression: '1 > 0' }])
    } else {
      throw new Error('expected logic node')
    }
  })

  it('sets and clears edge conditions and stales the target subtree', () => {
    const id = useStudio.getState().addNode('logic')
    expect(useStudio.getState().addEdge(id, 'n2')).toBe(true)
    useStudio.setState({
      results: { n2: { nodeId: 'n2', status: 'success' } },
    })

    const edgeId = `e-${id}-n2`
    useStudio.getState().setEdgeWhen(edgeId, { output: 'out1', equals: true })
    const edge = useStudio.getState().scenario.edges.find((item) => item.id === edgeId)
    expect(edge?.when).toEqual({ output: 'out1', equals: true })
    expect(useStudio.getState().results.n2?.status).toBe('stale')

    useStudio.setState({
      results: { n2: { nodeId: 'n2', status: 'success' } },
    })
    useStudio.getState().setEdgeWhen(edgeId, undefined)
    const cleared = useStudio.getState().scenario.edges.find((item) => item.id === edgeId)
    expect(cleared && 'when' in cleared).toBe(false)
    expect(useStudio.getState().results.n2?.status).toBe('stale')
  })
})

describe('importing logic scenarios', () => {
  it('keeps logic nodes and edge conditions through import', () => {
    const source = structuredClone(DEFAULT_SCENARIO)
    source.id = 'imported'
    source.name = '导入逻辑'
    source.nodes.push({
      id: 'l1',
      kind: 'logic',
      title: '门',
      position: { x: 0, y: 900 },
      outputs: [{ id: 'flag', expression: '1 > 0' }],
    })
    source.edges.push({
      id: 'e-n1-l1',
      source: 'n1',
      target: 'l1',
      when: { output: 'flag', equals: true },
    })

    expect(useStudio.getState().importScenario(JSON.stringify(source))).toBe(true)
    const scenario = useStudio.getState().scenario
    expect(scenario.name).toContain('导入逻辑')
    expect(scenario.nodes.at(-1)?.kind).toBe('logic')
    expect(scenario.edges.at(-1)?.when).toEqual({ output: 'flag', equals: true })
    expect(useStudio.getState().customScenarios.at(-1)?.id).toBe(scenario.id)
  })
})
