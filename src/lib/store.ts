import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import { ancestorsOf, descendantsOf, findCycle, topoOrder } from './graph'
import { DEFAULT_SCENARIO, PRESETS } from './presets'
import { executeOrder } from './runner'
import {
  createCustomScenario,
  findScenario,
  isScenarioNameAvailable,
  newScenarioId,
  restoreScenarios,
  scenarioNames,
  suggestScenarioName,
  syncCustomScenarios,
} from './scenarios'
import { parseScenario } from './schema'
import { isLogicNode } from './types'
import type {
  EdgeCondition,
  LogicOutput,
  Question,
  RunRecord,
  Scenario,
  StateValue,
  StepNode,
} from './types'
import { validateScenario } from './validate'
import type { Health, ModelInfo } from './types'

export interface Toast {
  id: string
  kind: 'info' | 'error' | 'success'
  message: string
}

interface StudioState {
  scenario: Scenario
  customScenarios: Scenario[]
  selectedId: string | null
  results: Record<string, RunRecord>
  running: boolean
  runningId: string | null
  logOpen: boolean
  health: Health | null
  models: ModelInfo[]
  toasts: Toast[]

  setHealth: (health: Health | null) => void
  setModels: (models: ModelInfo[]) => void
  notify: (message: string, kind?: Toast['kind']) => void
  dismissToast: (id: string) => void
  select: (id: string | null) => void
  switchScenario: (id: string) => void
  createScenario: (name: string) => boolean
  renameScenario: (id: string, name: string) => boolean
  deleteScenario: (id: string) => boolean
  importScenario: (text: string) => boolean
  updateNode: (id: string, patch: { title?: string; includeUpstream?: boolean }) => void
  updateState: (id: string, state: StateValue) => void
  updateQuestions: (id: string, questions: Record<string, Question>) => void
  updateOutputs: (id: string, outputs: LogicOutput[]) => void
  setPosition: (id: string, position: { x: number; y: number }) => void
  addNode: (kind?: 'api' | 'logic') => string
  duplicateNode: (id: string) => string | null
  deleteNode: (id: string) => void
  addEdge: (source: string, target: string) => boolean
  deleteEdge: (id: string) => void
  setEdgeWhen: (edgeId: string, when: EdgeCondition | undefined) => void
  setModel: (model: string) => void
  runAll: () => Promise<void>
  runNode: (id: string) => Promise<void>
  stop: () => void
  clearResults: () => void
  setLogOpen: (open: boolean) => void
}

let abortController: AbortController | null = null
let runSequence = 0

const PRESET_IDS = new Set(PRESETS.map((scenario) => scenario.id))

function staleResults(
  results: Record<string, RunRecord>,
  scenario: Scenario,
  id: string,
): Record<string, RunRecord> {
  const affected = new Set([id, ...descendantsOf(id, scenario.edges)])
  let changed = false
  const next: Record<string, RunRecord> = { ...results }
  for (const key of affected) {
    const record = next[key]
    if (record && record.status !== 'stale' && record.status !== 'running') {
      next[key] = { ...record, status: 'stale' }
      changed = true
    }
  }
  return changed ? next : results
}

function updateNodeIn(
  state: { scenario: Scenario; results: Record<string, RunRecord> },
  id: string,
  update: (node: StepNode) => StepNode,
): { scenario: Scenario; results: Record<string, RunRecord> } {
  const scenario: Scenario = {
    ...state.scenario,
    nodes: state.scenario.nodes.map((node) => (node.id === id ? update(node) : node)),
  }
  return { scenario, results: staleResults(state.results, scenario, id) }
}

function nextNodeId(scenario: Scenario): string {
  let index = scenario.nodes.length + 1
  const ids = new Set(scenario.nodes.map((node) => node.id))
  while (ids.has(`n${index}`)) index += 1
  return `n${index}`
}

export const useStudio = create<StudioState>()(
  persist(
    (set, get) => ({
      scenario: structuredClone(DEFAULT_SCENARIO),
      customScenarios: [],
      selectedId: 'n1',
      results: {},
      running: false,
      runningId: null,
      logOpen: false,
      health: null,
      models: [],
      toasts: [],

      setHealth: (health) => set({ health }),
      setModels: (models) => set({ models }),
      notify: (message, kind = 'info') => {
        const id = crypto.randomUUID()
        set((state) => ({ toasts: [...state.toasts, { id, kind, message }] }))
        setTimeout(() => get().dismissToast(id), 6000)
      },
      dismissToast: (id) =>
        set((state) => ({ toasts: state.toasts.filter((toast) => toast.id !== id) })),
      select: (id) => set({ selectedId: id }),

      switchScenario: (id) => {
        const state = get()
        if (state.scenario.id === id) return
        if (state.running) {
          get().notify('请先停止运行再切换场景', 'info')
          return
        }
        const synced = syncCustomScenarios(
          state.customScenarios,
          state.scenario,
          PRESET_IDS,
        )
        const target = findScenario(PRESETS, synced, id)
        if (!target) {
          get().notify('场景不存在', 'error')
          return
        }
        set({
          customScenarios: synced,
          scenario: structuredClone(target),
          results: {},
          selectedId: target.nodes[0]?.id ?? null,
          running: false,
          runningId: null,
          logOpen: false,
        })
        get().notify(`已切换到「${target.name}」`, 'info')
      },

      createScenario: (name) => {
        const state = get()
        if (state.running) {
          get().notify('请先停止运行再创建场景', 'info')
          return false
        }
        const trimmed = name.trim()
        const synced = syncCustomScenarios(
          state.customScenarios,
          state.scenario,
          PRESET_IDS,
        )
        const existing = scenarioNames(PRESETS, synced)
        if (!trimmed) {
          get().notify('场景名称不能为空', 'error')
          return false
        }
        if (!isScenarioNameAvailable(trimmed, existing)) {
          get().notify(`场景名称「${trimmed}」已存在`, 'error')
          return false
        }
        const created = createCustomScenario(
          DEFAULT_SCENARIO,
          trimmed,
          newScenarioId(),
        )
        set({
          customScenarios: [...synced, created],
          scenario: created,
          results: {},
          selectedId: created.nodes[0]?.id ?? null,
          running: false,
          runningId: null,
          logOpen: false,
        })
        get().notify(`已创建场景「${trimmed}」`, 'success')
        return true
      },

      renameScenario: (id, name) => {
        const state = get()
        if (state.running) {
          get().notify('请先停止运行再重命名场景', 'info')
          return false
        }
        if (PRESET_IDS.has(id)) {
          get().notify('内置模板不能重命名，请先创建副本', 'info')
          return false
        }
        const synced = syncCustomScenarios(
          state.customScenarios,
          state.scenario,
          PRESET_IDS,
        )
        const target = synced.find((scenario) => scenario.id === id)
        if (!target) {
          get().notify('场景不存在', 'error')
          return false
        }
        const trimmed = name.trim()
        if (!trimmed) {
          get().notify('场景名称不能为空', 'error')
          return false
        }
        const others = [...PRESETS, ...synced.filter((scenario) => scenario.id !== id)].map(
          (scenario) => scenario.name,
        )
        if (!isScenarioNameAvailable(trimmed, others)) {
          get().notify(`场景名称「${trimmed}」已存在`, 'error')
          return false
        }
        if (trimmed === target.name) return true
        set({
          customScenarios: synced.map((scenario) =>
            scenario.id === id ? { ...scenario, name: trimmed } : scenario,
          ),
          scenario:
            state.scenario.id === id
              ? { ...state.scenario, name: trimmed }
              : state.scenario,
        })
        get().notify(`已重命名为「${trimmed}」`, 'success')
        return true
      },

      deleteScenario: (id) => {
        const state = get()
        if (state.running) {
          get().notify('请先停止运行再删除场景', 'info')
          return false
        }
        if (PRESET_IDS.has(id)) {
          get().notify('内置模板不能删除', 'info')
          return false
        }
        const synced = syncCustomScenarios(
          state.customScenarios,
          state.scenario,
          PRESET_IDS,
        )
        const target = synced.find((scenario) => scenario.id === id)
        if (!target) {
          get().notify('场景不存在', 'error')
          return false
        }
        const customScenarios = synced.filter((scenario) => scenario.id !== id)
        if (state.scenario.id !== id) {
          set({ customScenarios })
          get().notify(`已删除场景「${target.name}」`, 'success')
          return true
        }
        const fallback = structuredClone(DEFAULT_SCENARIO)
        set({
          customScenarios,
          scenario: fallback,
          results: {},
          selectedId: fallback.nodes[0]?.id ?? null,
          running: false,
          runningId: null,
          logOpen: false,
        })
        get().notify(`已删除场景「${target.name}」`, 'success')
        return true
      },

      importScenario: (text) => {
        let parsedJson: unknown
        try {
          parsedJson = JSON.parse(text)
        } catch (error) {
          get().notify(`JSON 解析失败：${error instanceof Error ? error.message : error}`, 'error')
          return false
        }
        const parsed = parseScenario(parsedJson)
        if (!parsed.scenario) {
          get().notify(`场景格式不正确：${parsed.error ?? '未知错误'}`, 'error')
          return false
        }
        const state = get()
        if (state.running) {
          get().notify('请先停止运行再导入场景', 'info')
          return false
        }
        const synced = syncCustomScenarios(
          state.customScenarios,
          state.scenario,
          PRESET_IDS,
        )
        const name = suggestScenarioName(
          parsed.scenario.name,
          scenarioNames(PRESETS, synced),
        )
        const imported: Scenario = {
          ...structuredClone(parsed.scenario),
          id: newScenarioId(),
          name,
        }
        set({
          customScenarios: [...synced, imported],
          scenario: imported,
          results: {},
          selectedId: imported.nodes[0]?.id ?? null,
          running: false,
          runningId: null,
          logOpen: false,
        })
        get().notify(`场景已导入为「${name}」`, 'success')
        return true
      },

      updateNode: (id, patch) =>
        set((state) =>
          updateNodeIn(state, id, (node) => {
            if (isLogicNode(node)) {
              return patch.title === undefined ? node : { ...node, title: patch.title }
            }
            return {
              ...node,
              ...(patch.title !== undefined ? { title: patch.title } : {}),
              ...(patch.includeUpstream !== undefined
                ? { includeUpstream: patch.includeUpstream }
                : {}),
            }
          }),
        ),

      updateState: (id, stateValue) =>
        set((state) =>
          updateNodeIn(state, id, (node) =>
            isLogicNode(node) ? node : { ...node, state: stateValue },
          ),
        ),

      updateQuestions: (id, questions) =>
        set((state) =>
          updateNodeIn(state, id, (node) =>
            isLogicNode(node) ? node : { ...node, questions },
          ),
        ),

      updateOutputs: (id, outputs) =>
        set((state) =>
          updateNodeIn(state, id, (node) =>
            isLogicNode(node) ? { ...node, outputs } : node,
          ),
        ),
      setPosition: (id, position) =>
        set((state) => ({
          scenario: {
            ...state.scenario,
            nodes: state.scenario.nodes.map((node) =>
              node.id === id ? { ...node, position } : node,
            ),
          },
        })),

      addNode: (kind = 'api') => {
        const scenario = get().scenario
        const id = nextNodeId(scenario)
        // 画布按从左往右排布，新节点放在最右侧节点之后。
        const rightmost = scenario.nodes.reduce<StepNode | null>(
          (anchor, node) =>
            !anchor || node.position.x > anchor.position.x ? node : anchor,
          null,
        )
        const position = rightmost
          ? { x: rightmost.position.x + 380, y: rightmost.position.y }
          : { x: 0, y: 0 }
        const node: StepNode =
          kind === 'logic'
            ? {
                id,
                kind: 'logic',
                title: '逻辑判断',
                outputs: [{ id: 'out1', expression: '' }],
                position,
              }
            : {
                id,
                title: `步骤 ${scenario.nodes.length + 1}`,
                state: '在这里输入需要判断的内容。',
                questions: {
                  q1: { type: 'noul', instructions: '这个判断是否成立？' },
                },
                position,
                includeUpstream: true,
              }
        set((state) => ({
          scenario: { ...state.scenario, nodes: [...state.scenario.nodes, node] },
          selectedId: id,
        }))
        return id
      },

      duplicateNode: (id) => {
        const scenario = get().scenario
        const source = scenario.nodes.find((node) => node.id === id)
        if (!source) return null
        const newId = nextNodeId(scenario)
        const copy = structuredClone(source)
        copy.id = newId
        copy.title = `${source.title} 副本`
        copy.position = { x: source.position.x + 120, y: source.position.y + 48 }
        set((state) => ({
          scenario: { ...state.scenario, nodes: [...state.scenario.nodes, copy] },
          selectedId: newId,
        }))
        return newId
      },

      deleteNode: (id) =>
        set((state) => {
          const nodes = state.scenario.nodes.filter((node) => node.id !== id)
          const edges = state.scenario.edges.filter(
            (edge) => edge.source !== id && edge.target !== id,
          )
          const scenario = { ...state.scenario, nodes, edges }
          const results = { ...state.results }
          delete results[id]
          for (const child of descendantsOf(id, state.scenario.edges)) {
            if (results[child] && results[child].status !== 'running') {
              results[child] = { ...results[child], status: 'stale' }
            }
          }
          return {
            scenario,
            results,
            selectedId: state.selectedId === id ? (nodes[0]?.id ?? null) : state.selectedId,
          }
        }),

      addEdge: (source, target) => {
        const { scenario } = get()
        if (source === target) {
          get().notify('节点不能依赖自身', 'error')
          return false
        }
        if (scenario.edges.some((edge) => edge.source === source && edge.target === target)) {
          get().notify('这条依赖已经存在', 'info')
          return false
        }
        if (ancestorsOf(source, scenario.edges).has(target)) {
          get().notify('该连线会形成环，已拒绝', 'error')
          return false
        }
        const edge = { id: `e-${source}-${target}`, source, target }
        set((state) => ({
          scenario: { ...state.scenario, edges: [...state.scenario.edges, edge] },
          results: staleResults(state.results, state.scenario, target),
        }))
        return true
      },

      deleteEdge: (id) =>
        set((state) => {
          const edge = state.scenario.edges.find((item) => item.id === id)
          const scenario = {
            ...state.scenario,
            edges: state.scenario.edges.filter((item) => item.id !== id),
          }
          return {
            scenario,
            results: edge
              ? staleResults(state.results, scenario, edge.target)
              : state.results,
          }
        }),

      setEdgeWhen: (edgeId, when) =>
        set((state) => {
          const edge = state.scenario.edges.find((item) => item.id === edgeId)
          if (!edge) return {}
          const scenario: Scenario = {
            ...state.scenario,
            edges: state.scenario.edges.map((item) =>
              item.id === edgeId ? { ...item, when } : item,
            ),
          }
          if (when === undefined) {
            const restored = scenario.edges.map((item) => {
              if (item.id !== edgeId) return item
              const { when: _drop, ...rest } = item
              return rest
            })
            return {
              scenario: { ...scenario, edges: restored },
              results: staleResults(state.results, scenario, edge.target),
            }
          }
          return {
            scenario,
            results: staleResults(state.results, scenario, edge.target),
          }
        }),

      setModel: (model) =>
        set((state) => ({
          scenario: { ...state.scenario, model },
          results: Object.fromEntries(
            Object.entries(state.results).map(([id, record]) => [
              id,
              record.status === 'running' ? record : { ...record, status: 'stale' as const },
            ]),
          ),
        })),

      runAll: async () => {
        const { scenario, running } = get()
        if (running) return
        const cycle = findCycle(scenario.nodes, scenario.edges)
        if (cycle) {
          get().notify(`依赖关系成环：${cycle.join(' → ')}`, 'error')
          return
        }
        const issues = validateScenario(scenario)
        if (issues.errorCount > 0) {
          get().notify(`配置中有 ${issues.errorCount} 处错误，请先修正`, 'error')
          return
        }
        const order = topoOrder(scenario.nodes, scenario.edges)
        if (order.length === 0) {
          get().notify('画布上还没有节点', 'info')
          return
        }

        const token = ++runSequence
        const controller = new AbortController()
        abortController = controller
        set({ running: true, runningId: null, results: {} })
        const outcome = await executeOrder({
          scenario,
          order,
          seed: {},
          signal: controller.signal,
          onRecord: (record) => {
            if (token !== runSequence) return
            set((state) => ({ results: { ...state.results, [record.nodeId]: record } }))
          },
          onRunning: (nodeId) => {
            if (token !== runSequence) return
            set({ runningId: nodeId })
          },
        })
        if (token !== runSequence) return
        set({ results: outcome.results, running: false, runningId: null })
        if (outcome.aborted) get().notify('运行已停止', 'info')
      },

      runNode: async (id) => {
        const { scenario, running, results } = get()
        if (running) return
        const required = new Set([id, ...ancestorsOf(id, scenario.edges)])
        const subset = scenario.nodes.filter((node) => required.has(node.id))
        const edges = scenario.edges.filter(
          (edge) => required.has(edge.source) && required.has(edge.target),
        )
        const cycle = findCycle(subset, edges)
        if (cycle) {
          get().notify(`依赖关系成环：${cycle.join(' → ')}`, 'error')
          return
        }
        const subsetScenario = { ...scenario, nodes: subset, edges }
        const issues = validateScenario(subsetScenario)
        if (issues.errorCount > 0) {
          const first = issues.issues.find((issue) => issue.severity === 'error')
          get().notify(`配置错误：${first?.message ?? '请检查节点'}`, 'error')
          return
        }
        const order = topoOrder(subset, edges)
        const seed = Object.fromEntries(
          Object.entries(results).filter(([key]) => !required.has(key)),
        )

        const token = ++runSequence
        const controller = new AbortController()
        abortController = controller
        set({ running: true, runningId: null, results: seed })
        const outcome = await executeOrder({
          scenario,
          order,
          seed,
          signal: controller.signal,
          onRecord: (record) => {
            if (token !== runSequence) return
            set((state) => ({ results: { ...state.results, [record.nodeId]: record } }))
          },
          onRunning: (nodeId) => {
            if (token !== runSequence) return
            set({ runningId: nodeId })
          },
        })
        if (token !== runSequence) return
        set({ results: outcome.results, running: false, runningId: null })
        if (outcome.aborted) get().notify('运行已停止', 'info')
      },

      stop: () => {
        runSequence += 1
        abortController?.abort()
        abortController = null
        set({ running: false, runningId: null })
        get().notify('正在停止…', 'info')
      },

      clearResults: () => {
        runSequence += 1
        abortController?.abort()
        abortController = null
        set({ results: {}, running: false, runningId: null })
      },
      setLogOpen: (open) => set({ logOpen: open }),
    }),
    {
      name: 'jev-decision-studio',
      version: 1,
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        scenario: state.scenario,
        customScenarios: state.customScenarios,
      }),
      merge: (persisted, current) => {
        const stored = (persisted ?? {}) as Partial<
          Pick<StudioState, 'scenario' | 'customScenarios'>
        >
        // 内置模板不持久化编辑：刷新与切换场景保持一致，都回到模板原始内容。
        const { scenario, customScenarios } = restoreScenarios(
          stored.scenario,
          stored.customScenarios,
          { presets: PRESETS, fallback: current.scenario },
        )
        return {
          ...current,
          scenario,
          customScenarios,
          selectedId: scenario.nodes[0]?.id ?? null,
        }
      },
    },
  ),
)
