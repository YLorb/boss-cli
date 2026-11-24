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

当前版本：CLI `0.6.21-dev.0`，配套 Skill `1.0.32`

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
| `BOSS_TASK_CONFIG` | 指向普通任务 JSON |
| `BOSS_CLI_TRACE` | 输出只读诊断信息到 stderr |

---

## 4. 项目架构

### 4.1 顶层目录

```
boss-cli/
├── src/            # TypeScript 源码
│   ├── cli/        # 命令路由、参数解析、版本校验、任务 JSON
│   ├── toolset/    # 各业务命令实现：collect/recommend/search/greet/chat/send/ocr/jd...
│   ├── browser/    # 浏览器会话、CDP 连接、人工延迟、视口
│   ├── common/     # 简历抓取、OCR、页面守卫、动作历史、流程锁等公共能力
│   └── ocr/        # OCR 相关
├── skills/boss-recruitment/   # Skill（Agent 操作规范 + 命令手册）
│   ├── AGENTS.md              # Agent 每轮强制先读的上下文/执行边界
│   ├── SKILL.md               # Skill 入口（版本校验、SOP 约束）
│   └── references/            # 分主题手册：collect-sop / search-sop / install ...
├── scripts/        # 测试脚本（test-*.mjs）
├── docs/           # 项目文档（问题排查、URL 对照、开发日志等）
├── dist/           # 编译产物（tsc 输出）
└── landing/        # 官网落地页
```

### 4.2 Agent 与 CLI 的职责

任务要求保存在一个普通 JSON。Agent 负责按 SOP 判断下一步、人数和停止条件。CLI 保留版本、参数、实际身份及重复联系检查，并把业务结果逐步追加到固定 JSONL，联系与发送另存动作前意图。

使用 BOSS_TASK_CONFIG 指定任务文件后可直接运行业务命令。task-check --json 是可选离线诊断。具体示例见 [任务 JSON](../skills/boss-recruitment/references/task-config.md)。

## 5. 运行示例

Agent 先将用户要求写入一个任务 JSON，固定结果文件路径，再按 SOP 串行调用。下面展示搜索查看与评估的独立命令，Agent 每步读取结果后决定下一步。

```bash
export BOSS_SKILL_DIR=/path/to/skills/boss-recruitment
export BOSS_TASK_CONFIG=/path/to/task.json

boss version-check --json
boss status --json

boss search --city "深圳" --json
boss search --job "后训练平台工程师" --json
boss search --keyword "用户提供的关键词" --json
boss search --submit --json

boss preview "当前卡片姓名" --candidate-id "当前卡片ID" --json
boss ocr "截图回执的绝对路径" --layout boss-online-resume --json
boss decide --candidate-id "当前卡片ID" --verdict fit --json
```

岗位、关键词和评估结论以用户要求及本人的材料为准。CLI 逐步保存工具结果，Agent 补充评估理由、计数与下一步。需要联系时按[搜索 SOP](../skills/boss-recruitment/references/search-sop.md)核验并执行获准动作，逐人完成后继续循环。

中断后读取原任务 JSON 和结果文件，核验未确认动作，从明确未完成的步骤继续。任务没有强制过期时间。


## 6. 目前遇到的问题及解决方案

> 这些是今天实际踩过的坑，按「症状 → 原因 → 解法」记录。更详细的多岗位收集排查见 `docs/multijob-collect-troubleshooting-2026-11-09.md`。

| 症状 | 原因 | 解决方案 |
|---|---|---|
| `greet --check` 返回 `false` | 这不是报错，是「当前不在可打招呼状态」——简历没在打开态 | 先 `preview --open-only` 保持简历打开，再 `greet --check` 返回 `true` |
| `chat --recommend --open` 报「内嵌会话身份/岗位不符：job」 | `--job` 传成了「岗位 _ 城市 薪资」，而小窗实际是纯岗位名 | 改传纯岗位名（如 `Harness工程师`） |
| `search --job "岗位 _ 城市"` 连续 8s 超时 | 搜索页下拉是纯岗位名，`pickOption` 精确匹配，带城市必超时 | 传不带城市的岗位名 |
| `recommend --job ...` 报 `❌ 用法` | recommend 只接受 `--check-job` / `--ensure-job` | 改用 `--ensure-job` |
| `--ensure-job` 报「冻结快照前必须核验岗位」 | 需先 `status` 核验 | 先跑 `status --json` 再 ensure-job |
| 改 task 配置后报「任务配置已改变或错绑」 | `taskHash` 不匹配 | 改配置（如 `observeLimit`）时，用 CLI 内部 `loadTaskConfig`+`digest` 重算并同步写回 run 快照，别手工算 hash |
| 报「已到观察上限」 | `stop.observeLimit` 太小 | 提高该值，并按上一条同步 taskHash |
| OCR 报「图片不是当前候选人截图」 | Git Bash 把 `C:\` 改写成 `C:/`，路径对不上 | 用 Python `subprocess.run` 传 argv 绕开 shell 路径改写 |
| `MSYS2_ARG_CONV_EXCL='*'` 报 `Cannot find module` | 该变量破坏 node 脚本路径 | 不要用该变量，改用 subprocess 传参 |

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
| 各命令完整用法 | `boss commands --json`（唯一权威用法源） |
| 收集 / 推荐 / 搜索 SOP | `references/collect-sop.md` / `recommend-sop.md` / `search-sop.md` |
| 安装细节 | `references/install.md` |
| 环境准备 | `references/environment.md` |
| 页面 URL 与命令对应 | `docs/boss-url-map.md` |
| 问题排查（今天） | `docs/multijob-collect-troubleshooting-2026-11-09.md` |
| 开发日志 / 变更 | `docs/development-log.md` / `CHANGELOG.md` |
