import { useEffect, useState } from 'react'
import type { JSX } from 'react'
import { ChevronDown, Plus, Trash2, X } from 'lucide-react'
import {
  emptyCondition,
  emptyGroup,
  findBuilderNode,
  formatBuilderTree,
  makeOperand,
  operandType,
} from '../lib/logic-builder'
import type {
  BuilderCompareOp,
  BuilderGroup,
  BuilderGroupOp,
  BuilderIssue,
  BuilderNode,
  BuilderOperand,
  BuilderOperandKind,
  ScenarioRefGroup,
} from '../lib/logic-builder'
import { evaluateExpression, inferExpressionType, parseExpression } from '../lib/logic'
import type { LogicValueType, RefTypeResolver } from '../lib/logic'
import { resolveScopeValue } from '../lib/scope'
import type { TemplateScope } from '../lib/template'
import type { JsonValue } from '../lib/types'

const GROUP_LABELS: Record<BuilderGroupOp, string> = {
  and: '全部满足',
  or: '任一满足',
  xor: '恰好一个',
}

const OP_LABELS: Record<BuilderCompareOp, string> = {
  '>': '>',
  '>=': '≥',
  '<': '<',
  '<=': '≤',
  '==': '=',
  '!=': '≠',
}

const NUMBER_OPS: BuilderCompareOp[] = ['>', '>=', '<', '<=', '==', '!=']
const TEXT_OPS: BuilderCompareOp[] = ['==', '!=']

const TYPE_LABEL: Record<LogicValueType, string> = {
  number: '数',
  string: '文',
  boolean: '布',
}

const MODE_LABEL: Record<BuilderOperandKind, string> = {
  ref: '引用',
  number: '数字',
  string: '文本',
  boolean: '布尔',
  arith: '算式',
}

type OperandSide = 'left' | 'right' | 'operand'

interface EditingState {
  nodeId: string
  side: OperandSide
}

interface BuilderContext {
  issues: BuilderIssue[]
  refGroups: ScenarioRefGroup[]
  scope: TemplateScope
  resolveRef: RefTypeResolver
  editing: EditingState | null
  onEdit: (nodeId: string, side: OperandSide) => void
  onChangeNode: (id: string, update: (node: BuilderNode) => BuilderNode) => void
  onRemove: (id: string) => void
  onOperand: (nodeId: string, side: OperandSide, operand: BuilderOperand) => void
}

export interface LogicBuilderProps {
  tree: BuilderNode
  issues: BuilderIssue[]
  refGroups: ScenarioRefGroup[]
  scope: TemplateScope
  resolveRef: RefTypeResolver
  onChange: (tree: BuilderNode) => void
}

function withNode(
  node: BuilderNode,
  id: string,
  update: (node: BuilderNode) => BuilderNode,
): BuilderNode {
  if (node.id === id) return update(node)
  if (node.kind !== 'group') return node
  return { ...node, items: node.items.map((item) => withNode(item, id, update)) }
}

function pruneGroup(node: BuilderGroup, id: string): BuilderGroup | null {
  const items: BuilderNode[] = []
  for (const item of node.items) {
    if (item.id === id) continue
    if (item.kind === 'group') {
      const pruned = pruneGroup(item, id)
      if (pruned) items.push(pruned)
    } else {
      items.push(item)
    }
  }
  return items.length > 0 ? { ...node, items } : null
}

function removeNode(root: BuilderNode, id: string): BuilderNode {
  if (root.kind !== 'group' || root.id === id) return root
  const items: BuilderNode[] = []
  for (const item of root.items) {
    if (item.id === id) continue
    if (item.kind === 'group') {
      const pruned = pruneGroup(item, id)
      if (pruned) items.push(pruned)
    } else {
      items.push(item)
    }
  }
  return { ...root, items: items.length > 0 ? items : [emptyCondition()] }
}

function allowedOps(type: LogicValueType | null): BuilderCompareOp[] {
  return type === 'string' || type === 'boolean' ? TEXT_OPS : NUMBER_OPS
}

function defaultKind(type: LogicValueType | null): BuilderOperandKind {
  if (type === 'string') return 'string'
  if (type === 'boolean') return 'boolean'
  return 'number'
}

function switchOperandKind(operand: BuilderOperand, kind: BuilderOperandKind): BuilderOperand {
  if (operand.kind === kind) return operand
  const arithmetic =
    (operand.kind === 'number' || operand.kind === 'arith') &&
    (kind === 'number' || kind === 'arith')
  if (arithmetic) return { kind, text: operand.text ?? '' }
  return makeOperand(kind)
}

function evaluateNode(node: BuilderNode, scope: TemplateScope): boolean | null {
  const text = formatBuilderTree(node)
  if (!text) return null
  const parsed = parseExpression(text)
  if ('error' in parsed) return null
  const evaluated = evaluateExpression(parsed.ast, (path) => resolveScopeValue(scope, path))
  if ('error' in evaluated || typeof evaluated.value !== 'boolean') return null
  return evaluated.value
}

function formatValue(value: JsonValue | undefined): string {
  if (value === undefined) return '—'
  if (typeof value === 'boolean') return value ? '真' : '假'
  if (typeof value === 'string') return `"${value}"`
  if (typeof value === 'number') return String(value)
  return JSON.stringify(value)
}

function operandText(operand: BuilderOperand): { text: string; empty: boolean; title: string } {
  if (operand.kind === 'ref') {
    const path = (operand.path ?? '').trim()
    return path
      ? { text: `{{${path}}}`, empty: false, title: `引用 {{${path}}}` }
      : { text: '选择引用', empty: true, title: '选择一个上游字段' }
  }
  if (operand.kind === 'number') {
    const text = (operand.text ?? '').trim()
    return text
      ? { text, empty: false, title: `数字 ${text}` }
      : { text: '数字', empty: true, title: '输入一个数字' }
  }
  if (operand.kind === 'string') {
    if (typeof operand.value !== 'string') {
      return { text: '文本', empty: true, title: '输入一个文本值' }
    }
    return { text: `"${operand.value}"`, empty: false, title: `文本 ${operand.value}` }
  }
  if (operand.kind === 'boolean') {
    if (typeof operand.value !== 'boolean') {
      return { text: '布尔', empty: true, title: '选择 true 或 false' }
    }
    return {
      text: operand.value ? 'true' : 'false',
      empty: false,
      title: `布尔值 ${operand.value}`,
    }
  }
  const text = (operand.text ?? '').trim()
  return text
    ? { text: `ƒ ${text}`, empty: false, title: `算式 ${text}` }
    : { text: '算式', empty: true, title: '输入一段数值算式' }
}

function PreviewBadge({ value }: { value: boolean | null }): JSX.Element {
  if (value === null) {
    return <span className="insp-logic-preview is-empty" aria-hidden="true" />
  }
  return (
    <span className={`insp-logic-preview${value ? ' is-true' : ' is-false'}`}>
      {value ? '真' : '假'}
    </span>
  )
}

function OperandChip(props: {
  operand: BuilderOperand
  side: OperandSide
  onClick: () => void
}): JSX.Element {
  const { operand, side, onClick } = props
  const display = operandText(operand)
  return (
    <button
      type="button"
      className={`insp-logic-operand${display.empty ? ' is-empty' : ''}`}
      data-kind={operand.kind}
      data-side={side}
      title={display.title}
      aria-label={`编辑${side === 'right' ? '右值' : side === 'left' ? '左值' : '布尔条件'}`}
      onClick={onClick}
    >
      <span className="insp-logic-operand-text">{display.text}</span>
    </button>
  )
}

function NodeIssues({ nodeId, ctx }: { nodeId: string; ctx: BuilderContext }): JSX.Element | null {
  const issues = ctx.issues.filter((issue) => issue.nodeId === nodeId)
  if (issues.length === 0) return null
  return (
    <ul className="insp-logic-issue">
      {issues.map((issue, index) => (
        <li key={`${issue.message}-${index}`}>{issue.message}</li>
      ))}
    </ul>
  )
}

function GroupView(props: {
  group: BuilderGroup
  depth: number
  ctx: BuilderContext
}): JSX.Element {
  const { group, depth, ctx } = props
  const preview = evaluateNode(group, ctx.scope)
  const own = ctx.issues.filter((issue) => issue.nodeId === group.id)

  const addItem = (node: BuilderNode) => {
    ctx.onChangeNode(group.id, (current) =>
      current.kind === 'group' ? { ...current, items: [...current.items, node] } : current,
    )
  }

  return (
    <section
      className={`insp-logic-group${group.negated ? ' is-negated' : ''}`}
      data-depth={Math.min(depth, 3)}
      aria-label={`条件组 ${GROUP_LABELS[group.op]}`}
    >
      <header className="insp-logic-group-head">
        <select
          className="insp-logic-group-op"
          value={group.op}
          aria-label="条件组连接词"
          onChange={(event) =>
            ctx.onChangeNode(group.id, (current) =>
              current.kind === 'group'
                ? { ...current, op: event.target.value as BuilderGroupOp }
                : current,
            )
          }
        >
          <option value="and">全部满足</option>
          <option value="or">任一满足</option>
          <option value="xor">恰好一个</option>
        </select>
        <PreviewBadge value={preview} />
        <button
          type="button"
          className={`insp-logic-neg${group.negated ? ' is-on' : ''}`}
          aria-pressed={group.negated}
          title={group.negated ? '取消整组取反' : '整组取反（AND→NAND，XOR→XNOR）'}
          onClick={() =>
            ctx.onChangeNode(group.id, (current) =>
              current.kind === 'group' ? { ...current, negated: !current.negated } : current,
            )
          }
        >
          ¬
        </button>
        {depth > 0 ? (
          <button
            type="button"
            className="insp-icon-btn insp-icon-btn-danger insp-logic-del"
            title="删除子组"
            aria-label="删除子组"
            onClick={() => ctx.onRemove(group.id)}
          >
            <Trash2 size={12} strokeWidth={1.5} aria-hidden="true" />
          </button>
        ) : null}
      </header>

      <div className="insp-logic-rows">
        {group.items.map((item) =>
          item.kind === 'group' ? (
            <GroupView key={item.id} group={item} depth={depth + 1} ctx={ctx} />
          ) : (
            <RowView key={item.id} node={item} ctx={ctx} />
          ),
        )}
      </div>

      {own.length > 0 ? (
        <ul className="insp-logic-issue">
          {own.map((issue, index) => (
            <li key={`${issue.message}-${index}`}>{issue.message}</li>
          ))}
        </ul>
      ) : null}

      <div className="insp-logic-group-actions">
        <button type="button" className="insp-logic-add" onClick={() => addItem(emptyCondition())}>
          <Plus size={11} strokeWidth={1.6} aria-hidden="true" />
          条件
        </button>
        <button type="button" className="insp-logic-add" onClick={() => addItem(emptyGroup())}>
          <Plus size={11} strokeWidth={1.6} aria-hidden="true" />
          子组
        </button>
      </div>
    </section>
  )
}

function RowView(props: { node: Exclude<BuilderNode, BuilderGroup>; ctx: BuilderContext }): JSX.Element {
  const { node, ctx } = props
  const preview = evaluateNode(node, ctx.scope)

  if (node.kind === 'bool') {
    const type = operandType(node.operand, ctx.resolveRef)
    return (
      <div className={`insp-logic-row is-bool${node.negated ? ' is-negated' : ''}`}>
        <OperandChip
          operand={node.operand}
          side="operand"
          onClick={() => ctx.onEdit(node.id, 'operand')}
        />
        <span className="insp-logic-booltag">
          {type === null ? '布尔' : TYPE_LABEL[type]}
        </span>
        <PreviewBadge value={preview} />
        <button
          type="button"
          className={`insp-logic-neg${node.negated ? ' is-on' : ''}`}
          aria-pressed={node.negated}
          title={node.negated ? '取消取反' : '对这一项取反'}
          onClick={() =>
            ctx.onChangeNode(node.id, (current) =>
              current.kind === 'bool' ? { ...current, negated: !current.negated } : current,
            )
          }
        >
          ¬
        </button>
        <button
          type="button"
          className="insp-icon-btn insp-icon-btn-danger insp-logic-del"
          title="删除条件"
          aria-label="删除条件"
          onClick={() => ctx.onRemove(node.id)}
        >
          <Trash2 size={12} strokeWidth={1.5} aria-hidden="true" />
        </button>
        <NodeIssues nodeId={node.id} ctx={ctx} />
      </div>
    )
  }

  const leftType = operandType(node.left, ctx.resolveRef)
  const ops = allowedOps(leftType)
  const options = ops.includes(node.op) ? ops : [node.op, ...ops]

  return (
    <div className={`insp-logic-row${node.negated ? ' is-negated' : ''}`}>
      <OperandChip operand={node.left} side="left" onClick={() => ctx.onEdit(node.id, 'left')} />
      <span className="insp-logic-op-wrap">
        <select
          className="insp-logic-op"
          value={node.op}
          aria-label="比较符"
          onChange={(event) =>
            ctx.onChangeNode(node.id, (current) =>
              current.kind === 'compare'
                ? { ...current, op: event.target.value as BuilderCompareOp }
                : current,
            )
          }
        >
          {options.map((op) => (
            <option key={op} value={op}>
              {OP_LABELS[op]}
            </option>
          ))}
        </select>
        <ChevronDown
          size={9}
          strokeWidth={1.8}
          className="insp-logic-op-chevron"
          aria-hidden="true"
        />
      </span>
      <OperandChip
        operand={node.right}
        side="right"
        onClick={() => ctx.onEdit(node.id, 'right')}
      />
      <PreviewBadge value={preview} />
      <button
        type="button"
        className={`insp-logic-neg${node.negated ? ' is-on' : ''}`}
        aria-pressed={node.negated}
        title={node.negated ? '取消取反' : '对这一项取反'}
        onClick={() =>
          ctx.onChangeNode(node.id, (current) =>
            current.kind === 'compare'
              ? { ...current, negated: !current.negated }
              : current,
          )
        }
      >
        ¬
      </button>
      <button
        type="button"
        className="insp-icon-btn insp-icon-btn-danger insp-logic-del"
        title="删除条件"
        aria-label="删除条件"
        onClick={() => ctx.onRemove(node.id)}
      >
        <Trash2 size={12} strokeWidth={1.5} aria-hidden="true" />
      </button>
      <NodeIssues nodeId={node.id} ctx={ctx} />
    </div>
  )
}

function OperandPicker(props: {
  nodeId: string
  side: OperandSide
  label: string
  operand: BuilderOperand
  expected: LogicValueType | null
  ctx: BuilderContext
  onClose: () => void
}): JSX.Element {
  const { nodeId, side, label, operand, expected, ctx, onClose } = props
  const [query, setQuery] = useState('')
  const [manual, setManual] = useState('')

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  const allowed =
    expected === 'number'
      ? (['ref', 'number', 'arith'] as BuilderOperandKind[])
      : expected === 'string'
        ? (['ref', 'string'] as BuilderOperandKind[])
        : expected === 'boolean'
          ? (['ref', 'boolean'] as BuilderOperandKind[])
          : (['ref', 'number', 'string', 'arith', 'boolean'] as BuilderOperandKind[])
  if (!allowed.includes(operand.kind)) allowed.push(operand.kind)

  const commit = (next: BuilderOperand, close = false) => {
    ctx.onOperand(nodeId, side, next)
    if (close) onClose()
  }

  const needle = query.trim().toLowerCase()
  const groups = ctx.refGroups
    .map((group) => ({
      ...group,
      items: group.items.filter(
        (item) =>
          !needle ||
          item.label.toLowerCase().includes(needle) ||
          item.path.toLowerCase().includes(needle),
      ),
    }))
    .filter((group) => group.items.length > 0)

  const arithCheck = (text: string) => {
    if (!text.trim()) return { hint: '例如：{{n1.risk.score}} * 2 + 1' }
    const parsed = parseExpression(text)
    if ('error' in parsed) return { error: parsed.error.message }
    const inferred = inferExpressionType(parsed.ast, ctx.resolveRef)
    if ('error' in inferred) return { error: inferred.error.message }
    if (inferred.type !== 'number') return { error: '算式必须得到数字' }
    const evaluated = evaluateExpression(parsed.ast, (path) => resolveScopeValue(ctx.scope, path))
    if ('error' in evaluated) return { hint: '运行上游后可预览结果' }
    return { value: evaluated.value }
  }

  const submitManual = () => {
    const path = manual
      .trim()
      .replace(/^\{\{\s*/u, '')
      .replace(/\s*\}\}$/u, '')
    if (!path) return
    commit({ kind: 'ref', path }, true)
  }

  return (
    <section
      className="insp-logic-picker"
      aria-label={`编辑${label}`}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.stopPropagation()
          onClose()
        }
      }}
    >
      <header className="insp-logic-picker-head">
        <span className="insp-field-label">编辑{label}</span>
        <button
          type="button"
          className="insp-icon-btn"
          title="关闭"
          aria-label="关闭值编辑器"
          onClick={onClose}
        >
          <X size={13} strokeWidth={1.5} aria-hidden="true" />
        </button>
      </header>

      <div className="insp-logic-modes" role="tablist" aria-label="值类型">
        {allowed.map((kind) => (
          <button
            type="button"
            role="tab"
            key={kind}
            aria-selected={operand.kind === kind}
            className={`insp-logic-mode${operand.kind === kind ? ' is-active' : ''}`}
            onClick={() => commit(switchOperandKind(operand, kind))}
          >
            {MODE_LABEL[kind]}
          </button>
        ))}
      </div>

      {operand.kind === 'ref' ? (
        <div className="insp-logic-refpick">
          <input
            className="insp-input"
            value={query}
            placeholder="搜索变量…"
            aria-label="搜索变量"
            autoFocus
            onChange={(event) => setQuery(event.target.value)}
          />
          <div className="insp-logic-reflist">
            {groups.length === 0 ? (
              <p className="insp-hint">没有匹配的字段，可在下方手动输入路径。</p>
            ) : (
              groups.map((group) => (
                <div className="insp-logic-refgroup" key={group.nodeId}>
                  <div className="insp-logic-refgroup-title">
                    {group.title}
                    <span className="mono">{group.nodeId}</span>
                  </div>
                  {group.items.map((item) => {
                    const value = resolveScopeValue(ctx.scope, item.path).value
                    return (
                      <button
                        type="button"
                        className="insp-logic-refitem"
                        key={item.path}
                        onClick={() => commit({ kind: 'ref', path: item.path }, true)}
                      >
                        <span className="insp-logic-refitem-main">
                          <span className="insp-logic-refitem-label">{item.label}</span>
                          <span className={`insp-logic-type is-${item.type}`}>
                            {TYPE_LABEL[item.type]}
                          </span>
                          <span className="insp-logic-refitem-value mono">
                            {formatValue(value)}
                          </span>
                        </span>
                        <code className="insp-logic-refitem-path">{`{{${item.path}}}`}</code>
                      </button>
                    )
                  })}
                </div>
              ))
            )}
          </div>
          <div className="insp-logic-manual">
            <input
              className="insp-input mono"
              value={manual}
              placeholder="{{n1.risk.score}}"
              aria-label="手动输入引用路径"
              onChange={(event) => setManual(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault()
                  submitManual()
                }
              }}
            />
            <button type="button" className="insp-btn" onClick={submitManual}>
              使用
            </button>
          </div>
        </div>
      ) : null}

      {operand.kind === 'number' ? (
        <div className="insp-logic-valuemode">
          <input
            className="insp-input mono"
            inputMode="decimal"
            value={operand.text ?? ''}
            placeholder="0.5"
            aria-label="数字值"
            autoFocus
            onChange={(event) => commit({ kind: 'number', text: event.target.value })}
          />
        </div>
      ) : null}

      {operand.kind === 'string' ? (
        <div className="insp-logic-valuemode">
          <input
            className="insp-input"
            value={typeof operand.value === 'string' ? operand.value : ''}
            placeholder="例如：其他"
            aria-label="文本值"
            autoFocus
            onChange={(event) => commit({ kind: 'string', value: event.target.value })}
          />
        </div>
      ) : null}

      {operand.kind === 'arith' ? (
        <div className="insp-logic-valuemode">
          <input
            className="insp-input mono"
            value={operand.text ?? ''}
            placeholder="{{n1.risk.score}} * 2 + 1"
            aria-label="算式"
            autoFocus
            onChange={(event) => commit({ kind: 'arith', text: event.target.value })}
          />
          {(() => {
            const check = arithCheck(operand.text ?? '')
            if ('error' in check && check.error) {
              return <span className="insp-logic-error">{check.error}</span>
            }
            if ('value' in check && check.value !== undefined) {
              return (
                <span className="insp-logic-arith-value">结果：{formatValue(check.value)}</span>
              )
            }
            return <span className="insp-logic-hint">{'hint' in check ? check.hint : ''}</span>
          })()}
        </div>
      ) : null}

      {operand.kind === 'boolean' ? (
        <div className="insp-logic-valuemode insp-logic-boolpick">
          <button
            type="button"
            className={`insp-btn${operand.value === true ? ' is-active' : ''}`}
            onClick={() => commit({ kind: 'boolean', value: true }, true)}
          >
            true
          </button>
          <button
            type="button"
            className={`insp-btn${operand.value === false ? ' is-active' : ''}`}
            onClick={() => commit({ kind: 'boolean', value: false }, true)}
          >
            false
          </button>
        </div>
      ) : null}
    </section>
  )
}

export function LogicBuilder(props: LogicBuilderProps): JSX.Element {
  const { tree, issues, refGroups, scope, resolveRef, onChange } = props
  const [editing, setEditing] = useState<EditingState | null>(null)

  const root: BuilderNode =
    tree.kind === 'group'
      ? tree
      : { kind: 'group', id: `wrap-${tree.id}`, op: 'and', negated: false, items: [tree] }

  useEffect(() => {
    if (editing && !findBuilderNode(root, editing.nodeId)) setEditing(null)
  }, [root, editing])

  const ctx: BuilderContext = {
    issues,
    refGroups,
    scope,
    resolveRef,
    editing,
    onEdit: (nodeId, side) =>
      setEditing((current) =>
        current && current.nodeId === nodeId && current.side === side ? null : { nodeId, side },
      ),
    onChangeNode: (id, update) => onChange(withNode(root, id, update)),
    onRemove: (id) => {
      onChange(removeNode(root, id))
      setEditing((current) => (current?.nodeId === id ? null : current))
    },
    onOperand: (nodeId, side, operand) => {
      if (!nodeId) return
      onChange(
        withNode(root, nodeId, (node) => {
          if (node.kind === 'bool') {
            const type = operandType(operand, resolveRef)
            if (type !== null && type !== 'boolean') {
              return {
                kind: 'compare',
                id: node.id,
                negated: node.negated,
                op: type === 'string' ? '==' : '>',
                left: operand,
                right: makeOperand(defaultKind(type)),
              }
            }
            return { ...node, operand }
          }
          if (node.kind !== 'compare') return node
          if (side === 'operand') return node

          const next = side === 'left' ? { ...node, left: operand } : { ...node, right: operand }
          const leftType = operandType(next.left, resolveRef)
          if (leftType === 'boolean') {
            return { kind: 'bool', id: node.id, negated: node.negated, operand: next.left }
          }

          let op = next.op
          let right = next.right
          if (leftType !== null) {
            const options = allowedOps(leftType)
            if (!options.includes(op)) op = options[0]
            const rightType = operandType(right, resolveRef)
            if (rightType !== null && rightType !== leftType) {
              right = makeOperand(defaultKind(leftType))
            }
          }
          return { ...next, op, right }
        }),
      )
    },
  }

  const editingNode = editing ? findBuilderNode(root, editing.nodeId) : null
  let editingOperand: BuilderOperand | null = null
  let editingExpected: LogicValueType | null = null
  let editingLabel = '条件'

  if (editingNode && editing) {
    if (editingNode.kind === 'bool') {
      editingOperand = editingNode.operand
      editingExpected = 'boolean'
      editingLabel = '布尔条件'
    } else if (editingNode.kind === 'compare') {
      editingOperand = editing.side === 'right' ? editingNode.right : editingNode.left
      editingLabel = editing.side === 'right' ? '右值' : '左值'
      // 左值决定这一行是数字、字符串还是布尔；未选之前不限制类型。
      editingExpected =
        editing.side === 'right' ? operandType(editingNode.left, resolveRef) : null
    }
  }

  return (
    <div className="insp-logic-builder">
      <GroupView group={root as BuilderGroup} depth={0} ctx={ctx} />
      {editingOperand && editing ? (
        <OperandPicker
          nodeId={editing.nodeId}
          side={editing.side}
          label={editingLabel}
          operand={editingOperand}
          expected={editingExpected}
          ctx={ctx}
          onClose={() => setEditing(null)}
        />
      ) : null}
    </div>
  )
}
