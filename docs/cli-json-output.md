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
- 诊断日志、trace 写 stderr。JSON 模式跳过自动版本检查提示；退出码和结果必须一起判断。
- 交互开发模式也接受该开关，但提示符等属于交互界面。Agent 应调用一次性命令。
- `help/version/update` 与内部凭证命令不在业务 JSON 范围内。

## 各命令成功字段

| 命令 | 顶层字段 | 说明 |
| --- | --- | --- |
| `login` | `url,status` | status 为 `awaiting-manual-login`，不代表已登录 |
| `list` | `category,filter,candidates` | 每行 `dataId,name,job,time,message,unreadCount` |
| `chat`（姓名、序号或 data-id） | `name,dataId,summary,messages,hasFriendResumeAttachment` | summary 保留摘要数组；messages 含 `text,time,from`；仅页面已加载内容 |
| `recommend` | `job,candidates` | 保留 `geekId,name,salary,baseInfo,expect,experience,advantage,highlights,canGreet,hasHistoryChat,hasViewed` |
| `search` | `keyword,job,candidates` | 保留 `name,active,labels,basicInfo,summary,tags,expectation,work,education,reason,contactText`；当前没有候选人 ID |
| `deep-search` | `matched,form` | form 保留岗位、要求、剩余次数文字/数值、按钮文字和禁用状态 |
| `deep-search --match` | `matched,form,candidates` | candidates 含 `name,meta,work,edu,reason`，最新 20 条；排除“继续沟通”候选人 |
| `positions` | `jobs,totalText,url` | 每项 `id,title,label,status,meta,viewed,chatted,interested` |
| `jd` | `name,path,markdown,source` | 继续保存和复用 `.md`；source 为 `cache` 或 `page` |
| `accept-resume` / `action agree-resume` | `action,kind,which,target,attachmentReceived` | 返回 clicked，且已等到新附件卡片；已处理请求仍报错 |
| `download-resume` | `name,dataId,geekId,attachmentName,fileName,path,bytes,sha256` | 默认即 JSON；`--json` 同样接受；图片 geekId 为 null |
| `preview` | `name,sourceUrl,job,path,type` | type 为 `online-resume-screenshot`，不是原附件或 OCR 结果 |
| `action resume` | `action,name,path,type` | 同上，为在线简历截图 |
| `greet` | `source,name,message,status,candidates`，推荐页另含 `geekId,job`；深度搜索另含 `jobKeyword` | status 为 clicked，只确认点击，不代表回复；jobKeyword 是输入关键字 |
| `send` | `text,target,status,requestResume`；求简历时另含 `resumeRequest` | status 为 message-visible，已确认页面出现新增匹配正文；不是已读回执。未指定目标时 target 为 null |
| `action not-fit` | `action,status` | clicked |
| `action remark` | `action,status,remark` | saved |
| `action request-attachment-resume` / `action wechat` | `action,status` | confirmed，只确认页面动作和弹窗，不代表对方接受 |
| `action history` | `action,status,colleague,mine` | read 时两个数组，每行 `action,operat`；入口缺失时 unavailable 且数组为 null；JSON 模式弹窗超时报错 |

## 字段边界

JSON 保留现有页面读取器的内容，包括空字符串、null、数组、布尔值和摘要中的混合文字，不新增推断字段。年龄、学历、经验和岗位匹配由 Agent 自行分析。搜索候选人 ID、消息/附件 ID、来源事件键和完整分页历史尚未补齐。

`--json` 仅改变输出格式，命令原有副作用仍存在：打招呼、发消息、求简历、备注等仍执行对应动作。下载只保存已收到附件，不发送文字。

## 验证

```powershell
npm run build
npm run test:json
```

定向测试覆盖业务命令参数传递、字面量与默认行为、失败 JSON/退出码、推荐和搜索原字段、聊天消息和附件标记、JD 缓存、深度搜索未知次数、发送确认、附件接收/已处理边界。

真实账号已验证 `chat 张袁僖 --data-id 580745010-0 --json`：成功返回一个 JSON 对象，包含摘要、10 条页面已加载消息和附件存在标记；未发送消息。其余动作 JSON 使用隔离替身验证，本轮未在真实账号重复发送、打招呼或接收请求。
