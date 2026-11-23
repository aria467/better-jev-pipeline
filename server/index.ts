import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import express from 'express'
import dotenv from 'dotenv'
import { Agent, EnvHttpProxyAgent, fetch, setGlobalDispatcher } from 'undici'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '..')

dotenv.config({ path: path.join(root, '.env') })

const PORT = Number(process.env.PORT || 8791)
const HOST = '127.0.0.1'
const BASE_URL = (process.env.TYPESAFE_BASE_URL || 'https://api.typesafe.ai').replace(/\/+$/, '')
const PROXY =
  process.env.TYPESAFE_PROXY ||
  process.env.HTTPS_PROXY ||
  process.env.https_proxy ||
  'http://127.0.0.1:7892'
const API_KEY = (process.env.TYPESAFE_API_KEY || '').trim()

if (PROXY) {
  process.env.HTTPS_PROXY = PROXY
  process.env.HTTP_PROXY = PROXY
  setGlobalDispatcher(new EnvHttpProxyAgent())
} else {
  setGlobalDispatcher(new Agent())
}

const RETRYABLE = new Set([429, 529, 500, 502, 503, 504])
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

function redact(value: string): string {
  return value.replace(/(\/\/)[^/@]+@/, '$1***@')
}

type UndiciInit = Parameters<typeof fetch>[1]
type UndiciResponse = Awaited<ReturnType<typeof fetch>>

async function upstream(
  pathname: string,
  init: UndiciInit,
  attempts = 3,
): Promise<UndiciResponse> {
  let lastError: unknown
  for (let attempt = 0; attempt <= attempts; attempt += 1) {
    try {
      const res = await fetch(`${BASE_URL}${pathname}`, {
        ...init,
        signal: AbortSignal.timeout(120_000),
      })
      if (RETRYABLE.has(res.status) && attempt < attempts) {
        const retryAfter = Number(res.headers.get('retry-after') || 0)
        await res.body?.cancel()
        await sleep(retryAfter > 0 ? Math.min(retryAfter * 1000, 15_000) : Math.min(500 * 2 ** attempt, 8_000))
        continue
      }
      return res
    } catch (error) {
      lastError = error
      if (attempt < attempts) {
        await sleep(Math.min(400 * 2 ** attempt, 4_000))
        continue
      }
    }
  }
  throw lastError instanceof Error ? lastError : new Error('upstream request failed')
}

const app = express()
app.disable('x-powered-by')
app.use(express.json({ limit: '8mb' }))

app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    keyConfigured: API_KEY.length > 0,
    baseUrl: BASE_URL,
    proxyConfigured: Boolean(PROXY),
    proxy: PROXY ? redact(PROXY) : null,
  })
})

let modelsCache: { at: number; body: unknown } | null = null

app.get('/api/models', async (_req, res) => {
  if (!API_KEY) {
    res.status(503).json({ error: { code: 'missing_api_key', message: '未配置 TYPESAFE_API_KEY' } })
    return
  }
  if (modelsCache && Date.now() - modelsCache.at < 5 * 60_000) {
    res.json(modelsCache.body)
    return
  }
  try {
    const upstreamRes = await upstream('/v1/models', {
      method: 'GET',
      headers: { authorization: `Bearer ${API_KEY}` },
    })
    const text = await upstreamRes.text()
    if (!upstreamRes.ok) {
      res.status(upstreamRes.status).type('application/json').send(text)
      return
    }
    const body = JSON.parse(text)
    modelsCache = { at: Date.now(), body }
    res.json(body)
  } catch (error) {
    respondUpstreamFailure(res, error)
  }
})

app.post('/api/systemone', async (req, res) => {
  if (!API_KEY) {
    res.status(503).json({ error: { code: 'missing_api_key', message: '未配置 TYPESAFE_API_KEY' } })
    return
  }
  if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) {
    res.status(400).json({ error: { code: 'invalid_request', message: '请求体必须是 JSON 对象' } })
    return
  }

  const started = Date.now()
  try {
    const upstreamRes = await upstream('/v1/systemone', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${API_KEY}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(req.body),
    })
    const text = await upstreamRes.text()
    if (!upstreamRes.ok) {
      console.warn(`[jev] systemone ${upstreamRes.status} in ${Date.now() - started}ms`)
    } else {
      console.log(`[jev] systemone 200 in ${Date.now() - started}ms`)
    }
    const retryAfter = upstreamRes.headers.get('retry-after')
    if (retryAfter) res.setHeader('retry-after', retryAfter)
    res
      .status(upstreamRes.status)
      .type(upstreamRes.headers.get('content-type') || 'application/json')
      .send(text)
  } catch (error) {
    respondUpstreamFailure(res, error)
  }
})

function respondUpstreamFailure(res: express.Response, error: unknown) {
  const cause = (error as { cause?: { code?: string } })?.cause
  const code = cause?.code || (error instanceof Error ? error.name : 'unknown')
  const message =
    code === 'ENOTFOUND' || code === 'ECONNREFUSED' || code === 'ECONNRESET'
      ? `无法连接 ${BASE_URL}（${code}）。请确认本地代理 ${redact(PROXY)} 正在运行。`
      : `上游请求失败：${error instanceof Error ? error.message : String(error)}`
  console.error(`[jev] upstream failure: ${code}`)
  res.status(502).json({
    error: {
      code: 'upstream_unreachable',
      message,
      hint: '直连 api.typesafe.ai 会返回 451，必须通过本地代理访问。',
    },
  })
}

const dist = path.join(root, 'dist')
if (fs.existsSync(dist)) {
  app.use(express.static(dist))
  app.get(/^\/(?!api\/).*/, (_req, res) => {
    res.sendFile(path.join(dist, 'index.html'))
  })
}

app.listen(PORT, HOST, () => {
  console.log(`[jev] studio server http://${HOST}:${PORT}`)
  console.log(`[jev] upstream ${BASE_URL} via ${PROXY ? redact(PROXY) : 'direct'}`)
  console.log(`[jev] api key ${API_KEY ? 'configured' : 'MISSING'}`)
})
