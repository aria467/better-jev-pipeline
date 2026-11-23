import type { JSX } from 'react'
import { AlertTriangle, Inbox } from 'lucide-react'
import type { RunRecord } from '../lib/types'
import { JsonTree } from './JsonTree'
import './json.css'

/** 逻辑步的结果视图：命名布尔输出 + 引用的上游值。 */
export function LogicResultView({ record }: { record: RunRecord }): JSX.Element {
  if (record.status === 'error') {
    const error = record.error
    return (
      <section className="res">
        <div className="res-card res-error">
          <header className="res-error-head">
            <span className="res-error-icon" aria-hidden="true">
              <AlertTriangle size={16} strokeWidth={1.5} />
            </span>
            <h4 className="res-error-title">逻辑求值失败</h4>
            <span className="res-error-code mono">{error?.code ?? 'logic_error'}</span>
          </header>
          <p className="res-error-message">{error?.message ?? '表达式未能求值。'}</p>
        </div>
      </section>
    )
  }

  if (!record.outputs) {
    return (
      <section className="res">
        <div className="res-empty">
          <span className="res-empty-icon" aria-hidden="true">
            <Inbox size={22} strokeWidth={1.5} />
          </span>
          <p className="res-note">运行后在这里查看布尔输出与引用的上游值</p>
        </div>
      </section>
    )
  }

  const outputs = Object.entries(record.outputs)
  const inputs = Object.entries(record.inputs ?? {})

  return (
    <section className="res">
      <header className="res-meta">
        <span className="res-model mono">本地计算</span>
        <span className="res-meta-item">
          耗时 {record.ms !== undefined ? `${record.ms} ms` : '—'}
        </span>
        <span className="res-chip res-chip-ok">成功</span>
      </header>

      <div className="res-list">
        {outputs.length === 0 ? (
          <p className="res-note">这次运行没有产生布尔输出。</p>
        ) : (
          outputs.map(([id, value]) => (
            <article className="res-card" key={id}>
              <header className="res-card-head">
                <h4 className="res-question-id mono">{id}</h4>
                <span
                  className={`res-chip ${value ? 'res-chip-logic-true' : 'res-chip-logic-false'}`}
                >
                  {value ? '真' : '假'}
                </span>
              </header>
              <p className="res-note">
                {value
                  ? '条件成立：条件为真的下游连线会放行。'
                  : '条件不成立：条件为真的下游连线会被跳过。'}
              </p>
            </article>
          ))
        )}
      </div>

      {inputs.length > 0 ? (
        <div className="res-inputs">
          <div className="res-detail-label">引用的上游值</div>
          <JsonTree value={Object.fromEntries(inputs)} maxHeight={240} />
        </div>
      ) : null}
    </section>
  )
}
