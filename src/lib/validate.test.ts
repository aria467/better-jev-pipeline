import { describe, expect, it } from 'vitest'
import { PRESETS } from './presets'
import { validateScenario } from './validate'
import type { ApiStepNode, Scenario } from './types'

describe('validateScenario', () => {
  it('accepts the bundled presets', () => {
    for (const preset of PRESETS) {
      const result = validateScenario(preset)
      expect(result.errorCount, `${preset.name}: ${result.issues.map((i) => i.message).join('; ')}`).toBe(0)
    }
  })

  it('rejects empty choice criteria', () => {
    const scenario = structuredClone(PRESETS[0]) as Scenario
    const question = (scenario.nodes[0] as ApiStepNode).questions.department
    if (question.type === 'choice') question.options = []
    const result = validateScenario(scenario)
    expect(result.errorCount).toBeGreaterThan(0)
    expect(result.byNode.n1?.join(' ')).toContain('至少需要一个选项')
  })

  it('rejects references to non-ancestors', () => {
    const scenario = structuredClone(PRESETS[1]) as Scenario
    scenario.edges = []
    const result = validateScenario(scenario)
    expect(result.errorCount).toBeGreaterThan(0)
    expect(result.issues.some((issue) => issue.message.includes('不是该节点的上游'))).toBe(true)
  })

  it('rejects cycles', () => {
    const scenario = structuredClone(PRESETS[1]) as Scenario
    scenario.edges.push({ id: 'back', source: 'n3', target: 'n1' })
    const result = validateScenario(scenario)
    expect(result.cycle).not.toBeNull()
  })
})

function logicScenario(): Scenario {
  return {
    id: 'logic',
    name: 'logic',
    model: 'jev-latest',
    nodes: [
      {
        id: 'n1',
        title: '判断',
        state: '内容',
        includeUpstream: false,
        position: { x: 0, y: 0 },
        questions: {
          dept: {
            type: 'choice',
            instructions: '',
            options: [{ name: '财务', description: '' }],
          },
          urgent: { type: 'noul', instructions: '' },
        },
      },
      {
        id: 'n2',
        kind: 'logic',
        title: '门',
        position: { x: 0, y: 200 },
        outputs: [
          {
            id: 'flag',
            expression:
              '{{n1.dept.probabilities.财务}} > 0.4 AND {{n1.urgent.noul}} > 0.5',
          },
        ],
      },
      {
        id: 'n3',
        title: '下游',
        state: { flag: '{{n2.flag}}' },
        includeUpstream: false,
        position: { x: 0, y: 400 },
        questions: { q: { type: 'noul', instructions: '' } },
      },
    ],
    edges: [
      { id: 'e1', source: 'n1', target: 'n2' },
      { id: 'e2', source: 'n2', target: 'n3', when: { output: 'flag', equals: true } },
    ],
  }
}

function messages(scenario: Scenario): string {
  return validateScenario(scenario).issues.map((issue) => issue.message).join('；')
}

describe('logic step validation', () => {
  it('accepts a wired logic step and its boolean template', () => {
    const result = validateScenario(logicScenario())
    expect(result.errorCount, messages(logicScenario())).toBe(0)
  })

  it('requires at least one output and non-empty boolean expressions', () => {
    const scenario = logicScenario()
    const logic = scenario.nodes[1]
    if (logic.kind === 'logic') logic.outputs = []
    expect(messages(scenario)).toContain('至少需要一个输出')

    const second = logicScenario()
    const node = second.nodes[1]
    if (node.kind === 'logic') {
      node.outputs = [
        { id: 'flag', expression: '' },
        { id: 'flag', expression: '{{n1.urgent.noul}}' },
      ]
    }
    const text = messages(second)
    expect(text).toContain('表达式为空')
    expect(text).toContain('重复')
    expect(text).toContain('布尔')
  })

  it('checks ancestry and existence of referenced values', () => {
    const scenario = logicScenario()
    const node = scenario.nodes[1]
    if (node.kind === 'logic') node.outputs[0].expression = '{{n3.q.noul}} > 0.5'
    expect(messages(scenario)).toContain('不是该节点的上游')

    const missing = logicScenario()
    const target = missing.nodes[1]
    if (target.kind === 'logic') target.outputs[0].expression = '{{n9.x}} > 0.5'
    expect(messages(missing)).toContain('不存在的节点')
  })

  it('validates edge conditions against logic outputs', () => {
    const fromApi = logicScenario()
    fromApi.edges.push({
      id: 'bad',
      source: 'n1',
      target: 'n3',
      when: { output: 'flag', equals: true },
    })
    expect(messages(fromApi)).toContain('只能由逻辑步')

    const missingOutput = logicScenario()
    const edge = missingOutput.edges[1]
    edge.when = { output: 'nope', equals: true }
    expect(messages(missingOutput)).toContain('不存在的输出')

    const wrongOutput = logicScenario()
    const downstream = wrongOutput.nodes[2]
    if (downstream.kind !== 'logic') downstream.state = { flag: '{{n2.nope}}' }
    expect(messages(wrongOutput)).toContain('不存在的输出')
  })
})
