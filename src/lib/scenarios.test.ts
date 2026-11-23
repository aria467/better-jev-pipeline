import { describe, expect, it } from 'vitest'
import { DEFAULT_SCENARIO, PRESETS } from './presets'
import type { ApiStepNode } from './types'
import {
  createCustomScenario,
  findScenario,
  isScenarioNameAvailable,
  restoreScenarios,
  scenarioOptions,
  suggestScenarioName,
  syncCustomScenarios,
} from './scenarios'

const presetIds = new Set(PRESETS.map((scenario) => scenario.id))

describe('createCustomScenario', () => {
  it('copies the support template with a new id and name', () => {
    const created = createCustomScenario(DEFAULT_SCENARIO, '我的工单场景', 'custom-1')
    expect(created.id).toBe('custom-1')
    expect(created.name).toBe('我的工单场景')
    expect(created.description).toContain('客服工单分流')
    expect(created.nodes.map((node) => node.id)).toEqual(
      DEFAULT_SCENARIO.nodes.map((node) => node.id),
    )
    expect(created.edges).toEqual(DEFAULT_SCENARIO.edges)
    expect(created.nodes).toHaveLength(4)
  })

  it('does not mutate the template', () => {
    const before = JSON.stringify(DEFAULT_SCENARIO)
    const created = createCustomScenario(DEFAULT_SCENARIO, '副本', 'custom-2')
    created.nodes[0].title = '被改过的标题'
    ;(created.nodes[0] as ApiStepNode).state = '被改过的 state'
    created.edges = []
    expect(JSON.stringify(DEFAULT_SCENARIO)).toBe(before)
  })
})

describe('scenario names', () => {
  it('rejects empty and duplicate names', () => {
    const names = ['客服工单分流', '我的场景']
    expect(isScenarioNameAvailable('', names)).toBe(false)
    expect(isScenarioNameAvailable('   ', names)).toBe(false)
    expect(isScenarioNameAvailable('  我的场景 ', names)).toBe(false)
    expect(isScenarioNameAvailable('新场景', names)).toBe(true)
  })

  it('suggests unique names', () => {
    expect(suggestScenarioName('客服工单分流 副本', [])).toBe('客服工单分流 副本')
    expect(suggestScenarioName('副本', ['副本'])).toBe('副本 2')
    expect(suggestScenarioName('副本', ['副本', '副本 2'])).toBe('副本 3')
  })
})

describe('syncCustomScenarios', () => {
  const customA = createCustomScenario(DEFAULT_SCENARIO, 'A', 'custom-a')
  const customB = createCustomScenario(DEFAULT_SCENARIO, 'B', 'custom-b')

  it('ignores preset scenarios', () => {
    const list = [customA]
    expect(syncCustomScenarios(list, PRESETS[0], presetIds)).toBe(list)
  })

  it('updates a registered custom scenario in place', () => {
    const edited = { ...customA, name: 'A2' }
    const result = syncCustomScenarios([customA, customB], edited, presetIds)
    expect(result.map((scenario) => scenario.name)).toEqual(['A2', 'B'])
  })

  it('registers an unregistered custom scenario', () => {
    const result = syncCustomScenarios([customB], customA, presetIds)
    expect(result.map((scenario) => scenario.id)).toEqual(['custom-b', 'custom-a'])
  })
})

describe('scenario lists', () => {
  it('finds presets and customs', () => {
    const customA = createCustomScenario(DEFAULT_SCENARIO, 'A', 'custom-a')
    expect(findScenario(PRESETS, [customA], 'support-triage')?.name).toBe('客服工单分流')
    expect(findScenario(PRESETS, [customA], 'custom-a')?.name).toBe('A')
    expect(findScenario(PRESETS, [customA], 'missing')).toBeUndefined()
  })

  it('builds grouped options', () => {
    const customA = createCustomScenario(DEFAULT_SCENARIO, 'A', 'custom-a')
    const options = scenarioOptions(PRESETS, [customA])
    expect(options).toHaveLength(5)
    expect(options.filter((option) => option.kind === 'preset')).toHaveLength(4)
    expect(options.at(-1)).toEqual({ id: 'custom-a', name: 'A', kind: 'custom' })
  })
})

describe('restoreScenarios', () => {
  it('drops edits to a preset and restores the template', () => {
    const edited = structuredClone(DEFAULT_SCENARIO)
    edited.nodes[0].title = '预设被改'
    const restored = restoreScenarios(edited, [], {
      presets: PRESETS,
      fallback: DEFAULT_SCENARIO,
    })
    expect(restored.scenario.id).toBe(DEFAULT_SCENARIO.id)
    expect(restored.scenario.nodes[0].title).toBe(DEFAULT_SCENARIO.nodes[0].title)
    expect(restored.customScenarios).toEqual([])
  })

  it('keeps a custom scenario with its edits', () => {
    const custom = createCustomScenario(DEFAULT_SCENARIO, '我的场景', 'custom-r')
    custom.nodes[0].title = '改过的标题'
    const restored = restoreScenarios(custom, [custom], {
      presets: PRESETS,
      fallback: DEFAULT_SCENARIO,
    })
    expect(restored.scenario.nodes[0].title).toBe('改过的标题')
    expect(restored.customScenarios.map((scenario) => scenario.id)).toEqual(['custom-r'])
  })

  it('falls back when stored data is malformed', () => {
    const restored = restoreScenarios(
      { id: 'broken', nodes: 'x', edges: null },
      [null, { id: 5 }, { id: 'ok', nodes: [], edges: [] }],
      { presets: PRESETS, fallback: DEFAULT_SCENARIO },
    )
    expect(restored.scenario.id).toBe(DEFAULT_SCENARIO.id)
    expect(restored.customScenarios.map((scenario) => scenario.id)).toEqual(['ok'])
  })
})

describe('restoreScenarios with logic nodes', () => {
  it('keeps valid logic nodes and drops malformed ones', () => {
    const custom = createCustomScenario(DEFAULT_SCENARIO, '含逻辑', 'custom-logic')
    custom.nodes.push({
      id: 'l1',
      kind: 'logic',
      title: '门',
      position: { x: 0, y: 900 },
      outputs: [{ id: 'flag', expression: '1 > 0' }],
    })
    const broken = {
      ...createCustomScenario(DEFAULT_SCENARIO, '坏节点', 'custom-broken'),
      nodes: [{ id: 'l2', kind: 'logic', title: '坏', position: { x: 0, y: 0 } }],
    }

    const restored = restoreScenarios(custom, [custom, broken], {
      presets: PRESETS,
      fallback: DEFAULT_SCENARIO,
    })
    expect(restored.scenario.id).toBe('custom-logic')
    expect(restored.scenario.nodes.some((node) => node.kind === 'logic')).toBe(true)
    expect(restored.customScenarios.map((scenario) => scenario.id)).toEqual(['custom-logic'])
  })
})
