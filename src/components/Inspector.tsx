import { useEffect, useMemo, useState } from 'react'
import type { JSX } from 'react'
import {
  Check,
  CircleAlert,
  Copy,
  ListChecks,
  PanelRight,
  Play,
  Trash2,
  X,
} from 'lucide-react'
import { ancestorsOf, parentsOf } from '../lib/graph'
import { buildRequest } from '../lib/request'
import { useStudio } from '../lib/store'
import { isLogicNode } from '../lib/types'
import type { JsonValue, RunRecord, Scenario } from '../lib/types'
import { validateScenario } from '../lib/validate'
import { JsonTree } from './JsonTree'
import { LogicOutputsEditor } from './LogicOutputsEditor'
import { LogicResultView } from './LogicResultView'
import { QuestionsEditor } from './QuestionsEditor'
import { ResultView } from './ResultView'
import { StateEditor } from './StateEditor'
import type { VariableGroup } from './VariableMenu'
import './inspector.css'

type Tab = 'edit' | 'request' | 'response' | 'result'

const TABS: { id: Tab; label: string }[] = [
  { id: 'edit', label: '编辑' },
  { id: 'request', label: '请求 JSON' },
  { id: 'response', label: '响应 JSON' },
  { id: 'result', label: '结果' },
]

const SAFE_PATH_SEGMENT = /^[^\s.{}]+$/u

function collectVariables(
  nodeId: string,
  scenario: Scenario,
  results: Record<string, RunRecord>,
): VariableGroup[] {
  const ancestors = ancestorsOf(nodeId, scenario.edges)
  const groups: VariableGroup[] = []

  for (const owner of scenario.nodes) {
    if (!ancestors.has(owner.id)) continue
    const record = results[owner.id]
    if (record?.status !== 'success') continue
    if (isLogicNode(owner)) {
      const outputs = record.outputs
      if (!outputs) continue
      const items: VariableGroup['items'] = Object.entries(outputs).map(
        ([outputId, value]) => ({
          label: `${outputId} · ${value ? '真' : '假'}`,
          template: `{{${owner.id}.${outputId}}}`,
        }),
      )
      if (items.length > 0) {
        groups.push({
          nodeId: owner.id,
          title: `${owner.title} · ${owner.id}`,
          items,
        })
      }
      continue
    }
    if (!record.response) continue
    const items: VariableGroup['items'] = []
    for (const [questionId, answer] of Object.entries(record.response.answers)) {
      const base = `${owner.id}.${questionId}`
      const push = (label: string, path: string) =>
        items.push({
          label: `${questionId} · ${label}`,
          template: `{{${path}}}`,
        })
      if (answer.type === 'choice') {
        push('choice', `${base}.choice`)
        push('confidence', `${base}.confidence`)
        for (const key of Object.keys(answer.probabilities ?? {})) {
          if (SAFE_PATH_SEGMENT.test(key)) {
            push(`${key} 概率`, `${base}.probabilities.${key}`)
          }
        }
      } else if (answer.type === 'score') {
        push('score', `${base}.score`)
        push('confidence', `${base}.confidence`)
        for (const key of Object.keys(answer.probabilities ?? {})) {
          if (SAFE_PATH_SEGMENT.test(key)) {
            push(`${key} 概率`, `${base}.probabilities.${key}`)
          }
        }
      } else if (answer.type === 'noul') {
        push('noul', `${base}.noul`)
      }
    }
    if (items.length > 0) {
      groups.push({
        nodeId: owner.id,
        title: `${owner.title} · ${owner.id}`,
        items,
      })
    }
  }

  return groups
}

function ResponseErrorCard({ record }: { record: RunRecord }): JSX.Element {
  const [detailOpen, setDetailOpen] = useState(false)
  const error = record.error
  if (!error) return <></>

  return (
    <div className="insp-error-card">
      <div className="insp-error-card-head">
        <CircleAlert size={15} strokeWidth={1.5} aria-hidden="true" />
        <span>{error.message}</span>
        {error.status !== undefined ? (
          <span className="insp-error-status mono">{error.status}</span>
        ) : null}
      </div>
      <dl className="insp-error-meta">
        <div>
          <dt>code</dt>
          <dd className="mono">{error.code}</dd>
        </div>
        {error.hint ? (
          <div>
            <dt>hint</dt>
            <dd>{error.hint}</dd>
          </div>
        ) : null}
      </dl>
      {error.detail !== undefined && error.detail !== null ? (
        <>
          <button
            type="button"
            className="insp-link-btn"
            onClick={() => setDetailOpen((value) => !value)}
          >
            {detailOpen ? '收起 detail' : '展开 detail'}
          </button>
          {detailOpen ? <JsonTree value={error.detail} maxHeight={260} /> : null}
        </>
      ) : null}
    </div>
  )
}

export function Inspector(): JSX.Element {
  const {
    scenario,
    selectedId,
    results,
    running,
    runningId,
    updateNode,
    updateQuestions,
    updateState,
    updateOutputs,
    deleteNode,
    duplicateNode,
    deleteEdge,
    runNode,
  } = useStudio()

  const [tab, setTab] = useState<Tab>('edit')

  const node = useMemo(
    () => scenario.nodes.find((item) => item.id === selectedId) ?? null,
    [scenario, selectedId],
  )
  const index = node
    ? scenario.nodes.findIndex((item) => item.id === node.id)
    : -1
  const logicNode = node && isLogicNode(node) ? node : null
  const apiNode = node && !isLogicNode(node) ? node : null
  const record = node ? results[node.id] : undefined
  const variables = useMemo(
    () => (node ? collectVariables(node.id, scenario, results) : []),
    [node, scenario, results],
  )
  const built = useMemo(
    () => (apiNode ? buildRequest({ scenario, node: apiNode, results }) : null),
    [apiNode, scenario, results],
  )
  // 使用场景级校验：除节点自身问题外，也覆盖指向该节点的条件边错误。
  const nodeErrors = useMemo(() => {
    if (!node) return []
    const messages = validateScenario(scenario).byNode[node.id] ?? []
    return messages.map((message) => ({ nodeId: node.id, message, severity: 'error' as const }))
  }, [node, scenario])

  useEffect(() => {
    if (logicNode && tab !== 'edit' && tab !== 'result') setTab('edit')
  }, [logicNode, tab])

  if (!node) {
    return (
      <aside className="insp-root" aria-label="节点检查器">
        <div className="insp-empty">
          <div className="insp-empty-icon">
            <PanelRight size={20} strokeWidth={1.5} aria-hidden="true" />
          </div>
          <p className="insp-empty-title">选择一个节点</p>
          <p className="insp-empty-text">
            在画布上点击任意步骤，即可编辑它的 State、问题与请求 JSON。也可以从上游节点底部拖线到本节点顶部来建立依赖。
          </p>
        </div>
      </aside>
    )
  }

  const parents = parentsOf(node.id, scenario.edges)
  const isThisRunning = runningId === node.id

  return (
    <aside className="insp-root" aria-label="节点检查器">
      <header className="insp-head">
        <div className="insp-head-main">
          <div className="insp-head-meta">
            <span className="eyebrow">
              {logicNode ? 'LOGIC' : 'STEP'} {String(index + 1).padStart(2, '0')}
            </span>
            <span className="insp-node-id mono">{node.id}</span>
          </div>
          <input
            className="insp-title-input"
            value={node.title}
            aria-label="节点标题"
            onChange={(event) => updateNode(node.id, { title: event.target.value })}
          />
        </div>
        <div className="insp-head-actions">
          <button
            type="button"
            className="insp-icon-btn"
            title="复制节点"
            aria-label="复制节点"
            onClick={() => duplicateNode(node.id)}
          >
            <Copy size={15} strokeWidth={1.5} aria-hidden="true" />
          </button>
          <button
            type="button"
            className="insp-icon-btn insp-icon-btn-danger"
            title="删除节点"
            aria-label="删除节点"
            onClick={() => deleteNode(node.id)}
          >
            <Trash2 size={15} strokeWidth={1.5} aria-hidden="true" />
          </button>
          <button
            type="button"
            className={`insp-run-btn${isThisRunning ? ' is-running' : ''}`}
            title={
              isThisRunning ? '正在运行此节点' : running ? '运行中，请稍候' : '运行此节点'
            }
            aria-label="运行此节点"
            disabled={running}
            onClick={() => void runNode(node.id)}
          >
            <Play size={13} strokeWidth={1.5} aria-hidden="true" />
            运行
          </button>
        </div>
      </header>

      <nav className="insp-tabs" role="tablist" aria-label="检查器页签">
        {(logicNode ? TABS.filter((item) => item.id === 'edit' || item.id === 'result') : TABS).map((item) => (
          <button
            type="button"
            role="tab"
            key={item.id}
            aria-selected={tab === item.id}
            className={`insp-tab${tab === item.id ? ' is-active' : ''}`}
            onClick={() => setTab(item.id)}
          >
            {item.label}
          </button>
        ))}
      </nav>

      <div className="insp-body">
        {tab === 'edit' ? (
          <div className="insp-tabpane">
            {nodeErrors.length > 0 ? (
              <div className="insp-alert-error" role="alert">
                <div className="insp-alert-head">
                  <CircleAlert size={14} strokeWidth={1.5} aria-hidden="true" />
                  <span>配置问题</span>
                </div>
                <ul>
                  {nodeErrors.map((issue, issueIndex) => (
                    <li key={`${issue.message}-${issueIndex}`}>{issue.message}</li>
                  ))}
                </ul>
              </div>
            ) : null}

            <section className="insp-section">
              <div className="insp-section-head">
                <h3 className="insp-section-title">依赖</h3>
                {parents.length > 0 ? (
                  <span className="insp-count">{parents.length}</span>
                ) : null}
              </div>
              {parents.length > 0 ? (
                <ul className="insp-dep-list">
                  {parents.map((parentId) => {
                    const parent = scenario.nodes.find((item) => item.id === parentId)
                    const edge = scenario.edges.find(
                      (item) => item.source === parentId && item.target === node.id,
                    )
                    return (
                      <li className="insp-dep-chip" key={parentId}>
                        <span className="insp-dep-title">
                          {parent?.title ?? parentId}
                        </span>
                        <span className="insp-dep-id mono">{parentId}</span>
                        {edge?.when ? (
                          <span className="insp-dep-cond mono" title="条件连线">
                            {edge.when.output} = {edge.when.equals ? '真' : '假'}
                          </span>
                        ) : null}
                        <button
                          type="button"
                          className="insp-chip-x"
                          title="移除依赖"
                          aria-label={`移除来自 ${parentId} 的依赖`}
                          disabled={!edge}
                          onClick={() => {
                            if (edge) deleteEdge(edge.id)
                          }}
                        >
                          <X size={12} strokeWidth={1.5} aria-hidden="true" />
                        </button>
                      </li>
                    )
                  })}
                </ul>
              ) : (
                <p className="insp-hint">还没有上游节点。</p>
              )}
              <p className="insp-hint">从上游节点底部拖线到本节点顶部可新增依赖。</p>
            </section>

            {logicNode ? (
              <LogicOutputsEditor
                scenario={scenario}
                node={logicNode}
                results={results}
                variables={variables}
                onChange={(outputs) => updateOutputs(logicNode.id, outputs)}
              />
            ) : null}

            {apiNode ? (
              <>
                <section className="insp-section">
                  <label className="insp-toggle">
                    <input
                      type="checkbox"
                      checked={apiNode.includeUpstream}
                      onChange={(event) =>
                        updateNode(apiNode.id, { includeUpstream: event.target.checked })
                      }
                    />
                    <span className="insp-toggle-track" aria-hidden="true">
                      <span className="insp-toggle-thumb" />
                    </span>
                    <span className="insp-toggle-text">
                      <span className="insp-toggle-title">自动注入上游结果</span>
                      <span className="insp-hint">
                        直接上游的 answers 会放入 <code>state.upstream</code>；文本 state 会包装为{' '}
                        <code>{'{ text, upstream }'}</code>。
                      </span>
                    </span>
                  </label>
                </section>

                <section className="insp-section">
                  <StateEditor
                    key={`${scenario.id}:${apiNode.id}`}
                    nodeId={apiNode.id}
                    value={apiNode.state}
                    variables={variables}
                    onChange={(next) => updateState(apiNode.id, next)}
                  />
                </section>

                <section className="insp-section">
                  <QuestionsEditor
                    key={`${scenario.id}:${apiNode.id}`}
                    questions={apiNode.questions}
                    variables={variables}
                    onChange={(next) => updateQuestions(apiNode.id, next)}
                  />
                </section>
              </>
            ) : null}
          </div>
        ) : null}

        {tab === 'request' && built ? (
          <div className="insp-tabpane">
            {built.errors.length > 0 ? (
              <div className="insp-alert-error" role="alert">
                <div className="insp-alert-head">
                  <CircleAlert size={14} strokeWidth={1.5} aria-hidden="true" />
                  <span>请求未完全就绪</span>
                </div>
                <ul>
                  {built.errors.map((issue, issueIndex) => (
                    <li key={`${issue.path}-${issueIndex}-${issue.message}`}>
                      {issue.path ? <code className="mono">{`{{${issue.path}}}`}</code> : null}
                      {issue.path ? ' ' : null}
                      {issue.message}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            {built.hasUpstream ? (
              <p className="insp-hint">已注入直接上游的 answers 到请求 state。</p>
            ) : null}
            <div className="insp-tree-wrap">
              <JsonTree
                value={built.request as unknown as JsonValue}
                defaultExpandDepth={3}
                maxHeight={520}
                toolbar
              />
            </div>
          </div>
        ) : null}

        {tab === 'response' ? (
          <div className="insp-tabpane">
            {record?.response ? (
              <JsonTree
                value={record.response as unknown as JsonValue}
                defaultExpandDepth={2}
                maxHeight={520}
                toolbar
              />
            ) : record?.error ? (
              <ResponseErrorCard record={record} />
            ) : (
              <div className="insp-empty insp-empty-compact">
                <div className="insp-empty-icon">
                  <Play size={18} strokeWidth={1.5} aria-hidden="true" />
                </div>
                <p className="insp-empty-title">运行后查看响应</p>
                <p className="insp-empty-text">
                  运行此节点后，这里会显示原始响应 JSON。
                </p>
              </div>
            )}
          </div>
        ) : null}

        {tab === 'result' ? (
          <div className="insp-tabpane">
            {record && logicNode ? <LogicResultView record={record} /> : null}
            {record && apiNode ? (
              <ResultView record={record} questions={apiNode.questions} />
            ) : null}
            {!record ? (
              <div className="insp-empty insp-empty-compact">
                <div className="insp-empty-icon">
                  <ListChecks size={18} strokeWidth={1.5} aria-hidden="true" />
                </div>
                <p className="insp-empty-title">还没有运行结果</p>
                <p className="insp-empty-text">
                  {logicNode
                    ? '运行此节点后，这里会显示布尔输出与引用的上游值。'
                    : '运行此节点后，这里会显示 choice、score 与 noul 的解读。'}
                </p>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>

      <footer className="insp-foot">
        {nodeErrors.length > 0 ? (
          <button
            type="button"
            className="insp-foot-errors"
            title="切换到编辑页查看"
            onClick={() => setTab('edit')}
          >
            <CircleAlert size={13} strokeWidth={1.5} aria-hidden="true" />
            <span>{nodeErrors.length} 处配置错误</span>
          </button>
        ) : (
          <span className="insp-foot-ok">
            <Check size={13} strokeWidth={1.5} aria-hidden="true" />
            配置校验通过
          </span>
        )}
        <span className="insp-foot-id mono">{node.id}</span>
      </footer>
    </aside>
  )
}
