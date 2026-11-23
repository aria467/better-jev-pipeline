import type {
  ApiErrorBody,
  Health,
  JsonValue,
  ModelInfo,
  SystemOneRequest,
  SystemOneResponse,
} from './types'

export interface ApiFailure {
  ok: false
  status?: number
  code: string
  message: string
  hint?: string
  detail?: JsonValue
}

export interface ApiSuccess<T> {
  ok: true
  data: T
}

function formatDetail(detail: unknown): string {
  if (typeof detail === 'string') return detail
  if (Array.isArray(detail)) {
    return detail
      .map((item) => {
        if (item && typeof item === 'object') {
          const entry = item as { loc?: unknown[]; msg?: string; type?: string }
          const loc = Array.isArray(entry.loc) ? entry.loc.join('.') : ''
          return [loc, entry.msg ?? entry.type ?? ''].filter(Boolean).join(': ')
        }
        return String(item)
      })
      .filter(Boolean)
      .join('；')
  }
  if (detail === undefined || detail === null) return ''
  return JSON.stringify(detail)
}

async function parseFailure(res: Response): Promise<ApiFailure> {
  const text = await res.text()
  let body: ApiErrorBody | undefined
  try {
    body = text ? (JSON.parse(text) as ApiErrorBody) : undefined
  } catch {
    body = undefined
  }
  const error = body?.error
  const detailMessage = formatDetail(body?.detail)
  return {
    ok: false,
    status: res.status,
    code: error?.code ?? `http_${res.status}`,
    message: error?.message || detailMessage || text || `HTTP ${res.status}`,
    hint: error?.hint,
    detail: (body?.detail ?? (text && !body ? text : undefined)) as JsonValue | undefined,
  }
}

async function request<T>(url: string, init?: RequestInit): Promise<ApiSuccess<T> | ApiFailure> {
  try {
    const res = await fetch(url, init)
    if (!res.ok) return parseFailure(res)
    return { ok: true, data: (await res.json()) as T }
  } catch (error) {
    return {
      ok: false,
      code: 'network_error',
      message: error instanceof Error ? error.message : String(error),
      hint: '确认本地 studio 服务（8787）正在运行。',
    }
  }
}

export function getHealth() {
  return request<Health>('/api/health')
}

export function getModels() {
  return request<{ models: ModelInfo[] }>('/api/models')
}

export function callSystemOne(payload: SystemOneRequest, signal?: AbortSignal) {
  return request<SystemOneResponse>('/api/systemone', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
    signal,
  })
}

export function formatCost(inputTokens: number): string {
  const usd = (inputTokens * 42) / 1_000_000_000
  if (usd === 0) return '$0'
  if (usd < 0.000001) return `$${usd.toExponential(2)}`
  return `$${usd.toFixed(6)}`
}
