import { describe, expect, it } from 'vitest'
import {
  checkBuilderNode,
  collectBuilderRefs,
  collectScenarioRefs,
  emptyBuilderTree,
  emptyGroup,
  expressionToTree,
  formatBuilderTree,
  isBuilderTree,
  logicOutputExpression,
  normalizeBuilderTree,
  normalizeLogicOutputs,
} from './logic-builder'
import type { BuilderNode } from './logic-builder'
import { evaluateExpression, parseExpression, refTypeInScenario } from './logic'
import type { LogicValueType } from './logic'
import type { JsonValue, Scenario } from './types'

const types: Record<string, LogicValueType> = {
  'n1.dept.choice': 'string',
  'n1.dept.confidence': 'number',
  'n1.dept.probabilities.财务': 'number',
  'n1.dept.probabilities.技术': 'number',
  'n1.risk.score': 'number',
  'n1.urgent.noul': 'number',
  'n1.high_value.noul': 'number',
  'n2.a': 'boolean',
  'n2.b': 'boolean',
  'n2.c': 'boolean',
}

const values: Record<string, JsonValue> = {
  'n1.dept.choice': '财务',
  'n1.dept.confidence': 0.9,
  'n1.dept.probabilities.财务': 0.72,
  'n1.dept.probabilities.技术': 0.28,
  'n1.risk.score': 1.4,
  'n1.urgent.noul': 0.8,
  'n1.high_value.noul': 0.3,
  'n2.a': true,
  'n2.b': false,
  'n2.c': true,
}

const resolveType = (path: string) =>
  path in types ? { type: types[path] } : { error: `未知引用 ${path}` }

const resolveValue = (path: string) =>
  path in values ? { value: values[path] } : { error: `缺少 ${path}` }

type Outcome = { value: JsonValue } | { error: string }

function evaluateText(text: string): Outcome {
  const parsed = parseExpression(text)
  if ('error' in parsed) return { error: parsed.error.message }
  const result = evaluateExpression(parsed.ast, resolveValue)
  if ('error' in result) return { error: result.error.message }
  return { value: result.value }
}

function treeOf(text: string): BuilderNode {
  const result = expressionToTree(text, resolveType)
  if ('error' in result) throw new Error(`${text} -> ${result.error.message}`)
  return result.tree
}

function expectRoundTrip(text: string): string {
  const tree = treeOf(text)
  const formatted = formatBuilderTree(tree)
  expect(formatted).not.toMatch(/NAND|XNOR|&&|\|\|/)
  expect(formatted.replace(/!=/g, '')).not.toContain('!')
  expect(formatted).not.toMatch(/NOT (?!\()/)
  expect(evaluateText(formatted)).toEqual(evaluateText(text))
  expect(formatBuilderTree(treeOf(formatted))).toBe(formatted)
  return formatted
}

describe('expressionToTree / formatBuilderTree', () => {
  const cases = [
    '{{n2.a}} AND {{n2.b}}',
    '{{n2.a}} OR {{n2.b}} AND {{n2.c}}',
    '({{n2.a}} OR {{n2.b}}) AND {{n2.c}}',
    '({{n2.a}} OR {{n2.b}})',
    'NOT (({{n2.a}} OR {{n2.b}}))',
    '{{n2.a}} XOR {{n2.b}} AND {{n2.c}}',
    'NOT ({{n2.a}} OR {{n2.b}})',
    'NOT {{n2.a}}',
    'NOT NOT {{n2.a}}',
    '{{n2.a}} NAND {{n2.b}}',
    '{{n2.a}} XNOR {{n2.b}}',
    '{{n2.a}} AND {{n2.b}} NAND {{n2.c}}',
    '{{n2.a}} NAND {{n2.b}} AND {{n2.c}}',
    '{{n2.a}} == true',
    '{{n2.a}} == false',
    '{{n2.a}} != true',
    '{{n2.a}} != false',
    '{{n2.a}} == {{n2.b}}',
    '({{n1.risk.score}} > 1) == ({{n1.urgent.noul}} > 0.5)',
    '{{n1.high_value.noul}} < 0.4 AND {{n1.risk.score}} < 0.5 AND {{n1.dept.choice}} != "其他"',
    '{{n1.risk.score}} * 2 + 1 > 3',
    '({{n1.risk.score}} + 1) * 2 < 5',
    '{{n1.risk.score}} - ({{n1.urgent.noul}} - 0.5) > 0',
    '-{{n1.risk.score}} > -2',
    '2 - -3 > 4',
    '{{n1.dept.probabilities.财务}} * 2 > {{n1.urgent.noul}} / 2',
    '{{n1.dept.choice}} == "财务"',
    "{{n1.dept.choice}} == '财务'",
    '{{n1.dept.choice}} == "a\\"b"',
    '{{n1.dept.choice}} == "a\\\\b"',
    '"{{n2.a}}" == "{{n2.a}}"',
    'true',
    'false',
    '{{n2.a}}',
  ]

  for (const text of cases) {
    it(`round-trips ${text}`, () => {
      expectRoundTrip(text)
    })
  }

  it('keeps NAND chains semantically correct', () => {
    const chain = '{{n2.a}} NAND {{n2.b}} NAND {{n2.c}}'
    const flat = 'NOT ({{n2.a}} AND {{n2.b}} AND {{n2.c}})'
    expect(evaluateText(chain)).toEqual({ value: false })
    expect(evaluateText(flat)).toEqual({ value: true })
    expectRoundTrip(chain)
  })

  it('normalizes nested groups with parentheses', () => {
    expect(expectRoundTrip('{{n2.a}} OR {{n2.b}} AND {{n2.c}}')).toBe(
      '{{n2.a}} OR ({{n2.b}} AND {{n2.c}})',
    )
    expect(expectRoundTrip('({{n2.a}} OR {{n2.b}}) AND {{n2.c}}')).toBe(
      '({{n2.a}} OR {{n2.b}}) AND {{n2.c}}',
    )
  })

  it('preserves arithmetic grouping', () => {
    expect(expectRoundTrip('{{n1.risk.score}} - ({{n1.urgent.noul}} - 0.5) > 0')).toContain(
      '({{n1.risk.score}} - ({{n1.urgent.noul}} - 0.5))',
    )
  })

  it('reports expressions that cannot be represented', () => {
    const numeric = expressionToTree('{{n1.risk.score}}', resolveType)
    expect('error' in numeric && numeric.error.message).toContain('布尔')

    const unknown = expressionToTree('{{n9.x}} > 1', resolveType)
    expect('tree' in unknown).toBe(true)
    if ('tree' in unknown) {
      expect(
        checkBuilderNode(unknown.tree, resolveType).issues.some((issue) =>
          issue.message.includes('未知引用'),
        ),
      ).toBe(true)
    }
  })

  it('accepts an empty expression as an empty tree', () => {
    const tree = treeOf('   ')
    expect(tree.kind).toBe('group')
    expect(formatBuilderTree(tree)).toBe('')
  })
})

describe('checkBuilderNode', () => {
  it('flags empty and incomplete conditions', () => {
    const empty = checkBuilderNode(emptyBuilderTree(), resolveType)
    expect(empty.expression).toBe('')
    expect(empty.issues.length).toBeGreaterThan(0)

    const tree = treeOf('{{n1.risk.score}} > 1')
    if (tree.kind !== 'group' || tree.items[0].kind !== 'compare') throw new Error('shape')
    const broken: BuilderNode = {
      ...tree,
      items: [{ ...tree.items[0], right: { kind: 'number', text: '' } }],
    }
    const check = checkBuilderNode(broken, resolveType)
    expect(check.expression).toBe('')
    expect(check.issues.some((issue) => issue.side === 'right')).toBe(true)
  })

  it('flags type mismatches and invalid arithmetic', () => {
    const mismatch = treeOf('{{n1.risk.score}} > 1')
    if (mismatch.kind !== 'group' || mismatch.items[0].kind !== 'compare') throw new Error('shape')
    const bad: BuilderNode = {
      ...mismatch,
      items: [{ ...mismatch.items[0], right: { kind: 'string', value: 'x' } }],
    }
    expect(
      checkBuilderNode(bad, resolveType).issues.some((issue) =>
        issue.message.includes('类型不一致'),
      ),
    ).toBe(true)

    const loose: BuilderNode = {
      ...mismatch,
      items: [{ ...mismatch.items[0], right: { kind: 'arith', text: '1 +' } }],
    }
    expect(
      checkBuilderNode(loose, resolveType).issues.some((issue) => issue.side === 'right'),
    ).toBe(true)

    const booleanArith: BuilderNode = {
      ...mismatch,
      items: [{ ...mismatch.items[0], right: { kind: 'arith', text: '{{n2.a}}' } }],
    }
    expect(
      checkBuilderNode(booleanArith, resolveType).issues.some((issue) =>
        issue.message.includes('必须得到数字'),
      ),
    ).toBe(true)
  })

  it('flags empty groups and unknown refs', () => {
    const group = emptyGroup()
    group.items = []
    expect(
      checkBuilderNode(group, resolveType).issues.some((issue) =>
        issue.message.includes('条件组为空'),
      ),
    ).toBe(true)

    const tree = treeOf('{{n1.risk.score}} > 1')
    if (tree.kind !== 'group' || tree.items[0].kind !== 'compare') throw new Error('shape')
    const unknown: BuilderNode = {
      ...tree,
      items: [{ ...tree.items[0], left: { kind: 'ref', path: 'n9.x' } }],
    }
    expect(
      checkBuilderNode(unknown, resolveType).issues.some((issue) =>
        issue.message.includes('未知引用'),
      ),
    ).toBe(true)
  })

  it('returns refs even when parts are invalid', () => {
    const check = checkBuilderNode(treeOf('{{n1.risk.score}} > 1'), resolveType)
    expect(check.refs).toEqual(['n1.risk.score'])
    expect(check.issues).toEqual([])
  })
})

describe('helpers', () => {
  it('collects refs and ignores braces inside string literals', () => {
    expect(
      collectBuilderRefs(treeOf('{{n1.risk.score}} * 2 > 1 AND {{n2.a}}')),
    ).toEqual(['n1.risk.score', 'n2.a'])

    expect(collectBuilderRefs(treeOf('"{{n2.a}}" == "x"'))).toEqual([])
  })

  it('normalizes imported trees and rejects malformed ones', () => {
    const tree = normalizeBuilderTree({
      kind: 'group',
      op: 'and',
      items: [
        {
          kind: 'compare',
          op: '>',
          left: { kind: 'ref', path: 'n1.risk.score' },
          right: { kind: 'number', text: '1' },
        },
      ],
    })
    expect(tree?.kind).toBe('group')
    if (tree?.kind === 'group') expect(tree.items[0].id).toBeTruthy()
    expect(isBuilderTree({ kind: 'nope' })).toBe(false)

    let deep: unknown = { kind: 'bool', operand: { kind: 'boolean', value: true } }
    for (let index = 0; index < 40; index += 1) {
      deep = { kind: 'group', op: 'and', items: [deep] }
    }
    expect(isBuilderTree(deep)).toBe(false)
  })

  it('uses graph as the authoritative expression', () => {
    const tree = treeOf('{{n2.a}} AND {{n2.b}}')
    expect(
      logicOutputExpression({ id: 'x', expression: 'stale', graph: tree }),
    ).toBe(formatBuilderTree(tree))
    expect(logicOutputExpression({ id: 'x', expression: '1 > 0' })).toBe('1 > 0')
  })
})

describe('scenario refs and normalization', () => {
  const scenario: Scenario = {
    id: 'builder-test',
    name: 'builder',
    model: 'jev-latest',
    nodes: [
      {
        id: 'n1',
        title: '理解',
        state: 'x',
        includeUpstream: false,
        position: { x: 0, y: 0 },
        questions: {
          dept: {
            type: 'choice',
            instructions: '部门',
            options: [
              { name: '财务', description: '' },
              { name: '有 空格', description: '' },
            ],
          },
          risk: {
            type: 'score',
            instructions: '风险',
            levels: [{ label: '低' }, { label: '中' }],
          },
          urgent: { type: 'noul', instructions: '紧急' },
        },
      },
      {
        id: 'n2',
        kind: 'logic',
        title: '分流',
        position: { x: 0, y: 200 },
        outputs: [{ id: 'flag', expression: '1 > 0' }],
      },
      {
        id: 'n3',
        kind: 'logic',
        title: '末级',
        position: { x: 0, y: 400 },
        outputs: [{ id: 'done', expression: 'true' }],
      },
    ],
    edges: [
      { id: 'e1', source: 'n1', target: 'n2' },
      { id: 'e2', source: 'n1', target: 'n3' },
      { id: 'e3', source: 'n2', target: 'n3' },
    ],
  }

  it('lists structural ancestor fields without running', () => {
    const groups = collectScenarioRefs(scenario, 'n3')
    expect(groups.map((group) => group.nodeId)).toEqual(['n1', 'n2'])
    const paths = groups.flatMap((group) => group.items.map((item) => item.path))
    expect(paths).toContain('n1.dept.probabilities.财务')
    expect(paths).toContain('n1.risk.probabilities.低')
    expect(paths).toContain('n2.flag')
    expect(paths).not.toContain('n3.done')
    expect(paths.some((path) => path.includes('有 空格'))).toBe(false)

    for (const group of groups) {
      for (const item of group.items) {
        expect(refTypeInScenario(scenario, item.path)).toEqual({ type: item.type })
      }
    }
  })

  it('syncs expression from graph and drops malformed graphs on load', () => {
    const graph = treeOf('{{n1.risk.score}} > 1')
    const valid: Scenario = {
      ...scenario,
      nodes: scenario.nodes.map((node) =>
        node.id === 'n2' && node.kind === 'logic'
          ? { ...node, outputs: [{ id: 'flag', expression: 'stale', graph }] }
          : node,
      ),
    }
    const normalized = normalizeLogicOutputs(valid)
    const output = normalized.nodes.find((node) => node.id === 'n2')
    if (output?.kind !== 'logic') throw new Error('shape')
    expect(output.outputs[0].expression).toBe(formatBuilderTree(graph))

    const broken: Scenario = {
      ...scenario,
      nodes: scenario.nodes.map((node) =>
        node.id === 'n2' && node.kind === 'logic'
          ? {
              ...node,
              outputs: [
                {
                  id: 'flag',
                  expression: '1 > 0',
                  graph: { kind: 'group', op: 'bad', items: [] } as unknown as BuilderNode,
                  mode: 'graph' as const,
                },
              ],
            }
          : node,
      ),
    }
    const cleaned = normalizeLogicOutputs(broken)
    const cleanedOutput = cleaned.nodes.find((node) => node.id === 'n2')
    if (cleanedOutput?.kind !== 'logic') throw new Error('shape')
    expect(cleanedOutput.outputs[0].graph).toBeUndefined()
    expect(cleanedOutput.outputs[0].mode).toBe('text')
    expect(cleanedOutput.outputs[0].expression).toBe('1 > 0')
  })
})
