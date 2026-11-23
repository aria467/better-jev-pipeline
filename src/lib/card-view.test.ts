import { describe, expect, it } from 'vitest'
import {
  buildLogicOutputRows,
  buildQuestionViews,
  formatPercent,
} from './card-view'
import type { Answer, ApiStepNode, LogicStepNode, RunRecord } from './types'

function apiNode(questions: ApiStepNode['questions']): ApiStepNode {
  return {
    id: 'n1',
    title: '节点',
    position: { x: 0, y: 0 },
    state: '测试 state',
    questions,
    includeUpstream: false,
  }
}

function successRecord(answers: Record<string, Answer>): RunRecord {
  return {
    nodeId: 'n1',
    status: 'success',
    response: {
      model: 'jev-latest',
      answers,
      usage: { input_tokens: 10, output_tokens: 2 },
    },
  }
}

const fiveOptions: ApiStepNode['questions'] = {
  reason: {
    type: 'choice',
    instructions: '',
    options: ['A', 'B', 'C', 'D', 'E'].map((name) => ({ name, description: '' })),
  },
}

describe('buildQuestionViews: choice', () => {
  it('lists configured options with None before running', () => {
    const views = buildQuestionViews(apiNode(fiveOptions))
    expect(views).toHaveLength(1)
    const view = views[0]
    expect(view.type).toBe('choice')
    expect(view.hasAnswer).toBe(false)
    expect(view.rows.map((row) => row.label)).toEqual(['A', 'B', 'C', 'D'])
    expect(view.rows.every((row) => row.percent === null)).toBe(true)
    expect(view.rows.some((row) => row.chosen)).toBe(false)
    expect(view.overflow).toBe(1)
    expect(view.confidence).toBe(null)
  })

  it('sorts probabilities, marks the choice and caps at four rows', () => {
    const record = successRecord({
      reason: {
        type: 'choice',
        choice: 'B',
        confidence: 0.9,
        probabilities: { A: 0.1, B: 0.6, C: 0.2, D: 0.05, E: 0.05 },
      },
    })
    const view = buildQuestionViews(apiNode(fiveOptions), record)[0]
    expect(view.hasAnswer).toBe(true)
    expect(view.rows.map((row) => row.label)).toEqual(['B', 'C', 'A', 'D'])
    expect(view.rows[0]).toMatchObject({ label: 'B', percent: 0.6, chosen: true })
    expect(view.rows[1]?.chosen).toBe(false)
    expect(view.overflow).toBe(1)
    expect(view.confidence).toBe(0.9)
  })

  it('falls back to configured options when probabilities are empty', () => {
    const record = successRecord({
      reason: {
        type: 'choice',
        choice: 'A',
        confidence: 0.5,
        probabilities: {},
      },
    })
    const view = buildQuestionViews(apiNode(fiveOptions), record)[0]
    expect(view.hasAnswer).toBe(true)
    expect(view.rows.map((row) => row.label)).toEqual(['A', 'B', 'C', 'D'])
    expect(view.rows.every((row) => row.percent === null)).toBe(true)
  })

  it('keeps old answers when the record is stale', () => {
    const record: RunRecord = {
      ...successRecord({
        reason: {
          type: 'choice',
          choice: 'A',
          confidence: 0.8,
          probabilities: { A: 0.8, B: 0.2 },
        },
      }),
      status: 'stale',
    }
    const view = buildQuestionViews(apiNode(fiveOptions), record)[0]
    expect(view.hasAnswer).toBe(true)
    expect(view.rows[0]?.label).toBe('A')
    expect(view.confidence).toBe(0.8)
  })
})

describe('buildQuestionViews: score and noul', () => {
  const node = apiNode({
    risk: {
      type: 'score',
      instructions: '',
      levels: [{ label: '低' }, { label: '中' }, { label: '高' }],
    },
    high_value: { type: 'noul', instructions: '' },
  })

  it('shows configured levels with None before running', () => {
    const [score, noul] = buildQuestionViews(node)
    expect(score.type).toBe('score')
    expect(score.rows.map((row) => row.label)).toEqual(['低', '中', '高'])
    expect(score.rows.every((row) => row.percent === null)).toBe(true)
    expect(score.scoreText).toBeUndefined()
    expect(score.hasAnswer).toBe(false)
    expect(noul.type).toBe('noul')
    expect(noul.noulPercent).toBe(null)
    expect(noul.hasAnswer).toBe(false)
  })

  it('orders levels by index and builds the score text', () => {
    const record = successRecord({
      risk: {
        type: 'score',
        score: 1.3,
        confidence: 0.75,
        legend: { 0: '低', 1: '中', 2: '高' },
        probabilities: { 2: 0.5, 0: 0.2, 1: 0.3 },
      },
      high_value: { type: 'noul', noul: 0.72 },
    })
    const [score, noul] = buildQuestionViews(node, record)
    expect(score.rows.map((row) => row.label)).toEqual(['低', '中', '高'])
    expect(score.rows.map((row) => row.percent)).toEqual([0.2, 0.3, 0.5])
    expect(score.scoreText).toBe('1.30 / 2')
    expect(score.confidence).toBe(0.75)
    expect(noul.noulPercent).toBe(0.72)
    expect(noul.hasAnswer).toBe(true)
  })

  it('appends answers that are not configured and skips box questions', () => {
    const views = buildQuestionViews(apiNode({ image: { type: 'box', instructions: '' } }), successRecord({
      legacy: { type: 'noul', noul: 0.4 },
    }))
    expect(views.map((view) => view.id)).toEqual(['legacy'])
    expect(views[0]?.type).toBe('noul')
    expect(views[0]?.noulPercent).toBe(0.4)
  })
})

describe('buildLogicOutputRows', () => {
  const node: LogicStepNode = {
    id: 'l1',
    kind: 'logic',
    title: '逻辑',
    position: { x: 0, y: 0 },
    outputs: [
      { id: 'a', expression: '1 > 0' },
      { id: 'b', expression: '1 < 0' },
    ],
  }

  it('shows None before running', () => {
    expect(buildLogicOutputRows(node)).toEqual([
      { id: 'a', value: null },
      { id: 'b', value: null },
    ])
  })

  it('reads boolean outputs and appends unknown ones', () => {
    const record: RunRecord = {
      nodeId: 'l1',
      status: 'success',
      outputs: { a: true, b: false, c: true },
    }
    expect(buildLogicOutputRows(node, record)).toEqual([
      { id: 'a', value: true },
      { id: 'b', value: false },
      { id: 'c', value: true },
    ])
  })
})

describe('formatPercent', () => {
  it('rounds whole percentages and keeps one decimal otherwise', () => {
    expect(formatPercent(0.9)).toBe('90%')
    expect(formatPercent(0.123)).toBe('12.3%')
    expect(formatPercent(1)).toBe('100%')
  })
})
