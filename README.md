# dsh-sidechat

DSH 侧会话插件：`/side` 与 `/btw` 在当前会话的 fork 中发起隔离子会话，**渲染在 DSH 原生右侧边栏（native right Sidebar）的标签页里**，而不是插件自绘的浮动面板。

功能与 [dsh-sidechain](https://github.com/omdsh-dev/dsh-sidechain) 对齐（Codex 风格 `/side` 持续侧会话 + Claude 风格 `/btw` 一次性侧问），区别只在呈现层：侧会话是原生 Sidebar 的一个 tab type，标签条、分屏、浮动、全屏、宽度、布局持久化、引导页入口全部由 DSH 自己提供。

| | dsh-sidechain | dsh-sidechat（本插件） |
|---|---|---|
| 面板 | 插件自绘 `position: fixed` 浮动面板 | 原生右侧边栏标签页（`ctx.sidebarRightTabs`） |
| 标签条 / 分屏 / 浮动 / 全屏 | 自绘（仅展开、拖宽） | 原生 dockkit 提供 |
| 布局持久化 | 自绘 localStorage 宽度 | 原生按 session 持久化 |
| 引导页入口 | 无 | 原生 guide 卡片 |
| 打开方式 | 头部按钮 / 快捷键 | 头部按钮、guide 卡片、命令卡片自动打开 |
| 会话列表 / 转录 / 输入框 | 自绘 | 自绘（tab body 内容，仍是插件代码） |
| 命令 | `/side`、`/btw`、`/side list` | 相同 |

## 安装

> **先停用 dsh-sidechain。** 两个插件注册同名命令 `/side` 与 `/btw`，DSH 的命令注册表对重名会直接抛错（`command "side" is already registered`）。在 **设置 → 插件** 里禁用 `@dsh-external/dsh-sidechain`，或执行：
>
> ```sh
> dsh plugin --profile web remove @dsh-external/dsh-sidechain
> ```

从本地目录安装（本仓库根目录就是插件包）：

```sh
dsh plugin --profile web add /absolute/path/to/dsh-side-chat
```

`dsh plugin add` 会把包链接进 profile，并把 `@local/dsh-sidechat` 追加到 `dsh.profile.bundles`。随后重启 `dsh web` 并强制刷新浏览器。

卸载：

```sh
dsh plugin --profile web remove @local/dsh-sidechat
```

## 使用

| 命令 | 用途 |
|---|---|
| `/btw <问题>` | 一次性侧问，后台跑完，答案流进侧边栏 |
| `/side <问题>` | 创建可续聊的侧会话 |
| `/side list` | 列出当前会话的直接子代理 |

- 命令成功后，原生侧边栏会自动展开并打开 **Side chat** 标签页，选中新建的子会话。自动打开只对"卡片亲眼看到从运行中变为成功"的命令生效；页面加载时已经结束的历史命令不会抢焦点，用卡片上的"在侧边栏打开"按钮手动打开。
- 会话标题栏的侧会话按钮（分支图标，带运行中数量角标）随时打开/切回该标签页。
- 侧边栏的引导页（guide）里有 **Side chat** 卡片，可从原生入口打开；快捷键 `⌘⇧E` / `Ctrl+Shift+E` 走同一个 `sidechat.open` 命令。
- 标签页内：列表显示当前会话的全部直接子代理（类型、标题、运行状态、活动摘要）；选中后显示完整时间线（用户消息、思考、上下文、工具调用与结果、Markdown/代码/表格/公式），`/side` 线程底部有输入框可继续对话，`/btw` 线程只读。
- 标签页可被拖到分屏、浮动、全屏，布局按 session 持久化——这些都是原生行为。

## 失败恢复

- 转录读取失败时保留上一次成功的内容，并在时间线顶部显示错误和重试按钮；下一次轮询或手动重试会补齐缺失的分页，不会把缺口当成完整历史。
- 切换子会话时，旧子会话的转录、文件提及和错误状态不会短暂显示在新视图里；旧请求返回后也不会覆盖新视图。
- 发送失败时保留用户输入；等待期间继续输入的内容不会被旧结果清空。连续点击发送只提交一次。
- 图片附件读取失败不会阻塞正文，下一次读取会重试。
- 子会话目录里存在但会话摘要尚未到达时，状态显示为未知而不是"已结束"，避免把运行中的子会话误报为完成。

## 架构

**Host 半**（`src/index.ts`，Node ESM）：

- `ctx.commands.register` 注册 `/side`、`/btw`；通过 `ctx.subagents.startActivation` 以 fork provider 创建子会话（继承父会话已完成回合作为参考上下文，不写入主会话历史）。
- `ctx.sessionProjections.register(sidechatModes)`：从 `command/done` 结果投影出每个子会话的命令身份（`side` / `btw`），因为 DSH 0.2.1 把新建本地子会话统一存为 `continuable`。
- `settle-silence`：阻止子会话的 report / settlement 通知进入父会话收件箱；子会话 id 持久化在 `$DSH_HOME/sidechat-children.json`。
- 可选 `readOnlyTools` 白名单（与 sidechain 相同）。

**Client 半**（`src/client/index.tsx`，浏览器 bundle）：

- `ctx.sidebarRightTabs.register({ id, kind: 'sidechat', keepMounted: true, title, guide })` —— 注册原生 Sidebar 的 tab type（page type，按 kind 打开）。
- `ctx.slots.register({ name: 'sidebar.right.pane.tab', key: ID, locale, inject }, SidechatTab)` —— 注册 tab body；body 从框架拿到 `sessionId`、`useSessions`、`useTabInfo()`，从 `inject` 拿到转录/活动/发送/刷新 RPC。
- `ctx.sidebarRight.openTab('sidechat', { params: { childId, mode } })` —— 命令卡片在命令 settle 后打开标签页并选中子会话；body 读 `tab.navigation.params` 完成选择。
- `conversation.chat.commandview` 注册 `/side`、`/btw` 命令卡片（含“在侧边栏打开”按钮）。
- `conversation.session.header.actions` 注册头部按钮。

数据面与 sidechain 相同：子会话成员来自 Session Controller 的 `subagentCatalog` 投影，转录通过 `ctx.remote.session` 的 `session.follow` 分页读取（在 fork seed 的 `session/end-seed` 处截断、丢弃 boundary prompt），运行中的子会话用轻量 tail 轮询近实时更新；续聊通过 `ctx.remote.subagents.prompt`。

## 开发

```sh
pnpm install
pnpm check   # typecheck + vitest + tsdown build
```

构建产物：`lib/index.js`（host 半）、`lib/client.js`（浏览器半，`window.__ModuleLoader__.load` 包装）、`lib/index.d.ts`。

## 验证记录

- `pnpm check`：类型检查通过；11 个测试文件、131 个用例通过（含 tab body 的 SSR 渲染测试：loading / empty / 列表 / 转录+输入框四种状态，以及转录分页连续性、跨子会话异步状态、自动打开条件、registry 原子写入等回归用例）。
- 在 workspace 内的临时 `DSH_HOME` 启动真实 `dsh web`（独立端口），安装本插件后：
  - 插件出现在浏览器 boot graph，`/plugins/??@local/dsh-sidechat/client.js` 返回 200；
  - 页面无 console error / pageerror；
  - 客户端 `apply` 执行，`ctx.sidebarRightTabs` 中注册出 `sidechat` tab type（与内置 `guide` 并列）；
  - 服务端 session 投影中出现 `sidechatModes`，证明 host 半已激活。
- 未做：在真实会话里用模型跑一次 `/side` 的端到端视觉验证（临时 home 没有模型凭据）。tab body 的渲染由 SSR 测试覆盖。
- 版本边界：开发依赖和实测只覆盖 DSH `0.2.1-rc.5`；`engines.dsh` 声明的 rc.2–rc.4 尚未逐版验证，属于声明范围而不是已验证矩阵。

## 限制

与 dsh-sidechain 相同：

- fork 不包含父会话正在进行的回合。
- DSH 0.2.1 把新建本地子会话统一存为 `continuable`；`/btw` 的只读身份由命令结果投影恢复，不是宿主层的不可续聊权限。
- `/side list` 与侧边栏列出当前会话的全部直接子代理，不限于本插件创建的线程。
- `/side` 必须带首个问题（subagent API 不支持创建后等待首次输入的空线程）。
- 自动打开依赖命令卡片观察到 pending → success；如果命令在卡片挂载前就已经结束，不会自动打开，需要手动点击卡片、头部按钮或 guide 卡片。

## 来源

派生自 [dsh-sidechain](https://github.com/omdsh-dev/dsh-sidechain)（BSD-3-Clause），保留其 host 半与转录数据层，客户端呈现层改写为原生 Sidebar tab。
