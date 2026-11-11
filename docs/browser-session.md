# 浏览器连接与会话管理

WorkBuddy 启动入口为 `boss browser-session --json`。就绪后该后台任务不持有 CDP 连接，使用同一调试端点的 HTTP 存活回执跟踪 Chrome。Windows 本机可运行 `node scripts/test-browser-session-lifecycle.mjs`，使用独立端口和目录观察断开 CDP 后至少 120 秒。

## 架构概览

```
src/browser/
├── cdp_browser.ts      # Chrome 启动 + CDP 连接
├── browser_session.ts  # 浏览器/页面引用 & 会话生命周期
└── timing.ts           # sleep / random 工具

src/common/
└── boss_session_page.ts  # Boss 页面壳：导航、侧栏检测、安全拦截
```

## 连接流程

### 1. 启动与连接

- 在支持跨轮次存活的宿主运行公开命令 `boss browser-session --json`。端口明确未监听时启动 Chrome，已有会话通过专用配置目录回执核验。收到 `ready` 后保持该宿主任务运行。
- automation 每轮调用 `preflight --json`，再由业务命令连接同一端口。端点不可用时报告失败，启动职责归常驻任务。
- Chrome 的生命周期取决于启动它的宿主。多层子进程、`detached` 和 `unref()` 无法保证 Chrome 跨宿主回收存活。若后台任务随每轮 automation 回收，应在用户独立桌面会话或宿主提供的持久服务里启动常驻任务。

### 2. ensureBrowserSession() — `src/browser/browser_session.ts`

```
ensureBrowserSession()
  │
  ├── browserRef 已连接 & pageRef 活着
  │    ├── page URL 是 about:blank → pickOrCreatePage 换到 zhipin 页面
  │    └── 直接返回（复用现有会话）
  │
  ├── browserRef 已连接 & pageRef 死了
  │    └── pickOrCreatePage 重新选页
  │
  └── browserRef 断开
       └── establishSession()
            ├── 断开旧 browser 连接
            ├── connectBrowser()
            ├── 等待首个 page target 就绪（不把 browser_ui 当作页面），再枚举现有标签
            ├── pickOrCreatePage(browser)
            │    ├── 优先 zhipin.com 页面
            │    ├── 其次任何非 about:blank 页面
            │    └── 最后 newPage()
            └── 关掉多余的 blank 页面
```

### 3. withBossSessionPage() — `src/common/boss_session_page.ts`

```
withBossSessionPage(callback)
  │
  ├── ensureBrowserSession()           ← 获取健康的浏览器+页面
  ├── getPageRef() / pickExistingPage  ← 确认为 zhipin.com 页面
  ├── page.bringToFront()
  │
  ├── page.evaluateOnNewDocument()     ← 页面级防御：
  │   ├── navigator.webdriver → undefined
  │   ├── navigator.plugins → 模拟3个Chrome插件
  │   ├── navigator.languages → ['zh-CN','zh','en']
  │   ├── window.chrome 对象 mock
  │   ├── window.close() → no-op
  │   ├── history.back() → no-op
  │   ├── history.go(n<0) → 阻止
  │   ├── Location.assign/replace → 拦截风险 URL:
  │   │     about:blank
  │   │     /web/common/403.html
  │   │     /web/common/nonsupport.html
  │   │     /web/user/safe/verify-slider
  │   │     /web/passport/zp/* / /web/passport/cm/*
  │   ├── beforeunload / unload 事件阻止
  │   ├── window.closed → 始终 false
  │   └── console.clear() / clear() / window.console 替换入口 → 默认锁住
  │
  ├── CDP 拦截（每条命令重新建立）：
  │   ├── Network.setCacheDisabled     ← 禁用 HTTP 缓存
  │   └── Fetch.enable patterns:       ← 请求阶段拦截安全文件、风险跳转和检测上报
  │        *zhipin-security/web/boss/*       (aegis_bg.wasm, index.js)
  │        *zhipin-boss*risk-detection*      (risk-detection.js)
  │        *bosszhipin.com/static/zhipin/geek/sdk/*  (browser-check等)
  │        *logapi.zhipin.com/dap/api/json*  (返回 204)
  │        *apm-fe.zhipin.com/wapi/zpApm/*   (返回 204)
  │        */web/passport/*                  (阻断风控跳转)
  │
  ├── framenavigated 主框架守卫       ← 若落到 about:blank / 403 / verify / passport，则回到沟通页
  │
  ├── page.goto(BOSS_CHAT_INDEX_URL)   ← 强制导航到沟通页
  ├── ensureMenuListStableAfterLoad    ← 等侧栏稳定
  └── callback(page)                   ← 执行具体命令（list/chat等）
```

## 跨命令复用

常驻宿主启动一次 `browser-session --json` 并保留其任务 ID。首次登录使用 `login --json`。每轮 automation 通过 `preflight --json` 核验已存在的会话，后续业务命令共用同一端口和专用用户数据目录。业务命令结束时释放其连接，保留常驻任务。

## Windows 桌面测试启动器

在资源管理器双击仓库根目录的 [start-test-cdp.cmd](../start-test-cdp.cmd)。脚本使用本地构建和仓库配套 Skill，通过公开的 `browser-session --json` 启动可见 Chrome。测试端口为 `127.0.0.1:53471`，测试配置及运行目录位于 `output/test-cdp/`。启动器只启动浏览器会话，无页面导航步骤。

窗口输出 `ready` 后保持打开，后续 `alive` 回执用于观察测试 Chrome 是否持续存活。跨两次 automation 测试时，核对回执的 PID 和端口，并把测试轮次的 `BOSS_BROWSER_REMOTE_DEBUGGING_PORT` 设为 `53471`。结束时关闭测试 Chrome 窗口，常驻命令检测到端口退出后结束。

## 调试注意事项

### 2026-10-14 CLI 退出后的浏览器存活验证

在沙箱外执行源码公开入口 `node dist/cli/index.js login --json`，设置独立 `BOSS_BROWSER_REMOTE_DEBUGGING_PORT=53471` 和 `BOSS_BROWSER_USER_DATA_DIR=D:\document\boss-cli\output\todo-chrome-lifecycle\profile`，与原浏览器隔离。CLI PID 16884 正常退出（0），未使用持续运行的 CLI 或 sleep 保活。

退出后的 22:16:49、22:16:57、22:17:15（北京时间）检查均显示监听 PID 22300，启动时间为 22:16:37，启动参数包含该独立目录和 `--remote-debugging-port=53471`，`/json/version` 返回同一个有效 CDP WebSocket 地址。Chrome 154.0.8037.98、Node 22.17.0、Windows；说明此环境下 CLI 退出后 Chrome/CDP 至少持续存活至最后一次检查，不保证所有启动环境的行为。

本地证据保存在 `output/todo-chrome-lifecycle/{stdout.log,stderr.log,snapshots.json}`（忽略提交）。复现时使用未占用端口及独立目录，通过公开 browser-session 命令启动，以监听 PID、进程创建时间、参数和 `/json/version` 联合核验；仅有窗口不能证明 CDP 存活。实验观察结束后仅清理该独立测试进程。

Boss 主包中存在反 DevTools / 反篡改逻辑，可能通过 `console.log` / `console.table` 副作用、`console.clear()`、快捷键拦截、打印大对象耗时、原生对象完整性检查等方式判断 DevTools 是否打开。

自动化命令执行时，不建议手动打开页面 DevTools。需要排查页面行为时，优先使用 CDP 事件、Network initiator、外部日志或截图；如果必须打开 DevTools，应预期页面可能触发检测上报、清空控制台、跳转、隐藏页面或关闭/回退页面。
