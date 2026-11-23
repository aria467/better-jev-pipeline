import { useState } from 'react'
import { ChevronDown, ChevronRight, Trash2, X } from 'lucide-react'
import { formatCost } from '../lib/api'
import { topoOrder } from '../lib/graph'
import { useStudio } from '../lib/store'
import type { RunRecord } from '../lib/types'
import { JsonTree } from './JsonTree'

const STATUS_LABEL: Record<string, string> = {
  idle: '待运行',
  waiting: '等待',
  running: '运行中',
  success: '成功',
  error: '失败',
  skipped: '已跳过',
  stale: '待更新',
}

function recordOrder(scenario: ReturnType<typeof useStudio.getState>['scenario']) {
  const ordered = topoOrder(scenario.nodes, scenario.edges)
  const known = new Set(ordered)
  return [...ordered, ...scenario.nodes.map((node) => node.id).filter((id) => !known.has(id))]
}

export function RunLog() {
  const scenario = useStudio((state) => state.scenario)
  const results = useStudio((state) => state.results)
  const open = useStudio((state) => state.logOpen)
  const running = useStudio((state) => state.running)
  const setLogOpen = useStudio((state) => state.setLogOpen)
  const clearResults = useStudio((state) => state.clearResults)
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})

  const records = recordOrder(scenario)
    .map((id) => results[id])
    .filter((record): record is RunRecord => Boolean(record))
  const totalInput = records.reduce((sum, record) => sum + (record.inputTokens ?? 0), 0)
  const failures = records.filter((record) => record.status === 'error').length

  if (!open) return null

  return (
    <section className={`runlog ${open ? 'is-open' : ''}`} aria-label="运行日志">
      <header className="runlog-head">
        <div className="runlog-title">
          <span className="eyebrow">Run log</span>
          <strong>运行日志</strong>
          <span className="runlog-meta">
            {records.length} 个节点 · {totalInput.toLocaleString()} input tokens ·{' '}
            {formatCost(totalInput)}
            {failures ? ` · ${failures} 个失败` : ''}
          </span>
          {running ? <span className="runlog-live">运行中</span> : null}
        </div>
        <div className="runlog-actions">
          <button className="btn btn-ghost" type="button" onClick={clearResults} disabled={!records.length}>
            <Trash2 size={14} strokeWidth={1.5} />
            清空
          </button>
          <button className="btn btn-icon" type="button" onClick={() => setLogOpen(false)} title="收起">
            <X size={15} strokeWidth={1.5} />
          </button>
        </div>
      </header>

      {records.length === 0 ? (
        <div className="runlog-empty">运行后，每一步的请求、响应、耗时与费用会记录在这里。</div>
      ) : (
        <div className="runlog-body">
          <div className="runlog-table-head">
            <span>步骤</span>
            <span>状态</span>
            <span>耗时</span>
            <span>Tokens</span>
            <span>费用</span>
            <span />
          </div>
          {records.map((record) => {
            const node = scenario.nodes.find((item) => item.id === record.nodeId)
            const isExpanded = expanded[record.nodeId] ?? false
            return (
              <div className={`runlog-row ${isExpanded ? 'is-expanded' : ''}`} key={record.nodeId}>
                <button
                  className="runlog-line"
                  type="button"
                  onClick={() =>
                    setExpanded((current) => ({ ...current, [record.nodeId]: !isExpanded }))
                  }
                >
                  <span className="runlog-step">
                    {isExpanded ? (
                      <ChevronDown size={13} strokeWidth={1.6} />
                    ) : (
                      <ChevronRight size={13} strokeWidth={1.6} />
                    )}
                    <span className="runlog-step-id">{record.nodeId}</span>
                    <span className="runlog-step-title">{node?.title ?? record.nodeId}</span>
                  </span>
                  <span className={`runlog-status is-${record.status}`}>
                    {STATUS_LABEL[record.status] ?? record.status}
                  </span>
                  <span className="runlog-num">{record.ms != null ? `${record.ms} ms` : '—'}</span>
                  <span className="runlog-num">
                    {record.inputTokens != null ? record.inputTokens.toLocaleString() : '—'}
                  </span>
                  <span className="runlog-num">{formatCost(record.inputTokens ?? 0)}</span>
                  <span />
                </button>
                {record.note ? <div className="runlog-note">{record.note}</div> : null}
                {isExpanded ? (
                  <div className="runlog-detail">
                    <div className="runlog-json">
                      <div className="runlog-json-label">请求 JSON</div>
                      {record.request ? (
                        <JsonTree value={record.request as never} maxHeight={220} />
                      ) : (
                        <div className="runlog-empty-small">无请求</div>
                      )}
                    </div>
                    <div className="runlog-json">
                      <div className="runlog-json-label">
                        {record.error
                          ? '错误'
                          : record.response
                            ? '响应 JSON'
                            : record.outputs
                              ? '本地输出'
                              : '响应 JSON'}
                      </div>
                      {record.error ? (
                        <div className="runlog-error">
                          <div className="runlog-error-code">
                            {record.error.status ? `${record.error.status} · ` : ''}
                            {record.error.code}
                          </div>
                          <p>{record.error.message}</p>
                          {record.error.hint ? <p className="runlog-hint">{record.error.hint}</p> : null}
                          {record.error.detail ? (
                            <JsonTree value={record.error.detail} maxHeight={180} />
                          ) : null}
                        </div>
                      ) : record.response ? (
                        <JsonTree value={record.response as never} maxHeight={220} />
                      ) : record.outputs ? (
                        <JsonTree
                          value={
                            {
                              outputs: record.outputs,
                              ...(record.inputs ? { inputs: record.inputs } : {}),
                            } as never
                          }
                          maxHeight={220}
                        />
                      ) : (
                        <div className="runlog-empty-small">无响应</div>
                      )}
                    </div>
                  </div>
                ) : null}
              </div>
            )
          })}
        </div>
      )}
    </section>
  )
}
