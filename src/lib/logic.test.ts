import { describe, expect, it } from 'vitest'
import {
  checkLogicExpression,
  collectLogicRefs,
  evaluateExpression,
  evaluateLogicOutputs,
  inferExpressionType,
  parseExpression,
  refTypeInScenario,
} from './logic'
import type { Scenario } from './types'

const values: Record<string, number | string | boolean> = {
  'n1.dept.choice': '财务',
  'n1.dept.probabilities.财务': 0.72,
  'n1.dept.confidence': 0.9,
  'n1.risk.score': 1.4,
  'n1.urgent.noul': 0.8,
  'n2.manual_review': true,
}

const resolveValue = (path: string) =>
  path in values ? { value: values[path] } : { error: `缺少 ${path}` }

function evaluate(expression: string) {
  const parsed = parseExpression(expression)
  if ('error' in parsed) throw new Error(parsed.error.message)
  const result = evaluateExpression(parsed.ast, resolveValue)
  if ('error' in result) throw new Error(result.error.message)
  return result.value
}

function errorOf(expression: string): string {
  const parsed = parseExpression(expression)
  if ('error' in parsed) return parsed.error.message
  const result = evaluateExpression(parsed.ast, resolveValue)
  if ('error' in result) return result.error.message
  throw new Error(`expected error for ${expression}`)
}

describe('parse & precedence', () => {
  it('evaluates arithmetic and comparisons', () => {
    expect(evaluate('1 + 2 * 3 == 7')).toBe(true)
    expect(evaluate('(1 + 2) * 3 == 9')).toBe(true)
    expect(evaluate('10 / 4')).toBe(2.5)
    expect(evaluate('2 - -3')).toBe(5)
    expect(evaluate('0.5 * 4 > 1.9')).toBe(true)
  })

  it('follows boolean precedence NOT > AND > XOR > OR', () => {
    expect(evaluate('true OR false AND false')).toBe(true)
    expect(evaluate('NOT false AND true')).toBe(true)
    expect(evaluate('true XOR false AND false')).toBe(true)
    expect(evaluate('(true XOR false) AND false')).toBe(false)
  })

  it('accepts Chinese reference paths and string equality', () => {
    expect(evaluate('{{n1.dept.probabilities.财务}} > 0.4')).toBe(true)
    expect(evaluate('{{n1.dept.choice}} == "财务"')).toBe(true)
    expect(evaluate("{{n1.dept.choice}} != '技术'")).toBe(true)
    expect(evaluate('{{n1.risk.score}} >= 1.5')).toBe(false)
  })
})

describe('boolean gates', () => {
  it('computes truth tables', () => {
    expect(evaluate('true AND false')).toBe(false)
    expect(evaluate('true && false')).toBe(false)
    expect(evaluate('true OR false')).toBe(true)
    expect(evaluate('true || false')).toBe(true)
    expect(evaluate('true XOR true')).toBe(false)
    expect(evaluate('false NAND false')).toBe(true)
    expect(evaluate('true NAND true')).toBe(false)
    expect(evaluate('true XNOR true')).toBe(true)
    expect(evaluate('true XNOR false')).toBe(false)
    expect(evaluate('NOT false')).toBe(true)
    expect(evaluate('!false')).toBe(true)
    expect(evaluate('not FALSE')).toBe(true)
  })

  it('reads logic-step outputs as booleans', () => {
    expect(evaluate('{{n2.manual_review}} == true')).toBe(true)
    expect(evaluate('NOT {{n2.manual_review}}')).toBe(false)
  })
})

describe('errors', () => {
  it('reports division by zero', () => {
    expect(errorOf('1 / 0')).toContain('除数不能为零')
  })

  it('reports type mismatches', () => {
    expect(errorOf('true > 1')).toContain('大小比较')
    expect(errorOf('1 AND true')).toContain('布尔值')
    expect(errorOf('"a" + 1')).toContain('算术运算')
    expect(errorOf('{{n1.dept.choice}} > 0.5')).toContain('大小比较')
  })

  it('reports syntax problems with positions', () => {
    const empty = parseExpression('   ')
    expect('error' in empty && empty.error.message).toContain('不能为空')
    const missing = parseExpression('(1 + 2')
    expect('error' in missing && missing.error.message).toContain(')')
    const unknown = parseExpression('foo == 1')
    expect('error' in unknown && unknown.error.message).toContain('未知标识符')
    const trailing = parseExpression('1 > 0 0')
    expect('error' in trailing && trailing.error.message).toContain('多余')
    const badChar = parseExpression('1 > 0 且 2 > 1')
    expect('error' in badChar && badChar.error.message).toContain('无法识别')
  })

  it('reports missing references at evaluation time', () => {
    const parsed = parseExpression('{{n9.foo}} > 1')
    expect('ast' in parsed).toBe(true)
    if ('error' in parsed) return
    const result = evaluateExpression(parsed.ast, resolveValue)
    expect('error' in result && result.error.message).toContain('缺少')
  })
})

const scenario: Scenario = {
  id: 'logic-test',
  name: 'logic',
  model: 'jev-latest',
  nodes: [
    {
      id: 'n1',
      title: '判断',
      state: 'state',
      includeUpstream: false,
      position: { x: 0, y: 0 },
      questions: {
        dept: {
          type: 'choice',
          instructions: '部门',
          options: [
            { name: '财务', description: '' },
            { name: '技术', description: '' },
          ],
        },
        risk: {
          type: 'score',
          instructions: '风险',
          levels: [{ label: '低' }, { label: '中' }, { label: '高' }],
        },
        urgent: { type: 'noul', instructions: '紧急' },
      },
    },
    {
      id: 'n2',
      kind: 'logic',
      title: '分流',
      outputs: [{ id: 'manual_review', expression: 'true' }],
      position: { x: 0, y: 200 },
    },
  ],
  edges: [{ id: 'e', source: 'n1', target: 'n2' }],
}

describe('static types', () => {
  const resolve = (path: string) => refTypeInScenario(scenario, path)

  it('infers reference types from the scenario', () => {
    expect(refTypeInScenario(scenario, 'n1.dept.choice')).toEqual({ type: 'string' })
    expect(refTypeInScenario(scenario, 'n1.dept.probabilities.财务')).toEqual({ type: 'number' })
    expect(refTypeInScenario(scenario, 'n1.risk.score')).toEqual({ type: 'number' })
    expect(refTypeInScenario(scenario, 'n1.urgent.noul')).toEqual({ type: 'number' })
    expect(refTypeInScenario(scenario, 'n2.manual_review')).toEqual({ type: 'boolean' })
    expect('error' in refTypeInScenario(scenario, 'n2.missing')).toBe(true)
    expect('error' in refTypeInScenario(scenario, 'n1.dept')).toBe(true)
  })

  it('checks that an expression resolves to boolean', () => {
    const ok = checkLogicExpression('{{n1.dept.probabilities.财务}} > 0.4', resolve)
    expect('refs' in ok && !('error' in ok)).toBe(true)
    expect(ok.refs).toEqual(['n1.dept.probabilities.财务'])

    const notBoolean = checkLogicExpression('{{n1.dept.confidence}}', resolve)
    expect('error' in notBoolean && notBoolean.error.message).toContain('布尔')

    const unknown = checkLogicExpression('{{n9.x}} > 1', resolve)
    expect('error' in unknown && unknown.error.message).toContain('找不到节点')

    const parsed = parseExpression('{{n1.dept.choice}} == "财务" AND {{n1.urgent.noul}} > 0.5')
    expect('ast' in parsed).toBe(true)
    if ('ast' in parsed) {
      expect(inferExpressionType(parsed.ast, resolve)).toEqual({ type: 'boolean' })
    }
  })

  it('collects unique references', () => {
    expect(collectLogicRefs('{{n1.urgent.noul}} > 0.5 AND {{n1.urgent.noul}} < 0.9')).toEqual([
      'n1.urgent.noul',
    ])
  })

  it('ignores brace text inside string literals', () => {
    expect(collectLogicRefs('"{{n1.urgent.noul}}" == "x"')).toEqual([])
    expect(evaluate('"{{n1.urgent.noul}}" == "{{n1.urgent.noul}}"')).toBe(true)
  })
})

describe('evaluateLogicOutputs', () => {
  it('returns outputs, inputs and per-output errors', () => {
    const result = evaluateLogicOutputs(
      [
        { id: 'high', expression: '{{n1.dept.probabilities.财务}} > 0.4' },
        { id: 'risk', expression: '{{n1.risk.score}} >= 1.5' },
      ],
      resolveValue,
    )
    expect(result.outputs).toEqual({ high: true, risk: false })
    expect(result.inputs).toEqual({
      'n1.dept.probabilities.财务': 0.72,
      'n1.risk.score': 1.4,
    })
    expect(result.errors).toEqual([])
  })

  it('records expression errors with the output id', () => {
    const result = evaluateLogicOutputs(
      [
        { id: 'ok', expression: '1 > 0' },
        { id: 'bad', expression: '1 +' },
        { id: 'notBool', expression: '1 + 1' },
      ],
      resolveValue,
    )
    expect(result.outputs).toEqual({ ok: true })
    expect(result.errors).toHaveLength(2)
    expect(result.errors[0]).toContain('bad')
    expect(result.errors[1]).toContain('布尔')
  })
})
