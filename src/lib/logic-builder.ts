import { ancestorsOf } from './graph'
import {
  MAX_EXPRESSION_LENGTH,
  SAFE_PATH_SEGMENT,
  collectLogicRefs,
  expressionErrorAt,
  inferExpressionType,
  parseExpression,
  questionRefFields,
} from './logic'
import type { LogicAst, LogicError, LogicValueType, RefTypeResolver } from './logic'
import { isLogicNode } from './types'
import type { LogicOutput, Scenario } from './types'

/** 与文本 DSL 一致的输出表达式上限。 */
export const MAX_BUILDER_NODES = 200
export const MAX_BUILDER_DEPTH = 32

export type BuilderCompareOp = '>' | '>=' | '<' | '<=' | '==' | '!='
export type BuilderGroupOp = 'and' | 'or' | 'xor'
export type BuilderOperandKind = 'ref' | 'number' | 'string' | 'boolean' | 'arith'

export interface BuilderOperand {
  kind: BuilderOperandKind
  /** ref 用 */
  path?: string
  /** number / arith 用，保留用户原始输入文本 */
  text?: string
  /** string / boolean 用 */
  value?: string | boolean
}

export interface BuilderGroup {
  kind: 'group'
  id: string
  op: BuilderGroupOp
  negated: boolean
  items: BuilderNode[]
}

export interface BuilderCompare {
  kind: 'compare'
  id: string
  op: BuilderCompareOp
  negated: boolean
  left: BuilderOperand
  right: BuilderOperand
}

export interface BuilderBool {
  kind: 'bool'
  id: string
  negated: boolean
  operand: BuilderOperand
}

export type BuilderNode = BuilderGroup | BuilderCompare | BuilderBool

export type BuilderOperandSide = 'left' | 'right' | 'operand'

export interface BuilderIssue {
  nodeId: string
  side?: BuilderOperandSide
  message: string
}

export interface BuilderCheck {
  type: LogicValueType
  refs: string[]
  issues: BuilderIssue[]
  /** 完整的、可交给 DSL 执行的文本；不完整时为空串。 */
  expression: string
}

let fallbackId = 0

export function newBuilderId(): string {
  const raw =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `${Date.now().toString(36)}-${fallbackId++}`
  return `b${raw.replace(/-/g, '').slice(0, 10)}`
}

export function makeOperand(kind: BuilderOperandKind): BuilderOperand {
  if (kind === 'ref') return { kind, path: '' }
  if (kind === 'number' || kind === 'arith') return { kind, text: '' }
  if (kind === 'string') return { kind, value: '' }
  return { kind, value: true }
}

export function emptyCondition(id = newBuilderId()): BuilderCompare {
  return {
    kind: 'compare',
    id,
    op: '>',
    negated: false,
    left: makeOperand('ref'),
    right: makeOperand('number'),
  }
}

export function emptyGroup(id = newBuilderId()): BuilderGroup {
  return { kind: 'group', id, op: 'and', negated: false, items: [emptyCondition()] }
}

export function emptyBuilderTree(): BuilderGroup {
  return emptyGroup()
}

/* ------------------------------------------------------------------ */
/* 结构守卫与导入归一化                                                */
/* ------------------------------------------------------------------ */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function parseOperand(value: unknown): BuilderOperand | null {
  if (!isRecord(value)) return null
  const kind = value.kind
  if (kind === 'ref') {
    return typeof value.path === 'string' ? { kind, path: value.path } : null
  }
  if (kind === 'number' || kind === 'arith') {
    return typeof value.text === 'string' ? { kind, text: value.text } : null
  }
  if (kind === 'string') {
    return typeof value.value === 'string' ? { kind, value: value.value } : null
  }
  if (kind === 'boolean') {
    return typeof value.value === 'boolean' ? { kind, value: value.value } : null
  }
  return null
}

const COMPARE_OPS: readonly string[] = ['>', '>=', '<', '<=', '==', '!=']
const GROUP_OPS: readonly string[] = ['and', 'or', 'xor']

function parseBuilderNode(
  value: unknown,
  depth: number,
  counter: { nodes: number },
): BuilderNode | null {
  if (!isRecord(value)) return null
  counter.nodes += 1
  if (counter.nodes > MAX_BUILDER_NODES || depth > MAX_BUILDER_DEPTH) return null

  const id = typeof value.id === 'string' && value.id ? value.id : newBuilderId()
  const negated = value.negated === true

  if (value.kind === 'group') {
    if (typeof value.op !== 'string' || !GROUP_OPS.includes(value.op)) return null
    if (!Array.isArray(value.items)) return null
    const items: BuilderNode[] = []
    for (const item of value.items) {
      const parsed = parseBuilderNode(item, depth + 1, counter)
      if (!parsed) return null
      items.push(parsed)
    }
    return {
      kind: 'group',
      id,
      op: value.op as BuilderGroupOp,
      negated,
      items,
    }
  }

  if (value.kind === 'compare') {
    if (typeof value.op !== 'string' || !COMPARE_OPS.includes(value.op)) return null
    const left = parseOperand(value.left)
    const right = parseOperand(value.right)
    if (!left || !right) return null
    return {
      kind: 'compare',
      id,
      op: value.op as BuilderCompareOp,
      negated,
      left,
      right,
    }
  }

  if (value.kind === 'bool') {
    const operand = parseOperand(value.operand)
    if (!operand) return null
    return { kind: 'bool', id, negated, operand }
  }

  return null
}

/** 校验并补齐节点 id；非法结构返回 null。用于导入与持久化恢复。 */
export function normalizeBuilderTree(value: unknown): BuilderNode | null {
  return parseBuilderNode(value, 0, { nodes: 0 })
}

export function isBuilderTree(value: unknown): value is BuilderNode {
  return normalizeBuilderTree(value) !== null
}

/** 导入 / 恢复时把图形输出同步成可执行文本，非法图形退回文本模式。 */
export function normalizeLogicOutputs(scenario: Scenario): Scenario {
  let changed = false
  const nodes = scenario.nodes.map((node) => {
    if (!isLogicNode(node)) return node
    let nodeChanged = false
    const outputs = node.outputs.map((output): LogicOutput => {
      if (!output.graph) return output
      const tree = normalizeBuilderTree(output.graph)
      if (!tree) {
        nodeChanged = true
        return { ...output, graph: undefined, mode: 'text' }
      }
      const expression = formatBuilderTree(tree)
      if (expression !== output.expression || tree !== output.graph) nodeChanged = true
      return { ...output, graph: tree, expression }
    })
    if (!nodeChanged) return node
    changed = true
    return { ...node, outputs }
  })
  return changed ? { ...scenario, nodes } : scenario
}

/* ------------------------------------------------------------------ */
/* 表达式 -> 构建器树                                                  */
/* ------------------------------------------------------------------ */

interface ConvertContext {
  resolveRef: RefTypeResolver
}

function convertError(message: string, index = 0): { error: LogicError } {
  return { error: { message, index } }
}

function inferTypeSafe(
  ast: LogicAst,
  ctx: ConvertContext,
): LogicValueType | null {
  const inferred = inferExpressionType(ast, ctx.resolveRef)
  return 'error' in inferred ? null : inferred.type
}

function formatNumberLiteral(ast: Extract<LogicAst, { type: 'number' }>): string {
  const raw = ast.raw ?? String(ast.value)
  return /^\d+(?:\.\d+)?$/.test(raw) ? raw : String(ast.value)
}

function formatArithmetic(ast: LogicAst): string | null {
  if (ast.type === 'number') return formatNumberLiteral(ast)
  if (ast.type === 'ref') return `{{${ast.path}}}`
  if (ast.type === 'string') return `"${escapeString(ast.value)}"`
  if (ast.type === 'boolean') return ast.value ? 'true' : 'false'
  if (ast.type === 'neg') {
    const inner = formatArithmetic(ast.operand)
    return inner === null ? null : `-(${inner})`
  }
  if (ast.type === 'binary' && ['+', '-', '*', '/'].includes(ast.op)) {
    const left = formatArithmetic(ast.left)
    const right = formatArithmetic(ast.right)
    if (left === null || right === null) return null
    return `(${left} ${ast.op} ${right})`
  }
  return null
}

function convertOperand(ast: LogicAst): BuilderOperand | { error: LogicError } {
  if (ast.type === 'number') return { kind: 'number', text: formatNumberLiteral(ast) }
  if (ast.type === 'string') return { kind: 'string', value: ast.value }
  if (ast.type === 'boolean') return { kind: 'boolean', value: ast.value }
  if (ast.type === 'ref') return { kind: 'ref', path: ast.path }
  if (ast.type === 'neg' && ast.operand.type === 'number') {
    return { kind: 'number', text: `-${formatNumberLiteral(ast.operand)}` }
  }
  if (ast.type === 'neg' || (ast.type === 'binary' && ['+', '-', '*', '/'].includes(ast.op))) {
    const text = formatArithmetic(ast)
    if (text === null) return convertError('这个值无法用图形表示', ast.index)
    return { kind: 'arith', text }
  }
  return convertError('比较两侧必须是数字、字符串、引用或算式', ast.index)
}

function booleanLiteralOf(ast: LogicAst): boolean | null {
  return ast.type === 'boolean' ? ast.value : null
}

function convertBoolean(
  ast: LogicAst,
  negate: boolean,
  ctx: ConvertContext,
): BuilderNode | { error: LogicError } {
  if (ast.type === 'not') {
    return convertBoolean(ast.operand, !negate, ctx)
  }

  if (ast.type === 'boolean') {
    return {
      kind: 'bool',
      id: newBuilderId(),
      negated: negate,
      operand: { kind: 'boolean', value: ast.value },
    }
  }

  if (ast.type === 'ref') {
    const type = inferTypeSafe(ast, ctx)
    if (type !== null && type !== 'boolean') {
      return convertError(`引用 {{${ast.path}}} 是${typeName(type)}，布尔输出需要布尔值`, ast.index)
    }
    return {
      kind: 'bool',
      id: newBuilderId(),
      negated: negate,
      operand: { kind: 'ref', path: ast.path },
    }
  }

  if (ast.type === 'binary') {
    const op = ast.op
    if (op === 'AND' || op === 'OR' || op === 'XOR' || op === 'NAND' || op === 'XNOR') {
      const base: BuilderGroupOp = op === 'AND' || op === 'NAND' ? 'and' : op === 'OR' ? 'or' : 'xor'
      const inverted = op === 'NAND' || op === 'XNOR'
      const left = collectGroupItems(ast.left, base, ctx)
      if ('error' in left) return left
      const right = collectGroupItems(ast.right, base, ctx)
      if ('error' in right) return right
      return {
        kind: 'group',
        id: newBuilderId(),
        op: base,
        negated: negate !== inverted,
        items: [...left.items, ...right.items],
      }
    }

    if (op === '==' || op === '!=') {
      const leftLiteral = booleanLiteralOf(ast.left)
      const rightLiteral = booleanLiteralOf(ast.right)

      if (leftLiteral !== null || rightLiteral !== null) {
        const other = leftLiteral !== null ? ast.right : ast.left
        const literal = leftLiteral !== null ? leftLiteral : (rightLiteral as boolean)
        const otherType = inferTypeSafe(other, ctx)
        if (otherType === 'boolean') {
          const innerNegate = (op === '==') !== literal
          return convertBoolean(other, negate !== innerNegate, ctx)
        }
      }

      const leftType = inferTypeSafe(ast.left, ctx)
      const rightType = inferTypeSafe(ast.right, ctx)
      if (leftType === 'boolean' && rightType === 'boolean') {
        const left = convertBoolean(ast.left, false, ctx)
        if ('error' in left) return left
        const right = convertBoolean(ast.right, false, ctx)
        if ('error' in right) return right
        return {
          kind: 'group',
          id: newBuilderId(),
          op: 'xor',
          negated: negate !== (op === '=='),
          items: [left, right],
        }
      }

      const left = convertOperand(ast.left)
      if ('error' in left) return left
      const right = convertOperand(ast.right)
      if ('error' in right) return right
      return {
        kind: 'compare',
        id: newBuilderId(),
        op,
        negated: negate,
        left,
        right,
      }
    }

    if (op === '>' || op === '>=' || op === '<' || op === '<=') {
      const left = convertOperand(ast.left)
      if ('error' in left) return left
      const right = convertOperand(ast.right)
      if ('error' in right) return right
      return {
        kind: 'compare',
        id: newBuilderId(),
        op,
        negated: negate,
        left,
        right,
      }
    }
  }

  return convertError('这个表达式无法用图形构建器表示，请继续使用文本模式', ast.index)
}

/**
 * 收集一个组的条件：
 * 只有「同连接词且未取反」的子组才能摊平；NAND/XNOR 链与取反子组必须保留嵌套。
 */
function collectGroupItems(
  ast: LogicAst,
  base: BuilderGroupOp,
  ctx: ConvertContext,
): { items: BuilderNode[] } | { error: LogicError } {
  if (ast.type === 'binary') {
    const expected = base.toUpperCase()
    if (ast.op === expected) {
      const left = collectGroupItems(ast.left, base, ctx)
      if ('error' in left) return left
      const right = collectGroupItems(ast.right, base, ctx)
      if ('error' in right) return right
      return { items: [...left.items, ...right.items] }
    }
  }
  const node = convertBoolean(ast, false, ctx)
  if ('error' in node) return node
  return { items: [node] }
}

export function expressionToTree(
  text: string,
  resolveRef: RefTypeResolver,
): { tree: BuilderNode } | { error: LogicError } {
  if (!text.trim()) return { tree: emptyBuilderTree() }
  const parsed = parseExpression(text)
  if ('error' in parsed) return parsed

  const ctx: ConvertContext = { resolveRef }
  const converted = convertBoolean(parsed.ast, false, ctx)
  if ('error' in converted) return converted

  if (converted.kind === 'group') return { tree: converted }
  return {
    tree: {
      kind: 'group',
      id: newBuilderId(),
      op: 'and',
      negated: false,
      items: [converted],
    },
  }
}

/* ------------------------------------------------------------------ */
/* 构建器树 -> 表达式文本                                              */
/* ------------------------------------------------------------------ */

function typeName(type: LogicValueType): string {
  return type === 'number' ? '数字' : type === 'string' ? '字符串' : '布尔值'
}

function escapeString(value: string): string {
  // DSL 词法器只识别反斜杠转义；不要生成 \n / \u 这类序列。
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}

const NUMBER_TEXT = /^-?\d+(?:\.\d+)?$/

function formatOperand(operand: BuilderOperand): string {
  if (operand.kind === 'ref') {
    const path = (operand.path ?? '').trim()
    return path ? `{{${path}}}` : ''
  }
  if (operand.kind === 'number') {
    const text = (operand.text ?? '').trim()
    return NUMBER_TEXT.test(text) ? text : ''
  }
  if (operand.kind === 'string') {
    return typeof operand.value === 'string' ? `"${escapeString(operand.value)}"` : ''
  }
  if (operand.kind === 'boolean') {
    if (operand.value === true) return 'true'
    if (operand.value === false) return 'false'
    return ''
  }
  const text = (operand.text ?? '').trim()
  return text ? `(${text})` : ''
}

export function formatBuilderTree(tree: BuilderNode): string {
  const visit = (node: BuilderNode): string => {
    if (node.kind === 'bool') {
      const operand = formatOperand(node.operand)
      if (!operand) return ''
      return node.negated ? `NOT (${operand})` : operand
    }

    if (node.kind === 'compare') {
      const left = formatOperand(node.left)
      const right = formatOperand(node.right)
      if (!left || !right) return ''
      const inner = `${left} ${node.op} ${right}`
      return node.negated ? `NOT (${inner})` : inner
    }

    if (node.items.length === 0) return ''
    const single = node.items.length === 1
    const parts: string[] = []
    for (const item of node.items) {
      const text = visit(item)
      if (!text) return ''
      // 只有一个子项时，父组的连接词不产生歧义，不必再包一层括号。
      const needsParens = item.kind === 'group' && !item.negated && !single
      parts.push(needsParens ? `(${text})` : text)
    }
    const body = parts.join(` ${node.op.toUpperCase()} `)
    return node.negated ? `NOT (${body})` : body
  }

  return visit(tree)
}

export function operandType(
  operand: BuilderOperand,
  resolveRef: RefTypeResolver,
): LogicValueType | null {
  if (operand.kind === 'ref') {
    const path = (operand.path ?? '').trim()
    if (!path) return null
    const resolved = resolveRef(path)
    return 'error' in resolved ? null : resolved.type
  }
  if (operand.kind === 'number' || operand.kind === 'arith') return 'number'
  if (operand.kind === 'string') return 'string'
  return 'boolean'
}

export function findBuilderNode(tree: BuilderNode, id: string): BuilderNode | null {
  if (tree.id === id) return tree
  if (tree.kind !== 'group') return null
  for (const item of tree.items) {
    const found = findBuilderNode(item, id)
    if (found) return found
  }
  return null
}

export function logicOutputExpression(output: LogicOutput): string {
  if (output.graph && isBuilderTree(output.graph)) {
    return formatBuilderTree(output.graph)
  }
  return output.expression
}

export function collectBuilderRefs(tree: BuilderNode): string[] {
  const refs = new Set<string>()

  const addOperand = (operand: BuilderOperand) => {
    if (operand.kind === 'ref') {
      const path = (operand.path ?? '').trim()
      if (path) refs.add(path)
    } else if (operand.kind === 'arith') {
      for (const ref of collectLogicRefs(operand.text ?? '')) refs.add(ref)
    }
  }

  const visit = (node: BuilderNode) => {
    if (node.kind === 'group') {
      for (const item of node.items) visit(item)
      return
    }
    if (node.kind === 'compare') {
      addOperand(node.left)
      addOperand(node.right)
      return
    }
    addOperand(node.operand)
  }

  visit(tree)
  return Array.from(refs)
}

/* ------------------------------------------------------------------ */
/* 结构校验                                                            */
/* ------------------------------------------------------------------ */

function checkOperand(
  operand: BuilderOperand,
  nodeId: string,
  side: BuilderOperandSide,
  resolveRef: RefTypeResolver,
  issues: BuilderIssue[],
  refs: Set<string>,
  label: string,
): LogicValueType | null {
  const push = (message: string) => issues.push({ nodeId, side, message })

  if (operand.kind === 'ref') {
    const path = (operand.path ?? '').trim()
    if (!path) {
      push(`请${label}选择引用`)
      return null
    }
    const resolved = resolveRef(path)
    if ('error' in resolved) {
      push(resolved.error)
      return null
    }
    refs.add(path)
    return resolved.type
  }

  if (operand.kind === 'number') {
    const text = (operand.text ?? '').trim()
    if (!text) {
      push(`${label}不能为空`)
      return null
    }
    if (!NUMBER_TEXT.test(text)) {
      push(`${label}「${text}」不是合法数字`)
      return null
    }
    return 'number'
  }

  if (operand.kind === 'string') {
    if (typeof operand.value !== 'string') {
      push(`${label}不能为空`)
      return null
    }
    return 'string'
  }

  if (operand.kind === 'boolean') {
    if (typeof operand.value !== 'boolean') {
      push(`${label}必须是 true 或 false`)
      return null
    }
    return 'boolean'
  }

  const text = (operand.text ?? '').trim()
  if (!text) {
    push(`${label}算式不能为空`)
    return null
  }
  const parsed = parseExpression(text)
  if ('error' in parsed) {
    push(`${label}算式：${expressionErrorAt(text, parsed.error)}`)
    return null
  }
  const inferred = inferExpressionType(parsed.ast, resolveRef)
  if ('error' in inferred) {
    push(`${label}算式：${inferred.error.message}`)
    return null
  }
  if (inferred.type !== 'number') {
    push(`${label}算式必须得到数字，实际是${typeName(inferred.type)}`)
    return null
  }
  for (const ref of collectLogicRefs(text)) refs.add(ref)
  return 'number'
}

function checkNode(
  node: BuilderNode,
  resolveRef: RefTypeResolver,
  issues: BuilderIssue[],
  refs: Set<string>,
  depth: number,
  counter: { nodes: number },
): LogicValueType {
  counter.nodes += 1
  if (counter.nodes > MAX_BUILDER_NODES) {
    issues.push({ nodeId: node.id, message: `条件数量过多（上限 ${MAX_BUILDER_NODES}）` })
    return 'boolean'
  }
  if (depth > MAX_BUILDER_DEPTH) {
    issues.push({ nodeId: node.id, message: `条件嵌套过深（上限 ${MAX_BUILDER_DEPTH} 层）` })
    return 'boolean'
  }

  if (node.kind === 'group') {
    if (node.items.length === 0) {
      issues.push({ nodeId: node.id, message: '条件组为空，至少添加一个条件' })
    }
    for (const item of node.items) {
      const type = checkNode(item, resolveRef, issues, refs, depth + 1, counter)
      if (type !== 'boolean') {
        issues.push({ nodeId: node.id, message: '条件组里的每一项都必须是布尔结果' })
      }
    }
    return 'boolean'
  }

  if (node.kind === 'bool') {
    const type = checkOperand(node.operand, node.id, 'operand', resolveRef, issues, refs, '布尔条件')
    if (type !== null && type !== 'boolean') {
      issues.push({
        nodeId: node.id,
        side: 'operand',
        message: `布尔条件需要布尔值，实际是${typeName(type)}`,
      })
    }
    return 'boolean'
  }

  const left = checkOperand(node.left, node.id, 'left', resolveRef, issues, refs, '左值')
  const right = checkOperand(node.right, node.id, 'right', resolveRef, issues, refs, '右值')

  if (left !== null && right !== null) {
    if (left !== right) {
      issues.push({
        nodeId: node.id,
        message: `比较两侧类型不一致（${typeName(left)}与${typeName(right)}）`,
      })
    } else if (left !== 'number' && node.op !== '==' && node.op !== '!=') {
      issues.push({
        nodeId: node.id,
        message: `${typeName(left)}只能使用等于或不等于`,
      })
    }
  }

  return 'boolean'
}

export function checkBuilderNode(tree: BuilderNode, resolveRef: RefTypeResolver): BuilderCheck {
  const issues: BuilderIssue[] = []
  const refs = new Set<string>()
  checkNode(tree, resolveRef, issues, refs, 0, { nodes: 0 })
  const expression = formatBuilderTree(tree)
  if (!expression && issues.length === 0) {
    issues.push({ nodeId: tree.id, message: '表达式不完整，请补全每个条件' })
  }
  if (expression.length > MAX_EXPRESSION_LENGTH) {
    issues.push({
      nodeId: tree.id,
      message: `表达式过长（上限 ${MAX_EXPRESSION_LENGTH} 字符）`,
    })
  }
  return { type: 'boolean', refs: Array.from(refs), issues, expression }
}

/* ------------------------------------------------------------------ */
/* 引用目录                                                            */
/* ------------------------------------------------------------------ */

export interface ScenarioRefItem {
  path: string
  label: string
  type: LogicValueType
}

export interface ScenarioRefGroup {
  nodeId: string
  title: string
  items: ScenarioRefItem[]
}

/**
 * 按场景结构枚举某逻辑步所有祖先的可引用字段。
 * 不依赖运行结果，所以未运行上游时选择器也是完整的。
 */
export function collectScenarioRefs(scenario: Scenario, nodeId: string): ScenarioRefGroup[] {
  const allowed = ancestorsOf(nodeId, scenario.edges)
  const groups: ScenarioRefGroup[] = []

  for (const owner of scenario.nodes) {
    if (!allowed.has(owner.id)) continue
    const items: ScenarioRefItem[] = []

    if (isLogicNode(owner)) {
      for (const output of owner.outputs) {
        const id = output.id.trim()
        if (!id) continue
        items.push({ path: `${owner.id}.${id}`, label: id, type: 'boolean' })
      }
    } else {
      for (const [questionId, question] of Object.entries(owner.questions)) {
        if (!SAFE_PATH_SEGMENT.test(questionId)) continue
        for (const field of questionRefFields(question)) {
          items.push({
            path: `${owner.id}.${questionId}.${field.key}`,
            label: `${questionId} · ${field.key}`,
            type: field.type,
          })
        }
      }
    }

    if (items.length > 0) {
      groups.push({ nodeId: owner.id, title: owner.title, items })
    }
  }

  return groups
}
