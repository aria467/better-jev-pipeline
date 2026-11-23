import { extractRefs } from './template'
import { isLogicNode } from './types'
import type { JsonValue, LogicOutput, Question, Scenario } from './types'

export type LogicValueType = 'number' | 'string' | 'boolean'

export interface LogicError {
  message: string
  index: number
}

export type LogicBinaryOp =
  | 'OR'
  | 'XOR'
  | 'AND'
  | 'NAND'
  | 'XNOR'
  | '>'
  | '>='
  | '<'
  | '<='
  | '=='
  | '!='
  | '+'
  | '-'
  | '*'
  | '/'

export type LogicAst =
  | { type: 'number'; value: number; raw?: string; index: number }
  | { type: 'string'; value: string; index: number }
  | { type: 'boolean'; value: boolean; index: number }
  | { type: 'ref'; path: string; index: number }
  | { type: 'not'; operand: LogicAst; index: number }
  | { type: 'neg'; operand: LogicAst; index: number }
  | { type: 'binary'; op: LogicBinaryOp; left: LogicAst; right: LogicAst; index: number }

type TokenType = 'number' | 'string' | 'ref' | 'word' | 'symbol' | 'eof'

interface Token {
  type: TokenType
  value: string
  index: number
  number?: number
}

const REF_AT = /\{\{\s*([^{}\s]+?)\s*\}\}/uy
const NUMBER_AT = /\d+(?:\.\d+)?/y
const WORD_AT = /[A-Za-z_][A-Za-z0-9_]*/y
const MULTI_OPS = ['>=', '<=', '==', '!=', '&&', '||'] as const
const SINGLE_OPS = ['>', '<', '!', '(', ')', '+', '-', '*', '/'] as const
const WORD_OPS: Record<string, string> = {
  and: 'AND',
  or: 'OR',
  not: 'NOT',
  xor: 'XOR',
  nand: 'NAND',
  xnor: 'XNOR',
}

function fail(message: string, index: number): never {
  throw { message, index } satisfies LogicError
}

function tokenize(input: string): Token[] {
  const tokens: Token[] = []
  let index = 0

  while (index < input.length) {
    const char = input[index]
    if (/\s/u.test(char)) {
      index += 1
      continue
    }

    if (char === '{') {
      REF_AT.lastIndex = index
      const match = REF_AT.exec(input)
      if (!match) fail('引用应写成 {{节点.输出}} 或 {{节点.问题.字段}}', index)
      tokens.push({ type: 'ref', value: match[1], index })
      index = REF_AT.lastIndex
      continue
    }

    if (char === '"' || char === "'") {
      const quote = char
      let cursor = index + 1
      let text = ''
      let closed = false
      while (cursor < input.length) {
        const current = input[cursor]
        if (current === '\\' && cursor + 1 < input.length) {
          text += input[cursor + 1]
          cursor += 2
          continue
        }
        if (current === quote) {
          closed = true
          cursor += 1
          break
        }
        text += current
        cursor += 1
      }
      if (!closed) fail('字符串缺少结束引号', index)
      tokens.push({ type: 'string', value: text, index })
      index = cursor
      continue
    }

    if (/\d/u.test(char)) {
      NUMBER_AT.lastIndex = index
      const match = NUMBER_AT.exec(input)
      if (!match) fail('数字格式不正确', index)
      tokens.push({ type: 'number', value: match[0], number: Number(match[0]), index })
      index = NUMBER_AT.lastIndex
      continue
    }

    if (/[A-Za-z_]/u.test(char)) {
      WORD_AT.lastIndex = index
      const match = WORD_AT.exec(input)
      if (!match) fail('标识符格式不正确', index)
      const op = WORD_OPS[match[0].toLowerCase()]
      tokens.push({ type: op ? 'symbol' : 'word', value: op ?? match[0], index })
      index = WORD_AT.lastIndex
      continue
    }

    const multi = MULTI_OPS.find((op) => input.startsWith(op, index))
    if (multi) {
      tokens.push({ type: 'symbol', value: multi === '&&' ? 'AND' : multi === '||' ? 'OR' : multi, index })
      index += multi.length
      continue
    }

    const single = SINGLE_OPS.find((op) => input.startsWith(op, index))
    if (single) {
      tokens.push({
        type: 'symbol',
        value: single === '!' ? 'NOT' : single,
        index,
      })
      index += single.length
      continue
    }

    fail(`无法识别的字符「${char}」`, index)
  }

  tokens.push({ type: 'eof', value: '', index: input.length })
  return tokens
}

class Parser {
  private readonly tokens: Token[]
  private position = 0

  constructor(tokens: Token[]) {
    this.tokens = tokens
  }

  private peek(): Token {
    return this.tokens[this.position]
  }

  private next(): Token {
    const token = this.tokens[this.position]
    if (token.type !== 'eof') this.position += 1
    return token
  }

  private matchSymbol(value: string): Token | null {
    const token = this.peek()
    if (token.type === 'symbol' && token.value === value) return this.next()
    return null
  }

  private expectSymbol(value: string): Token {
    const token = this.matchSymbol(value)
    if (!token) {
      const found = this.peek()
      const text = found.type === 'eof' ? '表达式结尾' : `「${found.value}」`
      fail(`这里应为「${value}」，实际是${text}`, found.index)
    }
    return token
  }

  parse(): LogicAst {
    const expression = this.parseOr()
    const rest = this.peek()
    if (rest.type !== 'eof') fail(`多余的「${rest.value}」`, rest.index)
    return expression
  }

  private parseOr(): LogicAst {
    let left = this.parseXor()
    let token: Token | null
    while ((token = this.matchSymbol('OR'))) {
      left = { type: 'binary', op: 'OR', left, right: this.parseXor(), index: token.index }
    }
    return left
  }

  private parseXor(): LogicAst {
    let left = this.parseAnd()
    let token: Token | null
    while ((token = this.matchSymbol('XOR') ?? this.matchSymbol('XNOR'))) {
      const op = token.value === 'XNOR' ? 'XNOR' : 'XOR'
      left = { type: 'binary', op, left, right: this.parseAnd(), index: token.index }
    }
    return left
  }

  private parseAnd(): LogicAst {
    let left = this.parseComparison()
    let token: Token | null
    while ((token = this.matchSymbol('AND') ?? this.matchSymbol('NAND'))) {
      const op = token.value === 'NAND' ? 'NAND' : 'AND'
      left = { type: 'binary', op, left, right: this.parseComparison(), index: token.index }
    }
    return left
  }

  private parseComparison(): LogicAst {
    let left = this.parseAdditive()
    let token: Token | null
    while (
      (token =
        this.matchSymbol('>') ??
        this.matchSymbol('>=') ??
        this.matchSymbol('<') ??
        this.matchSymbol('<=') ??
        this.matchSymbol('==') ??
        this.matchSymbol('!='))
    ) {
      left = {
        type: 'binary',
        op: token.value as LogicBinaryOp,
        left,
        right: this.parseAdditive(),
        index: token.index,
      }
    }
    return left
  }

  private parseAdditive(): LogicAst {
    let left = this.parseMultiplicative()
    let token: Token | null
    while ((token = this.matchSymbol('+') ?? this.matchSymbol('-'))) {
      left = {
        type: 'binary',
        op: token.value === '+' ? '+' : '-',
        left,
        right: this.parseMultiplicative(),
        index: token.index,
      }
    }
    return left
  }

  private parseMultiplicative(): LogicAst {
    let left = this.parseUnary()
    let token: Token | null
    while ((token = this.matchSymbol('*') ?? this.matchSymbol('/'))) {
      left = {
        type: 'binary',
        op: token.value === '*' ? '*' : '/',
        left,
        right: this.parseUnary(),
        index: token.index,
      }
    }
    return left
  }

  private parseUnary(): LogicAst {
    const not = this.matchSymbol('NOT')
    if (not) return { type: 'not', operand: this.parseUnary(), index: not.index }
    const minus = this.matchSymbol('-')
    if (minus) return { type: 'neg', operand: this.parseUnary(), index: minus.index }
    return this.parsePrimary()
  }

  private parsePrimary(): LogicAst {
    const token = this.next()
    if (token.type === 'number') {
      return { type: 'number', value: token.number ?? 0, raw: token.value, index: token.index }
    }
    if (token.type === 'string') {
      return { type: 'string', value: token.value, index: token.index }
    }
    if (token.type === 'ref') {
      return { type: 'ref', path: token.value, index: token.index }
    }
    if (token.type === 'word') {
      const word = token.value.toLowerCase()
      if (word === 'true' || word === 'false') {
        return { type: 'boolean', value: word === 'true', index: token.index }
      }
      const op = WORD_OPS[word]
      if (op === 'AND' || op === 'OR' || op === 'NOT' || op === 'XOR' || op === 'NAND' || op === 'XNOR') {
        fail(`运算符「${token.value.toUpperCase()}」缺少操作数`, token.index)
      }
      fail(`未知标识符「${token.value}」，引用上游结果请写成 {{节点.字段}}`, token.index)
    }
    if (token.type === 'symbol' && token.value === '(') {
      const inner = this.parseOr()
      this.expectSymbol(')')
      return inner
    }
    const text = token.type === 'eof' ? '表达式结尾' : `「${token.value}」`
    fail(`这里应为数字、字符串、引用或括号，实际是${text}`, token.index)
  }
}

export const MAX_EXPRESSION_LENGTH = 2000

export function parseExpression(text: string): { ast: LogicAst } | { error: LogicError } {
  if (!text.trim()) return { error: { message: '表达式不能为空', index: 0 } }
  if (text.length > MAX_EXPRESSION_LENGTH) {
    return {
      error: { message: `表达式过长（上限 ${MAX_EXPRESSION_LENGTH} 字符）`, index: MAX_EXPRESSION_LENGTH },
    }
  }
  try {
    const tokens = tokenize(text)
    return { ast: new Parser(tokens).parse() }
  } catch (error) {
    if (typeof error === 'object' && error !== null && 'message' in error && 'index' in error) {
      const logicError = error as LogicError
      return { error: { message: logicError.message, index: logicError.index } }
    }
    return { error: { message: String(error), index: 0 } }
  }
}

function astRefs(ast: LogicAst, into: string[]): void {
  if (ast.type === 'ref') {
    into.push(ast.path)
    return
  }
  if (ast.type === 'not' || ast.type === 'neg') {
    astRefs(ast.operand, into)
    return
  }
  if (ast.type === 'binary') {
    astRefs(ast.left, into)
    astRefs(ast.right, into)
  }
}

/** 提取表达式真正求值的引用；字符串字面量里的 {{...}} 不算引用。 */
export function collectLogicRefs(expression: string): string[] {
  const parsed = parseExpression(expression)
  if ('ast' in parsed) {
    const refs: string[] = []
    astRefs(parsed.ast, refs)
    return Array.from(new Set(refs))
  }
  return Array.from(new Set(extractRefs(expression)))
}

export type RefTypeResolver = (path: string) => { type: LogicValueType } | { error: string }

/** 引用路径的一段不能包含空白、点或花括号，否则 DSL 无法写出。 */
export const SAFE_PATH_SEGMENT = /^[^\s.{}]+$/u

export interface QuestionRefField {
  key: string
  type: LogicValueType
}

/**
 * 一个问题能产出哪些可引用字段。
 * 引用选择器与 refTypeInScenario 共用这一份规则，避免“目录里有、校验不认”的分裂。
 */
export function questionRefFields(question: Question): QuestionRefField[] {
  if (question.type === 'box') return []
  if (question.type === 'noul') return [{ key: 'noul', type: 'number' }]

  if (question.type === 'choice') {
    const fields: QuestionRefField[] = [
      { key: 'choice', type: 'string' },
      { key: 'confidence', type: 'number' },
    ]
    for (const option of question.options) {
      if (SAFE_PATH_SEGMENT.test(option.name)) {
        fields.push({ key: `probabilities.${option.name}`, type: 'number' })
      }
    }
    return fields
  }

  const fields: QuestionRefField[] = [
    { key: 'score', type: 'number' },
    { key: 'confidence', type: 'number' },
  ]
  for (const level of question.levels) {
    if (SAFE_PATH_SEGMENT.test(level.label)) {
      fields.push({ key: `probabilities.${level.label}`, type: 'number' })
    }
  }
  return fields
}

/** 根据场景结构推断引用路径的静态类型（不依赖运行结果）。 */
export function refTypeInScenario(scenario: Scenario, path: string): { type: LogicValueType } | { error: string } {
  const parts = path.split('.').filter(Boolean)
  if (parts.length < 2) {
    return { error: '引用格式应为 {{节点.输出}} 或 {{节点.问题.字段}}' }
  }
  const [nodeId, key, ...rest] = parts
  const owner = scenario.nodes.find((node) => node.id === nodeId)
  if (!owner) return { error: `找不到节点 ${nodeId}` }

  if (isLogicNode(owner)) {
    if (rest.length > 0) return { error: `逻辑步「${owner.title}」的输出 ${key} 没有下级字段` }
    if (!owner.outputs.some((output) => output.id === key)) {
      return { error: `逻辑步「${owner.title}」没有输出 ${key}` }
    }
    return { type: 'boolean' }
  }

  const question = owner.questions[key]
  if (!question) return { error: `节点「${owner.title}」没有问题 ${key}` }
  if (question.type === 'box') {
    return { error: 'box 类型的答案暂不支持参与逻辑计算' }
  }

  const field = rest.join('.')
  if (!field) {
    const hint =
      question.type === 'choice'
        ? '.choice、.confidence 或 .probabilities.<选项>'
        : question.type === 'score'
          ? '.score、.confidence 或 .probabilities.<等级>'
          : '.noul'
    return { error: `{{${path}}} 的 ${question.type} 结果是对象，请使用 ${hint}` }
  }
  if (question.type === 'score' && rest[0] === 'legend') {
    return { error: 'score 的 legend 字段暂不支持参与逻辑计算' }
  }
  const match = questionRefFields(question).find((item) => item.key === field)
  if (match) return { type: match.type }
  return { error: `${question.type} 结果没有字段 ${field}` }
}

function typeName(type: LogicValueType): string {
  return type === 'number' ? '数字' : type === 'string' ? '字符串' : '布尔值'
}

export function inferExpressionType(
  ast: LogicAst,
  resolveRef: RefTypeResolver,
): { type: LogicValueType } | { error: LogicError } {
  const visit = (node: LogicAst): { type: LogicValueType } | { error: LogicError } => {
    if (node.type === 'number') return { type: 'number' }
    if (node.type === 'string') return { type: 'string' }
    if (node.type === 'boolean') return { type: 'boolean' }
    if (node.type === 'ref') {
      const resolved = resolveRef(node.path)
      if ('error' in resolved) return { error: { message: resolved.error, index: node.index } }
      return { type: resolved.type }
    }
    if (node.type === 'not') {
      const operand = visit(node.operand)
      if ('error' in operand) return operand
      if (operand.type !== 'boolean') {
        return { error: { message: `NOT 需要布尔值，实际是${typeName(operand.type)}`, index: node.index } }
      }
      return { type: 'boolean' }
    }
    if (node.type === 'neg') {
      const operand = visit(node.operand)
      if ('error' in operand) return operand
      if (operand.type !== 'number') {
        return { error: { message: `负号需要数字，实际是${typeName(operand.type)}`, index: node.index } }
      }
      return { type: 'number' }
    }

    const left = visit(node.left)
    if ('error' in left) return left
    const right = visit(node.right)
    if ('error' in right) return right

    if (
      node.op === 'AND' ||
      node.op === 'OR' ||
      node.op === 'XOR' ||
      node.op === 'XNOR' ||
      node.op === 'NAND'
    ) {
      if (left.type !== 'boolean' || right.type !== 'boolean') {
        return {
          error: {
            message: `${node.op} 需要两个布尔值，实际是${typeName(left.type)}与${typeName(right.type)}`,
            index: node.index,
          },
        }
      }
      return { type: 'boolean' }
    }

    if (node.op === '+' || node.op === '-' || node.op === '*' || node.op === '/') {
      if (left.type !== 'number' || right.type !== 'number') {
        return {
          error: {
            message: `算术运算需要两个数字，实际是${typeName(left.type)}与${typeName(right.type)}`,
            index: node.index,
          },
        }
      }
      return { type: 'number' }
    }

    if (node.op === '==' || node.op === '!=') {
      if (left.type !== right.type) {
        return {
          error: {
            message: `比较两侧类型不一致（${typeName(left.type)}与${typeName(right.type)}）`,
            index: node.index,
          },
        }
      }
      return { type: 'boolean' }
    }

    if (left.type !== 'number' || right.type !== 'number') {
      return {
        error: {
          message: `大小比较需要两个数字，实际是${typeName(left.type)}与${typeName(right.type)}`,
          index: node.index,
        },
      }
    }
    return { type: 'boolean' }
  }
  return visit(ast)
}

export type RefValueResolver = (path: string) => { value?: JsonValue; error?: string }

function valueTypeOf(value: JsonValue): LogicValueType | null {
  if (typeof value === 'number') return 'number'
  if (typeof value === 'string') return 'string'
  if (typeof value === 'boolean') return 'boolean'
  return null
}

export function evaluateExpression(
  ast: LogicAst,
  resolveRef: RefValueResolver,
): { value: JsonValue } | { error: LogicError } {
  const visit = (node: LogicAst): { value: JsonValue } | { error: LogicError } => {
    if (node.type === 'number') return { value: node.value }
    if (node.type === 'string') return { value: node.value }
    if (node.type === 'boolean') return { value: node.value }
    if (node.type === 'ref') {
      const resolved = resolveRef(node.path)
      if (resolved.error !== undefined) {
        return { error: { message: resolved.error, index: node.index } }
      }
      const value = resolved.value
      if (value === undefined) {
        return { error: { message: `引用 {{${node.path}}} 没有取到值`, index: node.index } }
      }
      if (valueTypeOf(value) === null) {
        return { error: { message: `引用 {{${node.path}}} 不是数字、字符串或布尔值`, index: node.index } }
      }
      return { value }
    }
    if (node.type === 'not') {
      const operand = visit(node.operand)
      if ('error' in operand) return operand
      if (typeof operand.value !== 'boolean') {
        return { error: { message: 'NOT 需要布尔值', index: node.index } }
      }
      return { value: !operand.value }
    }
    if (node.type === 'neg') {
      const operand = visit(node.operand)
      if ('error' in operand) return operand
      if (typeof operand.value !== 'number') {
        return { error: { message: '负号需要数字', index: node.index } }
      }
      return { value: -operand.value }
    }

    const left = visit(node.left)
    if ('error' in left) return left
    const right = visit(node.right)
    if ('error' in right) return right
    const a = left.value
    const b = right.value

    if (
      node.op === 'AND' ||
      node.op === 'OR' ||
      node.op === 'XOR' ||
      node.op === 'XNOR' ||
      node.op === 'NAND'
    ) {
      if (typeof a !== 'boolean' || typeof b !== 'boolean') {
        return { error: { message: `${node.op} 需要两个布尔值`, index: node.index } }
      }
      if (node.op === 'AND') return { value: a && b }
      if (node.op === 'OR') return { value: a || b }
      if (node.op === 'XOR') return { value: a !== b }
      if (node.op === 'XNOR') return { value: a === b }
      return { value: !(a && b) }
    }

    if (node.op === '+' || node.op === '-' || node.op === '*' || node.op === '/') {
      if (typeof a !== 'number' || typeof b !== 'number') {
        return { error: { message: '算术运算需要两个数字', index: node.index } }
      }
      if (node.op === '/' && b === 0) {
        return { error: { message: '除数不能为零', index: node.index } }
      }
      if (node.op === '+') return { value: a + b }
      if (node.op === '-') return { value: a - b }
      if (node.op === '*') return { value: a * b }
      return { value: a / b }
    }

    if (node.op === '==' || node.op === '!=') {
      const typeA = valueTypeOf(a)
      const typeB = valueTypeOf(b)
      if (typeA === null || typeB === null || typeA !== typeB) {
        return { error: { message: '比较两侧类型不一致', index: node.index } }
      }
      return { value: node.op === '==' ? a === b : a !== b }
    }

    if (typeof a !== 'number' || typeof b !== 'number') {
      return { error: { message: '大小比较需要两个数字', index: node.index } }
    }
    if (node.op === '>') return { value: a > b }
    if (node.op === '>=') return { value: a >= b }
    if (node.op === '<') return { value: a < b }
    return { value: a <= b }
  }
  return visit(ast)
}

export interface LogicEvaluation {
  outputs: Record<string, boolean>
  inputs: Record<string, JsonValue>
  errors: string[]
}

/** 逐个求值逻辑步的输出；任一输出失败会记录错误，由运行器决定节点状态。 */
export function evaluateLogicOutputs(
  outputs: LogicOutput[],
  resolveRef: RefValueResolver,
): LogicEvaluation {
  const result: LogicEvaluation = { outputs: {}, inputs: {}, errors: [] }
  const seen = new Set<string>()

  const recordingResolver: RefValueResolver = (path) => {
    const resolved = resolveRef(path)
    if (resolved.error === undefined && resolved.value !== undefined && !seen.has(path)) {
      seen.add(path)
      result.inputs[path] = resolved.value
    }
    return resolved
  }

  for (const output of outputs) {
    const parsed = parseExpression(output.expression)
    if ('error' in parsed) {
      result.errors.push(`输出「${output.id}」：${parsed.error.message}`)
      continue
    }
    const evaluated = evaluateExpression(parsed.ast, recordingResolver)
    if ('error' in evaluated) {
      result.errors.push(`输出「${output.id}」：${evaluated.error.message}`)
      continue
    }
    if (typeof evaluated.value !== 'boolean') {
      result.errors.push(`输出「${output.id}」必须是布尔表达式`)
      continue
    }
    result.outputs[output.id] = evaluated.value
  }

  return result
}

/** 校验单个输出表达式：解析、类型推断，并要求最终类型为布尔。 */
export function checkLogicExpression(
  expression: string,
  resolveRef: RefTypeResolver,
): { refs: string[] } | { error: LogicError; refs: string[] } {
  const refs = collectLogicRefs(expression)
  const parsed = parseExpression(expression)
  if ('error' in parsed) return { error: parsed.error, refs }
  const inferred = inferExpressionType(parsed.ast, resolveRef)
  if ('error' in inferred) return { error: inferred.error, refs }
  if (inferred.type !== 'boolean') {
    return {
      error: { message: '输出必须是布尔表达式（比较或逻辑运算的结果）', index: 0 },
      refs,
    }
  }
  return { refs }
}

/** 从表达式文本中提取第一个错误的位置，便于界面定位（保留给编辑器显示）。 */
export function expressionErrorAt(text: string, error: LogicError): string {
  const before = text.slice(0, error.index)
  const line = before.split('\n').length
  const column = before.length - before.lastIndexOf('\n')
  return `第 ${line} 行第 ${column} 列：${error.message}`
}
