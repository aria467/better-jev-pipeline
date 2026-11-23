import { normalizeLogicOutputs } from './logic-builder'
import type { Scenario, StepNode } from './types'

export interface ScenarioOption {
  id: string
  name: string
  kind: 'preset' | 'custom'
}

export function createCustomScenario(
  template: Scenario,
  name: string,
  id: string,
): Scenario {
  const clone = structuredClone(template)
  return {
    ...clone,
    id,
    name,
    description: `基于「${template.name}」创建，可自由修改。`,
  }
}

export function newScenarioId(): string {
  return `custom-${crypto.randomUUID()}`
}

export function scenarioNames(presets: Scenario[], customs: Scenario[]): string[] {
  return [...presets, ...customs].map((scenario) => scenario.name)
}

export function isScenarioNameAvailable(name: string, existing: string[]): boolean {
  const trimmed = name.trim()
  if (!trimmed) return false
  return !existing.some((item) => item.trim() === trimmed)
}

export function suggestScenarioName(base: string, existing: string[]): string {
  const trimmedBase = base.trim() || '新场景'
  if (isScenarioNameAvailable(trimmedBase, existing)) return trimmedBase
  let suffix = 2
  while (!isScenarioNameAvailable(`${trimmedBase} ${suffix}`, existing)) suffix += 1
  return `${trimmedBase} ${suffix}`
}

/**
 * 把当前场景同步进“我的场景”列表：
 * - 内置模板不写入列表（切走即恢复模板）；
 * - 已存在的自定义场景原位更新；
 * - 尚未登记的自定义场景（如旧版本持久化或导入）追加到末尾。
 */
export function syncCustomScenarios(
  customScenarios: Scenario[],
  current: Scenario,
  presetIds: Set<string>,
): Scenario[] {
  if (presetIds.has(current.id)) return customScenarios
  const index = customScenarios.findIndex((scenario) => scenario.id === current.id)
  if (index === -1) return [...customScenarios, current]
  const next = customScenarios.slice()
  next[index] = current
  return next
}

function isNodeLike(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false
  const node = value as Partial<StepNode>
  if (typeof node.id !== 'string' || !node.position) return false
  if (node.kind === 'logic') {
    return (
      Array.isArray(node.outputs) &&
      node.outputs.every(
        (output) =>
          Boolean(output) &&
          typeof output === 'object' &&
          typeof output.id === 'string' &&
          typeof output.expression === 'string',
      )
    )
  }
  return true
}

function isScenarioLike(value: unknown): value is Scenario {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<Scenario>
  return (
    typeof candidate.id === 'string' &&
    Array.isArray(candidate.nodes) &&
    candidate.nodes.every(isNodeLike) &&
    Array.isArray(candidate.edges)
  )
}

/**
 * 从持久化数据恢复当前场景与“我的场景”列表：
 * - 结构不合法的记录被丢弃，回退到 fallback；
 * - 内置模板不保留编辑，恢复为模板原始内容（与切换场景行为一致）。
 */
export function restoreScenarios(
  storedScenario: unknown,
  storedCustoms: unknown,
  options: { presets: Scenario[]; fallback: Scenario },
): { scenario: Scenario; customScenarios: Scenario[] } {
  const scenarioInput = isScenarioLike(storedScenario) ? storedScenario : options.fallback
  const preset = options.presets.find((item) => item.id === scenarioInput.id)
  const scenario = preset ? structuredClone(preset) : normalizeLogicOutputs(scenarioInput)
  const presetIds = new Set(options.presets.map((item) => item.id))
  const customs = Array.isArray(storedCustoms)
    ? storedCustoms.filter(isScenarioLike).map(normalizeLogicOutputs)
    : []
  return {
    scenario,
    customScenarios: syncCustomScenarios(customs, scenario, presetIds),
  }
}

export function findScenario(
  presets: Scenario[],
  customs: Scenario[],
  id: string,
): Scenario | undefined {
  return presets.find((scenario) => scenario.id === id) ?? customs.find((scenario) => scenario.id === id)
}

export function scenarioOptions(
  presets: Scenario[],
  customs: Scenario[],
): ScenarioOption[] {
  return [
    ...presets.map((scenario) => ({ id: scenario.id, name: scenario.name, kind: 'preset' as const })),
    ...customs.map((scenario) => ({ id: scenario.id, name: scenario.name, kind: 'custom' as const })),
  ]
}
