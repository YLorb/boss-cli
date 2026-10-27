---
title: "只读check与status"
read_when: "状态转换前检查、恢复、发送或读取当前页面"
updated: "2026-10-23"
scope: "readonly-state"
---

# 检查与动作分离

本地新版为破坏性语义变更：`check` 和业务命令 `--check` 只返回 JSON 布尔 `true` / `false`，无 --json 时也一样。它们不定位、不滚动、不刷新、不选岗、不输入、不发送、不接收或下载。比较不成立为 false；连接失败、读取失败、多标签或状态歧义直接报错，不伪装成 false。不得通过捕获错误后刷新重试。

`status --json` 返回当前 URL、pageType、overlayType、内嵌/独立会话身份、岗位、关键词、当前草稿和已加载己方消息等 info。status 不修改页面，不证明未加载的历史不存在。主页面与弹层分开：search 页面打开简历时，pageType=search、overlayType=online-resume。

推荐页岗位为recommendJob（searchJob为空），搜索页为searchJob；check按pageType比较对应岗位。推荐岗位按“岗位名称＋城市”比较并忽略薪资后缀，返回标签保留原文。推荐cards包含candidateId、componentId、componentName及按钮状态，只读取实际卡片，不重复读取外层列表项。推荐姓名／ID检查须精确唯一，卡片主体DOM ID与主体组件ID一致；打开简历时还须两处简历ID一致。

沟通搜索展开时，`chatSearch.matches` 每项输出 `name`、`uniqueId`、`label`、`info`、`tag`；info取workDesc原文，tag取exchangeDesc原文，缺失为null，非字符串时报错。公司／院校可出现在info中，可将此前取得且与目标关联的info交给chat-search或chat --data-id的--info精确筛选，但仍核验姓名和会话ID，同名同info仍暂停；check/status本身不接受--info；`rows` 继续保留完整行文本。status仅读取当前结果，不搜索、不清空、不点击，适用于多匹配暂停后的人工核对。

## 显式比较

```powershell
boss check --page search --job '目标完整岗位' --keyword '关键词' --json
boss check --overlay online-resume --json
boss check --page chat --state conversation --name '张三' --data-id '123-0' --json
boss check --page chat --state message-visible --name '张三' --data-id '123-0' --text '原正文' --json
boss status --json
```

--page 支持 chat/search/recommend/deep-search/online-resume/positions/login/other；独立简历页用 --page online-resume，弹层用 --overlay online-resume（或none）。--state 支持 online-resume-open/conversation/send-ready/message-visible/contact-ready/contacted/job-selected/resume-received/resume-request。
所有给出的条件同时匹配。无任何比较条件、未知枚举、消息状态未给正文、ID未给姓名均报参数错误。--embedded 指定内嵌会话。--job、--keyword 精确比较，不会设置它们。

## --job 比较的是哪个岗位

- 普通沟通页：比较当前候选人详情里的沟通岗位 `chatJob`，不是顶部筛选 `chatFilterJob`；没有当前会话时不能据此确认筛选。
- 搜索／推荐页：比较页面当前搜索／推荐岗位条件。
- `--embedded`：比较内嵌会话岗位；`--state job-selected`：比较联系选岗弹层的已选岗位。
- 核验顶部沟通筛选应读取 `status --json` 的 `chatFilterJob`，或使用岗位切换脚本的明确回执。账本完整岗位键（含城市、去薪资）不得直接当作无城市的 `chatJob` 比较值。

## 业务命令的默认比较标准

| 命令 | 默认比较标准 |
| --- | --- |
| chat 姓名 --check [--data-id ID] | 沟通页当前选中会话与姓名/可选ID一致，详情姓名一致 |
| send --name 姓名 --data-id ID --text 正文 --check | 当前目标独立会话匹配、输入框可编辑且无草稿、已加载消息没有同文；不表示服务端允许发送 |
| accept-resume 姓名 --data-id ID --check | 当前目标会话匹配且有可用的待同意附件请求 |
| download-resume 姓名 --data-id ID --check | 当前目标会话匹配且存在已收到附件卡片；不验证下载完成 |
| greet 姓名 --candidate-id ID --check | 搜索：当前简历身份匹配且按钮可用，未打开为false；推荐：当前列表卡片身份唯一且打招呼按钮可用，简历覆盖列表为false；均不点击 |
| greet ... --continue-chat --check | 当前简历及列表身份匹配，按钮为继续沟通；列表卡片已移除时返回false，不能据此认定未联系 |
| greet ... --select-job 岗位 [--confirm-contact] --check | 候选人匹配且弹层已选中指定完整岗位；不代选或确认 |
| chat ... --embedded --check | 内嵌候选人ID、姓名、岗位与编辑器关联匹配 |
| send ... --embedded --text 正文 --check | 上述内嵌身份匹配、可编辑无草稿、已加载消息没有同文 |
| recommend 岗位 --check-job | 当前推荐页岗位匹配，只比较 |
| back --check-in_online_resume | 当前为独立在线简历页或存在在线简历弹层，只比较 |
| --check-login | 已登录为true、未登录为false、无法判断报错 |

原条件动作改名：`recommend 岗位 --ensure-job` 在岗位不同情况下选择；`back --if-open` 在已打开简历时返回/关闭，已在列表时不动。它们是业务动作，不是检查，仍须符合本轮授权。

## SOP 调用方迁移

1. 先读取status或运行有明确比较标准的check。检查结果必须按布尔解析，不再读取ready/status/identityVerified字段。
2. false时停止该业务动作，根据status与用户授权处理差异；不能解释为“从未发送”。异常同样停止。
3. true且已获准时，执行不带--check的业务命令；保留姓名、ID、岗位和正文等参数。检查本身绝不记为联系/发送/接收/下载成功。
4. 动作后根据真实回执及页面证据记账。已发同文、历史不完整或发送结果不明不得补发；状态检查不是持久化幂等保障。
5. 检查和动作之间可能发生人工页面变更，实际业务命令仍须内部核验身份。不得因为check=true而绕过原有保护。

当前实现无真实页面验收；本次仅本地夹具验证，不宣传整个发送去重链路已完成。

## 收件字段不可混用

`probe-resume.request` 仅代表我方已加载消息中是否出现求简历话术，绝不代表候选人申请发送简历。不能据此跳过同意，也不能改成无条件同意后下载。`accept-resume --check` 判断候选人的可用同意请求；`download-resume --check` 判断收到的附件卡片。检查false但用户指出存在请求时，停止并排查读取证据，不盲目操作。
