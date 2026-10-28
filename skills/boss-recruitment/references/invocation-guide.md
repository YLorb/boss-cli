---
title: "逐项调用手册：参数、位置、结果与停止规则"
updated: "2026-10-27"
scope: "public-cli-invocations"
---

# 逐项调用手册

这是当前包的实际调用方式，配合对应 SOP 使用。命令可用不等于获得发送、联系、下载或改账授权。示例的姓名、ID、岗位、目录必须替换为已核验的值；不要整段执行包含真实动作的示例。

## 1. 固定执行目录和参数

在包含 `package.json`、`dist` 的解压目录运行。首次安装依赖运行 `npm install --omit=dev`；发布包已带构建产物，不需要在接收端编译。源码开发才需要 `npm install`、`npm run build`。

```powershell
Set-Location 'C:\Recruitment\boss-cli'
$env:BOSS_BROWSER_REMOTE_DEBUGGING_PORT = '53470'
$env:BOSS_CHAT_SEARCH_TIMEOUT_MS = '20000'
node .\dist\cli\index.js help
```

后文以 `boss` 简写 `node .\dist\cli\index.js`。只有确认全局 boss 指向同一版本时才直接使用该简写。所有路径使用绝对路径；普通参数值含空格时加引号。`--json` 输出 JSON，错误为非零退出码；检查结果 `false` 仍是正常读取结果，不是执行失败。解析 JSON，不依据终端图标或关键字猜结果。

四种岗位值必须分开保存：

| 值 | 例子 | 用在哪 |
| --- | --- | --- |
| 岗位下拉完整 label | 全栈软件开发工程师 _ 深圳 15-30K | 用户手动选岗及 status.chatFilterJob 核验，必须与实际岗位一致 |
| 账本 job | 全栈软件开发工程师 _ 深圳 | collect、add、账本文件名；保留城市、去掉薪资，由 Agent 确定 |
| 当前会话岗位 | 全栈软件开发工程师 | chat-search --job、沟通页 check --job；按实际详情值比较 |
| 搜索联系岗位 | 页面弹层显示的完整名称 | greet --select-job；不用账本键猜测弹层文案 |

`data-id` 是沟通会话ID；`candidate-id` 是搜索或推荐卡片候选人ID（推荐列表字段为geekId）。两者不能互换。完整岗位键发生变化时不自动迁移旧账本；城市不明确时先核对，不猜补。

## 2. 登录、状态和只读检查

| 调用 | 前置条件／动作 | 结果与使用方法 |
| --- | --- | --- |
| `boss login --json` | 启动或复用 Chrome，打开登录页 | 用户扫码后另行检查；返回不代表登录成功 |
| `boss --check-login --json` | 已有可连接 Chrome | true 已登录；false 未登录；无法判断时报错 |
| `boss status --json` | 唯一 BOSS 标签页 | 读取 pageType、conversation、chatSearch、chatFilterJob、chatJob、草稿、已加载己方消息等，不操作页面 |
| `boss check --page chat --state conversation --name '张三' --data-id '123-0' --json` | 正确会话已打开 | true 才证明此刻姓名、ID、详情姓名一致；false 不会自动定位 |
| `boss check --page chat --job '当前详情岗位' --json` | 普通沟通页 | 比较 chatJob，**不比较顶部 chatFilterJob** |
| `boss check --page search --job '当前搜索条件岗位' --keyword '关键词' --json` | 搜索页 | 比较实际搜索条件，不设置条件 |
| `boss check --overlay online-resume --json` | 任何可读取页面 | 判断在线简历弹层；`--overlay none` 判断没有该弹层 |
| `boss check --page chat --state message-visible --name '张三' --data-id '123-0' --text '完整正文' --json` | 指定会话已打开 | 只查已加载的己方消息；false 不能证明历史从未发送 |

check 可组合 `--page`、`--overlay`、`--state`、`--name`、`--data-id`、`--candidate-id`、`--job`、`--keyword`、`--text`、`--embedded`，全部条件须同时成立。`--data-id`／`--candidate-id` 要配姓名，消息状态要配正文。完整枚举见[check/status说明](check-status.md)。检查异常停止，不解释为false。核对顶部沟通岗位必须读取 `status.chatFilterJob`；内嵌检查的job来自内嵌会话，job-selected检查来自选岗弹层。

## 3. 选择沟通岗位和获取起始列表

沟通岗位由用户手动切换，Agent 通过公开 CLI `status --json` 的 `chatFilterJob` 核验。当前没有 `boss switch-job` 子命令；独立 `scripts/switch-job.mjs` 直连真实浏览器的旧许可已撤销，不运行或包装该脚本。岗位不符或无法核实时停止依赖步骤，详见[岗位切换边界](switch-job.md)。

| 调用 | 行为 | 结果 |
| --- | --- | --- |
| `boss list --json` | 进入沟通列表并读取当前已加载行 | 姓名、dataId、岗位等；不是全量历史 |
| `boss list --unread --json` | 进入沟通并选择未读 | 保存为本轮固定起始快照；循环内不重读刷新 |
| `boss list --chatting --json` | 选择顶部“沟通中” | 不等于只读status；不要作为恢复失败的绕路命令 |

列表岗位与账本岗位的标题形式可能不同，城市归属由已核验的完整岗位label及快照保存。不要把缺少城市的标题自动补为账本城市。

## 4. 昵称搜索、定位和读取聊天

须已在 `/web/chat/index`；搜索框存在旧输入或结果时停止，不覆盖、不自动清理。定位不操作岗位下拉，BOSS自行重置岗位不算失败；重名仍暂停，不按已有ID挑选。

| 调用 | 含义 | 结果／限制 |
| --- | --- | --- |
| `boss chat-search '张三' --json` | 显式搜索完整昵称并在唯一精确匹配时打开 | opened／needs-confirmation／not-found，均须检查status，不只检查退出码 |
| `boss chat-search '张三' --data-id '123-0' --job '实际沟通岗位' --json` | 搜索后额外比较已知ID和岗位 | 比较参数不设置岗位，也不消除重名；不支持--check |
| `boss chat '张三' --data-id '123-0' --json` | 当前身份一致则复用，否则搜索定位 | 成功返回summary、messages、附件事实；不表示完整聊天历史 |
| `boss chat '张三' --json` | 按完整昵称搜索，打开后读聊天 | 只有姓名时不走联合键复用；--strict仅兼容旧调用 |
| `boss chat '张三' --index 2 --unread --json` | 从调用时列表第2行取姓名／ID再搜索 | 不是按旧快照序号点击；保存快照后使用姓名＋ID |
| `boss chat '张三' --data-id '123-0' --check --json` | 仅读当前身份 | true／false，不搜索 |

结果处理：

`chat-search` 的 `match`／`matches`、`status.chatSearch.matches` 及失败诊断匹配项统一包含 `name`、`uniqueId`、`label`、`info`、`tag`。info是workDesc原文（公司或院校等补充信息），tag是exchangeDesc原文（交换提示），缺失返回null；不从label拆分猜补。搜索现场已有结果时使用 `boss status --json` 读取，不重新调用chat-search。已获得并与目标关联的info原文可用于 `boss chat-search '张三' --info '已知原文' --data-id '123-0' --json` 或 `boss chat '张三' --data-id '123-0' --info '已知原文' --json`。页面只输入昵称，返回后精确比较完整姓名和info，唯一且ID相符才打开；零匹配停止，同名同info或群聊歧义仍暂停。searchMatches保留全部原始匹配，info保留输入条件。当前会话姓名和ID一致直接复用。chat的--info须带--data-id，不与--index/--check混用；send和附件命令不接受--info，先chat定位后复用。无--tag，不从label猜填，不退回只按姓名搜索。

- `opened`：姓名、会话ID及详情姓名已核验；页面筛选不需要保持不变。
- `needs-confirmation`：多个联系人或群聊等歧义，clicked=false，保留现场等用户，不继续下一人。
- `not-found`：本次查询明确完成且零匹配，clicked=false。普通chat及发送／附件共用定位会抛CandidateNotFound，不继续后续动作。
- 超时：查询或身份未确认，保存stage、clickState、diagnostics；不当作零结果，不自动重试。

`BOSS_CHAT_SEARCH_TIMEOUT_MS` 为每阶段1000–60000毫秒，默认20000；不改变附件命令15秒总预算。`--keep-current-job` 临时选项已移除。不支持CLI通配符配置；用户的 `王洪*` 由Agent解释为前缀查询并报告完整姓名。唯一结果与查询关键词不完全一致时精确定位会停止，应读取status报告匹配，不绕过精确核验或重名暂停。

## 5. 发送与当前会话动作

只在已获得相应授权时调用。不带姓名／ID的send针对当前会话，自动化优先联合键。正文和换行须来自用户确认的话术。

```powershell
boss send --name '张三' --data-id '123-0' --text '已确认正文' --check --json
# 检查为true且本轮已授权，才执行下一条：
boss send --name '张三' --data-id '123-0' --text '已确认正文' --json
```

`--check` 只比较身份、可编辑状态、草稿和已加载同文消息；false时先读status。实际send核验同一会话中的新消息，结果不明不补发。`--text` 可用 `-t`，发送可能覆盖系统剪贴板。`--request-resume` 会追加平台求简历动作，必须单独获准，消息3不用此选项。

| 调用 | 实际动作／前提 |
| --- | --- |
| `boss action resume --json` | 当前正确会话的在线简历截图，不做OCR |
| `boss action history --json` | 打开并读取沟通记录，不证明所有历史均已加载 |
| `boss action remark --remark '备注内容' --json` | 修改当前候选人备注 |
| `boss action agree-resume --json` | 同意当前附件请求；自动化优先使用带联合键的accept-resume |
| `boss action request-attachment-resume --json` | 平台求附件动作，可能发默认话术，需双方各至少发过消息 |
| `boss action not-fit --json` | 标记平台不合适；普通本地筛选FAIL不调用 |
| `boss action wechat --json` | 交换微信，仅在明确授权时使用 |

action没有通用--check；执行前用身份check/status。失败直接停止，不换另一个action尝试。

## 6. 附件：检查、同意、下载、探测

| 调用 | 方法与结果 |
| --- | --- |
| `boss accept-resume '张三' --data-id '123-0' --check --json` | 只读检查当前正确会话是否有可用待同意请求 |
| `boss accept-resume '张三' --data-id '123-0' --json` | 已授权且检查通过后同意一次，等待收到附件；不发送文字 |
| `boss download-resume '张三' --data-id '123-0' --check --json` | 只读检查当前会话已有附件，不证明已下载 |
| `boss download-resume '张三' --data-id '123-0' --output-dir 'C:\Recruitment\resumes' --json` | 下载已收到原文件，核对path、bytes、sha256及真实文件 |
| `boss probe-resume '张三' --data-id '123-0' --json` | 定位／复用后探测已加载附件及己方求附件话术，不自动同意，不下载 |
| `boss probe-resume '张三' --data-id '123-0' --download --output-dir 'C:\Recruitment\resumes' --json` | 探测并下载已收到附件；只有--download时可传output-dir |

probe-resume不支持--check。request=SENT指我方求简历话术，不代表对方待同意请求；NOT_OBSERVED不能推断历史没发过。三类附件命令总时限15秒，超时须等子进程退出、保存证据并标待复核，不能假定动作未发生。外部下载不会自动回写collect，不用再次下载冒充账本合并。

## 7. 推荐、人才搜索、深度搜索

| 调用 | 前置条件／作用 | 核验 |
| --- | --- | --- |
| `boss recommend '岗位关键字' --json` | 按需进入推荐页，关键词选岗、读取列表 | 核对返回完整岗位；同岗位不重复选中 |
| `boss recommend '岗位名称 _ 城市' --ensure-job --json` | 下拉搜索岗位名称，再用名称＋城市唯一精确匹配，忽略薪资后缀 | 同键不重复选岗；多项匹配暂停；不是只读检查 |
| `boss recommend '完整岗位名' --check-job --json` | 只读比较当前推荐岗位 | true／false，不能与ensure-job混用 |
| `boss search '关键词' --json` | 按需进入人才搜索页、输入并提交关键词 | 最多20字符；核对keyword、job与新卡片，不能只凭输入框正确判定结果更新 |
| `boss search --json` | 已在搜索页时读取当前卡片；其他页会导航 | 返回candidateId、education、work、tags等，不是沟通昵称搜索 |
| `boss deep-search --core '核心要求' --bonus '加分要求' --json` | 进入深度搜索并更新要求 | core／bonus可重复；同组按传入列表同步，多余项会删除 |
| `boss deep-search --clear-core --clear-bonus --json` | 清空指定要求分组 | 属于修改动作 |
| `boss deep-search '岗位关键词' --match --json` | 选岗并点击匹配，消耗匹配额度 | 也可用--job传岗位；返回顶部最新20条，不能推断全量 |

search不支持--job、自动加载更多或自动设置“不限职位”。指定搜索筛选由用户在页面设置后核验。deep-search不带--match不点击匹配。普通搜索提交一次，等待本次关键词、岗位第1页的响应成功，再核验页面及组件的ID/查询标识与响应一致；成功空数组才为零结果，超时、接口错误或未同步直接报错，不重复查询。

卡片提供可核验院校信息时，Agent先按用户硬性条件预筛；明确不符合才记录原因并跳过preview，未知按用户规则处理。推荐新增work/education数组，experience保留合并文本；字段仅辅助预筛，缺失允许preview，不直接判淘汰。卡片预筛数与实际打开简历数N分开计数，不能用摘要冒充完整简历评估。

## 8. 预览、返回与搜索联系

preview/greet须已在对应推荐、常规搜索或深度搜索页，不负责导航。

| 调用 | 方法与结果 |
| --- | --- |
| `boss preview '唯一显示姓名' --json` | 推荐／深度搜索按唯一姓名；成功截图后关闭简历，消耗查看次数 |
| `boss preview '显示姓名' --candidate-id '当前卡片ID' --json` | 常规搜索／推荐按姓名＋ID唯一定位，核验卡片及简历ID后截图；深度搜索不支持ID |
| `boss preview '显示姓名' --candidate-id '卡片ID' --open-only --json` | 仅常规搜索，打开／复用并核验，保持展开，不截图、不联系 |
| `boss back --check-in_online_resume --json` | 只读判断简历是否打开 |
| `boss back --if-open --json` | 有简历则关闭／经历史核验返回，列表上不操作；失败不回退到其他页面 |
| `boss back --json` | 明确要求返回；未打开简历时报错 |
| `boss greet '唯一姓名' --job '推荐岗位关键字' --json` | 推荐页选择岗位后打招呼；先核对对象，本动作可能发平台默认问候 |
| `boss greet '唯一姓名' --json` | 当前推荐／深度搜索候选人联系；常规搜索按下列带ID步骤执行 |
| `boss greet '姓名' --candidate-id '快照geekId' --check --json` | 推荐列表只读核验姓名、唯一ID、组件身份及可用按钮；简历覆盖列表时false |
| `boss greet '姓名' --candidate-id '快照geekId' --json` | 推荐列表核验通过且已获联系授权后点击一次，回执candidateId/identityVerified/status=clicked；不能视为联系已确认 |

截图提示固定层不代表正文一定无遮挡。推荐／常规搜索允许提示后继续，仍需通过拼接完整性检查并检查成图；其他页面同类遮挡可能停止。

常规搜索联系步骤（已有明确联系授权才去掉--check；每一步检查实际结果再决定下一步）：

```powershell
boss preview '显示姓名' --candidate-id '卡片ID' --open-only --json
boss greet '显示姓名' --candidate-id '卡片ID' --check --json
boss greet '显示姓名' --candidate-id '卡片ID' --json
```

already-contacted不再点击；contact-confirmed才记录联系确认。若出现预期的联系选岗弹层，使用弹层实际完整岗位名：

```powershell
boss greet '显示姓名' --candidate-id '卡片ID' --select-job '联系岗位完整名称' --json
boss greet '显示姓名' --candidate-id '卡片ID' --select-job '联系岗位完整名称' --confirm-contact --check --json
boss greet '显示姓名' --candidate-id '卡片ID' --select-job '联系岗位完整名称' --confirm-contact --json
boss greet '显示姓名' --continue-chat --candidate-id '联系成功回执ID' --json
```

select-job只选岗；confirm-contact只确认一次；continue-clicked只证明点击继续沟通，不证明窗口身份。常规搜索greet不支持--job。首次点击出现弹层后，不重复首次greet，不把购买提示当作沟通成功。不同页面的重名处理不能混用：沟通昵称搜索遇多匹配一律暂停；常规搜索和推荐卡片可在取得可靠candidateId后联合唯一核验，仍不唯一就暂停。

## 9. 搜索页内嵌会话

```powershell
boss chat --inspect-embedded --json
boss chat '实际姓名' --embedded --check --candidate-id '触达回执ID' --job '实际沟通岗位' --json
boss send --embedded --name '实际姓名' --candidate-id '触达回执ID' --job '实际沟通岗位' --text '已确认正文' --check --json
# 上述检查通过且已获发送授权才执行：
boss send --embedded --name '实际姓名' --candidate-id '触达回执ID' --job '实际沟通岗位' --text '已确认正文' --json
```

inspect仅诊断；check返回true才通过。内嵌conversationId不能直接当作列表dataId。草稿、ID／岗位不符、多窗口均停止，不跳到独立会话重试。入口已实现，完整真实发送链路尚未验收，不宣称已完成。

## 10. 岗位、JD和账本

`boss positions --json` 读取岗位列表；`boss jd '岗位名称' --json` 读取或复用缓存Markdown，返回正文、路径及来源。岗位列表可能分页，缓存不保证最新；必须使用用户确认的JD。

```powershell
boss collect --job '全栈软件开发工程师 _ 深圳' --ledger-dir 'C:\Recruitment\shared\ledgers'
```

这是常驻进程，不是批处理一条命令。等待started，核对job、绝对file及recoveryRequired；下列JSON逐行写入**同一进程stdin**，每条等回执再发送下一条，不能作为PowerShell命令执行：

| stdin单行JSON | 实际行为与结果 |
| --- | --- |
| `{"op":"show"}` | 读取当前账本与恢复标记 |
| `{"op":"add","job":"全栈软件开发工程师 _ 深圳","name":"张三","dataId":"123-0"}` | 新增已核验候选人；job须与会话账本完全一致 |
| `{"op":"decision","dataId":"123-0","decision":"PASS"}` | 保存通过结论，未下载者进入等待 |
| `{"op":"decision","dataId":"123-0","decision":"FAIL"}` | 删除正式记录；本轮忽略原因另存回执 |
| `{"op":"round"}` | 遍历账本对象，PASS者可能下载；不扫描新人、不自动发送。仅用于明确授权范围 |
| `{"op":"recheck"}` | 复核RECHECK，只读附件证据，不下载发送 |
| `{"op":"reconcile"}` | 操作页面全量对账，不是离线修复；清单岗位须与账本键可核验对应，缺少城市时不能猜补后宣告完成 |
| `{"op":"stop"}` | 等在途工作退出并原子写回；等stopped与进程退出才算保存 |

stdin不支持send、download、upload、recordProbe。独立下载回执不会自动转到账本。EOF／杀进程不是stop；reading或reconciliationRequired时停止普通业务。历史账本含薪资或缺城市时，明确迁移方案后再处理，不新建空账本绕过历史去重。完整协议见[账本与恢复](ledger-and-recovery.md)。

## 11. 版本维护及不支持的调用

| 调用 | 用途 |
| --- | --- |
| `boss help` | 本地入口与语法，不连接BOSS |
| `boss version`／`boss ver`／`boss --version`／`boss -v` | 版本及npm更新检查，可能联网 |
| `boss update` | 更新全局npm包，不等于更新当前源码／ZIP；不要在业务中自动升级 |

没有通用的搜索清空、批量候选人选择、账本导入下载回执或上传HR系统命令。常规搜索扩池使用下节有上限的 search-more；不支持其他页面加载更多。遇到能力缺口保存现场并报告，不编造选项、不使用跨页往返恢复。失败后仅可按下节显式 back --previous 返回一步，不重新执行失败动作。`_baidu-keys` 是内部凭据入口，不属于本SOP；截图OCR当前关闭。

运行记录留在工作目录，包含命令参数、开始／结束时间、退出码、原始JSON、筛选与身份依据。不要随发布包交付真实候选人回执、简历、浏览器资料或密钥。

## 12. 有上限的搜索扩池与返回上一页

已在常规搜索页、起始列表处理完且本轮明确允许扩池时调用：

```powershell
boss search-more --max-scrolls 2 --max-candidates 40 --timeout-ms 10000 --json
```

示例上限不是平台安全额度。max-scrolls 必填且为 1–20；max-candidates 必填且为 1–500，包含起始卡片，限制本次返回池。单次平台响应可能额外加载卡片。每轮响应及页面核验共用 timeout-ms（1000–15000，默认10000）。保持现有关键词／岗位，按 candidateId 去重；输出 candidates 及 scrolls、initialCount、addedCount、duplicatesSkipped、stopReason。已有卡片达到人数上限时不滚动。只支持搜索 iframe 文档滚动，不支持推荐页、深度搜索或其他容器。

成功响应为空、响应无新增 ID 或达到上限即结束；无响应、状态变化、缺 ID、接口错误及超时均报错停止，无刷新、改关键词、备用滚动路径或自动重试。返回池不是新联系人清单；跨轮次去重与已联系回执仍须核对，本命令不发送或联系。

失败后先保存原始回执，等待命令退出；确需返回且已知前一条历史的准确 URL 时，显式调用一次：

```powershell
boss back --previous --expect-url 'https://www.zhipin.com/web/chat/search' --json
```

expect-url 必须是实际前一条历史的完整 URL，包含原有查询参数，不是任意想去的页面。仅当前已知 BOSS 列表、独立在线简历或权益页可用；登录／验证／未知页面不返回。目标只接受已知列表（沟通、推荐、常规搜索、深度搜索）。前后历史 ID、索引及 URL 核验不符则报错；最多一次 goBack，不刷新、不 goto、不自动重跑失败动作。弹层仍打开时应显式使用现有 back --if-open，不能混用模式或在其失败后切换模式兜底。

两个入口均复用 CLI 会话锁和页面守护。此次仅通过离线测试，未连接真实 BOSS；页面结构不兼容时按错误停止，不生成临时脚本。
