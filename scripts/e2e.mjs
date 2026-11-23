/**
 * 本地交互验收：用 Helium（Chromium）打开开发页面，运行完整 DAG，
 * 检查节点状态、结果视图、请求 JSON 与控制台错误。
 *
 * 前置：`pnpm dev` 已启动；`node scripts/e2e.mjs`
 */
import { chromium } from 'playwright-core'

const BASE = process.env.STUDIO_URL || 'http://127.0.0.1:5173'
const EXECUTABLE = process.env.HELIUM_BIN || '/usr/bin/helium-browser'

const browser = await chromium.launch({
  executablePath: EXECUTABLE,
  headless: true,
  args: ['--no-sandbox', '--disable-gpu'],
})
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } })
const errors = []
const warnings = []
page.on('console', (message) => {
  if (message.type() === 'error') errors.push(message.text())
  if (message.type() === 'warning') warnings.push(message.text())
})
page.on('pageerror', (error) => errors.push(String(error)))

try {
  await page.goto(BASE, { waitUntil: 'networkidle', timeout: 30_000 })
  await page.screenshot({ path: '/tmp/jev-e2e-initial.png' })

  const title = await page.title()
  const nodeCount = await page.locator('.step-card').count()
  console.log(`title: ${title}`)
  console.log(`nodes: ${nodeCount}`)

  await page.getByRole('button', { name: /运行全部/ }).click()
  await page.waitForFunction(
    () => document.querySelectorAll('.step-state--success').length >= 4,
    undefined,
    { timeout: 90_000 },
  )
  await page.waitForTimeout(600)
  await page.screenshot({ path: '/tmp/jev-e2e-run.png' })

  const states = await page.locator('.step-state').allTextContents()
  console.log(`states: ${states.join(' | ')}`)

  await page.getByText('处置汇总', { exact: true }).first().click()
  await page.getByRole('tab', { name: '结果', exact: true }).click()
  await page.waitForTimeout(300)
  await page.screenshot({ path: '/tmp/jev-e2e-result.png' })

  await page.getByRole('tab', { name: '请求 JSON', exact: true }).click()
  await page.waitForTimeout(300)
  const requestText = await page.locator('.json-tree').first().innerText()
  console.log(
    `request has upstream: ${requestText.includes('upstream')} · resolved department: ${requestText.includes('技术')}`,
  )
  await page.screenshot({ path: '/tmp/jev-e2e-request.png' })

  if ((await page.locator('.runlog').count()) === 0) {
    await page.getByRole('button', { name: /日志/ }).click()
  }
  await page.waitForTimeout(500)
  const logText = await page.locator('.runlog').innerText()
  console.log(`runlog mentions cost: ${logText.includes('$')} · rows: ${await page.locator('.runlog-row').count()}`)
  await page.screenshot({ path: '/tmp/jev-e2e-log.png' })

  // 关闭日志，测试新增节点、连线、变量插入、删除与导出。
  await page.getByTitle('收起').click()
  await page.waitForTimeout(400)
  await page.getByRole('button', { name: /添加步骤/ }).first().click()
  await page.waitForTimeout(500)
  console.log(`nodes after add: ${await page.locator('.step-card').count()}`)

  await page.getByRole('button', { name: /自动布局/ }).click()
  await page.waitForTimeout(900)
  await page.locator('.react-flow__node[data-id="n5"]').click()
  await page.waitForTimeout(300)

  const source = page.locator('.react-flow__node[data-id="n1"] .react-flow__handle.source')
  const target = page.locator('.react-flow__node[data-id="n5"] .react-flow__handle.target')
  const from = await source.boundingBox()
  const to = await target.boundingBox()
  if (from && to) {
    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2)
    await page.mouse.down()
    await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 14 })
    await page.mouse.up()
    await page.waitForTimeout(400)
  }
  console.log(`graph stats after connect: ${(await page.locator('.gx-stats').innerText()).replace(/\n/g, ' ')}`)
  await page.locator('.react-flow__node[data-id="n5"]').click()
  await page.getByRole('tab', { name: '编辑', exact: true }).click()
  await page.waitForTimeout(300)

  const varTrigger = page.locator('.insp-var-trigger').first()
  console.log(
    `inspector node: ${await page.locator('.insp-node-id').first().innerText().catch(() => 'none')} · triggers: ${await varTrigger.count()} · disabled: ${(await varTrigger.count()) ? await varTrigger.isDisabled() : 'n/a'}`,
  )
  if ((await varTrigger.count()) > 0 && !(await varTrigger.isDisabled())) {
    await varTrigger.click()
    const menuItems = await page.locator('.insp-var-item').count()
    console.log(`variable menu items: ${menuItems}`)
    if (menuItems > 0) {
      await page.locator('.insp-var-item').first().click()
      console.log(
        `state contains template: ${(await page.locator('.insp-state-text').inputValue()).includes('{{')}`,
      )
    }
  } else {
    console.log('variable menu unavailable')
  }

  await page.getByRole('button', { name: '删除节点' }).click()
  await page.waitForTimeout(500)
  console.log(`nodes after delete: ${await page.locator('.step-card').count()}`)

  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 10_000 }),
    page.getByRole('button', { name: /导出/ }).click(),
  ])
  console.log(`download: ${download.suggestedFilename()}`)
  await page.screenshot({ path: '/tmp/jev-e2e-edited.png' })

  // 回归：先在另一个场景里打开原始 JSON 与 State 的 JSON 模式，
  // 再创建新场景——新场景的编辑器不能沿用上一个场景的草稿。
  await page.locator('.topbar-scenario-row select').selectOption('content-review')
  await page.waitForTimeout(500)
  await page.locator('.react-flow__node[data-id="n1"]').click()
  await page.waitForTimeout(250)
  await page.getByRole('tab', { name: '编辑', exact: true }).click()
  await page.getByRole('button', { name: '原始 JSON', exact: true }).click()
  await page.locator('.insp-mode-btn', { hasText: 'JSON' }).click()
  await page.waitForTimeout(250)

  // 创建新场景：以「客服工单分流」为母版复制，并验证刷新后仍存在。
  await page.locator('.topbar-new-scenario').click()
  await page.waitForTimeout(250)
  const prefilled = await page.locator('#scenario-name').inputValue()
  await page.locator('#scenario-name').fill('我的工单场景')
  await page.getByRole('button', { name: '创建场景', exact: true }).click()
  await page.waitForTimeout(600)
  console.log(
    `create dialog default: ${prefilled} · scenario id: ${await page.locator('.topbar-scenario-row select').inputValue()}`,
  )
  const staleRaw = await page.locator('.insp-raw').count()
  const staleMode = await page.locator('.insp-mode-btn[aria-pressed="true"]').innerText()
  const questionIds = await page
    .locator('.insp-q-id')
    .evaluateAll((nodes) => nodes.map((node) => node.value))
  console.log(
    `fresh editors after create: raw panels ${staleRaw} · state mode ${staleMode} · questions ${questionIds.join(',')}`,
  )
  console.log(
    `created nodes: ${await page.locator('.step-card').count()} · first node: ${await page.locator('.step-title').first().innerText()}`,
  )
  console.log(
    `preset options: ${await page.locator('.topbar-scenario-row optgroup[label="内置模板"] option').count()} · custom options: ${await page.locator('.topbar-scenario-row optgroup[label="我的场景"] option').count()}`,
  )
  await page.screenshot({ path: '/tmp/jev-e2e-created.png' })

  // 编辑自定义场景 -> 切到内置模板 -> 切回，确认修改被保留。
  await page.locator('.insp-title-input').fill('改过的工单理解')
  await page.locator('.topbar-scenario-row select').selectOption('resume-screen')
  await page.waitForTimeout(400)
  await page.locator('.topbar-scenario-row select').selectOption({ label: '我的工单场景' })
  await page.waitForTimeout(400)
  console.log(
    `edit preserved after switch: ${(await page.locator('.insp-title-input').inputValue()) === '改过的工单理解'}`,
  )

  await page.reload({ waitUntil: 'networkidle' })
  await page.waitForTimeout(700)
  console.log(
    `after reload: ${await page.locator('.topbar-scenario-row select option:checked').innerText()} · nodes: ${await page.locator('.step-card').count()} · title: ${await page.locator('.insp-title-input').inputValue()}`,
  )
  await page.screenshot({ path: '/tmp/jev-e2e-scenario.png' })

  // 回归：内置模板的编辑在刷新后回到模板内容（与切换场景一致）。
  await page.locator('.topbar-scenario-row select').selectOption('support-triage')
  await page.waitForTimeout(400)
  await page.locator('.insp-title-input').fill('预设被改')
  await page.waitForTimeout(200)
  await page.reload({ waitUntil: 'networkidle' })
  await page.waitForTimeout(700)
  console.log(
    `preset after reload: ${await page.locator('.topbar-scenario-row select option:checked').innerText()} · title: ${await page.locator('.insp-title-input').inputValue()} · custom options: ${await page.locator('.topbar-scenario-row optgroup[label="我的场景"] option').count()}`,
  )

  // 场景管理：重命名（含重名拦截）与删除自定义场景。
  await page.locator('.topbar-scenario-row select').selectOption({ label: '我的工单场景' })
  await page.waitForTimeout(400)
  await page.locator('.topbar-scenario-row select').selectOption('__rename__')
  await page.waitForTimeout(300)
  const renamePrefill = await page.locator('#scenario-rename').inputValue()
  await page.locator('#scenario-rename').fill('简历初筛')
  console.log(
    `rename duplicate blocked: ${await page.getByRole('button', { name: '保存名称' }).isDisabled()}`,
  )
  await page.locator('#scenario-rename').fill('重命名后的场景')
  await page.getByRole('button', { name: '保存名称' }).click()
  await page.waitForTimeout(400)
  console.log(
    `renamed: prefill ${renamePrefill} · current ${await page.locator('.topbar-scenario-row select option:checked').innerText()} · nodes ${await page.locator('.step-card').count()}`,
  )

  await page.locator('.topbar-scenario-row select').selectOption('__delete__')
  await page.waitForTimeout(300)
  const deleteText = await page.locator('.modal-panel').innerText()
  await page.getByRole('button', { name: '删除场景', exact: true }).click()
  await page.waitForTimeout(500)
  console.log(
    `after delete: ${await page.locator('.topbar-scenario-row select option:checked').innerText()} · custom options ${await page.locator('.topbar-scenario-row optgroup[label="我的场景"] option').count()} · confirm named scene: ${deleteText.includes('重命名后的场景')}`,
  )
  await page.screenshot({ path: '/tmp/jev-e2e-manage.png' })

  // 逻辑步：第四个示例「退款审批」。
  await page.locator('.topbar-scenario-row select').selectOption('refund-gate')
  await page.waitForTimeout(900)
  console.log(
    `logic preset: cards ${await page.locator('.step-card').count()} · logic cards ${await page.locator('.step-card--logic').count()} · chips ${(await page.locator('.step-card--logic .step-chips').innerText()).replace(/\n/g, ' + ')}`,
  )

  await page.locator('.react-flow__node[data-id="n2"]').click()
  await page.waitForTimeout(400)
  console.log(`logic tabs: ${(await page.locator('.insp-tab').allInnerTexts()).join(' | ')}`)
  const outputIds = await page
    .locator('.insp-logic-card .insp-q-id')
    .evaluateAll((nodes) => nodes.map((node) => node.value))
  console.log(`logic outputs: ${outputIds.join(',')} · cards ${await page.locator('.insp-logic-card').count()}`)

  // 运行逻辑步（会先运行上游 n1），让变量菜单可用。
  await page.getByRole('button', { name: '运行此节点' }).click()
  await page.waitForFunction(
    () => document.querySelector('.react-flow__node[data-id="n2"] .step-state--success') !== null,
    undefined,
    { timeout: 120000 },
  )
  await page.waitForTimeout(500)
  const logicExpr = page.locator('.insp-logic-expr').first()
  const originalExpr = await logicExpr.inputValue()
  console.log(
    `logic run: summary ${(await page.locator('.step-card--logic .step-summary').innerText()).replace(/\n/g, ' + ')} · preview ${(await page.locator('.insp-logic-value').first().innerText().catch(() => 'none'))}`,
  )

  await page.locator('.insp-logic-card .insp-var-trigger').first().click()
  await page.waitForTimeout(250)
  const varItems = await page.locator('.insp-var-item').count()
  if (varItems > 0) await page.locator('.insp-var-item').first().click()
  console.log(
    `logic variable insert: items ${varItems} · inserted ${(await logicExpr.inputValue()).includes('{{')}`,
  )

  await logicExpr.fill(`${originalExpr} AND`)
  await page.waitForTimeout(300)
  console.log(`logic syntax error: ${await page.locator('.insp-logic-error').first().innerText()}`)
  await page.getByRole('button', { name: /运行全部/ }).click()
  await page.waitForTimeout(400)
  const blockToast = await page.locator('.toast').last().innerText().catch(() => 'none')
  console.log(`logic run blocked: ${blockToast.includes('错误')}`)

  // 改成常量表达式，得到确定性的门控结果。
  await logicExpr.fill('1 > 0')
  await page.locator('.insp-logic-expr').nth(1).fill('1 < 0')
  await page.waitForTimeout(400)
  await page.getByRole('button', { name: /运行全部/ }).click()
  await page.waitForFunction(
    () =>
      document.querySelectorAll('.step-state--success, .step-state--skipped').length >= 4 &&
      document.querySelector('.step-state--running') === null,
    undefined,
    { timeout: 120000 },
  )
  await page.waitForTimeout(600)
  const statusOf = async (id) =>
    (await page.locator(`.react-flow__node[data-id="${id}"] .step-state`).innerText()).trim()
  console.log(
    `deterministic gates: n2 ${await statusOf('n2')} · n3 ${await statusOf('n3')} · n4 ${await statusOf('n4')}`,
  )

  if ((await page.locator('.runlog').count()) === 0) {
    await page.getByRole('button', { name: /日志/ }).click()
  }
  await page.waitForTimeout(500)
  const gateNote = await page.locator('.runlog-note').first().innerText().catch(() => 'none')
  console.log(`gate note: ${gateNote}`)
  await page.screenshot({ path: '/tmp/jev-e2e-logic.png' })
  await page.getByTitle('收起').click()
  await page.waitForTimeout(400)

  // 条件边面板
  await page.locator('.react-flow__edge[data-id="e-n2-n3"]').click({ force: true })
  await page.waitForTimeout(500)
  const panel = page.locator('.gx-edge-panel')
  console.log(`edge panel: ${await panel.count()} · mode ${await panel.locator('select').first().inputValue()}`)
  await panel.locator('select').first().selectOption('always')
  await page.waitForTimeout(500)
  console.log(`edge mode after always: ${await panel.locator('select').first().inputValue()}`)
  await panel.locator('select').first().selectOption('true')
  await page.waitForTimeout(500)
  console.log(`edge mode restored: ${await panel.locator('select').first().inputValue()}`)
  await page.screenshot({ path: '/tmp/jev-e2e-edge.png' })

  // 从工具栏添加逻辑步，单独运行（纯本地、无 API 调用），再删除。
  await page.getByRole('button', { name: '添加逻辑步', exact: true }).click()
  await page.waitForTimeout(700)
  console.log(
    `added logic: cards ${await page.locator('.step-card').count()} · logic ${await page.locator('.step-card--logic').count()} · title ${await page.locator('.insp-title-input').inputValue()}`,
  )
  await page.locator('.insp-logic-expr').first().fill('1 > 0')
  await page.waitForTimeout(400)
  await page.getByRole('button', { name: '运行此节点' }).click()
  await page.waitForFunction(
    () => document.querySelectorAll('.step-card--logic .step-state--success').length >= 2,
    undefined,
    { timeout: 30_000 },
  )
  await page.waitForTimeout(300)
  console.log(
    `standalone logic: summary ${(await page.locator('.step-card--logic .step-summary').last().innerText()).replace(/\n/g, ' + ')}`,
  )
  await page.getByRole('button', { name: '删除节点' }).click()
  await page.waitForTimeout(400)
  console.log(`logic removed: cards ${await page.locator('.step-card').count()}`)

  console.log(`console errors: ${errors.length} · warnings: ${warnings.length}`)
  for (const error of errors.slice(0, 8)) console.log(`  - ${error}`)
  for (const warning of warnings.slice(0, 5)) console.log(`  ! ${warning}`)
  if (errors.length > 0) process.exitCode = 2
} finally {
  await browser.close()
}
