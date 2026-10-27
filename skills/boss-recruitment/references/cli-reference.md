---
title: "CLI指令、示例与页面要求"
read_when: "需要某个命令的语法或副作用说明"
updated: "2026-10-27"
scope: "cli-reference"
source: "本地cliRouter、help、docs/boss-url-map.md"
---

# 命令参考

逐项可执行语法、每个调用的前置条件／结果／副作用、岗位值区别及collect stdin协议，统一见[逐项调用手册](invocation-guide.md)。本文保留按功能的补充说明。

使用前遵守[工具使用边界](tool-boundary.md)。缺失能力不授权 Agent 直接连接 CDP、使用其他浏览器工具、导入内部模块或临时编写页面脚本。

目录：基础与登录 → 页面映射 → 列表与会话 → 搜索与推荐 → 消息与动作 → 附件 → 岗位 → collect。

以下 `boss` 是**简写**；使用源码包时一律替换为 `node .\dist\cli\index.js`，在源码根目录运行。示例中的姓名、ID、岗位都是占位数据，不能直接对真实页面执行。命令支持不等于本轮已授权。

## 基础与登录

| 命令 | 用法与结果 |
| --- | --- |
| `boss help` | 查看实际安装版本的入口和参数 |
| `boss` | 交互模式；exit／quit退出；Agent优先使用单命令进程 |
| `boss version`、`boss ver`、`boss -v`、`boss --version` | 显示版本并检查npm更新；不是纯离线核验 |
| `boss update` | 更新全局npm包；不更新源码工作区，不在业务中自动执行 |
| `boss login --json` | 打开登录页，用户扫码，命令返回不代表已登录 |
| `boss --check-login --json` | 只读检查已有BOSS标签，不导航；已登录返回true、未登录false，无法判断报错 |

业务命令 `--json` 输出原始结构；stdout为结果，stderr为日志。错误返回非零码和 `{ok:false,command,error:{name,message}}`。下载默认也是JSON。不能通过错误码推断副作用未发生。

## URL 与位置

| 页面 | URL路径 | 可用入口 |
| --- | --- | --- |
| 登录 | `/web/user/?ka=header-login` | login |
| 沟通 | `/web/chat/index` | list/chat/send/action/附件命令 |
| 推荐 | `/web/chat/recommend` | recommend/preview/greet |
| 常规搜索 | `/web/chat/search` | search/preview/greet；搜索 greet --check 只预检，需包含2026-10-20本地实现的CLI |
| 深度搜索 | `/web/chat/aiform` | deep-search/preview/greet |
| 职位管理 | `/web/chat/job/list` | positions/jd |

网站为 `https://www.zhipin.com`。search/recommend按需进入对应页；preview/greet要求已经位于支持页面且列表已加载。不要让错误页面的按钮成为替代入口。

## 列表与会话

2026-10-26 用户确认的[沟通页候选人定位流程](chat-candidate-location.md)：`boss chat-search "完整昵称" [--data-id "预期ID"] [--job "预期岗位"] --json`，必须已在沟通页。保留当前页面状态、不主动切岗 → 搜索图标 → 输入昵称 → 读取完整匹配项（含隐藏项） → 唯一匹配才点击 → 核验会话姓名、data-id及岗位。重名或其他歧义返回 `status=needs-confirmation`、`clicked=false` 和匹配项，等待用户手动确认或进一步指令；比较参数不用于选择重名。成功为 `status=opened`；已完成零结果返回status=not-found且不点击；未完成查询超时、旧搜索未清空或核验失败直接报错，不重试。此命令不支持 `--check`、不发送，不以人才搜索 `boss search` 代用，现有chat及指定对象发送／附件／探测均接入此搜索，滚动查找已删除；仍只处理起始快照中的对象。`status --json` 的 `chatSearch` 字段只读查看搜索输入及结果。

沟通页岗位切换使用CLI仓库的 `node .\scripts\switch-job.mjs --list` 与 `--job '完整label'`，不是boss子命令。调用前必须读取[脚本规范](switch-job.md)，参数、当前位置、结果核验和失败处理均按该规范执行。

```powershell
boss list --unread --json
boss list --chatting --json
boss chat '张三' --strict --json
boss chat '张三' --index 2 --unread --strict --json
boss chat '张三' --data-id '123-0' --json
```

list读取列表，--chatting选顶部“沟通中”，--unread选未读；输出姓名、data-id和岗位。不是F5，页面不匹配时仍会导航，筛选不一致时会点击。正常循环仅起始读取一次。

chat仅用于已有会话，必须已在沟通页。姓名和--index入口直接按完整昵称搜索，不主动切换或恢复岗位，不再滚动查找；姓名始终精确匹配，--strict保留兼容。index从1开始，仅从调用时列表取得姓名、ID及岗位再搜索，不能复用旧序号。重名即使已给ID或序号也通过CandidateSelectionRequired暂停，等待用户手动确认或进一步指令；没有滚动回退。指定候选人的发送、附件及探测同样在重名时中止。--data-id入口先核验当前姓名、ID和详情姓名，一致则直接复用，否则才搜索。chat --json成功仍返回已加载消息、摘要与附件事实，不证明历史完整。

## 推荐、搜索、预览与打招呼

```powershell
boss recommend '目标岗位关键字' --json
boss search '推理加速' --json
boss preview '唯一候选人姓名' --json
boss greet '唯一候选人姓名' --job '岗位关键字' --json
```

recommend岗位模糊匹配；核对实际完整名称。search关键词最多20字符，不带词只读取当前状态；不支持--job、不设置不限职位、不提供加载更多。preview保存在线简历截图并关闭弹层，会消耗查看次数；不做OCR。姓名歧义先停止。greet支持推荐／深度搜索；包含2026-10-20本地实现的CLI还支持搜索页及其在线简历。搜索页先用 greet "完整显示姓名" --check --json 预检，实际联系去掉 --check，不支持 --job。联系可能消耗次数并发送平台默认问候。contact-confirmed只证明按钮变为“继续沟通”；不代表消息3或账本完成。点击后未确认不得重试。旧安装须先核验help及来源，不因本Skill描述就认定已具备新功能。

```powershell
boss deep-search --core '模型推理优化' --core '源码实现经验' --bonus 'CUDA' --json
boss deep-search --clear-bonus --json
boss deep-search --match --json
```

deep-search支持岗位位置参数或--job；--core/--bonus可重复，按给定列表同步分组，多余项会被删除；--clear-core/--clear-bonus清空。默认返回表单及剩余额度，只有--match点击匹配并消耗额度，返回顶部最新20条。此入口不是常规搜索SOP，不能自动替换。

## 发送与当前会话动作

```powershell
boss send --name '张三' --data-id '123-0' --check --text '已确认的话术' --json # 只读检查，返回true/false
# 仅检查为true且获得本轮授权后执行：
boss send --name '张三' --data-id '123-0' --text '已确认的话术' --json
boss action resume --json
boss action remark --remark '用户要求的备注' --json
```

send支持--text/-t；不带联合键时发送当前会话，自动化应先核对身份。--check只读比较当前会话及对应状态，返回true/false，不定位或执行动作。--request-resume会在发消息后追加求简历动作，不用于消息3。send使用剪贴板粘贴，会覆盖系统剪贴板。

| action操作 | 作用与示例 |
| --- | --- |
| resume | 当前会话在线简历截图：`boss action resume --json` |
| not-fit | 标记不合适：`boss action not-fit --json`；普通SOP忽略不执行此动作 |
| remark | 修改备注，必须--remark，见上例 |
| agree-resume | 当前会话同意附件：`boss action agree-resume --json`；自动化优先带身份的accept-resume |
| request-attachment-resume | 平台求简历并发送默认话术：`boss action request-attachment-resume --json`；需双方各至少发过消息 |
| history | `boss action history --json`，读取历史入口内容，不据此宣称全部历史已加载 |
| wechat | `boss action wechat --json`，交换微信动作；仅明确授权时使用 |

上述action都要求当前已打开正确会话。不得用not-fit代替本地初筛FAIL。

## 附件

```powershell
boss probe-resume '张三' --data-id '123-0' --json
boss probe-resume '张三' --data-id '123-0' --download --output-dir 'C:\Recruitment\runtime\resumes' --json
boss accept-resume '张三' --data-id '123-0' --check --json # 只读检查，返回true/false
# 仅检查为true且获得本轮授权后执行：
boss accept-resume '张三' --data-id '123-0' --json
boss download-resume '张三' --data-id '123-0' --check --output-dir 'C:\Recruitment\runtime\resumes' --json # 只读检查，返回true/false
# 仅检查为true且获得本轮授权后执行：
boss download-resume '张三' --data-id '123-0' --output-dir 'C:\Recruitment\runtime\resumes' --json
```

probe-resume核对指定会话附件与默认求简历话术；--download才下载，不接受--check。accept-resume只在出现待同意卡片时操作并等待附件，不发文字。download-resume下载已收到的原附件，返回path、bytes、sha256等。三者整命令15秒预算；超时终止子进程不撤销已发送给浏览器的动作。

## 岗位与 JD

```powershell
boss positions --json
boss jd '岗位名称' --json
```

positions读取职位列表，jd读取或复用本地Markdown缓存，JSON返回正文和路径。不要把空职位数组解释为账号确实无岗位；本机曾出现选择器不兼容。JD缓存不一定最新，以使用者确认版本为准。

## collect

```powershell
boss collect --job '岗位完整名称' --ledger-dir 'C:\Recruitment\shared\ledgers'
```

保持进程，stdin逐行发送JSON，完整协议与例子见[账本与恢复](ledger-and-recovery.md)。不支持 send/upload/recordProbe 等stdin op；round遍历账本，不是未读单人循环。

### Canvas 简历身份核验（2026-10-20）

搜索列表无ID参数时完整显示姓名必须唯一；提供 --candidate-id 时姓名和ID必须联合唯一匹配，卡片组件姓名必须一致且提供候选人 `encryptGeekId`。在线简历打开时，CLI 在主页面对应简历右侧操作区定位按钮，同时核对该组件 `geekInfo`、`resumeInfo` 的 ID 与卡片 ID 一致；不要求 Canvas 简历提供姓名 DOM。任一字段缺失、不一致或作用域不唯一直接停止，不以截图姓名或全局按钮代替身份校验。`preview --open-only` 也使用此规则。

历史预检曾输出结构化对象；现行只读预检统一输出true/false，详情改用status。真实首次点击已弹出联系岗位选择框，后续弹层确认已验证成功，见下文。用户要求只读时必须保留 `--check`，不得因为 true 自动联系。

## 联系弹层选岗规则

用户已明确指定本轮招聘目标岗位时，直接选择弹层中的对应岗位；未指定时先向用户确认，不采用默认选中项，也不将搜索条件“不限职位”当作联系岗位。简称须先核对唯一完整名称，歧义时询问用户。

使用 `boss greet "完整显示姓名" --select-job "联系岗位完整名称" --json`；可加 `--check` 只读核对。CLI 核对候选人 ID、精确匹配岗位并验证选中状态；该步骤只选岗，不点击弹层“立即沟通”。后续确认遵循用户当前授权范围。

确认联系使用 `boss greet "完整显示姓名" --select-job "已选岗位完整名称" --confirm-contact --json`，可先加 `--check` 只读核对。要求候选人身份与已选岗位一致，不自动改选，只点击弹层确认一次。弹层关闭且同一候选人的按钮变为“继续沟通”后返回 `contact-confirmed`、`contactConfirmed=true`；失败不得重试。仅在用户已授权联系时执行，消息3及入账仍为独立步骤。

2026-10-20 实测：n** / 大模型推理加速专家已完成弹层确认，CLI 返回 `contactConfirmed=true`。本次未单独发送消息3或写入账本。

已联系后打开会话：`boss greet "姓名" --continue-chat --candidate-id "成功回执中的候选人ID" --json`。要求当前简历仍打开，核对该 ID 的两处组件数据；不依赖联系后可能移除候选人的搜索列表。可加 `--check` 只读核对。`continue-clicked` 只确认点击，不证明已打开独立沟通页。

已知边界：2026-10-20 实测“继续沟通”打开了搜索页内聊天窗口，姓名可能由掩码变为完整显示名。不带 --embedded 的 `chat --check` 与 `send` 使用 `/web/chat/index`；搜索内嵌会话使用下节显式 --embedded 入口，必须先核验身份。完整真实发送仍待验收。

搜索业务执行顺序以[搜索 SOP（2026-10-22）](search-sop.md)为准：已指定沟通岗位不走联系选岗弹层；不限职位才按招聘目标岗位选择。内嵌窗口正式入口已提供，详见下节；完整真实发送仍待验收，不据greet点击回执推定send成功。


### 搜索页内嵌聊天（本地新增，2026-10-22）

`chat --inspect-embedded --json` 仅读取当前窗口，不代表身份通过。
`chat "实际姓名" --embedded --check --candidate-id "触达回执ID" --job "完整岗位" --json` 严格核验。
`send --embedded --name "实际姓名" --candidate-id "触达回执ID" --job "完整岗位" --text "正文" [--check] --json` 发送；此处 --check 严格只读。
无窗口或多窗口、身份/岗位不符、已有草稿、发送禁用均停止；不导航、不刷新、不请求附件。conversationId 是原生内嵌组件ID，未核验与列表data-id映射前不得直接用于collect。只读身份已实测，完整真实发送待验证；先检查本地help确认版本支持。


## 搜索同名候选人定位（2026-10-22）

`search --json` 返回每张卡片的 `candidateId`（组件 encryptGeekId）；无关键词时只读当前搜索页列表。先将姓名、院校、年限与同一卡片 ID 对照保存，不使用旧序号。

- `preview "姓名" --candidate-id "ID" [--open-only] --json`：仅常规搜索页，按姓名和 ID 联合唯一定位，打开后核对简历组件 ID；截图回执也返回 candidateId 和 identityVerified。
- `greet "姓名" --candidate-id "ID" [--check] --json`：同一 ID 贯穿首次联系、预检及选岗/确认。继续沟通仍必须携带成功回执 ID。
- 无 ID 时维持姓名必须唯一；ID 缺失、姓名不符、重复 ID 或目标不在当前列表直接报错，不回退按姓名匹配，不刷新寻找。
- 此规则替代前文“同名一律不能操作”的限制：只有获得当前卡片的可靠 ID 后才可处理同名者。推荐与深度搜索不支持该参数。
