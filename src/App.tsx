import { useEffect } from 'react'
import { GraphCanvas } from './components/GraphCanvas'
import { Inspector } from './components/Inspector'
import { RunLog } from './components/RunLog'
import { Toasts } from './components/Toasts'
import { TopBar } from './components/TopBar'
import { getHealth, getModels } from './lib/api'
import { useStudio } from './lib/store'

export function App() {
  const health = useStudio((state) => state.health)
  const setHealth = useStudio((state) => state.setHealth)
  const setModels = useStudio((state) => state.setModels)
  const notify = useStudio((state) => state.notify)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const result = await getHealth()
      if (cancelled) return
      if (!result.ok) {
        setHealth(null)
        notify(result.message, 'error')
        return
      }
      setHealth(result.data)
      const models = await getModels()
      if (!cancelled && models.ok) setModels(models.data.models)
    })()
    return () => {
      cancelled = true
    }
  }, [notify, setHealth, setModels])

  const keyMissing = health !== null && !health.keyConfigured

  return (
    <div className="app-shell">
      <TopBar />
      {keyMissing ? (
        <div className="app-banner" role="alert">
          <span className="app-banner-dot" />
          <div>
            <strong>未检测到 API Key。</strong>
            在项目根目录的 <code>.env</code> 中设置 <code>TYPESAFE_API_KEY</code> 后重启开发服务。
          </div>
        </div>
      ) : null}
      <main className="app-main">
        <section className="app-canvas" aria-label="决策流程图">
          <GraphCanvas />
        </section>
        <aside className="app-inspector" aria-label="节点检查器">
          <Inspector />
        </aside>
      </main>
      <RunLog />
      <Toasts />
    </div>
  )
}
