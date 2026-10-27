# boss-cli — Boss直聘自动化 CLI | 批量发消息 · 自动打招呼 · AI Agent 招聘工具

[![npm version](https://img.shields.io/npm/v/@joohw/boss-cli)](https://www.npmjs.com/package/@joohw/boss-cli)
[![npm downloads](https://img.shields.io/npm/dm/@joohw/boss-cli)](https://www.npmjs.com/package/@joohw/boss-cli)
[![license](https://img.shields.io/github/license/joohw/boss-cli)](./LICENSE)
[![GitHub stars](https://img.shields.io/github/stars/joohw/boss-cli)](https://github.com/joohw/boss-cli)

官网主页：[boss-cli.com](https://boss-cli.com)

本机 WorkBuddy 招聘流程交接：[执行手册与逐步命令](docs/workbuddy-recruitment-runbook.md)。

**boss-cli**（`@joohw/boss-cli`）是开源的 **Boss直聘自动化命令行工具**。基于 Puppeteer / CDP 协议驱动本机 Chrome，无需 Selenium，把 Boss直聘 B 端的核心 HR 操作搬进终端：**候选人列表**、**批量发消息**、**自动打招呼**、**在线简历预览**、**深度搜索**、**职位管理**。

适合 HR 日常提效，也适合 Claude / GPT / Gemini 等 **AI Agent** 通过子进程调用，搭建全自动化招聘流水线。

```bash
npm install -g @joohw/boss-cli@latest
boss login
boss help
```

> 纯 CLI，不内置对话式 Agent。当前 `dev` 分支的命令默认输出文本；`boss list --json` 和 `boss download-resume` 提供 JSON，便于 Agent 编排。

---

## 为什么选择 boss-cli？

| 场景 | 命令 |
| --- | --- |
| Boss直聘批量发消息 | `boss send --text "..."` 配合脚本循环 |
| Boss直聘自动打招呼 | `boss greet <姓名> [--job <岗位>]` |
| Boss直聘候选人筛选 | `boss list` / `boss list --unread` |
| Boss直聘脚本自动化 | 本机 Chrome + CDP，Cookie 本地存储 |
| AI 招聘 Agent | 子进程调用，输出 Agent 友好 |
| 数据隐私 | 不经过第三方服务器，数据在 `~/.boss-cli/` |

---

## 安装

**要求**：Node.js ≥ 20，本机已安装 Chrome / Chromium。

```bash
npm install -g @joohw/boss-cli@latest
boss help
```

上面安装的是 npm 已发布版本。当前 `dev` 分支新增的联合键、附件下载等命令尚未通过 npm 发布；在本仓库中使用这些改动时，需从源码构建并运行：

```bash
npm ci
npm run build
node dist/cli/index.js help
```

下文新增命令以当前 `dev` 分支为准。

如果你觉得 boss-cli 好用，欢迎给本仓库一个 Star；使用中遇到问题请提交 Issue，新功能或改进也欢迎提交 PR。

> **macOS / Linux 权限问题**：系统 Node 默认全局前缀在 `/usr/local`，当前账户无写权限。建议先把全局前缀挪到用户目录（一次性配置）：
>
> ```bash
> mkdir -p ~/.npm-global
> npm config set prefix ~/.npm-global
> echo 'export PATH=~/.npm-global/bin:$PATH' >> ~/.zshrc   # bash 用 ~/.bash_profile
> source ~/.zshrc
> ```
>
> 使用 `fnm` / `nvm` / `volta` 的用户可跳过此步。Windows 用户无需此步。

---

## 命令一览

| 命令 | 说明 |
| --- | --- |
| `boss login` | 打开 Boss直聘登录页（扫码/验证后手动完成） |
| `boss collect --job <岗位完整名称> [--ledger-dir <目录>]` | 候选人处理流程的起点：启动常驻岗位账本，检查恢复状态；停止时发送 stop 写回 |
| `boss update` | 通过 npm 安装最新版 boss-cli |
| `boss list [--unread] [--chatting] [--json]` | 读取聊天列表；`--chatting` 选“沟通中”，`--json` 包含显示名称、`data-id` 和当前沟通职位 |
| `boss chat <姓名> [--strict]` | 打开指定候选人会话 |
| `boss chat [姓名] --index <序号> [--unread] [--strict]` | 按 `boss list` 输出序号打开会话；同名候选人建议用序号 |
| `boss chat <姓名> --data-id <会话ID>` | 按显示名称和会话 `data-id` 联合定位 |
| `boss accept-resume <姓名> --data-id <会话ID>` | 在指定会话同意接收附件简历，不发送文字消息 |
| `boss download-resume <姓名> --data-id <会话ID> [--output-dir <目录>]` | 下载已收到的原附件，返回文件路径、大小和 SHA-256 |
| `boss send --text <内容> [--name <姓名> --data-id <会话ID>]` | 向当前会话发送；指定联合键时先核对收件人 |
| `boss action <操作>` | 索要简历 / 不合适 / 备注 / 交换微信等 |
| `boss recommend [岗位关键字]` | 读取推荐候选人列表 |
| `boss search [关键词]` | 常规搜索牛人列表 |
| `boss greet <姓名> [--job <岗位>]` | 在当前推荐/深度搜索页对候选人打招呼（不会自动跳转） |
| `boss preview <姓名>` | 在线简历预览（每日次数有限） |
| `boss deep-search [岗位关键字] [--core <要求>] [--bonus <加分项>] [--clear-core] [--clear-bonus] [--match]` | 深度搜索表单状态；`--core` / `--bonus` 可重复，并按传入列表同步分组；`--clear-*` 清空分组；默认不输出候选列表，`--match` 输出最新 20 条 |
| `boss positions` | 读取职位列表 |
| `boss jd <名称>` | 抓取职位 JD 缓存到本地 |

完整用法：`boss help`

---

## 快速上手

完成登录、确认岗位后，先启动岗位账本会话：

```bash
# 1. 登录
boss login

# 2. 启动 collect，保持进程及 stdin 打开
boss collect --job "前端工程师"
```

等待 collect 返回 `ok:true,event:started`，核对岗位及 recoveryRequired，再发送 `{"op":"show"}`。若需要恢复，先等待人工触发 reconcile 并完成全量逐项对账。以下独立 CLI 命令由另一个终端或外部编排器串行调用；与 collect 的轮次不得并发操作页面。读取的新候选人需先 add 到该账本，再按流程处理，结束时向 collect 发送 `{"op":"stop"}` 并等待 stopped。完整协议见 [岗位账本](docs/collection-ledger.md)。

```bash
# 3. 查看未读候选人，并将本岗位新候选人加入 collect 账本
boss list --unread

# 4. 根据流程核对发送条件后，打开会话并发送消息
boss chat 张三
boss send --text "您好，请问方便发一下简历吗？"

# 同名或姓名定位失败时，按 list 序号打开；--unread 对应 list --unread 的序号
boss chat --index 2 --unread
boss chat 张三 --index 2 --unread --strict

# 5. 先进入推荐页，再在当前页打招呼
boss recommend 前端工程师
boss greet 张三 --job 前端工程师

# 6. 常规搜索牛人
boss search "langgraph"

# 7. 深度搜索：按传入列表同步分组条件，但不消耗匹配次数
boss deep-search --core "AI产品经理" --core "做过 RAG 或 Agent 产品落地" --bonus "有 ToB 平台经验"

# 只有明确添加 --match 才会点击「立即匹配」，会消耗今日匹配次数，并只输出最新 20 条
boss deep-search --match
```

---

## 与 AI Agent 集成

boss-cli 可由外部 Agent 通过子进程编排。首先启动并保持 collect 会话，检查账本恢复状态后才进入候选人流程。采集附件使用会话联合键，并核对列表中的当前沟通职位：

```
1. boss collect --job <岗位完整名称>                  → 保持常驻进程，等待 started，核对 recoveryRequired
2. 向 collect 发送 show                              → 读取账本；需要恢复时等待人工 reconcile 完成
3. boss list --chatting --json                       → 获取姓名、data-id、沟通职位，将本岗位新候选人 add 入账
4. 向 collect 逐条发送 round / decision              → 按已有进度探测、记录筛选结果并下载；FAIL 直接移出账本
5. 按监督流程执行获准的后续动作                       → 核对附件与发送证据；RECHECK 候选人暂停，等待人工复查
6. 向同一 collect 发送 stop                          → 等待 stopped，确认账本写回后结束
```

详见 [岗位账本与流程起点](docs/collection-ledger.md) 和 [AGENTS.md](./AGENTS.md)。

---

## 常见问题

**boss-cli 是什么？**
开源 Boss直聘自动化 CLI，用终端命令代替手动操作 Boss直聘网页，支持 AI Agent 编排。

**和 Selenium / Playwright 有什么区别？**
boss-cli 基于 CDP 连接本机 Chrome，复用已有登录态，针对 Boss直聘 B 端页面做了专用封装，开箱即用。

**需要额外下载浏览器吗？**
不需要。使用本机已安装的 Chrome / Chromium，通过 CDP 协议连接。

**数据会上传到服务器吗？**
不会。Cookie 和缓存仅存储在本地 `~/.boss-cli/`，CLI 不经过任何第三方服务器。

**如何无头模式运行？**
设置环境变量 `BOSS_BROWSER_HEADLESS=true`（默认 headful，便于扫码登录）。

**如何实时查看列表命令的操作步骤？**
设置 `BOSS_CLI_TRACE=true` 后运行 `boss login` 或 `boss list --chatting`（源码构建版用 `node dist/cli/index.js` 加相应子命令）。浏览器窗口会显示页面操作，终端会依次显示连接、进入页面、选择筛选、滚动扫描和完成状态；步骤日志写到 stderr，`--json` 的 stdout 仍可单独解析。该开关目前覆盖登录和列表命令，不包含其他命令的内部步骤。

**如何自定义操作蒙层品牌？**
设置环境变量 `BOSS_CLI_AGENT_BRAND=你的品牌名`。

---

## 数据目录

| 路径 | 内容 |
| --- | --- |
| `~/.boss-cli/.cache/` | Cookie、浏览器用户数据 |
| `~/.boss-cli/jd/` | `boss jd` 缓存的岗位描述 |
| `~/.boss-cli/resume-files/` | `boss download-resume` 默认保存的原附件 |

---

## 开发

```bash
npm run build   # 编译到 dist/
npm run dev     # build + 交互模式
```

提交前维护两份日志：

- [功能变化日志](./CHANGELOG.md) 纳入 Git。每次提交新增一条，记录该提交的用户可见功能变化；仅改文档或维护配置时写明“无用户可见功能变化”。
- 开发日志位于 `docs/development-log.md`，由 `.gitignore` 排除，仅保留在本地。每次提交新增一条，记录改动文件、实现要点、验证结果及未完成项；其中的简历或账号信息不应写入日志。

现有日志从 2026-10-02 的两次 Boss CLI 提交开始记录；更早的提交历史以 `git log` 为准。新增提交应在提交前同时更新两份日志，提交主题可先作为条目标识，提交后再补充哈希。

---

## 发布

### npm 包

仓库通过 GitHub Actions 自动发布 npm 包，工作流文件是 `.github/workflows/tag-publish.yml`。

发布新版本时，本地只需要更新 `package.json` 版本号、提交代码、创建并推送 `v*` tag：

```bash
git tag -a v0.6.0 -m "v0.6.0"
git push origin main
git push origin v0.6.0
```

tag 推送后，workflow 会自动安装依赖、构建、检查 npm 版本、发布 `@joohw/boss-cli`、更新 `latest` dist-tag，并创建或更新 GitHub Release。npm 发布依赖仓库 Secret `NPM_TOKEN`，本地不需要手动执行 `npm publish`。

### 官网前端

`landing/` 使用 Next.js 静态导出，并由 Cloudflare Workers Static Assets 托管。推送到 `main` 后，Cloudflare Workers Builds 会自动构建并发布官网。

Cloudflare Workers Builds 配置：

- Worker：`boss-cli`
- Root directory：`landing`
- Build command：`npm run build`
- Deploy command：`npx wrangler deploy`
- Production branch：`main`

静态资源目录与自定义域名由 `landing/wrangler.jsonc` 管理。生产域名为 `boss-cli.com`，部署不依赖 GitHub Actions 或仓库中的 Cloudflare API Secret。

---

## 许可

[GPL-3.0](./LICENSE)

---

## 相关链接

- 官网：[boss-cli.com](https://boss-cli.com)
- npm：[@joohw/boss-cli](https://www.npmjs.com/package/@joohw/boss-cli)
- GitHub：[joohw/boss-cli](https://github.com/joohw/boss-cli)
- 问题反馈：[Issues](https://github.com/joohw/boss-cli/issues)

## 本地招聘调用说明

当前调用语法、参数、前置条件、返回结果与停止规则见[逐项调用手册](skills/boss-recruitment/references/invocation-guide.md)。岗位名、城市、薪资与会话岗位的区分，以及collect常驻stdin协议均在手册中明确。
