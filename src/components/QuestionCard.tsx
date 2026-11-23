import { useEffect, useMemo, useRef, useState } from 'react'
import type { JSX } from 'react'
import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react'
import { changeQuestionType } from '../lib/question-defaults'
import type { ChoiceOption, Question, QuestionType, ScoreLevel } from '../lib/types'
import { VariableMenu } from './VariableMenu'
import type { VariableGroup } from '../lib/variables'

export interface QuestionCardProps {
  id: string
  question: Question
  existingIds: string[]
  variables: VariableGroup[]
  onChange: (next: Question) => void
  onRename: (nextId: string) => void
  onDelete: () => void
}

interface TypeFieldsProps<T extends Question> {
  question: T
  onChange: (next: Question) => void
}

function ChoiceFields({ question, onChange }: TypeFieldsProps<Extract<Question, { type: 'choice' }>>): JSX.Element {
  const options = question.options
  const setOptions = (next: ChoiceOption[]) => onChange({ ...question, options: next })

  return (
    <div className="insp-subsection">
      <div className="insp-subhead">
        <span>选项</span>
        <span className="insp-count">{options.length} / 255</span>
      </div>
      {options.map((option, index) => (
        <div className="insp-option-row" key={index}>
          <input
            className="insp-input"
            value={option.name}
            placeholder={`选项 ${index + 1}`}
            aria-label={`选项 ${index + 1} 名称`}
            onChange={(event) =>
              setOptions(
                options.map((item, itemIndex) =>
                  itemIndex === index ? { ...item, name: event.target.value } : item,
                ),
              )
            }
          />
          <input
            className="insp-input"
            value={option.description}
            placeholder="描述（可选）"
            aria-label={`选项 ${index + 1} 描述`}
            onChange={(event) =>
              setOptions(
                options.map((item, itemIndex) =>
                  itemIndex === index
                    ? { ...item, description: event.target.value }
                    : item,
                ),
              )
            }
          />
          <button
            type="button"
            className="insp-icon-btn insp-icon-btn-danger"
            title="删除选项"
            aria-label={`删除选项 ${index + 1}`}
            onClick={() => setOptions(options.filter((_, itemIndex) => itemIndex !== index))}
          >
            <Trash2 size={13} strokeWidth={1.5} aria-hidden="true" />
          </button>
        </div>
      ))}
      <button
        type="button"
        className="insp-link-btn"
        disabled={options.length >= 255}
        onClick={() =>
          setOptions([
            ...options,
            { name: `选项 ${options.length + 1}`, description: '' },
          ])
        }
      >
        <Plus size={12} strokeWidth={1.5} aria-hidden="true" />
        添加选项
      </button>
    </div>
  )
}

function ScoreFields({ question, onChange }: TypeFieldsProps<Extract<Question, { type: 'score' }>>): JSX.Element {
  const levels = question.levels
  const setLevels = (next: ScoreLevel[]) => onChange({ ...question, levels: next })

  return (
    <div className="insp-subsection">
      <div className="insp-subhead">
        <span>等级 · 顺序即分数</span>
        <span className="insp-count">{levels.length} / 10</span>
      </div>
      {levels.map((level, index) => (
        <div className="insp-level-row" key={index}>
          <span className="insp-level-index">{index + 1}</span>
          <input
            className="insp-input"
            value={level.label}
            placeholder={`等级 ${index + 1}`}
            aria-label={`等级 ${index + 1}`}
            onChange={(event) =>
              setLevels(
                levels.map((item, itemIndex) =>
                  itemIndex === index ? { ...item, label: event.target.value } : item,
                ),
              )
            }
          />
          <input
            className="insp-input"
            value={level.description ?? ''}
            placeholder="补充说明（可选）"
            aria-label={`等级 ${index + 1} 补充说明`}
            onChange={(event) =>
              setLevels(
                levels.map((item, itemIndex) =>
                  itemIndex === index
                    ? { ...item, description: event.target.value }
                    : item,
                ),
              )
            }
          />
          <div className="insp-level-actions">
            <button
              type="button"
              className="insp-icon-btn"
              title="上移"
              aria-label={`上移等级 ${index + 1}`}
              disabled={index === 0}
              onClick={() => setLevels(moveItem(levels, index, index - 1))}
            >
              <ArrowUp size={12} strokeWidth={1.5} aria-hidden="true" />
            </button>
            <button
              type="button"
              className="insp-icon-btn"
              title="下移"
              aria-label={`下移等级 ${index + 1}`}
              disabled={index === levels.length - 1}
              onClick={() => setLevels(moveItem(levels, index, index + 1))}
            >
              <ArrowDown size={12} strokeWidth={1.5} aria-hidden="true" />
            </button>
            <button
              type="button"
              className="insp-icon-btn insp-icon-btn-danger"
              title="删除等级"
              aria-label={`删除等级 ${index + 1}`}
              onClick={() => setLevels(levels.filter((_, itemIndex) => itemIndex !== index))}
            >
              <Trash2 size={12} strokeWidth={1.5} aria-hidden="true" />
            </button>
          </div>
        </div>
      ))}
      <button
        type="button"
        className="insp-link-btn"
        disabled={levels.length >= 10}
        onClick={() => setLevels([...levels, { label: `等级 ${levels.length + 1}` }])}
      >
        <Plus size={12} strokeWidth={1.5} aria-hidden="true" />
        添加等级
      </button>
    </div>
  )
}

function NoulFields({ question, onChange }: TypeFieldsProps<Extract<Question, { type: 'noul' }>>): JSX.Element {
  return (
    <div className="insp-subsection">
      <div className="insp-subhead">
        <span>判断条件</span>
        <span className="insp-hint">可选</span>
      </div>
      <div className="insp-noul-row">
        <label className="insp-field">
          <span className="insp-field-label">成立时（true）</span>
          <input
            className="insp-input"
            value={question.criteria?.true ?? ''}
            placeholder="例如：明确表示要退款"
            onChange={(event) =>
              onChange({
                ...question,
                criteria: { ...question.criteria, true: event.target.value },
              })
            }
          />
        </label>
        <label className="insp-field">
          <span className="insp-field-label">不成立时（false）</span>
          <input
            className="insp-input"
            value={question.criteria?.false ?? ''}
            placeholder="例如：只是咨询流程"
            onChange={(event) =>
              onChange({
                ...question,
                criteria: { ...question.criteria, false: event.target.value },
              })
            }
          />
        </label>
      </div>
    </div>
  )
}

function questionErrors(question: Question): string[] {
  const errors: string[] = []
  if (question.type === 'choice') {
    if (question.options.length === 0) errors.push('至少需要一个选项')
    if (question.options.length > 255) errors.push('最多 255 个选项')
    const counts = new Map<string, number>()
    question.options.forEach((option, index) => {
      const name = option.name.trim()
      if (!name) errors.push(`第 ${index + 1} 个选项名称为空`)
      else counts.set(name, (counts.get(name) ?? 0) + 1)
    })
    for (const [name, count] of counts) {
      if (count > 1) errors.push(`选项「${name}」重复`)
    }
  }
  if (question.type === 'score') {
    if (question.levels.length === 0) errors.push('至少需要一个等级')
    if (question.levels.length > 10) errors.push('最多 10 个等级')
    question.levels.forEach((level, index) => {
      if (!level.label.trim()) errors.push(`第 ${index + 1} 个等级为空`)
    })
  }
  return errors
}

function moveItem<T>(items: T[], from: number, to: number): T[] {
  if (to < 0 || to >= items.length) return items
  const next = [...items]
  const [item] = next.splice(from, 1)
  next.splice(to, 0, item)
  return next
}

export function QuestionCard({
  id,
  question,
  existingIds,
  variables,
  onChange,
  onRename,
  onDelete,
}: QuestionCardProps): JSX.Element {
  const [idDraft, setIdDraft] = useState(id)
  const [idError, setIdError] = useState<string | null>(null)
  const instructionsRef = useRef<HTMLTextAreaElement>(null)
  const errors = useMemo(() => questionErrors(question), [question])

  useEffect(() => {
    setIdDraft(id)
    setIdError(null)
  }, [id])

  const commitId = () => {
    const next = idDraft.trim()
    if (next === id) {
      setIdError(null)
      return
    }
    if (!next) {
      setIdError('问题 ID 不能为空')
      return
    }
    if (!/^[A-Za-z0-9_-]+$/.test(next)) {
      setIdError('仅支持字母、数字、下划线和连字符')
      return
    }
    if (existingIds.includes(next)) {
      setIdError('该问题 ID 已存在')
      return
    }
    setIdError(null)
    onRename(next)
  }

  const insertVariable = (template: string) => {
    const element = instructionsRef.current
    const current = question.instructions
    const start = element?.selectionStart ?? current.length
    const end = element?.selectionEnd ?? start
    const next = `${current.slice(0, start)}${template}${current.slice(end)}`
    onChange({ ...question, instructions: next })
    requestAnimationFrame(() => {
      const target = instructionsRef.current
      if (!target) return
      target.focus()
      const cursor = start + template.length
      target.setSelectionRange(cursor, cursor)
    })
  }

  return (
    <article className="insp-q-card">
      <div className="insp-q-top">
        <input
          className="insp-input insp-q-id"
          value={idDraft}
          aria-label="问题 ID"
          spellCheck={false}
          onChange={(event) => {
            setIdDraft(event.target.value.replace(/[^A-Za-z0-9_-]/g, ''))
            setIdError(null)
          }}
          onBlur={commitId}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault()
              commitId()
            }
            if (event.key === 'Escape') {
              setIdDraft(id)
              setIdError(null)
              event.currentTarget.blur()
            }
          }}
        />
        <select
          className="insp-select"
          value={question.type}
          aria-label="问题类型"
          onChange={(event) =>
            onChange(changeQuestionType(question, event.target.value as QuestionType))
          }
        >
          <option value="choice">choice</option>
          <option value="score">score</option>
          <option value="noul">noul</option>
          {question.type === 'box' ? (
            <option value="box">box（不支持）</option>
          ) : null}
        </select>
        <button
          type="button"
          className="insp-icon-btn insp-icon-btn-danger"
          title="删除问题"
          aria-label="删除问题"
          onClick={onDelete}
        >
          <Trash2 size={14} strokeWidth={1.5} aria-hidden="true" />
        </button>
      </div>

      {idError ? <p className="insp-error-text">{idError}</p> : null}
      {errors.length > 0 ? (
        <ul className="insp-q-errors">
          {errors.map((message) => (
            <li key={message}>{message}</li>
          ))}
        </ul>
      ) : null}

      <div className="insp-field">
        <div className="insp-field-head">
          <span className="insp-field-label">instructions</span>
          <VariableMenu variables={variables} onInsert={insertVariable} />
        </div>
        <textarea
          ref={instructionsRef}
          className="insp-textarea"
          rows={2}
          value={question.instructions}
          placeholder="告诉模型要判断什么"
          spellCheck={false}
          onChange={(event) =>
            onChange({ ...question, instructions: event.target.value })
          }
        />
      </div>

      {question.type === 'choice' ? (
        <ChoiceFields question={question} onChange={onChange} />
      ) : null}
      {question.type === 'score' ? (
        <ScoreFields question={question} onChange={onChange} />
      ) : null}
      {question.type === 'noul' ? (
        <NoulFields question={question} onChange={onChange} />
      ) : null}
      {question.type === 'box' ? (
        <p className="insp-note">
          首版不支持图片输入，box 仅可在原始 JSON 中保留。
        </p>
      ) : null}
    </article>
  )
}
