import type { ChoiceOption, Question, QuestionType, ScoreLevel } from './types'

export function defaultChoiceOptions(): ChoiceOption[] {
  return [
    { name: '选项 A', description: '' },
    { name: '选项 B', description: '' },
  ]
}

export function defaultScoreLevels(): ScoreLevel[] {
  return [{ label: '低' }, { label: '中' }, { label: '高' }]
}

export function createQuestion(type: QuestionType): Question {
  if (type === 'choice') {
    return {
      type: 'choice',
      instructions: '请选择最合适的一项',
      options: defaultChoiceOptions(),
    }
  }
  if (type === 'score') {
    return {
      type: 'score',
      instructions: '请评估程度',
      levels: defaultScoreLevels(),
    }
  }
  if (type === 'noul') {
    return { type: 'noul', instructions: '这个判断是否成立？' }
  }
  return { type: 'box', instructions: '' }
}

export function changeQuestionType(question: Question, next: QuestionType): Question {
  if (question.type === next) return question
  const instructions = question.instructions
  if (next === 'choice') {
    return { type: 'choice', instructions, options: defaultChoiceOptions() }
  }
  if (next === 'score') {
    return { type: 'score', instructions, levels: defaultScoreLevels() }
  }
  if (next === 'noul') {
    return { type: 'noul', instructions }
  }
  return { type: 'box', instructions }
}
