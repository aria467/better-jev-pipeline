import { useEffect, useState } from 'react'
import { ChevronsLeft, ChevronsRight } from 'lucide-react'
import { GraphCanvas } from './components/GraphCanvas'
import { Inspector } from './components/Inspector'
import { RunLog } from './components/RunLog'
import { Toasts } from './components/Toasts'
import { TopBar } from './components/TopBar'
import { getHealth, getModels } from './lib/api'
import { useStudio } from './lib/store'

export function App() {
  const [inspectorOpen, setInspectorOpen] = useState(true)
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
        <aside
          className={`app-inspector${inspectorOpen ? '' : ' is-collapsed'}`}
          aria-label="节点检查器"
        >
          <button
            type="button"
            className="app-inspector-toggle"
            aria-label={inspectorOpen ? '折叠检查器' : '展开检查器'}
            aria-expanded={inspectorOpen}
            title={inspectorOpen ? '折叠检查器' : '展开检查器'}
            onClick={() => setInspectorOpen((value) => !value)}
          >
            {inspectorOpen ? (
              <ChevronsLeft size={14} strokeWidth={1.5} aria-hidden="true" />
            ) : (
              <ChevronsRight size={14} strokeWidth={1.5} aria-hidden="true" />
            )}
          </button>
          <div className="app-inspector-clip" aria-hidden={!inspectorOpen} inert={!inspectorOpen}>
            <Inspector />
          </div>
        </aside>
      </main>
      <RunLog />
      <Toasts />
    </div>
  )
}
