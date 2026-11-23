import { describe, expect, it } from 'vitest'
import { extractRefs, resolveValue } from './template'
import type { TemplateScope } from './template'

const scope: TemplateScope = {
  nodes: {
    n1: {
      title: '分类',
      answers: {
        dept: {
          type: 'choice',
          choice: '技术',
          confidence: 0.9,
          probabilities: { 技术: 0.9, 财务: 0.1 },
        },
        urgent: { type: 'noul', noul: 0.87 },
        level: {
          type: 'score',
          score: 1.4,
          confidence: 0.5,
          legend: { '0': '低', '1': '中' },
          probabilities: { '0': 0.2, '1': 0.8 },
        },
      },
    },
  },
}

describe('extractRefs', () => {
  it('finds nested references', () => {
    expect(
      extractRefs({
        a: '{{n1.dept.choice}}',
        b: ['x {{n1.urgent.noul}} y', { c: '{{n1.level.score}}' }],
      }).sort(),
    ).toEqual(['n1.dept.choice', 'n1.level.score', 'n1.urgent.noul'])
  })
})

describe('resolveValue', () => {
  it('keeps typed values for an exact placeholder', () => {
    const result = resolveValue('{{n1.urgent.noul}}', scope)
    expect(result.errors).toEqual([])
    expect(result.value).toBe(0.87)
  })

  it('interpolates embedded placeholders as strings', () => {
    const result = resolveValue('部门：{{n1.dept.choice}}，置信度 {{n1.dept.confidence}}', scope)
    expect(result.value).toBe('部门：技术，置信度 0.9')
  })

  it('resolves nested objects and arrays', () => {
    const result = resolveValue(
      { a: '{{n1.dept.probabilities.技术}}', b: ['{{n1.level.score}}'] },
      scope,
    )
    expect(result.value).toEqual({ a: 0.9, b: [1.4] })
  })

  it('reports missing nodes and fields', () => {
    const result = resolveValue(
      { a: '{{n9.dept.choice}}', b: '{{n1.dept.missing}}' },
      scope,
    )
    expect(result.errors).toHaveLength(2)
    expect(result.errors[0].message).toContain('n9')
  })
})
