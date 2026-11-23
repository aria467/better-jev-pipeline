import { useRef, useState } from 'react'
import {
  Copy,
  Download,
  PanelBottom,
  PencilLine,
  Play,
  Plus,
  Square,
  Upload,
} from 'lucide-react'
import { formatCost } from '../lib/api'
import { DEFAULT_SCENARIO, PRESETS } from '../lib/presets'
import { scenarioOptions, suggestScenarioName } from '../lib/scenarios'
import { useStudio } from '../lib/store'
import { DeleteScenarioDialog } from './DeleteScenarioDialog'
import { ScenarioNameDialog } from './ScenarioNameDialog'

const MODELS = ['jev-latest', 'jev-preview']

function downloadJson(name: string, value: unknown) {
  const blob = new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = `${name.replace(/[^\w一-龥-]+/g, '-')}.json`
  anchor.click()
  URL.revokeObjectURL(url)
}

export function TopBar() {
  const scenario = useStudio((state) => state.scenario)
  const health = useStudio((state) => state.health)
  const models = useStudio((state) => state.models)
  const running = useStudio((state) => state.running)
  const logOpen = useStudio((state) => state.logOpen)
  const resultCount = useStudio((state) => Object.keys(state.results).length)
  const totalInput = useStudio((state) =>
    Object.values(state.results).reduce((sum, record) => sum + (record.inputTokens ?? 0), 0),
  )
  const customScenarios = useStudio((state) => state.customScenarios)
  const switchScenario = useStudio((state) => state.switchScenario)
  const createScenario = useStudio((state) => state.createScenario)
  const renameScenario = useStudio((state) => state.renameScenario)
  const deleteScenario = useStudio((state) => state.deleteScenario)
  const setModel = useStudio((state) => state.setModel)
  const importScenario = useStudio((state) => state.importScenario)
  const runAll = useStudio((state) => state.runAll)
  const stop = useStudio((state) => state.stop)
  const setLogOpen = useStudio((state) => state.setLogOpen)
  const fileInput = useRef<HTMLInputElement>(null)
  const createButtonRef = useRef<HTMLButtonElement>(null)
  const selectRef = useRef<HTMLSelectElement>(null)
  const dialogTrigger = useRef<'select' | 'button'>('button')
  const [dialog, setDialog] = useState<'create' | 'rename' | 'delete' | null>(null)

  const modelNames = models.length ? models.map((model) => model.name) : MODELS
  const options = scenarioOptions(PRESETS, customScenarios)
  const knownScenario = options.some((option) => option.id === scenario.id)
  const isPreset = PRESETS.some((preset) => preset.id === scenario.id)
  const existingNames = Array.from(
    new Set([...options.map((option) => option.name), scenario.name]),
  )
  const suggestedName = suggestScenarioName(`${DEFAULT_SCENARIO.name} 副本`, existingNames)
  const otherNames = existingNames.filter((name) => name !== scenario.name)

  const openDialog = (kind: 'create' | 'rename' | 'delete', trigger: 'select' | 'button') => {
    dialogTrigger.current = trigger
    setDialog(kind)
  }

  const closeDialog = () => {
    setDialog(null)
    const target =
      dialogTrigger.current === 'select' ? selectRef.current : createButtonRef.current
    window.setTimeout(() => target?.focus(), 0)
  }

  const onScenarioChange = (value: string) => {
    if (value === '__create__') {
      openDialog('create', 'select')
      return
    }
    if (value === '__rename__') {
      openDialog('rename', 'select')
      return
    }
    if (value === '__delete__') {
      openDialog('delete', 'select')
      return
    }
    switchScenario(value)
  }

  const onDelete = () => {
    if (deleteScenario(scenario.id)) closeDialog()
  }

  const onImport = async (file: File | undefined) => {
    if (!file) return
    const text = await file.text()
    importScenario(text)
  }

  return (
    <>
      <header className="topbar">
      <div className="topbar-brand">
        <div className="eyebrow">TypeSafe · System One</div>
        <h1 className="topbar-title">Jev Decision Studio</h1>
        <p className="topbar-subtitle">多步决策编排 · 请求与响应的可视化编辑</p>
      </div>

      <div className="topbar-controls">
        <div className="topbar-status" title={health ? `${health.baseUrl} · ${health.proxy ?? '直连'}` : '正在连接本地服务'}>
          <span
            className={`topbar-dot ${health ? (health.keyConfigured ? 'is-ok' : 'is-warn') : 'is-idle'}`}
          />
          <span>
            {health ? (health.keyConfigured ? 'API Key 已配置' : '缺少 API Key') : '连接中'}
          </span>
          {health?.proxyConfigured ? <span className="topbar-proxy">代理</span> : null}
        </div>

        <div className="topbar-field">
          <span>场景</span>
          <div className="topbar-scenario-row">
            <select
              ref={selectRef}
              className="select"
              aria-label="场景"
              value={scenario.id}
              onChange={(event) => onScenarioChange(event.target.value)}
            >
              {!knownScenario ? (
                <option value={scenario.id}>{scenario.name}（未保存）</option>
              ) : null}
              <optgroup label="内置模板">
                {PRESETS.map((preset) => (
                  <option key={preset.id} value={preset.id}>
                    {preset.name}
                  </option>
                ))}
              </optgroup>
              {customScenarios.length > 0 ? (
                <optgroup label="我的场景">
                  {customScenarios.map((custom) => (
                    <option key={custom.id} value={custom.id}>
                      {custom.name}
                    </option>
                  ))}
                </optgroup>
              ) : null}
              <optgroup label="场景管理">
                <option value="__rename__" disabled={running || isPreset}>
                  重命名当前场景…
                </option>
                <option value="__delete__" disabled={running || isPreset}>
                  删除当前场景…
                </option>
              </optgroup>
              <option value="__create__" disabled={running}>
                创建新场景…
              </option>
            </select>
            <button
              ref={createButtonRef}
              className="btn btn-icon topbar-new-scenario"
              type="button"
              title={running ? '请先停止运行再创建场景' : '创建新场景'}
              aria-label="创建新场景"
              disabled={running}
              onClick={() => openDialog('create', 'button')}
            >
              <Plus size={16} strokeWidth={1.5} />
            </button>
          </div>
        </div>

        <label className="topbar-field">
          <span>模型</span>
          <select
            className="select"
            value={scenario.model}
            onChange={(event) => setModel(event.target.value)}
          >
            {!modelNames.includes(scenario.model) ? (
              <option value={scenario.model}>{scenario.model}</option>
            ) : null}
            {modelNames.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        </label>

        {totalInput > 0 ? (
          <span className="topbar-cost mono" title="当前场景累计输入 token 与估算费用">
            {totalInput.toLocaleString()} tok · {formatCost(totalInput)}
          </span>
        ) : null}

        <div className="topbar-actions">
          <button
            className="btn btn-ghost"
            type="button"
            onClick={() => fileInput.current?.click()}
            title="导入场景 JSON"
          >
            <Upload size={15} strokeWidth={1.5} />
            导入
          </button>
          <button
            className="btn btn-ghost"
            type="button"
            onClick={() => downloadJson(scenario.name, scenario)}
            title="导出场景 JSON"
          >
            <Download size={15} strokeWidth={1.5} />
            导出
          </button>
          <button
            className={`btn btn-ghost ${logOpen ? 'is-active' : ''}`}
            type="button"
            onClick={() => setLogOpen(!logOpen)}
            title="运行日志"
          >
            <PanelBottom size={15} strokeWidth={1.5} />
            日志
            {resultCount ? <span className="btn-badge">{resultCount}</span> : null}
          </button>
          {running ? (
            <button className="btn btn-stop" type="button" onClick={stop}>
              <Square size={14} strokeWidth={1.5} />
              停止
            </button>
          ) : (
            <button className="btn btn-primary" type="button" onClick={() => void runAll()}>
              <Play size={15} strokeWidth={1.6} />
              运行全部
            </button>
          )}
        </div>
      </div>

      <input
        ref={fileInput}
        className="visually-hidden"
        type="file"
        accept="application/json,.json"
        onChange={(event) => {
          void onImport(event.target.files?.[0])
          event.target.value = ''
        }}
      />
      </header>

      <ScenarioNameDialog
        open={dialog === 'create'}
        title="创建新场景"
        description={
          <>
            以「{DEFAULT_SCENARIO.name}」为母版复制 {DEFAULT_SCENARIO.nodes.length}{' '}
            个节点与全部依赖，之后可独立修改。
          </>
        }
        confirmLabel="创建场景"
        initialName={suggestedName}
        existingNames={existingNames}
        failureMessage="创建失败，请稍后重试。"
        icon={<Copy size={17} strokeWidth={1.5} />}
        onClose={closeDialog}
        onSubmit={createScenario}
      />

      <ScenarioNameDialog
        open={dialog === 'rename'}
        title="重命名场景"
        description={<>只修改名称，不改动「{scenario.name}」的节点与依赖。</>}
        confirmLabel="保存名称"
        initialName={scenario.name}
        existingNames={otherNames}
        failureMessage="重命名失败，请稍后重试。"
        inputId="scenario-rename"
        icon={<PencilLine size={17} strokeWidth={1.5} />}
        onClose={closeDialog}
        onSubmit={(name) => renameScenario(scenario.id, name)}
      />

      <DeleteScenarioDialog
        open={dialog === 'delete'}
        name={scenario.name}
        onClose={closeDialog}
        onConfirm={onDelete}
      />
    </>
  )
}
