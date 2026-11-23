import { useEffect, useMemo, useRef, useState } from 'react'
import type { JSX } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { ancestorsOf } from '../lib/graph'
import {
  checkLogicExpression,
  evaluateExpression,
  expressionErrorAt,
  parseExpression,
  refTypeInScenario,
} from '../lib/logic'
import { buildValueScope, resolveScopeValue } from '../lib/scope'
import type {
  LogicOutput,
  LogicStepNode,
  RunRecord,
  Scenario,
} from '../lib/types'
import { VariableMenu } from './VariableMenu'
import type { VariableGroup } from './VariableMenu'

interface LogicOutputsEditorProps {
  scenario: Scenario
  node: LogicStepNode
  results: Record<string, RunRecord>
  variables: VariableGroup[]
  onChange: (outputs: LogicOutput[]) => void
}

interface CheckState {
  error?: string
  preview?: boolean
  previewError?: string
}

const ID_PATTERN = /[^A-Za-z0-9_-]/g

function nextOutputId(outputs: LogicOutput[]): string {
  let index = outputs.length + 1
  const ids = new Set(outputs.map((output) => output.id))
  while (ids.has(`out${index}`)) index += 1
  return `out${index}`
}

function OutputRow(props: {
  output: LogicOutput
  check: CheckState
  variables: VariableGroup[]
  canRemove: boolean
  onChange: (patch: Partial<LogicOutput>) => void
  onRemove: () => void
}): JSX.Element {
  const { output, check, variables, canRemove, onChange, onRemove } = props
  const [idDraft, setIdDraft] = useState(output.id)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    setIdDraft(output.id)
  }, [output.id])

  const commitId = () => {
    const next = idDraft.trim()
    if (!next || next === output.id) {
      setIdDraft(output.id)
      return
    }
    onChange({ id: next })
  }

  const insertVariable = (template: string) => {
    const textarea = textareaRef.current
    const start = textarea?.selectionStart ?? output.expression.length
    const end = textarea?.selectionEnd ?? start
    const next = `${output.expression.slice(0, start)}${template}${output.expression.slice(end)}`
    onChange({ expression: next })
    window.setTimeout(() => {
      if (!textareaRef.current) return
      textareaRef.current.focus()
      const cursor = start + template.length
      textareaRef.current.setSelectionRange(cursor, cursor)
    }, 0)
  }

  const status = check.error ? (
    <span className="insp-logic-error" role="status">
      {check.error}
    </span>
  ) : check.preview !== undefined ? (
    <span className={`insp-logic-value${check.preview ? ' is-true' : ' is-false'}`}>
      求值：{check.preview ? '真' : '假'}
    </span>
  ) : (
    <span className="insp-logic-hint">
      {check.previewError ?? '运行上游后可预览结果'}
    </span>
  )

  return (
    <article className="insp-logic-card">
      <div className="insp-logic-head">
        <span className="insp-field-label">输出</span>
        <input
          className="insp-input insp-q-id"
          value={idDraft}
          aria-label="输出 ID"
          spellCheck={false}
          onChange={(event) => setIdDraft(event.target.value.replace(ID_PATTERN, ''))}
          onBlur={commitId}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault()
              commitId()
            }
            if (event.key === 'Escape') {
              setIdDraft(output.id)
              event.currentTarget.blur()
            }
          }}
        />
        <button
          type="button"
          className="insp-icon-btn insp-icon-btn-danger"
          title="删除输出"
          aria-label={`删除输出 ${output.id}`}
          disabled={!canRemove}
          onClick={onRemove}
        >
          <Trash2 size={13} strokeWidth={1.5} aria-hidden="true" />
        </button>
      </div>
      <textarea
        ref={textareaRef}
        className={`insp-textarea insp-logic-expr${check.error ? ' has-error' : ''}`}
        value={output.expression}
        rows={3}
        spellCheck={false}
        placeholder='例如：{{n1.department.probabilities.财务}} > 0.4 AND {{n1.urgent.noul}} > 0.5'
        aria-label={`输出 ${output.id} 的表达式`}
        aria-invalid={Boolean(check.error)}
        onChange={(event) => onChange({ expression: event.target.value })}
      />
      <div className="insp-logic-foot">
        {status}
        <VariableMenu
          variables={variables}
          onInsert={insertVariable}
          label="插入变量"
        />
      </div>
    </article>
  )
}

export function LogicOutputsEditor(props: LogicOutputsEditorProps): JSX.Element {
  const { scenario, node, results, variables, onChange } = props

  const scope = useMemo(
    () => buildValueScope(node.id, scenario, results),
    [node.id, scenario, results],
  )
  const hasValues = Object.keys(scope.nodes).length > 0
  const ancestors = useMemo(
    () => ancestorsOf(node.id, scenario.edges),
    [node.id, scenario.edges],
  )

  const checks = useMemo(
    () =>
      node.outputs.map((output): CheckState => {
        const checked = checkLogicExpression(output.expression, (path) =>
          refTypeInScenario(scenario, path),
        )
        if ('error' in checked) {
          return { error: expressionErrorAt(output.expression, checked.error) }
        }
        for (const ref of checked.refs) {
          const ownerId = ref.split('.')[0]
          if (ownerId === node.id) {
            return { error: `引用 {{${ref}}} 不能引用自身` }
          }
          if (ownerId && !ancestors.has(ownerId)) {
            return { error: `引用 {{${ref}}} 的 ${ownerId} 不是上游，请先连线` }
          }
        }
        const parsed = parseExpression(output.expression)
        if ('error' in parsed) {
          return { error: expressionErrorAt(output.expression, parsed.error) }
        }
        const evaluated = evaluateExpression(parsed.ast, (path) =>
          resolveScopeValue(scope, path),
        )
        if ('error' in evaluated) {
          return {
            previewError: hasValues ? evaluated.error.message : '运行上游后可预览结果',
          }
        }
        return { preview: Boolean(evaluated.value) }
      }),
    [node.outputs, scenario, scope, hasValues, ancestors],
  )

  const patch = (index: number, changes: Partial<LogicOutput>) => {
    onChange(node.outputs.map((output, i) => (i === index ? { ...output, ...changes } : output)))
  }

  return (
    <section className="insp-section insp-logic">
      <div className="insp-section-head">
        <div className="insp-title-row">
          <h3 className="insp-section-title">布尔输出</h3>
          <span className="insp-count">{node.outputs.length}</span>
        </div>
        <button
          type="button"
          className="insp-btn"
          onClick={() =>
            onChange([
              ...node.outputs,
              { id: nextOutputId(node.outputs), expression: '' },
            ])
          }
        >
          <Plus size={13} strokeWidth={1.5} aria-hidden="true" />
          添加输出
        </button>
      </div>

      <p className="insp-hint">
        每个输出是一个布尔表达式。引用上游结果用 <code>{'{{节点.字段}}'}</code>，例如{' '}
        <code>{'{{n1.department.probabilities.财务}} > 0.4'}</code>。
      </p>

      {node.outputs.length === 0 ? (
        <p className="insp-hint">还没有输出，至少需要一个布尔输出。</p>
      ) : (
        <div className="insp-logic-list">
          {node.outputs.map((output, index) => (
            <OutputRow
              key={index}
              output={output}
              check={checks[index] ?? {}}
              variables={variables}
              canRemove={node.outputs.length > 1}
              onChange={(changes) => patch(index, changes)}
              onRemove={() => onChange(node.outputs.filter((_, i) => i !== index))}
            />
          ))}
        </div>
      )}

      <details className="insp-logic-help">
        <summary>表达式语法</summary>
        <ul>
          <li>
            引用：<code>{'{{n1.department.choice}}'}</code>、<code>{'{{n1.urgent.noul}}'}</code>、
            <code>{'{{n2.risk}}'}</code>
          </li>
          <li>
            比较：<code>&gt;</code> <code>&gt;=</code> <code>&lt;</code> <code>&lt;=</code>{' '}
            <code>==</code> <code>!=</code>
          </li>
          <li>
            逻辑门：<code>AND</code> <code>OR</code> <code>XOR</code> <code>NAND</code>{' '}
            <code>XNOR</code> <code>NOT</code>（也接受 <code>&amp;&amp;</code>{' '}
            <code>||</code> <code>!</code>）
          </li>
          <li>
            算术与括号：<code>+ - * /</code>、<code>( )</code>；字符串用双引号，如{' '}
            <code>{'"财务"'}</code>
          </li>
          <li>
            优先级：括号 &gt; NOT/负号 &gt; 算术 &gt; 比较 &gt; AND/NAND &gt; XOR/XNOR &gt; OR；
            拿不准就加括号。
          </li>
        </ul>
      </details>
    </section>
  )
}
