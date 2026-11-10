# boss-cli 入门说明

> 面向新接手者的快速上手文档。用大白话讲清楚：这个项目是什么、怎么装、怎么跑、结构长什么样、会踩什么坑、出了问题怎么反馈。

---

## 1. 项目是什么

**boss-cli** 是一个命令行工具，让 AI Agent（比如 WorkBuddy）能自动操作 BOSS直聘网页，完成**招聘全流程**：

- **收集（collect）**：批量浏览候选人简历，按你给的 JD 和标准逐份评估、落账；
- **推荐（recommend）**：处理 BOSS 推荐的候选人列表；
- **搜索寻访（search）**：按城市、岗位、关键词搜索候选人，逐个查看、评估、触达；
- **触达（greet / chat / send）**：打招呼、发求简历话术、收简历；
- **OCR**：把简历截图识别成文字，供评估；
- **账本（ledger）**：跨对话保存岗位、候选人结论，避免重复处理。

一句话：**它把「招人要看几百份简历、逐个打招呼」这件重复劳动，交给脚本去自动执行**，同时用「权限、阶段、逐人闭环」三道闸保证每一步都在你的授权范围内、不越界、不重复。

它不是独立浏览器，而是**驱动本机 Chrome 的控制器**。运行需要：

- 能跑 shell 的 Agent（WorkBuddy等）
- Node.js
- Chrome

代码位置：`https://github.com/YLorb/boss-cli`（**你可以从这里的 dev 分支获取到最新的版本或者补丁版本**）

当前版本：CLI `0.6.20-dev.1`，配套 Skill `1.0.29`

---

## 2. 怎么安装

> **默认方式：让 Agent 帮你装。** 你不需要手动敲命令——只要对 Agent 说一句「帮我装好 boss-cli」，Agent 会自己完成下面的全过程。

Agent 会按 `skills/boss-recruitment/references/install.md` 执行：

1. 检查 Node.js / npm 是否就绪，缺了会**先征得你同意**，再由它从 `https://nodejs.org/` 下载配置；
2. 从 GitHub 取源码（**只从 `https://github.com/YLorb/boss-cli` 的 tag 或固定提交取，不从 npm 拉包**）；
3. 装依赖 + 编译：`npm ci` → `npm run build`；
4. 把 `skills/boss-recruitment/` 文件夹交给宿主的 Skill 导入机制（这就是让 Agent 能「按规范操作」的那份说明书）；
5. 跑 `node .\dist\cli\index.js version-check --json` 核验版本配套。

装完后，可执行入口是 `dist/cli/index.js`，日常由 Agent 用 `node dist/cli/index.js <命令>` 调用（`package.json` 里 `bin.boss = dist/cli/index.js`）。

> 如果你**手动**安装，本质也是这三步——clone/下载源码 → `npm ci` → `npm run build`（详见 install.md 的「GitHub 标签 ZIP 下载」一节，无需 Git 也能装）。

> 不要用 `npm install -g @joohw/boss-cli`，也不要依赖 `boss update` 升级——它们对应的是 npm 发布版，可能与源码能力不一致，且不会同步本机源码。

---

## 3. 运行环境

| 项目 | 要求 |
|---|---|
| Node.js | v22（实测 `v22.22.2`） |
| npm | 10.x（实测 `10.9.7`） |
| TypeScript | 通过 `npm install` 带入，target ES2022 / module NodeNext |
| 浏览器 | Chrome（通过 CDP 远程调试连接，端口如 `53470`） |
| 登录态 | 你自己的 BOSS直聘已登录会话 |
| 系统 | Windows（开发在本机 Windows + Git Bash 环境） |

关键依赖（`package.json`）：

- `puppeteer-core` —— 连接并驱动本机 Chrome（CDP）；
- `pngjs` —— 简历截图处理；
- `dotenv` —— 读取 `.env` 环境变量。

**环境变量**（运行时要设的）：

| 变量 | 作用 |
|---|---|
| `BOSS_BROWSER_REMOTE_DEBUGGING_PORT` | Chrome 的 CDP 调试端口（如 `53470`） |
| `BOSS_SKILL_DIR` | 本次实际加载的 Skill 绝对目录 |
| `BOSS_RUN_ID` / `BOSS_TASK_CONFIG` | 指定哪个 run / 哪个 task 配置 |
| `BOSS_CLI_TRACE` | 输出只读诊断信息到 stderr |

---

## 4. 项目架构

### 4.1 顶层目录

```
boss-cli/
├── src/            # TypeScript 源码
│   ├── cli/        # 命令路由、参数解析、权限(permit)、阶段状态(phase)、运行绑定(run)
│   ├── toolset/    # 各业务命令实现：collect/recommend/search/greet/chat/send/ocr/jd...
│   ├── browser/    # 浏览器会话、CDP 连接、人工延迟、视口
│   ├── common/     # 简历抓取、OCR、页面守卫、动作历史、流程锁等公共能力
│   └── ocr/        # OCR 相关
├── skills/boss-recruitment/   # Skill（Agent 操作规范 + 命令手册）
│   ├── AGENTS.md              # Agent 每轮强制先读的上下文/执行边界
│   ├── SKILL.md               # Skill 入口（版本校验、SOP 约束）
│   └── references/            # 分主题手册：collect-sop / search-sop / cli-reference / install ...
├── scripts/        # 测试脚本（test-*.mjs）
├── docs/           # 项目文档（问题排查、URL 对照、开发日志等）
├── dist/           # 编译产物（tsc 输出）
└── landing/        # 官网落地页
```

### 4.2 核心机制（理解这三点就懂了 80%）

**① 权限（permit）—— 每一步都要被授权**
命令按 `entry`（`collect` / `recommend` / `search` / `view-only`）划分权限，且必须与 task 的 `scope` 一致。`jd`、`search` 等敏感能力都需显式授权，否则 deny。

**② 阶段状态（phase-state）—— 逐人闭环，禁止重放**
记录 `paused`（全局暂停）、`pending`（未决动作）、`decisions`（评估结论）、`observed`（已查看名单）、`contacts`（已触达名单）。评估结论落账后，**该人的触达必须紧接着完成**，不得攒批。任何有副作用的动作（send/greet 等）会查动作历史，防止重复。

**③ 运行绑定（run-state）—— 版本校验 + 任务一致性**
`run` 记录 `cliVersion`、`taskFile`、`taskHash`。启动时校验 CLI 与 Skill 的配套版本，不一致就停止等确认；任务配置被改动导致 `taskHash` 不匹配也会报「任务配置已改变或错绑」。

### 4.3 命令一览（常用）

| 命令 | 作用 |
|---|---|
| `boss version-check --json` | 启动前版本校验（强制） |
| `boss task-check / task-init` | 写任务配置、初始化本轮 |
| `boss phase-status --json` | 读取当前阶段状态 |
| `boss collect / recommend / search` | 三种寻访入口 |
| `boss preview <姓名> --candidate-id <ID>` | 打开候选人完整简历 |
| `boss ocr <截图路径>` | 简历截图转文字 |
| `boss decide --verdict fit/not-fit` | 记录评估结论 |
| `boss greet / chat / send` | 打招呼、开会话、发消息 |
| `boss flow-resume / flow-status` | 解除暂停、看流程锁 |

完整命令与页面 URL 对照见 `skills/boss-recruitment/references/cli-reference.md` 和 `docs/boss-url-map.md`。

---

## 5. 运行示例

以一个「搜索轮评估 + 触达」的最小闭环为例（搜索后训练平台工程师岗位）：

```bash
# 0. 设环境变量（Chrome 已开，CDP 端口 53470）
export BOSS_BROWSER_REMOTE_DEBUGGING_PORT=53470
export BOSS_SKILL_DIR=/path/to/skills/boss-recruitment

# 1. 启动前版本校验（每次必做）
node dist/cli/index.js version-check --json

# 2. 初始化本轮任务
node dist/cli/index.js task-check --json
node dist/cli/index.js task-init --json

# 3. 搜索：设城市 + 岗位 + 关键词，提交
node dist/cli/index.js search --city "深圳" --json
node dist/cli/index.js search --job "后训练平台工程师" --json
node dist/cli/index.js search --submit --json

# 4. 打开某位候选人完整简历，核验身份
node dist/cli/index.js preview "杨**" --candidate-id "89fc..." --json

# 5. OCR 识别简历文字，评估
node dist/cli/index.js ocr "C:\...\preview-杨__-xxx.png" --layout boss-online-resume --json

# 6. 记录结论
node dist/cli/index.js decide --candidate-id "89fc..." --verdict fit --json

# 7. 触达（先在简历内打开，再打招呼）
node dist/cli/index.js preview "杨**" --candidate-id "89fc..." --open-only --json
node dist/cli/index.js greet "杨**" --candidate-id "89fc..." --check --json

# 8. 发求简历话术、关窗
node dist/cli/index.js send --embedded --candidate-id "89fc..." --text "你好，方便发一份简历吗？" --json
node dist/cli/index.js chat --embedded --close --candidate-id "89fc..." --json
```

> 注意：`--candidate-id` 用每次 `preview`/`greet` 回执里核验通过的真实 ID，不要自己编。搜索页岗位名要传**下拉里显示的原文**（纯岗位名，不带城市/薪资）。

---

## 6. 目前遇到的问题及解决方案

> 这些是今天实际踩过的坑，按「症状 → 原因 → 解法」记录。更详细的多岗位收集排查见 `docs/multijob-collect-troubleshooting-2026-11-09.md`。

| 症状 | 原因 | 解决方案 |
|---|---|---|
| `greet --check` 返回 `false` | 这不是报错，是「当前不在可打招呼状态」——简历没在打开态 | 先 `preview --open-only` 保持简历打开，再 `greet --check` 返回 `true` |
| `chat --recommend --open` 报「内嵌会话身份/岗位不符：job」 | `--job` 传成了「岗位 _ 城市 薪资」，而小窗实际是纯岗位名 | 改传纯岗位名（如 `Harness工程师`） |
| `search --job "岗位 _ 城市"` 连续 8s 超时 | 搜索页下拉是纯岗位名，`pickOption` 精确匹配，带城市必超时 | 传不带城市的岗位名 |
| `recommend --job ...` 报 `❌ 用法` | recommend 只接受 `--check-job` / `--ensure-job` | 改用 `--ensure-job` |
| `--ensure-job` 报「冻结快照前必须核验岗位」 | 需先 `status` 核验 | 先跑 `status --json` 再 ensure-job |
| 报「运行绑定冲突」 | 多岗位共用同一浏览器会话，同时设了 `BOSS_TASK_CONFIG` 又依赖 `current.json` 指针 | 用 `BOSS_RUN_ID`（`--run <runId>`）覆盖指针，不再设 `BOSS_TASK_CONFIG` |
| 改 task 配置后报「任务配置已改变或错绑」 | `taskHash` 不匹配 | 改配置（如 `observeLimit`）时，用 CLI 内部 `loadTaskConfig`+`digest` 重算并同步写回 run 快照，别手工算 hash |
| 报「已到观察上限」 | `stop.observeLimit` 太小 | 提高该值，并按上一条同步 taskHash |
| 报「已到连续失败上限」 | `maxConsecutiveFailures` 太紧，诊断一次就撞顶 | 调大（如 8）+ `task-init` 重置 |
| `preview` 报「在线简历 iframe 不可见 / 高度滚动变化」 | 页面加载慢 | `flow-resume` + 稍等重试 |
| OCR 报「图片不是当前候选人截图」 | Git Bash 把 `C:\` 改写成 `C:/`，路径对不上 | 用 Python `subprocess.run` 传 argv 绕开 shell 路径改写 |
| `MSYS2_ARG_CONV_EXCL='*'` 报 `Cannot find module` | 该变量破坏 node 脚本路径 | 不要用该变量，改用 subprocess 传参 |
| `flow-resume` 报「未决动作尚未核验，不能解除暂停」且 `status` 也报暂停死锁 | pending 需读页面核验才能清、读页面需 resume、resume 需 pending 已清，三重死锁 | 已修复：`flow-resume` 只解暂停、保留 pending，重放仍由「动作结果未决」门拦截 |

**一句话经验**：遇到失败，**先怀疑操作方式和参数**，不要立刻认定是代码缺陷——很多「以前能跑、现在跑不了」的情况，是参数传错或漏了前置步骤，而不是代码坏了。

---

## 7. 如何报告错误（向 @Danny 反馈）

反馈时请按下面模板组织，**信息越全，定位越快**。宁可多贴原文，不要自己概括后丢掉关键字段。

### 7.1 必填信息

1. **你正在做什么**：一句话说明目标（例如「搜索轮给候选人发求简历话术」）。
2. **执行了什么命令**：完整命令原文（含所有参数、`--json` 等），不要省略。
3. **期望结果 vs 实际结果**：希望发生什么 / 实际发生了什么。
4. **原始报错全文**：直接粘贴 stderr / 回执原文，**不要翻译、不要截断**。
5. **环境**：CLI 版本、Skill 版本、Node 版本、Chrome 端口、是否多岗位共用会话。
6. **复现步骤**：如果可复现，写出最小步骤。
7. **当时的阶段状态**（可选但很有用）：`phase-status --json` 的关键字段（`paused`、`pending`、`decisions`、`observed`）。

### 7.2 反馈模板（直接复制填）

```
【现象】做什么 → 什么命令 → 期望什么 → 实际什么
【报错原文】（贴全文）
【环境】CLI= , Skill= , Node= , 端口= , 是否多岗位共用会话=
【已尝试】我试过哪些方法、结果如何
【阶段状态】paused= , pending= , 最近 decisions=
```

### 7.3 判断「该不该反馈」的参考

- **该反馈**：报错无法定位、同一命令反复失败、怀疑是代码缺陷、权限/阶段状态异常、`taskHash` 不匹配等。
- **先自查再反馈**：参数是否传对（岗位名带没带城市/薪资、ID 是否用回执里的真实值）、前置步骤是否漏了（`version-check`、`preview --open-only`、先 `status` 核验岗位）。
- **对外动作尤其要保守**：发送/打招呼/提交类命令如果报「未确认成功」，**不要推断已发生或未发生**，先核对状态再决定是否补做，并在反馈里如实说明「不确定是否已产生动作」。

---

## 附：相关文档索引

| 想了解什么 | 看哪份 |
|---|---|
| 启动与版本校验细节 | `skills/boss-recruitment/references/start-and-use.md` |
| 各命令完整用法 | `skills/boss-recruitment/references/invocation-guide.md` + `cli-reference.md` |
| 收集 / 推荐 / 搜索 SOP | `references/collect-sop.md` / `recommend-sop.md` / `search-sop.md` |
| 安装细节 | `references/install.md` |
| 环境准备 | `references/environment.md` |
| 页面 URL 与命令对应 | `docs/boss-url-map.md` |
| 问题排查（今天） | `docs/multijob-collect-troubleshooting-2026-11-09.md` |
| 开发日志 / 变更 | `docs/development-log.md` / `CHANGELOG.md` |
