# CLI JSON 输出

业务命令加 `--json`，输出该功能已读取的字段和执行结果，供 Agent 自行分析。默认文本输出保留；`list --json` 和 `download-resume` 的现有 JSON 字段不改变。

```powershell
boss list --unread --json
boss chat 张袁僖 --data-id 580745010-0 --json
boss recommend "模型评估工程师" --json
boss search "模型评测" --json
boss deep-search --json
boss jd "模型评估工程师" --json
```

`--json` 是无值开关，可以放在业务命令之后的任意参数位置；不接受 `--json=true/false`。`--` 之后的参数是字面量；正文恰好是 `--json` 时使用 `--text=--json`。

## stdout 与失败

- 成功：stdout 输出一个 JSON 对象，每个命令使用自己的字段；没有统一的成功外壳，不反向解析中文结果。
- 失败：stdout 输出 `{"ok":false,"command":"chat","error":{"name":"CliError","message":"..."}}`，进程退出码为 1。错误名称和原始错误描述保留；尚未定义专门的业务错误码。
- 重名暂停：独立 `chat-search` 返回 `status=needs-confirmation,clicked=false,matches,groupCount,reason`；chat及指定对象的发送／附件／探测抛出 `CandidateSelectionRequired`，错误消息含完整匹配信息，退出码1。必须等待用户确认，不继续业务动作或改用滚动；collect暂停当前轮次，不写附件失败。
- 诊断日志、trace 写 stderr。JSON 模式跳过自动版本检查提示；退出码和结果必须一起判断。
- 交互开发模式也接受该开关，但提示符等属于交互界面。Agent 应调用一次性命令。
- `help/version/update` 与内部凭证命令不在业务 JSON 范围内。

## 各命令成功字段

| 命令 | 顶层字段 | 说明 |
| --- | --- | --- |
| `login` | `url,status` | status 为 `awaiting-manual-login`，不代表已登录 |
| `--check-login` | `url,status,loggedIn` | status 为 logged-in/logged-out/unknown，对应 loggedIn 为 true/false/null；正常检查退出 0，连接/页面错误退出 1。只读页面信号，不验证服务端会话有效期 |
| `list` | `category,filter,candidates` | 每行 `dataId,name,job,time,message,unreadCount` |
| `chat`（姓名、序号或 data-id） | `name,dataId,summary,messages,hasFriendResumeAttachment` | summary 保留摘要数组；messages 含 `text,time,from`；仅页面已加载内容 |
| `chat --embedded --close` | `status,closed,target,conversationId` | status 为 embedded-closed；核验目标身份及无草稿后仅关闭对应小窗一次，不导航；--close 与 --check 互斥 |
| `dismiss-contact-notice` | `status,clicked,target,contactConfirmed` | status 为 contact-notice-dismissed；只关闭已核验候选人的已知畅聊卡使用成功提示，不触达或打开聊天；不支持 --check |
| `recommend` | `job,candidates` | 每张实际卡片一项，保留 `geekId,name,salary,baseInfo,expect,experience,advantage,highlights,canGreet,hasHistoryChat,hasViewed`，新增work/education数组；缺失不阻止preview |
| `search` | `keyword,job,candidates` | `candidateId,name,active,labels,basicInfo,summary,tags,expectation,work,education,reason,contactText`；带关键词时等待本次响应并核验ID/查询标识，成功空数组才是零结果 |
| `deep-search` | `matched,form` | form 保留岗位、要求、剩余次数文字/数值、按钮文字和禁用状态 |
| `deep-search --match` | `matched,form,candidates` | candidates 含 `name,meta,work,edu,reason`，最新 20 条；排除“继续沟通”候选人 |
| `positions` | `jobs,totalText,url` | 每项 `id,title,label,status,meta,viewed,chatted,interested` |
| `jd` | `name,path,markdown,source` | 继续保存和复用 `.md`；source 为 `cache` 或 `page` |
| `accept-resume` / `action agree-resume` | `action,kind,which,target,attachmentReceived` | 返回 clicked，且已等到新附件卡片；已处理请求仍报错 |
| `download-resume` | `name,dataId,geekId,attachmentName,fileName,path,bytes,sha256` | 默认即 JSON；`--json` 同样接受；图片 geekId 为 null |
| `probe-resume` | `name,dataId,attachment,attachmentName,request,requestEvidence,scope,download` | 默认即 JSON；scope=loaded-messages；未观察到为 NOT_OBSERVED，不代表无附件或未发送；`--download` 才返回下载详情 |
| `preview` | `name,sourceUrl,job,path,type,ocr`，搜索／推荐另含candidateId、identityVerified | type 为 `online-resume-screenshot`，不是原附件或 OCR 结果；open-only仅搜索，见调用手册 |
| `action resume` | `action,name,path,type,ocr` | 同上，为在线简历截图 |
| `greet` | `source,name,message,status,candidates`，推荐页另含 `geekId,job,candidateId,identityVerified`；深度搜索另含 `jobKeyword` | 推荐status为clicked，只确认点击，不代表回复；搜索返回独立联系状态，见调用手册；--check只返回布尔值 |
| `send` | `text,target,status,requestResume`；求简历时另含 `resumeRequest` | status 为 message-visible，已确认页面出现新增匹配正文；不是已读回执。未指定目标时 target 为 null |
| `action not-fit` | `action,status` | clicked |
| `action remark` | `action,status,remark` | saved |
| `action request-attachment-resume` / `action wechat` | `action,status` | confirmed，只确认页面动作和弹窗，不代表对方接受 |
| `action history` | `action,status,colleague,mine` | read 时两个数组，每行 `action,operat`；入口缺失时 unavailable 且数组为 null；JSON 模式弹窗超时报错 |

## 字段边界

`probe-resume/accept-resume/download-resume` 总超时错误名为 AttachmentTimeoutError，退出码 1，已确认子进程退出。collect 使用独立逐行 JSON 协议，无需 --json，参见 [岗位账本](collection-ledger.md)。

`download-resume`、`accept-resume`、定向 `send` 可同时加 `--check --json`。`--check` 是严格只读开关，只返回true/false，不搜索、不定位、不发送；身份不符返回false，读取异常报错。`send --check` 必须同时提供姓名和 `data-id`。

JSON 保留现有页面读取器的内容，包括空字符串、null、数组、布尔值和摘要中的混合文字，不新增推断字段。年龄、学历、经验和岗位匹配由 Agent 自行分析。搜索候选人ID已提供；消息/附件ID、来源事件键和完整分页历史尚未补齐。

`--json` 仅改变输出格式，命令原有副作用仍存在：打招呼、发消息、求简历、备注等仍执行对应动作。下载只保存已收到附件，不发送文字。

## 验证

```powershell
npm run build
npm run test:json
```

定向测试覆盖业务命令参数传递、字面量与默认行为、失败 JSON/退出码、推荐和搜索原字段、聊天消息和附件标记、JD 缓存、深度搜索未知次数、发送确认、附件接收/已处理边界。

真实账号已验证 `chat 张袁僖 --data-id 580745010-0 --json`：成功返回一个 JSON 对象，包含摘要、10 条页面已加载消息和附件存在标记；未发送消息。其余动作 JSON 使用隔离替身验证，本轮未在真实账号重复发送、打招呼或接收请求。

## version-check

`boss version-check --json` 离线返回 `{compatible, requiresConfirmation, skillDir, actual:{cliVersion,skillVersion,skillCliVersion,compatibilityId}, expected:{cliVersion,skillVersion,compatibilityId}, confirmationToken}`。匹配退出码 0 且令牌为 null；不匹配退出码 2，业务启动被阻止，需用户明确确认后携带当前令牌。读取失败输出标准错误 JSON，退出码 1。外部 Skill 通过 BOSS_SKILL_DIR 指定绝对目录。

### 截图 OCR

截图回执的 `ocr={status:"not-started",command:"ocr",args:[绝对图片路径,"--json"],execution:"agent-background",imagePath}` 是待执行描述，不表示上传已开始。`ocr` 命令完成时返回 `status=completed`、输入 SHA-256、文字/坐标/原始响应/结果路径、layout、lineCount、lowConfidenceIds、needsReview 和 timing；失败为标准 JSON 错误，非零退出码，错误包含原图及诊断结果路径。每次调用独立输出目录，失败或中断不消费半成品。详见[OCR规范](../skills/boss-recruitment/references/resume-ocr.md)。
