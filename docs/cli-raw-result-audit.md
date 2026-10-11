# CLI 原始结果审计与 JSON 接口准备

日期：2026-10-11。本文保留实施前的原始字段审计；业务命令现已加入 `--json`，实际字段和验证范围见 [CLI JSON 输出](cli-json-output.md)。JD 按用户确认继续保存和复用 Markdown。

## 证据范围

- 本文字段来自当前 `src/toolset` 中的类型、页面读取脚本和业务返回值，不从 CLI 中文文本反向解析。
- 当前浏览器只读采样直接复用了 `readCandidateItems`、`fetchCandidateSummary`、`scrapeCurrentChatMessages` 的字符串读取脚本；未导航、未点击、未发送消息。
- 样本保存在 `output/raw-cli-audit/chat-readers.json`。当时页面为沟通页，选中张袁僖，读取到 40 条列表行、10 条已加载聊天消息和附件存在标记。样本不是完整历史或全部候选人。
- 推荐、常规搜索、深度搜索、职位和 JD 的字段本轮由源码确认，未对这些页面重新进行线上采样。
- 本轮未重放打招呼、接收简历、求简历或发送消息等动作。动作结果的字段来自代码；之前下载实测另有诊断记录。

## 数据流与接入位置

当前路径：页面读取脚本返回对象 → Node 业务函数处理 → 文本/Markdown/JSON 字符串 → `impl*` → `executeCommand` → stdout。

`src/toolset/index.ts` 的公开业务函数与 `executeCommand` 返回 `Promise<string>`。因此，CLI 路由当前拿到的已是最终字符串；不同功能的结构化数据存在于更下游的页面读取和业务函数中。

JSON 的改动位置应是业务函数的文本渲染之前。页面字段可以按命令保留；无需强制所有命令拥有相同 `data` 字段，也不应从 `render*` 拼接的文本恢复对象。

## 各命令最早可用的业务数据

以下是现有字段，而非最终承诺的 JSON schema。除特别注明外，展示文字字段为 string；数组和布尔值单独标注。

| 命令 | 最早可用的数据 | 目前如何输出 | 数据限制 |
| --- | --- | --- | --- |
| `list` | 每行：`dataId, name, job, time, message, unreadCount:number`；筛选：`category, filter` | 默认渲染文本，`--json` 已输出对象 | 普通读取仅返回当前 DOM 行；`--chatting` 有滚动扫描逻辑；`job` 是沟通行显示文字 |
| `chat <姓名>` / `chat --index` | `CandidateSummary` 与 `ChatMessageSnapshot`，详见下面字段 | 拼接摘要、附件状态与聊天文本 | 消息仅为页面已加载内容，不是服务端完整历史 |
| `chat --data-id` | 输入 `name,dataId`；身份核对对象含 `count,dataId,name,detailName` | 只返回打开并核对成功文字 | 这条分支没有调用聊天摘要/消息读取器 |
| `recommend` | 当前岗位文字 + `RecommendCandidate[]`，详见下面字段 | 按来源分组渲染文本 | `geekId` 可能为空；部分字段是多个 UI 文本的合并结果 |
| `search` | `keyword,job` + `NormalSearchCandidate[]` | 渲染文本 | 当前读取器没有候选人 ID；`contactText` 已读取但未输出到文本 |
| `deep-search` | `SearchFormSnapshot` | 渲染表单文本 | `remainingCount` 可为 null；未触发匹配时不读取候选列表 |
| `deep-search --match` | 表单快照 + `DeepSearchGeekItem[]` | 渲染文本，截取最新 20 条 | 无候选人 ID；读取器主动排除“继续沟通”人选 |
| `positions` | `JobReadResult` 含 `jobs[]` 和页面读取诊断上下文 | 渲染职位明细与统计 | ID、状态、统计值均从 DOM 取得，统计值当前为字符串 |
| `jd` | 选中 `JobListItem` + `JobDetail`；缓存文件路径 | 输出 Markdown，保存 `.md` | 命中本地缓存时直接读取 Markdown，不会重新产生 `JobDetail` 对象 |
| `accept-resume` / `action agree-resume` | `kind:clicked/already_handled/not_found`、`which:agree`；附件卡片数量变化验证 | 成功文字；其他状态转异常 | 未返回新附件的独立 ID；不能把 `already_handled` 当作新一次接收成功 |
| `download-resume` | `name,dataId,geekId:string|null,attachmentName,fileName,path,bytes:number,sha256` | 已输出 JSON | 选择最新已收到附件；图片地址没有 geekId；没有消息/附件来源事件键 |
| `preview` / `action resume` | 目标、岗位上下文、截图文件路径；弹层/截图步骤状态 | 拼接含路径的文本 | 产物是截图；没有执行 OCR，不提供简历全文对象 |
| `greet` | 推荐页：`kind, name, geekId`；深度搜索：`kind,name`，部分失败含 `target/label`；之后读取刷新列表 | 状态先转 `message`，再拼接列表文本 | 表示点击打招呼，不是候选人回复；推荐页返回对象的 geekId 在文字包装阶段丢失 |
| `send` | 输入正文/目标；发送前后匹配正文的消息数量，及身份核对 | 成功正文文字；可附求简历结果 | 当前没有新的消息 ID；只能确认页面出现匹配正文的新增消息，不代表对方已读 |
| `action not-fit` | 页面点击布尔状态及业务校验 | 确认文字 | 没有候选人结果对象 |
| `action remark` | 输入备注、编辑器内容校验及保存操作状态 | 确认文字 | 没有独立备注记录 ID |
| `action request-attachment-resume` / `action wechat` | 入口 `found/available`、点击与确认布尔结果 | 确认文字 | 点击并确认不代表对方接受或已发送附件；求简历会产生默认话术消息 |
| `action history` | 弹窗记录数组：`action,operat`，按“同事沟通/我的沟通”读取 | 合并成文本 | 缺少结构化时间、操作者 ID；并非聊天消息历史 |
| `login` | 打开的登录页地址、步骤完成状态 | 人工登录提示 | 未等待或校验登录完成 |
| `help/version/update` | 帮助文本、版本/更新信息、安装过程 | 人类可读输出 | 管理命令可独立处理，不是候选人采集结果 |

## 已存在的字段模型

### 聊天摘要与消息

`CandidateSummary`：

```text
name, active, basicFacts:string[], recentExperience:string[],
communicationPosition, expectation, remark
```

`ChatMessageSnapshot`：

```text
messages: [{time, from:'friend'|'myself'|'system'|'unknown', text}],
hasFriendResumeAttachment:boolean
```

附件标题与卡片按钮当前会被拼到 `text`，没有分离 `messageType`、附件 ID、请求 ID。`hasFriendResumeAttachment` 是布尔存在标记，不是附件数量或处理状态。

实测 `basicFacts` 为 `["25岁", "27年应届生", "硕士", "牛人分析器"]`。最后一项是 UI 工具文字，说明当前抓取字段存在内容污染；JSON 化不会自动修正它。

### 推荐

```text
geekId, name, salary, baseInfo, expect, experience, advantage,
highlights:string[], canGreet:boolean, hasHistoryChat:boolean, hasViewed:boolean
```

渲染器用会话内集合判断“打招呼产生的推荐”分组；这个来源分组不是 `RecommendCandidate` 的现有字段。`baseInfo`、`experience` 等仍是页面摘要文字，不是学历/工作年限等规范化业务字段。

### 常规搜索

```text
name, active, labels:string[], basicInfo, summary, tags:string[],
expectation, work:string[], education, reason, contactText
```

### 深度搜索

表单：

```text
selectedJob, coreRequirements:string[], bonusRequirements:string[],
remainingCountText, remainingCount:number|null,
matchButtonText, matchButtonDisabled:boolean
```

候选人：

```text
name, meta, work, edu, reason
```

### 职位与 JD

`JobListItem`：

```text
id, title, label, status, meta:string[], viewed, chatted, interested
```

`JobDetail`：

```text
pageTitle, pageUrl, company, recruitmentType, jobName, description,
overseas, jobCategory, experience, education, salaryRange, salaryMonths,
keywords, workLocation
```

## 如何添加 JSON：讨论稿

1. 分开业务结果和文本渲染。已有对象直接作为该命令数据；路径、校验结果和动作状态由业务函数显式组装。禁止最终字符串反向解析。
2. 统一外层可描述 `command`、成功/失败、schema 版本；内层 `data` 保留命令自己的字段。具体字段和兼容策略尚未定稿。
3. 同一业务对象供文本渲染与 JSON 序列化使用。CLI 选择输出格式，不理解或拆分业务正文。
4. JSON 模式 stdout 只含一个 JSON 结果；诊断日志走 stderr。动作失败保持非零退出码；未知执行结果不能伪装成未执行并自动重发。
5. 保留当前原始字段语义。年龄、学历、经验等规范化字段必须单独定义读取规则；不得依靠“看起来像”进行隐式猜测。
6. 独立处理 JD 缓存：文本缓存无法无损提供原对象。需要明确 JSON 模式是否强制重新读取，或者改为保存结构化缓存及其文本产物；本轮未选定。
7. 独立补齐真实数据缺口：搜索候选人 ID、消息/附件来源 ID、分页/加载范围和执行确认强度，不能仅增加 JSON 参数就声称具备。

## 后续实施边界

本轮仅产出调查记录和只读样本，未修改 CLI 路由、业务函数或输出契约。之前图片附件下载修复的工作树改动保留。

下一步可先针对 `list/chat/accept-resume/download-resume/send` 制作具体字段草案，再逐项处理推荐、搜索和 JD。正式实施前需要确认输出兼容策略、schema 范围及 JD 缓存行为。
