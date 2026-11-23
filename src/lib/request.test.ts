import { describe, expect, it } from 'vitest'
import { buildRequest } from './request'
import type { ApiStepNode, RunRecord, Scenario } from './types'

const scenario: Scenario = {
  id: 'test',
  name: 'test',
  model: 'jev-latest',
  nodes: [
    {
      id: 'n1',
      title: '上游',
      state: 'ticket',
      questions: {},
      position: { x: 0, y: 0 },
      includeUpstream: false,
    },
    {
      id: 'n2',
      title: '下游',
      state: {
        department: '{{n1.dept.choice}}',
        urgency: '{{n1.urgent.noul}}',
        nested: { keep: '{{n1.dept.probabilities.技术}}' },
      },
      questions: {
        action: {
          type: 'choice',
          instructions: '部门是 {{n1.dept.choice}}，该怎么做？',
          options: [
            { name: '自动', description: '置信度 {{n1.dept.confidence}}' },
            { name: '人工', description: '' },
          ],
        },
        risk: {
          type: 'score',
          instructions: '风险',
          levels: [{ label: '低' }, { label: '高', description: '需要复核' }],
        },
      },
      position: { x: 0, y: 200 },
      includeUpstream: true,
    },
  ],
  edges: [{ id: 'e', source: 'n1', target: 'n2' }],
}

const results: Record<string, RunRecord> = {
  n1: {
    nodeId: 'n1',
    status: 'success',
    response: {
      model: 'jev-1.14.0',
      answers: {
        dept: {
          type: 'choice',
          choice: '技术',
          confidence: 0.9,
          probabilities: { 技术: 0.9, 财务: 0.1 },
        },
        urgent: { type: 'noul', noul: 0.8 },
      },
      usage: { input_tokens: 100, output_tokens: 10 },
    },
  },
}

const target = (): ApiStepNode => scenario.nodes[1] as ApiStepNode

describe('buildRequest', () => {
  it('resolves templates with types and serializes questions', () => {
    const built = buildRequest({ scenario, node: target(), results })
    expect(built.errors).toEqual([])
    const state = built.request.state as Record<string, unknown>
    expect(state.department).toBe('技术')
    expect(state.urgency).toBe(0.8)
    expect(state.nested).toEqual({ keep: 0.9 })

    const questions = built.request.questions as Record<string, any>
    expect(questions.action.criteria).toEqual({
      自动: '置信度 0.9',
      人工: null,
    })
    expect(questions.risk.criteria).toEqual(['低', { label: '高', description: '需要复核' }])
  })

  it('injects direct upstream answers', () => {
    const built = buildRequest({ scenario, node: target(), results })
    const state = built.request.state as Record<string, any>
    expect(built.hasUpstream).toBe(true)
    expect(state.upstream.n1.answers.dept.choice).toBe('技术')
    expect(state.upstream.n1.usage.input_tokens).toBe(100)
  })

  it('reports unresolved templates before running', () => {
    const built = buildRequest({ scenario, node: target(), results: {} })
    expect(built.errors.length).toBeGreaterThan(0)
    expect(built.errors[0].message).toContain('上游')
  })
})

describe('logic outputs in requests', () => {
  it('resolves boolean outputs and injects them as upstream', () => {
    const logicScenario: Scenario = {
      id: 'logic',
      name: 'logic',
      model: 'jev-latest',
      nodes: [
        {
          id: 'n1',
          title: '入口',
          state: '内容',
          includeUpstream: false,
          position: { x: 0, y: 0 },
          questions: { q: { type: 'noul', instructions: '' } },
        },
        {
          id: 'n2',
          kind: 'logic',
          title: '门',
          outputs: [{ id: 'flag', expression: '1 > 0' }],
          position: { x: 0, y: 100 },
        },
        {
          id: 'n3',
          title: '下游',
          state: { flag: '{{n2.flag}}', label: 'flag={{n2.flag}}' },
          includeUpstream: true,
          position: { x: 0, y: 200 },
          questions: {
            go: { type: 'noul', instructions: 'flag 为 {{n2.flag}} 时如何处理？' },
          },
        },
      ],
      edges: [
        { id: 'e1', source: 'n1', target: 'n2' },
        { id: 'e2', source: 'n2', target: 'n3', when: { output: 'flag', equals: true } },
      ],
    }

    const logicResults: Record<string, RunRecord> = {
      n1: {
        nodeId: 'n1',
        status: 'success',
        response: {
          model: 'test',
          answers: { q: { type: 'noul', noul: 0.7 } },
          usage: { input_tokens: 5, output_tokens: 0 },
        },
      },
      n2: { nodeId: 'n2', status: 'success', outputs: { flag: true }, inputs: {} },
    }

    const target = logicScenario.nodes[2] as ApiStepNode
    const built = buildRequest({ scenario: logicScenario, node: target, results: logicResults })
    expect(built.errors).toEqual([])
    const state = built.request.state as Record<string, unknown>
    expect(state.flag).toBe(true)
    expect(state.label).toBe('flag=true')
    const upstream = state.upstream as Record<string, any>
    expect(upstream.n2.outputs.flag).toBe(true)
    const questions = built.request.questions as Record<string, any>
    expect(questions.go.instructions).toBe('flag 为 true 时如何处理？')
    expect(built.hasUpstream).toBe(true)
  })
})
