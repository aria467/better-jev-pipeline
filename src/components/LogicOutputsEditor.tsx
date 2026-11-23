import { useEffect, useMemo, useRef, useState } from 'react'
import type { JSX } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import {
  checkBuilderNode,
  collectScenarioRefs,
  emptyBuilderTree,
  expressionToTree,
  formatBuilderTree,
  normalizeBuilderTree,
} from '../lib/logic-builder'
import type { BuilderNode, ScenarioRefGroup } from '../lib/logic-builder'
import {
  checkLogicExpression,
  evaluateExpression,
  expressionErrorAt,
  parseExpression,
  refTypeInScenario,
} from '../lib/logic'
import type { RefTypeResolver } from '../lib/logic'
import { buildValueScope, resolveScopeValue } from '../lib/scope'
import type { TemplateScope } from '../lib/template'
import type {
  LogicOutput,
  LogicStepNode,
  RunRecord,
  Scenario,
} from '../lib/types'
import { LogicBuilder } from './LogicBuilder'
import { VariableMenu } from './VariableMenu'
import type { VariableGroup } from './VariableMenu'

interface LogicOutputsEditorProps {
  scenario: Scenario
  node: LogicStepNode
  results: Record<string, RunRecord>
  variables: VariableGroup[]
  onChange: (outputs: LogicOutput[]) => void
}

const ID_PATTERN = /[^A-Za-z0-9_-]/g

function nextOutputId(outputs: LogicOutput[]): string {
  let index = outputs.length + 1
  const ids = new Set(outputs.map((output) => output.id))
  while (ids.has(`out${index}`)) index += 1
  return `out${index}`
}

interface OutputCardProps {
  output: LogicOutput
  canRemove: boolean
  variables: VariableGroup[]
  refGroups: ScenarioRefGroup[]
  scope: TemplateScope
  resolveRef: RefTypeResolver
  onChange: (next: LogicOutput) => void
  onRemove: () => void
}

function hasScopeValues(scope: TemplateScope): boolean {
  return Object.keys(scope.nodes).length > 0
}

function LogicOutputCard(props: OutputCardProps): JSX.Element {
  const { output, canRemove, variables, refGroups, scope, resolveRef, onChange, onRemove } = props
  const [idDraft, setIdDraft] = useState(output.id)
  const [localError, setLocalError] = useState<string | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const hasValues = hasScopeValues(scope)

  useEffect(() => {
    setIdDraft(output.id)
  }, [output.id])

  const converted = useMemo<{ tree: BuilderNode | null; error?: string }>(() => {
    if (output.graph) {
      const normalized = normalizeBuilderTree(output.graph)
      if (normalized) return { tree: normalized }
    }
    if (!output.expression.trim()) return { tree: emptyBuilderTree() }
    const result = expressionToTree(output.expression, resolveRef)
    if ('error' in result) return { tree: null, error: result.error.message }
    return { tree: result.tree }
  }, [output.graph, output.expression, resolveRef])

  const graph = converted.tree
  const preferred = output.mode ?? 'graph'
  const mode: 'graph' | 'text' = preferred === 'text' || !graph ? 'text' : 'graph'

  const check = useMemo(
    () => (graph ? checkBuilderNode(graph, resolveRef) : null),
    [graph, resolveRef],
  )

  const preview = useMemo(() => {
    if (!graph || (check && check.issues.length > 0)) return null
    const text = formatBuilderTree(graph)
    if (!text) return null
    const parsed = parseExpression(text)
    if ('error' in parsed) return null
    const evaluated = evaluateExpression(parsed.ast, (path) => resolveScopeValue(scope, path))
    if ('error' in evaluated || typeof evaluated.value !== 'boolean') return null
    return evaluated.value
  }, [graph, check, scope])

  const textCheck = useMemo(() => {
    if (mode !== 'text') return {}
    if (!output.expression.trim()) return { error: '表达式不能为空' }
    const checked = checkLogicExpression(output.expression, resolveRef)
    if ('error' in checked) {
      return { error: expressionErrorAt(output.expression, checked.error) }
    }
    const parsed = parseExpression(output.expression)
    if ('error' in parsed) {
      return { error: expressionErrorAt(output.expression, parsed.error) }
    }
    const evaluated = evaluateExpression(parsed.ast, (path) => resolveScopeValue(scope, path))
    if ('error' in evaluated) {
      return { hint: hasValues ? evaluated.error.message : '运行上游后可预览结果' }
    }
    return { preview: Boolean(evaluated.value) }
  }, [mode, output.expression, resolveRef, scope, hasValues])

  const commitId = () => {
    const next = idDraft.trim()
    if (!next || next === output.id) {
      setIdDraft(output.id)
      return
    }
    onChange({ ...output, id: next })
  }

  const insertVariable = (template: string) => {
    const textarea = textareaRef.current
    const start = textarea?.selectionStart ?? output.expression.length
    const end = textarea?.selectionEnd ?? start
    const next = `${output.expression.slice(0, start)}${template}${output.expression.slice(end)}`
    onChange({ ...output, mode: 'text', expression: next, graph: undefined })
    window.setTimeout(() => {
      if (!textareaRef.current) return
      textareaRef.current.focus()
      const cursor = start + template.length
      textareaRef.current.setSelectionRange(cursor, cursor)
    }, 0)
  }

  const switchToText = () => {
    if (mode === 'text') return
    const expression = graph ? formatBuilderTree(graph) : output.expression
    setLocalError(null)
    onChange({ ...output, mode: 'text', expression })
  }

  const switchToGraph = () => {
    if (mode === 'graph') return
    setLocalError(null)
    const existing = output.graph ? normalizeBuilderTree(output.graph) : null
    if (existing) {
      onChange({ ...output, mode: 'graph', graph: existing, expression: formatBuilderTree(existing) })
      return
    }
    if (!output.expression.trim()) {
      onChange({ ...output, mode: 'graph', graph: emptyBuilderTree(), expression: '' })
      return
    }
    const result = expressionToTree(output.expression, resolveRef)
    if ('error' in result) {
      setLocalError(`无法转换成图形：${result.error.message}`)
      return
    }
    onChange({
      ...output,
      mode: 'graph',
      graph: result.tree,
      expression: formatBuilderTree(result.tree),
    })
  }

  const commitGraph = (next: BuilderNode) => {
    setLocalError(null)
    onChange({ ...output, mode: 'graph', graph: next, expression: formatBuilderTree(next) })
  }

  const graphExpression = graph ? formatBuilderTree(graph) : ''
  const graphIssues = check?.issues.length ?? 0
  const refCount = check?.refs.length ?? 0

  const status =
    mode === 'text' ? (
      textCheck.error ? (
        <span className="insp-logic-error" role="status">
          {textCheck.error}
        </span>
      ) : textCheck.preview !== undefined ? (
        <span className={`insp-logic-value${textCheck.preview ? ' is-true' : ' is-false'}`}>
          求值：{textCheck.preview ? '真' : '假'}
        </span>
      ) : (
        <span className="insp-logic-hint">{textCheck.hint ?? '运行上游后可预览结果'}</span>
      )
    ) : graphIssues > 0 ? (
      <span className="insp-logic-error" role="status">
        {graphIssues} 处问题待修正
      </span>
    ) : preview !== null ? (
      <span className={`insp-logic-value${preview ? ' is-true' : ' is-false'}`}>
        求值：{preview ? '真' : '假'}
      </span>
    ) : (
      <span className="insp-logic-hint">
        {hasValues ? '补全每个条件后可预览' : '运行上游后可预览结果'}
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
        <div className="insp-logic-modes" role="tablist" aria-label="表达式模式">
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'graph'}
            className={`insp-logic-mode${mode === 'graph' ? ' is-active' : ''}`}
            onClick={switchToGraph}
          >
            图形
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'text'}
            className={`insp-logic-mode${mode === 'text' ? ' is-active' : ''}`}
            onClick={switchToText}
          >
            文本
          </button>
        </div>
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

      {mode === 'graph' && graph ? (
        <LogicBuilder
          tree={graph}
          issues={check?.issues ?? []}
          refGroups={refGroups}
          scope={scope}
          resolveRef={resolveRef}
          onChange={commitGraph}
        />
      ) : null}

      {mode === 'text' ? (
        <>
          <textarea
            ref={textareaRef}
            className={`insp-textarea insp-logic-expr${textCheck.error ? ' has-error' : ''}`}
            value={output.expression}
            rows={3}
            spellCheck={false}
            placeholder="例如：{{n1.risk.score}} < 0.5 AND {{n1.dept.choice}} != &quot;其他&quot;"
            aria-label={`输出 ${output.id} 的表达式`}
            aria-invalid={Boolean(textCheck.error)}
            onChange={(event) =>
              onChange({
                ...output,
                mode: 'text',
                expression: event.target.value,
                graph: undefined,
              })
            }
          />
          <div className="insp-logic-foot">
            {status}
            <VariableMenu variables={variables} onInsert={insertVariable} label="插入变量" />
          </div>
          {converted.error ? (
            <p className="insp-logic-hint">
              无法转换为图形：{converted.error}，继续使用文本模式。
            </p>
          ) : null}
        </>
      ) : null}

      {mode === 'graph' ? (
        <>
          <div className="insp-logic-foot insp-logic-graphfoot">
            {status}
            <span className="insp-logic-refcount">引用 {refCount} 个字段</span>
          </div>
          {graphExpression ? (
            <details className="insp-logic-generated">
              <summary>生成的表达式</summary>
              <code>{graphExpression}</code>
            </details>
          ) : null}
        </>
      ) : null}

      {localError ? <p className="insp-logic-error">{localError}</p> : null}
    </article>
  )
}

export function LogicOutputsEditor(props: LogicOutputsEditorProps): JSX.Element {
  const { scenario, node, results, variables, onChange } = props

  const refGroups = useMemo(
    () => collectScenarioRefs(scenario, node.id),
    [scenario, node.id],
  )
  const scope = useMemo(
    () => buildValueScope(node.id, scenario, results),
    [node.id, scenario, results],
  )
  const resolveRef = useMemo<RefTypeResolver>(
    () => (path: string) => refTypeInScenario(scenario, path),
    [scenario],
  )

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
        默认用图形条件构建；每个输出可在「图形 / 文本」之间切换。引用上游结果写{' '}
        <code>{'{{节点.字段}}'}</code>。
      </p>

      {node.outputs.length === 0 ? (
        <p className="insp-hint">还没有输出，至少需要一个布尔输出。</p>
      ) : (
        <div className="insp-logic-list">
          {node.outputs.map((output, index) => (
            <LogicOutputCard
              key={index}
              output={output}
              canRemove={node.outputs.length > 1}
              variables={variables}
              refGroups={refGroups}
              scope={scope}
              resolveRef={resolveRef}
              onChange={(next) =>
                onChange(node.outputs.map((item, i) => (i === index ? next : item)))
              }
              onRemove={() => onChange(node.outputs.filter((_, i) => i !== index))}
            />
          ))}
        </div>
      )}

      <details className="insp-logic-help">
        <summary>图形构建器与表达式语法</summary>
        <ul>
          <li>
            图形：组连接词 <code>AND</code>（全部满足）、<code>OR</code>（任一满足）、
            <code>XOR</code>（恰好一个）；行和组都可 <code>¬</code> 取反。
            <code>NAND</code> 等价于取反的 AND 组，<code>XNOR</code> 等价于取反的 XOR 组。
          </li>
          <li>
            值槽：引用、数字、文本或算式。算式示例：
            <code>{'{{n1.risk.score}} * 2 + 1'}</code>。
          </li>
          <li>
            引用：<code>{'{{n1.department.choice}}'}</code>、
            <code>{'{{n1.urgent.noul}}'}</code>、<code>{'{{n2.risk}}'}</code>。
          </li>
          <li>
            文本模式比较：<code>&gt;</code> <code>&gt;=</code> <code>&lt;</code>{' '}
            <code>&lt;=</code> <code>==</code> <code>!=</code>；逻辑门：<code>AND</code>{' '}
            <code>OR</code> <code>XOR</code> <code>NAND</code> <code>XNOR</code>{' '}
            <code>NOT</code>（也接受 <code>&amp;&amp;</code> <code>||</code> <code>!</code>）。
          </li>
          <li>
            文本编辑会重新生成图形结构；无法转换的表达式会留在文本模式。字符串用双引号，
            如 <code>{'"其他"'}</code>。
          </li>
        </ul>
      </details>
    </section>
  )
}
