import { useEffect, useRef, useState } from 'react'
import type { JSX } from 'react'
import { ChevronDown, FileJson, Plus } from 'lucide-react'
import { createQuestion } from '../lib/question-defaults'
import type { ApiQuestion, Question, QuestionType } from '../lib/types'
import { questionsFromApi, questionsToApi } from '../lib/request'
import { JsonEditor } from './JsonEditor'
import { QuestionCard } from './QuestionCard'
import type { VariableGroup } from '../lib/variables'

interface QuestionsEditorProps {
  questions: Record<string, Question>
  variables: VariableGroup[]
  onChange: (next: Record<string, Question>) => void
}

function nextQuestionId(questions: Record<string, Question>): string {
  let index = Object.keys(questions).length + 1
  while (questions[`q${index}`]) index += 1
  return `q${index}`
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
