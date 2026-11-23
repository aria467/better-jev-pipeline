import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Background,
  BackgroundVariant,
  Controls,
  MarkerType,
  Panel,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  type Connection,
  type Edge,
  type EdgeChangeset,
  type Node,
  type NodeChangeset,
} from '@xyflow/react'
import { graphlib, layout as dagreLayout } from '@dagrejs/dagre'
import { Binary, LayoutGrid, Plus, X } from 'lucide-react'
import { wouldCreateCycle } from '../lib/graph'
import { useStudio } from '../lib/store'
import { isLogicNode } from '../lib/types'
import StepNode, { type StepNodeData } from './StepNode'
import { QuestionPopover } from './QuestionPopover'
import '@xyflow/react/dist/style.css'
import './graph.css'

const nodeTypes = { step: StepNode }
const NODE_WIDTH = 300
const NODE_HEIGHT = 280

function GraphCanvasInner() {
  const {
    scenario,
    results,
    selectedId,
    running,
    runningId,
    logOpen,
    select,
    setPosition,
    addEdge,
    deleteEdge,
    deleteNode,
    addNode,
    setEdgeWhen,
    closeQuestionEditor,
  } = useStudio()

  const { fitView, getNodes } = useReactFlow()
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null)
  const wasRunning = useRef(false)

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void fitView({ padding: '18%', duration: 260 })
    }, 320)
    return () => window.clearTimeout(timer)
  }, [fitView, logOpen])

  useEffect(() => {
    const finished = wasRunning.current && !running
    wasRunning.current = running
    if (!finished) return
    // 节点卡片在结果返回后会变高，等布局稳定后再适配一次。
    const timer = window.setTimeout(() => {
      void fitView({ padding: '16%', duration: 320 })
    }, 480)
    return () => window.clearTimeout(timer)
  }, [fitView, running])

  const nodes = useMemo<Node<StepNodeData>[]>(
    () =>
      scenario.nodes.map((node, index) => ({
        id: node.id,
        type: 'step',
        position: node.position,
        selected: node.id === selectedId,
        data: {
          node,
          index: index + 1,
          result: results[node.id],
          selected: node.id === selectedId,
        },
      })),
    [scenario.nodes, results, selectedId],
  )

  const edges = useMemo<Edge[]>(
    () =>
      scenario.edges.map((edge) => {
        const condition = edge.when
        return {
          id: edge.id,
          source: edge.source,
          target: edge.target,
          type: 'smoothstep',
          animated: results[edge.target]?.status === 'running',
          selected: edge.id === selectedEdgeId,
          ...(condition
            ? {
                label: `${condition.output} = ${condition.equals ? '真' : '假'}`,
                labelStyle: {
                  fill: '#4f46e5',
                  fontSize: 10,
                  fontWeight: 600,
                  fontFamily: 'var(--font-mono)',
                },
                labelBgStyle: { fill: 'rgba(255, 255, 255, 0.94)', stroke: '#c7d2fe' },
                labelBgPadding: [5, 3] as [number, number],
                labelBgBorderRadius: 5,
                style: { stroke: '#818cf8', strokeDasharray: '6 4' },
              }
            : {}),
          markerEnd: {
            type: MarkerType.ArrowClosed,
            width: 12,
            height: 12,
            color: condition ? '#818cf8' : '#b9cfe8',
          },
        }
      }),
    [scenario.edges, results, selectedEdgeId],
  )

  const selectedEdge = scenario.edges.find((edge) => edge.id === selectedEdgeId) ?? null
  const selectedEdgeSource = selectedEdge
    ? (scenario.nodes.find((node) => node.id === selectedEdge.source) ?? null)
    : null
  const selectedEdgeLogic =
    selectedEdgeSource && isLogicNode(selectedEdgeSource) ? selectedEdgeSource : null
  const edgeMode = selectedEdge?.when ? (selectedEdge.when.equals ? 'true' : 'false') : 'always'

  const changeEdgeMode = (mode: string) => {
    if (!selectedEdge) return
    if (mode === 'always') {
      setEdgeWhen(selectedEdge.id, undefined)
      return
    }
    const output =
      selectedEdge.when?.output ?? selectedEdgeLogic?.outputs[0]?.id ?? ''
    if (!output) return
    setEdgeWhen(selectedEdge.id, { output, equals: mode === 'true' })
  }

  const handleNodesChange = useCallback(
    (changes: NodeChangeset<Node<StepNodeData>>) => {
      for (const change of changes.getByType('position')) {
        if (change.position) setPosition(change.id, change.position)
      }
    },
    [setPosition],
  )

  const handleEdgesChange = useCallback((changes: EdgeChangeset) => {
    const selectChanges = changes.getByType('select')
    if (selectChanges.length === 0) return
    const selected = selectChanges.filter((change) => change.selected)
    setSelectedEdgeId(selected.length > 0 ? selected[selected.length - 1].id : null)
  }, [])

  const handleNodesDelete = useCallback(
    (deleted: Node[]) => {
      for (const node of deleted) deleteNode(node.id)
    },
    [deleteNode],
  )

  const handleEdgesDelete = useCallback(
    (deleted: Edge[]) => {
      for (const edge of deleted) deleteEdge(edge.id)
      setSelectedEdgeId(null)
    },
    [deleteEdge],
  )

  const handleConnect = useCallback(
    (connection: Connection) => {
      if (connection.source && connection.target) {
        addEdge(connection.source, connection.target)
      }
    },
    [addEdge],
  )

  const handleIsValidConnection = useCallback(
    (connection: Edge | Connection) => {
      if (!connection.source || !connection.target) return false
      if (connection.source === connection.target) return false
      return !wouldCreateCycle(scenario.edges, connection.source, connection.target)
    },
    [scenario.edges],
  )

  const handleAddNode = useCallback(
    (kind: 'api' | 'logic') => {
      const id = addNode(kind)
      window.setTimeout(() => {
        void fitView({ padding: '24%', duration: 320, nodes: [{ id }] })
      }, 60)
    },
    [addNode, fitView],
  )

  const handleAutoLayout = useCallback(() => {
    if (scenario.nodes.length === 0) return

    const graph = new graphlib.Graph()
    graph.setGraph({ rankdir: 'LR', nodesep: 64, ranksep: 96 })
    graph.setDefaultEdgeLabel(() => ({}))

    const measured = new Map(getNodes().map((node) => [node.id, node.measured]))
    const sizeOf = (id: string) => {
      const size = measured.get(id)
      return {
        width: size?.width ?? NODE_WIDTH,
        height: size?.height ?? NODE_HEIGHT,
      }
    }

    for (const node of scenario.nodes) {
      graph.setNode(node.id, sizeOf(node.id))
    }
    for (const edge of scenario.edges) {
      graph.setEdge(edge.source, edge.target)
    }

    dagreLayout(graph)

    for (const node of scenario.nodes) {
      const point = graph.node(node.id) as { x: number; y: number } | undefined
      if (!point) continue
      const { width, height } = sizeOf(node.id)
      setPosition(node.id, { x: point.x - width / 2, y: point.y - height / 2 })
    }

    window.setTimeout(() => {
      void fitView({ padding: '18%', duration: 320 })
    }, 60)
  }, [fitView, getNodes, scenario, setPosition])

  return (
    <>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodesChange={handleNodesChange}
        onEdgesChange={handleEdgesChange}
        onNodeClick={(event, node) => {
          setSelectedEdgeId(null)
          select(node.id)
          // 问题块自己负责打开/切换弹层，这里不要把它关掉。
          if ((event.target as HTMLElement | null)?.closest('.step-q')) return
          closeQuestionEditor()
        }}
        onEdgeClick={(_event, edge) => setSelectedEdgeId(edge.id)}
        onPaneClick={() => {
          setSelectedEdgeId(null)
          select(null)
          closeQuestionEditor()
        }}
        onNodesDelete={handleNodesDelete}
        onEdgesDelete={handleEdgesDelete}
        onConnect={handleConnect}
        isValidConnection={handleIsValidConnection}
        fitView
        fitViewOptions={{ padding: '18%' }}
        minZoom={0.2}
        maxZoom={1.8}
        deleteKeyCode={['Backspace', 'Delete']}
        className="graph-canvas"
      >
        <Background
          variant={BackgroundVariant.Dots}
          gap={22}
          size={1}
          color="#c9d9ec"
        />
        <Controls showInteractive={false} />
        <Panel
          position="top-left"
          className="gx-toolbar"
          onClick={(event) => event.stopPropagation()}
        >
          <span className="gx-toolbar-title">决策图</span>
          <span className="gx-toolbar-sep" aria-hidden="true" />
          <button
            type="button"
            className="gx-tool gx-tool--primary"
            onClick={() => handleAddNode('api')}
          >
            <Plus size={14} strokeWidth={1.5} aria-hidden="true" />
            添加步骤
          </button>
          <button type="button" className="gx-tool" onClick={() => handleAddNode('logic')}>
            <Binary size={14} strokeWidth={1.5} aria-hidden="true" />
            添加逻辑步
          </button>
          <button type="button" className="gx-tool" onClick={handleAutoLayout}>
            <LayoutGrid size={14} strokeWidth={1.5} aria-hidden="true" />
            自动布局
          </button>
        </Panel>
        <Panel
          position="top-right"
          className="gx-stats"
          onClick={(event) => event.stopPropagation()}
        >
          <span className="gx-stat">
            <span className="gx-stat-num mono">{scenario.nodes.length}</span>
            节点
          </span>
          <span className="gx-stat-sep" aria-hidden="true" />
          <span className="gx-stat">
            <span className="gx-stat-num mono">{scenario.edges.length}</span>
            依赖
          </span>
          {(running || runningId) && (
            <>
              <span className="gx-stat-sep" aria-hidden="true" />
              <span className="gx-live">
                <span className="gx-live-dot" aria-hidden="true" />
                运行中{runningId ? ` · ${runningId}` : ''}
              </span>
            </>
          )}
        </Panel>

        {selectedEdge ? (
          <Panel
            position="bottom-center"
            className="gx-edge-panel"
            onClick={(event) => event.stopPropagation()}
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="gx-edge-head">
              <span className="gx-edge-title">连线</span>
              <span className="gx-edge-path mono">
                {selectedEdge.source} → {selectedEdge.target}
              </span>
              <button
                type="button"
                className="gx-edge-close"
                aria-label="关闭连线设置"
                onClick={() => setSelectedEdgeId(null)}
              >
                <X size={13} strokeWidth={1.5} aria-hidden="true" />
              </button>
            </div>

            {selectedEdgeLogic ? (
              <div className="gx-edge-fields">
                <label className="gx-edge-field">
                  <span>条件</span>
                  <select
                    className="select"
                    value={edgeMode}
                    aria-label="连线条件"
                    onChange={(event) => changeEdgeMode(event.target.value)}
                  >
                    <option value="always">总是</option>
                    <option value="true">仅当为真</option>
                    <option value="false">仅当为假</option>
                  </select>
                </label>
                {selectedEdge.when ? (
                  <label className="gx-edge-field">
                    <span>输出</span>
                    <select
                      className="select"
                      value={selectedEdge.when.output}
                      aria-label="条件引用的逻辑输出"
                      onChange={(event) =>
                        setEdgeWhen(selectedEdge.id, {
                          output: event.target.value,
                          equals: selectedEdge.when?.equals ?? true,
                        })
                      }
                    >
                      {selectedEdgeLogic.outputs.map((output) => (
                        <option key={output.id} value={output.id}>
                          {output.id}
                        </option>
                      ))}
                    </select>
                  </label>
                ) : null}
              </div>
            ) : (
              <>
                <p className="gx-edge-hint">只有逻辑步出发的连线可以设置条件。</p>
                {selectedEdge.when ? (
                  <button
                    type="button"
                    className="gx-edge-clear"
                    onClick={() => setEdgeWhen(selectedEdge.id, undefined)}
                  >
                    清除条件
                  </button>
                ) : null}
              </>
            )}
            <p className="gx-edge-hint">按 Delete 或 Backspace 可删除这条连线。</p>
          </Panel>
        ) : null}
      </ReactFlow>

      <QuestionPopover />

      {scenario.nodes.length === 0 && (
        <div className="gx-empty">
          <div className="gx-empty-card">
            <h2 className="gx-empty-title">还没有决策步骤</h2>
            <p className="gx-empty-desc">
              添加一个步骤，填写状态与问题；再把节点右侧的连点拖到另一个节点左侧，就能建立依赖。
            </p>
            <button
              type="button"
              className="gx-tool gx-tool--primary gx-empty-action"
              onClick={() => handleAddNode('api')}
            >
              <Plus size={14} strokeWidth={1.5} aria-hidden="true" />
              添加步骤
            </button>
            <button
              type="button"
              className="gx-tool gx-empty-action"
              onClick={() => handleAddNode('logic')}
            >
              <Binary size={14} strokeWidth={1.5} aria-hidden="true" />
              添加逻辑步
            </button>
          </div>
        </div>
      )}
    </>
  )
}

export function GraphCanvas() {
  return (
    <ReactFlowProvider>
      <div className="graph-shell">
        <GraphCanvasInner />
      </div>
    </ReactFlowProvider>
  )
}

export default GraphCanvas
