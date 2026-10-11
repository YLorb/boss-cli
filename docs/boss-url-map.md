# Boss URL 与功能对照

本文件记录 boss-cli 已知页面 URL、对应命令和当前位置要求。修改页面导航、命令入口或报错文案前，先对照这里，避免把某个命令改成隐式跳转或多路径兜底。

## 页面 URL

| URL / Path | 页面功能 | 相关命令 | 当前行为 |
| --- | --- | --- | --- |
| `https://www.zhipin.com/web/user/?ka=header-login` | 登录入口 | `boss login` | 直接打开登录页，交还给人工扫码/验证。 |
| `/web/chat/index` | 沟通列表、候选人会话页 | `boss list [--unread] [--chatting] [--json]`、`boss chat <姓名>`、`boss chat [姓名] --index <序号> [--unread]`、`boss chat <姓名> --data-id <会话ID>`、`boss accept-resume <姓名> --data-id <会话ID>`、`boss download-resume <姓名> --data-id <会话ID> [--output-dir <目录>]`、`boss send [--name <姓名> --data-id <会话ID>]`、`boss action` | `list --chatting` 明确选择顶部「沟通中」，`--json` 输出会话行 `data-id` 和当前沟通职位；联合键命令会在顶部「全部」查找并核对详情。`accept-resume` 仅点击当前候选人的附件请求卡片并等待附件到达；`download-resume` 要求附件已经收到，打开预览并经 Boss 下载按钮保存原文件。指定目标的 `send` 在发送前后核对会话并确认新消息出现在页面。传统 `send` / `action` 仍要求当前会话已打开。 |
| `/web/chat/recommend` | 推荐候选人列表 | `boss recommend`、`boss preview <姓名>`、`boss greet <姓名>` | `recommend` 会先检查当前位置，不在该页时直接进入；`preview` / `greet` 要求当前已在该页且列表已加载。 |
| `/web/chat/aiform` | 深度搜索 / Agent 搜索 | `boss deep-search [--core <要求>] [--bonus <加分项>] [--clear-core] [--clear-bonus] [--match]`、`boss preview <姓名>`、`boss greet <姓名>` | `deep-search` 会先检查当前位置，不在该页时直接进入；默认只输出招聘要求表单、核心要求、加分项、今日剩余匹配次数和按钮状态，不输出候选列表；`--core` / `--bonus` 可重复，并按传入列表同步对应分组（多余行会删除，不足会新增），`--clear-core` / `--clear-bonus` 清空对应分组；只有 `--match` 会消耗今日匹配次数并输出列表顶部最新 20 条；`preview` / `greet` 要求当前已在该页且列表已加载。 |
| `/web/chat/search` | 常规搜索 | `boss search [关键词]`、`boss preview <姓名>` | `search` 会先检查当前位置，不在该页时直接进入；带关键词时填入搜索框并回车搜索；`preview` 要求当前已在该页且列表已加载，不支持 `--job`。 |
| `/web/chat/job/list` | 职位管理列表 | `boss positions`、`boss jd <name>` | 可通过侧栏进入职位管理页后读取。 |

## 约定

- 所有业务命令支持 `--json`：`login/list/chat/action/accept-resume/download-resume/send/positions/jd/recommend/search/deep-search/preview/greet`。默认文本行为保留，`download-resume` 默认已输出 JSON；JSON 字段与用法见 [CLI JSON 输出](cli-json-output.md)。JSON 模式 stdout 仅输出一个结果，日志走 stderr，参数或执行失败输出 JSON 错误并返回非零退出码。
- `chat --data-id --json` 在身份核对后读取人才摘要、当前已加载的消息和附件存在标记；默认文本仍仅输出定位确认。`jd --json` 继续保存和复用 Markdown，返回正文、文件路径与 `cache/page` 来源，不解析 Markdown 或强制刷新。

- 联合键定位前会关闭当前可见的附件预览（`.resume-detail-chat` 内的 `iframe.attachment-iframe` 或 `img` 所属弹层），防止预览遮挡会话列表；原附件下载成功并完成完整性校验后也会收起该预览，支持连续调用。图片预览会等待图片加载完成，再通过同一 Boss 下载按钮保存原文件；图片预览地址不提供 `geekId`，返回值为 `null`，会话仍通过姓名和 `data-id` 核对。
- 当前 URL 校验优先于 DOM 猜测。命令依赖特定页面时，先检查 path，再执行页面读取或点击。
- 不为高风险操作添加隐式兜底跳转。需要用户处于特定页面的命令，应直接报出当前 URL 与目标 URL。
- 页面入口发生变化时，同步更新本文件和相关命令 help 文案。
- `boss action resume` 与 `boss preview` 当前只保存并返回在线简历截图路径；Boss CLI 的截图 OCR 调用已关闭，不自动解析简历。
- `data-id` 是 Boss 页面会话行标识；联合键使用候选人显示名称和 `data-id`，两者不一致时停止操作。附件预览地址出现的 `geekId` 单独返回，但尚不作为定位主键。
