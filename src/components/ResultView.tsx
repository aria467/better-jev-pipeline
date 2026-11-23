import type { JSX } from 'react'
import { AlertTriangle, Inbox } from 'lucide-react'
import { formatCost } from '../lib/api'
import type {
  BoxAnswer,
  ChoiceAnswer,
  JsonValue,
  NoulAnswer,
  Question,
  RunRecord,
  ScoreAnswer,
} from '../lib/types'
import { JsonTree } from './JsonTree'
import './json.css'

function formatPercent(value: number): string {
  const percent = value * 100
  const rounded = Math.round(percent)
  const text = Math.abs(percent - rounded) < 0.05 ? String(rounded) : percent.toFixed(1)
  return `${text}%`
}

function barWidth(value: number): string {
  const percent = Math.max(0, Math.min(100, value * 100))
  return `${percent}%`
}

function CardHead(props: {
  id: string
  type: string
  confidence?: number | null
}): JSX.Element {
  const { id, type, confidence } = props
  return (
    <header className="res-card-head">
      <h4 className="res-question-id mono">{id}</h4>
      <span className={`res-chip res-chip-${type}`}>{type}</span>
      {typeof confidence === 'number' ? (
        <span className="res-conf">置信度 {formatPercent(confidence)}</span>
      ) : null}
    </header>
  )
}

function ChoiceResult(props: { id: string; answer: ChoiceAnswer }): JSX.Element {
  const { id, answer } = props
  const entries = Object.entries(answer.probabilities).sort((a, b) => b[1] - a[1])
  return (
    <article className="res-card res-choice">
      <CardHead id={id} type="choice" confidence={answer.confidence} />
      {entries.length === 0 ? (
        <p className="res-note">模型未返回概率分布。</p>
      ) : (
        <div className="res-bars">
          {entries.map(([name, probability]) => {
            const chosen = name === answer.choice
            return (
              <div
                className={`res-bar-row${chosen ? ' res-bar-row-chosen' : ''}`}
                key={name}
              >
                <div className="res-bar-label">
                  <span className="res-bar-name">{name}</span>
                  <span className="res-bar-pct mono">{formatPercent(probability)}</span>
                </div>
                <div className="res-bar-track">
                  <div
                    className="res-bar-fill"
                    style={{ width: barWidth(probability) }}
                  />
                </div>
              </div>
            )
          })}
        </div>
      )}
    </article>
  )
}

function legendLabel(value: JsonValue | undefined, fallback: string): string {
  if (typeof value === 'string') return value
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const record = value as Record<string, JsonValue>
    if (typeof record.label === 'string') return record.label
    if (typeof record.description === 'string') return record.description
  }
  return fallback
}

function scoreLevelOrder(answer: ScoreAnswer): string[] {
  return Object.keys(answer.probabilities).sort((a, b) => {
    const left = Number(a)
    const right = Number(b)
    if (Number.isFinite(left) && Number.isFinite(right)) return left - right
    return 0
  })
}

function ScoreResult(props: { id: string; answer: ScoreAnswer }): JSX.Element {
  const { id, answer } = props
  const rows = scoreLevelOrder(answer).map((key) => ({
    key,
    label: legendLabel(answer.legend?.[key], key),
    probability: answer.probabilities[key] ?? 0,
  }))

  return (
    <article className="res-card res-score">
      <CardHead id={id} type="score" confidence={answer.confidence} />
      <div className="res-score-hero">
        <span className="res-score-value">{answer.score.toFixed(2)}</span>
        <span className="res-score-cap">/ {Math.max(0, rows.length - 1)}</span>
      </div>
      {rows.length > 0 ? (
        <>
          <div className="res-stack" role="img" aria-label="等级概率分布">
            {rows.map((row, index) => (
              <span
                key={row.key}
                className="res-stack-seg"
                title={`${row.label} ${formatPercent(row.probability)}`}
                style={{
                  width: barWidth(row.probability),
                  opacity: rows.length > 1 ? 0.42 + (index / (rows.length - 1)) * 0.58 : 0.58,
                }}
              />
            ))}
          </div>
          <div className="res-bars">
            {rows.map((row) => (
              <div className="res-bar-row" key={row.key}>
                <div className="res-bar-label">
                  <span className="res-bar-name">{row.label}</span>
                  <span className="res-bar-pct mono">{formatPercent(row.probability)}</span>
                </div>
                <div className="res-bar-track">
                  <div
                    className="res-bar-fill"
                    style={{ width: barWidth(row.probability) }}
                  />
                </div>
              </div>
            ))}
          </div>
        </>
      ) : (
        <p className="res-note">模型未返回等级分布。</p>
      )}
    </article>
  )
}

function NoulResult(props: { id: string; answer: NoulAnswer }): JSX.Element {
  const { id, answer } = props
  const clamped = Math.max(0, Math.min(1, answer.noul))
  return (
    <article className="res-card res-noul">
      <CardHead id={id} type="noul" />
      <div className="res-noul-value">P(是) = {answer.noul.toFixed(2)}</div>
      <div className="res-gauge">
        <div className="res-gauge-track">
          <div className="res-gauge-fill" style={{ width: barWidth(clamped) }} />
          <span className="res-gauge-tick" aria-hidden="true" />
          <span
            className="res-gauge-marker"
            style={{ left: barWidth(clamped) }}
            aria-hidden="true"
          />
        </div>
        <div className="res-gauge-ends">
          <span>否</span>
          <span>是</span>
        </div>
      </div>
    </article>
  )
}

function BoxResult(props: { id: string; answer: BoxAnswer }): JSX.Element {
  const { id, answer } = props
  const coordinates = ['top', 'bottom', 'left', 'right'] as const
  return (
    <article className="res-card res-box">
      <CardHead id={id} type="box" confidence={answer.confidence} />
      <div className="res-box-grid">
        {coordinates.map((key) => (
          <div className="res-box-cell" key={key}>
            <span className="res-box-label">{key}</span>
            <span className="res-box-value mono">{answer.box[key].toFixed(3)}</span>
          </div>
        ))}
      </div>
    </article>
  )
}

export function ResultView(props: {
  record: RunRecord
  questions: Record<string, Question>
}): JSX.Element {
  const { record, questions } = props

  if (record.status === 'error') {
    const error = record.error
    const statusLabel =
      error?.status !== undefined && error.status !== null
        ? `${error.status} · ${error.code}`
        : error?.code ?? '未知错误'
    const detail = error?.detail
    return (
      <section className="res">
        <div className="res-card res-error">
          <header className="res-error-head">
            <span className="res-error-icon" aria-hidden="true">
              <AlertTriangle size={16} strokeWidth={1.5} />
            </span>
            <h4 className="res-error-title">请求失败</h4>
            <span className="res-error-code mono">{statusLabel}</span>
          </header>
          <p className="res-error-message">{error?.message ?? '请求未成功完成。'}</p>
          {error?.hint ? <p className="res-error-hint">{error.hint}</p> : null}
          {detail !== undefined && detail !== null ? (
            <div className="res-error-detail">
              <span className="res-detail-label">错误详情</span>
              <JsonTree value={detail} maxHeight={220} toolbar={false} />
            </div>
          ) : null}
        </div>
      </section>
    )
  }

  const response = record.response
  if (!response) {
    return (
      <section className="res">
        <div className="res-empty">
          <span className="res-empty-icon" aria-hidden="true">
            <Inbox size={22} strokeWidth={1.5} />
          </span>
          <p className="res-note">运行后在这里查看结构化结果</p>
        </div>
      </section>
    )
  }

  const inputTokens = record.inputTokens ?? response.usage.input_tokens
  const outputTokens = record.outputTokens ?? response.usage.output_tokens
  const ids = Object.keys(questions)

  return (
    <section className="res">
      <header className="res-meta">
        <span className="res-model mono">{response.model}</span>
        <span className="res-meta-item">
          耗时 {record.ms !== undefined ? `${record.ms} ms` : '—'}
        </span>
        <span className="res-meta-item">输入 {inputTokens} tokens</span>
        <span className="res-meta-item">输出 {outputTokens} tokens</span>
        <span className="res-meta-item">费用 {formatCost(inputTokens)}</span>
        <span className="res-chip res-chip-ok">成功</span>
      </header>
      <div className="res-list">
        {ids.length === 0 ? (
          <p className="res-note">本次运行没有配置问题。</p>
        ) : (
          ids.map((id) => {
            const question = questions[id]
            const answer = response.answers[id]
            if (!answer) {
              return (
                <article className="res-card res-card-missing" key={id}>
                  <header className="res-card-head">
                    <h4 className="res-question-id mono">{id}</h4>
                    {question ? <span className="res-chip">{question.type}</span> : null}
                  </header>
                  <p className="res-note">本次运行未返回该问题的答案。</p>
                </article>
              )
            }
            switch (answer.type) {
              case 'choice':
                return <ChoiceResult id={id} answer={answer} key={id} />
              case 'score':
                return <ScoreResult id={id} answer={answer} key={id} />
              case 'noul':
                return <NoulResult id={id} answer={answer} key={id} />
              case 'box':
                return <BoxResult id={id} answer={answer} key={id} />
            }
          })
        )}
      </div>
    </section>
  )
}
