# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目概览

Better Jev Pipeline 是 TypeSafe Jev（System One）的**本地编排客户端**，不是模型权重部署：

- 浏览器 React 应用（`src/`）通过 Vite 代理访问本地 Express 服务（`server/index.ts`），由服务端携带 API Key、经本地 HTTP 代理调用 `api.typesafe.ai`。
- 直连 `api.typesafe.ai` 会返回 **451**，必须走 `127.0.0.1:7892` 代理（`TYPESAFE_PROXY`）。
- API Key 只存在于 `.env` 与服务端进程。浏览器永远拿不到；不要打印 `.env` 内容，也不要提交它。
- 服务端只监听 `127.0.0.1`；生产模式同时托管 `dist/`。

## 常用命令

```bash
pnpm install
pnpm dev                 # 同时启动 Express(8791) 与 Vite(5173)
pnpm dev:server          # 只启动本地代理
pnpm dev:web             # 只启动前端
pnpm test                # 全量 Vitest
pnpm exec vitest run src/lib/logic-builder.test.ts
pnpm exec vitest run src/lib/logic-builder.test.ts -t "NAND"
pnpm test:watch
pnpm exec tsc --noEmit   # 类型检查（仓库没有单独的 lint 脚本）
pnpm build               # tsc --noEmit && vite build
pnpm start               # 生产：Express 在 8791 托管 dist 与 /api
pnpm smoke               # 真实 API 冒烟（需先 pnpm dev:server，会消耗少量 token）
```

- 开发入口 <http://127.0.0.1:5173>，生产入口 <http://127.0.0.1:8791>。
- `.env` 从仓库根加载，至少需要 `TYPESAFE_API_KEY`；`TYPESAFE_PROXY` 不能省。
- 修改 `PORT` 时同步修改 `vite.config.ts` 的 proxy target。

浏览器交互验收（真实 API，需先启动应用）：

```bash
pnpm dev
node scripts/e2e.mjs
STUDIO_URL=http://127.0.0.1:5174 HELIUM_BIN=/path/to/chromium node scripts/e2e.mjs
```

默认浏览器是可执行文件 `/usr/bin/helium-browser`（playwright-core，不下载浏览器）。E2E 会真实调用 Jev，消耗少量 token。

## 架构

### 三层数据流

1. **组件层** `src/components/*`：React Flow 画布 + 右侧检查器。`GraphCanvas` 负责节点、连线与条件边面板；`Inspector` 按节点类型分发到 API 编辑或逻辑构建器；`StepNode` 渲染卡片摘要。
2. **领域层** `src/lib/*`：纯函数为主。`store.ts`（zustand + localStorage）持有场景、结果与运行状态；`runner.ts` 按拓扑序执行；`request.ts` 把内部模型转成 Jev 请求；`api.ts` 调本地 `/api/*`。
3. **服务层** `server/index.ts`：`/api/health`、`/api/models`、`/api/systemone`，注入 Bearer Key；对 429/5xx 最多重试 3 次（指数退避），单次请求 120s 超时，JSON 上限 8MB。

执行链：`runAll` → `topoOrder` → 每个节点检查父节点成功与条件边 → `buildRequest`（模板 + 上游）→ `POST /api/systemone` → 结果写回 store → 画布 / 检查器 / 运行日志。`runNode` 会先补跑该节点的祖先子集。

### 数据模型与兼容性

- `src/lib/types.ts`：`Scenario { nodes, edges }`；`StepNode = ApiStepNode | LogicStepNode`（`kind?: 'api'`，缺省视为 api）；`Edge.when?: { output, equals }` 只允许逻辑步作为源；`RunRecord` 记录 request / response / outputs / inputs / status / ms / tokens。
- **旧场景与旧导出必须继续可加载**：`kind` 缺省为 api、`graph` 缺省为文本、`when` 缺省为总是。新增字段必须同步 `schema.ts`（zod 会剥掉未声明的键），并在导入时归一化；逻辑输出的图形结构由 `normalizeLogicOutputs` 守卫。
- `store.ts` 只持久化 `scenario` 与 `customScenarios`（key `jev-decision-studio`）。内置模板的编辑是会话级的，刷新或切换会恢复模板；只有自定义场景保留修改。运行结果不入 localStorage。
- 模板：`{{节点.问题.字段}}`。整个字符串恰好是占位符时保留原始类型，嵌在文本中时字符串化；只能引用祖先节点（`validate.ts` 检查）；每个直接上游的 `answers` 注入 `state.upstream`，逻辑父节点注入 `outputs`。

### 逻辑步（两套表示）

- `src/lib/logic.ts`：手写词法 / Pratt 解析器，**禁止 eval / new Function**。支持引用、数字/字符串/布尔、比较、算术、`AND/OR/XOR/NAND/XNOR/NOT`（及 `&& || !`）、括号；带静态类型推断与运行时求值；输出必须是布尔；表达式上限 2000 字符。
- `src/lib/logic-builder.ts`：可视化结构 `BuilderNode`（group / compare / bool，节点带稳定 id）与 DSL 的双向转换、格式化、结构校验、引用目录。关键不变量：
  - `LogicOutput.graph` 存在时是权威结构，`expression` 是同步缓存 / 导出文本。执行统一走 `logicOutputExpression(output)`，不要再加第二套求值器；校验走 `checkBuilderNode`。
  - 文本编辑会清除 `graph`；切回图形时重新解析。图形→文本会格式化（NAND/XNOR 归一化为 `NOT (...)`，语义不变）。
  - 只有「同连接词且未取反」的子组可以摊平；NAND/XNOR 链不能摊平，否则会改变语义。
  - 字符串只转义反斜杠与双引号，不要用 `JSON.stringify`（DSL 词法器不认 `\n` / `\u`）。
  - 引用目录与 `refTypeInScenario` 共用 `questionRefFields`；只列/用祖先字段；概率键必须符合 `SAFE_PATH_SEGMENT`。
  - 上限：200 节点 / 32 层。不完整树格式化为空串，由 `checkBuilderNode` 给出行级错误并阻止运行。
- 条件边：`Edge.when` 不满足时下游 `skipped`，note 写明具体条件，并继续向后代传播。逻辑步本身是本地计算，不发 API 请求，也不产生 token。

### 校验与运行

- `src/lib/validate.ts` 是运行前的唯一闸门：图、逻辑、模板、条件边、环都会检查；`runAll` / `runNode` 只看 `errorCount`。图形输出用结构校验，文本输出用 `checkLogicExpression`。
- 运行语义：顺序拓扑执行；任一父节点非 success 或条件边不满足 → skipped；API 失败只阻塞其下游；支持停止（AbortController）。
- `src/lib/request.ts` 负责内部问题模型 → Jev `questions` 的映射（choice / score 的 criteria、noul、box）与上游注入。`box` 保留在数据模型中，但首版没有图片输入。

### UI 约定

- 中文界面、无 emoji、学术蓝白配色；颜色与字体只使用 `src/styles/tokens.css` 的 token。
- 检查器固定 438px（窄屏 408px）。逻辑步页签只有「编辑 / 结果」；图形构建器的值编辑器在卡片内展开，不要用绝对定位浮层（会被滚动容器裁剪）。
- 画布右下角保留 React Flow attribution；条件边用虚线 + `输出 = 真/假` 标签。

## 测试与验收

- 单测与源码同目录：`src/lib/*.test.ts`。`runner.test.ts` 通过 `vi.mock('./api')` 隔离网络；`logic.test.ts` 覆盖 DSL，`logic-builder.test.ts` 覆盖结构转换 / 格式化 / 校验，`schema / validate / scenarios / store` 覆盖兼容与持久化。
- `scripts/e2e.mjs` 覆盖 4 节点工单、场景管理、退款审批逻辑构建器、文本/图形往返、条件门控、独立逻辑步与控制台零错误；它会真实调用 API。
- `pnpm smoke` 真实跑默认工单 DAG，校验模板 / 上游 / 响应结构，费用约 $0.0001。
- 如果仓库里存在 `.claude/worktrees/` 下的 worktree，Vitest 默认会把它里面的测试也扫进来；在主工作区跑干净的主干测试时可加 `--exclude '**/.claude/**'`。

## 关键文件

| 文件 | 职责 |
| --- | --- |
| `server/index.ts` | 本地代理、鉴权、重试、生产静态托管 |
| `src/lib/types.ts` | 场景 / 节点 / 边 / RunRecord / API 类型 |
| `src/lib/runner.ts` | 拓扑执行、门控、失败 / 跳过传播 |
| `src/lib/request.ts` + `template.ts` + `scope.ts` | 请求构建、模板解析、祖先作用域 |
| `src/lib/logic.ts` + `logic-builder.ts` | DSL 解析 / 求值、图形构建器双向转换与校验 |
| `src/lib/validate.ts` + `schema.ts` | 运行前校验、导入 / 导出 |
| `src/lib/store.ts` + `scenarios.ts` + `presets.ts` | zustand 状态、场景管理、四个内置示例 |
| `src/components/GraphCanvas.tsx` / `Inspector.tsx` / `LogicBuilder.tsx` | 画布、检查器、结构化逻辑编辑器 |
| `scripts/e2e.mjs` / `scripts/smoke.ts` | 浏览器验收、真实 API 冒烟 |

README.md 是面向用户的功能与排错说明；改行为时同步更新它和 E2E 验收项。
