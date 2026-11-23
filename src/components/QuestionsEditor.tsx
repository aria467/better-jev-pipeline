import { useEffect, useMemo, useRef, useState } from 'react'
import type { JSX } from 'react'
import {
  ArrowDown,
  ArrowUp,
  ChevronDown,
  FileJson,
  Plus,
  Trash2,
} from 'lucide-react'
import type {
  ApiQuestion,
  ChoiceOption,
  Question,
  QuestionType,
  ScoreLevel,
} from '../lib/types'
import { questionsFromApi, questionsToApi } from '../lib/request'
import { JsonEditor } from './JsonEditor'
import { VariableMenu } from './VariableMenu'
import type { VariableGroup } from './VariableMenu'

interface QuestionsEditorProps {
  questions: Record<string, Question>
  variables: VariableGroup[]
  onChange: (next: Record<string, Question>) => void
}

function defaultChoiceOptions(): ChoiceOption[] {
  return [
    { name: '选项 A', description: '' },
    { name: '选项 B', description: '' },
  ]
}

function defaultScoreLevels(): ScoreLevel[] {
  return [{ label: '低' }, { label: '中' }, { label: '高' }]
}

function createQuestion(type: QuestionType): Question {
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

function changeQuestionType(question: Question, next: QuestionType): Question {
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

function nextQuestionId(questions: Record<string, Question>): string {
  let index = Object.keys(questions).length + 1
  while (questions[`q${index}`]) index += 1
  return `q${index}`
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

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

type ParsedQuestions =
  | { value: Record<string, Question> }
  | { error: string }

function parseQuestionsJson(text: string): ParsedQuestions {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch (caught) {
    return { error: `JSON 解析失败：${messageOf(caught)}` }
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return { error: '顶层需要是 { 问题ID: Question } 对象' }
  }
  for (const [id, question] of Object.entries(parsed)) {
    if (!id.trim()) return { error: '问题 ID 不能为空' }
    if (typeof question !== 'object' || question === null || Array.isArray(question)) {
      return { error: `问题「${id}」需要是对象` }
    }
    const type = (question as { type?: unknown }).type
    if (type !== 'choice' && type !== 'score' && type !== 'noul' && type !== 'box') {
      return { error: `问题「${id}」的 type 无效` }
    }
  }
  try {
    return { value: questionsFromApi(parsed as Record<string, ApiQuestion>) }
  } catch (caught) {
    return { error: `无法解析问题：${messageOf(caught)}` }
  }
}

interface QuestionCardProps {
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

function QuestionCard({
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

export function QuestionsEditor({
  questions,
  variables,
  onChange,
}: QuestionsEditorProps): JSX.Element {
  const [rawOpen, setRawOpen] = useState(false)
  const [rawDraft, setRawDraft] = useState('')
  const [rawError, setRawError] = useState<string | null>(null)
  const [addOpen, setAddOpen] = useState(false)
  const addRef = useRef<HTMLDivElement>(null)
  const count = Object.keys(questions).length

  useEffect(() => {
    if (!addOpen) return
    const onPointerDown = (event: PointerEvent) => {
      if (addRef.current && !addRef.current.contains(event.target as Node)) {
        setAddOpen(false)
      }
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setAddOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [addOpen])

  const updateQuestion = (id: string, next: Question) => {
    onChange({ ...questions, [id]: next })
  }

  const renameQuestion = (oldId: string, newId: string) => {
    const entries = Object.entries(questions).map(([id, question]) =>
      id === oldId ? ([newId, question] as const) : ([id, question] as const),
    )
    onChange(Object.fromEntries(entries))
  }

  const removeQuestion = (id: string) => {
    const next = { ...questions }
    delete next[id]
    onChange(next)
  }

  const addQuestion = (type: QuestionType) => {
    const id = nextQuestionId(questions)
    onChange({ ...questions, [id]: createQuestion(type) })
    setAddOpen(false)
  }

  const toggleRaw = () => {
    if (rawOpen) {
      setRawOpen(false)
      setRawError(null)
      return
    }
    setRawDraft(JSON.stringify(questionsToApi(questions), null, 2))
    setRawError(null)
    setRawOpen(true)
    setAddOpen(false)
  }

  const handleRawChange = (next: string) => {
    setRawDraft(next)
    const parsed = parseQuestionsJson(next)
    if ('error' in parsed) {
      setRawError(parsed.error)
      return
    }
    setRawError(null)
    onChange(parsed.value)
  }

  const ids = Object.keys(questions)

  return (
    <section className="insp-questions">
      <div className="insp-section-head">
        <div className="insp-title-row">
          <h3 className="insp-section-title">问题</h3>
          <span className="insp-count">{count}</span>
        </div>
        <div className="insp-head-actions">
          <button
            type="button"
            className={`insp-link-btn${rawOpen ? ' is-active' : ''}`}
            aria-pressed={rawOpen}
            onClick={toggleRaw}
          >
            <FileJson size={13} strokeWidth={1.5} aria-hidden="true" />
            原始 JSON
          </button>
          {!rawOpen ? (
            <div className="insp-addmenu" ref={addRef}>
              <button
                type="button"
                className="insp-btn"
                aria-haspopup="menu"
                aria-expanded={addOpen}
                onClick={() => setAddOpen((value) => !value)}
              >
                <Plus size={13} strokeWidth={1.5} aria-hidden="true" />
                添加问题
                <ChevronDown size={12} strokeWidth={1.5} aria-hidden="true" />
              </button>
              {addOpen ? (
                <div className="insp-menu" role="menu">
                  <button
                    type="button"
                    role="menuitem"
                    className="insp-menu-item"
                    onClick={() => addQuestion('choice')}
                  >
                    <span className="mono">choice</span>
                    <span>分类选择</span>
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    className="insp-menu-item"
                    onClick={() => addQuestion('score')}
                  >
                    <span className="mono">score</span>
                    <span>程度打分</span>
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    className="insp-menu-item"
                    onClick={() => addQuestion('noul')}
                  >
                    <span className="mono">noul</span>
                    <span>是 / 否</span>
                  </button>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>

      {rawOpen ? (
        <div className="insp-raw">
          {rawError ? (
            <div className="insp-alert-error" role="alert">
              {rawError}
            </div>
          ) : null}
          <JsonEditor
            value={rawDraft}
            onChange={handleRawChange}
            height={420}
            ariaLabel="问题原始 JSON"
          />
          <p className="insp-hint">
            使用 API 结构 {`{ 问题ID: Question }`} 编辑；解析成功后会立即同步到表单，box 会原样保留。
          </p>
        </div>
      ) : (
        <>
          {count === 0 ? (
            <p className="insp-hint">还没有问题。点击「添加问题」创建 choice、score 或 noul。</p>
          ) : null}
          <div className="insp-q-list">
            {ids.map((id) => {
              const question = questions[id]
              return (
                <QuestionCard
                  key={id}
                  id={id}
                  question={question}
                  existingIds={ids}
                  variables={variables}
                  onChange={(next) => updateQuestion(id, next)}
                  onRename={(nextId) => renameQuestion(id, nextId)}
                  onDelete={() => removeQuestion(id)}
                />
              )
            })}
          </div>
        </>
      )}
    </section>
  )
}
