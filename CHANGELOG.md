# 功能变化日志

按提交记录面向使用者的功能变化。新提交在提交前新增条目；若提交只涉及文档、构建或维护配置，也需注明“无用户可见功能变化”。历史记录从 2026-10-02 开始，更早提交以 Git 历史为准。

## 2026-10-04 · feat: show live steps for login and candidate list

- 设置 `BOSS_CLI_TRACE=true` 后，`boss login` 和 `boss list` 会在终端实时输出浏览器连接、页面切换、筛选与列表扫描等步骤；不设置时保持原有输出。
- 步骤日志使用 stderr，`boss list --json` 的 stdout 格式不变。

## 2026-10-02 · docs: document source setup and per-commit logs

- 无用户可见功能变化；README 增加当前 `dev` 分支运行说明，并建立受 Git 跟踪的功能变化日志和仅本地保存的开发日志。

## 2026-10-02 · `f6a79d8` · Add targeted Boss resume collection commands

- `boss list --chatting --json` 输出“沟通中”会话的显示名称、`data-id`、当前沟通职位等结构化信息。
- `boss chat`、`boss accept-resume`、`boss download-resume` 支持按显示名称和 `data-id` 联合定位；身份不一致时停止操作。
- `boss download-resume` 下载原附件并返回保存路径、文件大小和 SHA-256；指定目标的 `boss send` 在发送前后核对会话并确认页面出现新消息。

## 2026-10-02 · `3bc77d2` · Disable Boss CLI resume OCR calls

- 在线简历截图不再调用 Boss CLI 内置 OCR；截图仍可保存并返回路径。
