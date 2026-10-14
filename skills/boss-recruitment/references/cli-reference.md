---
title: "CLI指令、示例与页面要求"
read_when: "需要某个命令的语法或副作用说明"
updated: "2026-10-14"
scope: "cli-reference"
source: "本地cliRouter、help、docs/boss-url-map.md"
---

# 命令参考

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
| `boss --check-login --json` | 只读检查已有BOSS标签，不导航；区分已登录、未登录和unknown |

业务命令 `--json` 输出原始结构；stdout为结果，stderr为日志。错误返回非零码和 `{ok:false,command,error:{name,message}}`。下载默认也是JSON。不能通过错误码推断副作用未发生。

## URL 与位置

| 页面 | URL路径 | 可用入口 |
| --- | --- | --- |
| 登录 | `/web/user/?ka=header-login` | login |
| 沟通 | `/web/chat/index` | list/chat/send/action/附件命令 |
| 推荐 | `/web/chat/recommend` | recommend/preview/greet |
| 常规搜索 | `/web/chat/search` | search/preview；greet不支持 |
| 深度搜索 | `/web/chat/aiform` | deep-search/preview/greet |
| 职位管理 | `/web/chat/job/list` | positions/jd |

网站为 `https://www.zhipin.com`。search/recommend按需进入对应页；preview/greet要求已经位于支持页面且列表已加载。不要让错误页面的按钮成为替代入口。

## 列表与会话

沟通页岗位切换使用CLI仓库的 `node .\scripts\switch-job.mjs --list` 与 `--job '完整label'`，不是boss子命令。调用前必须读取[脚本规范](switch-job.md)，参数、当前位置、结果核验和失败处理均按该规范执行。

```powershell
boss list --unread --json
boss list --chatting --json
boss chat '张三' --strict --json
boss chat '张三' --index 2 --unread --strict --json
boss chat '张三' --data-id '123-0' --json
```

list读取列表，--chatting选顶部“沟通中”，--unread选未读；输出姓名、data-id和岗位。不是F5，页面不匹配时仍会导航，筛选不一致时会点击。正常循环仅起始读取一次。

chat仅用于已有会话。默认姓名包含匹配，--strict精确匹配仍不能解决同名；index从1开始，指的是调用时列表，不能复用旧序号。--data-id联合姓名定位会进入顶部“全部”，不适合冒充严格未读定位。chat --json返回已加载消息、摘要与附件事实，不证明历史完整。

## 推荐、搜索、预览与打招呼

```powershell
boss recommend '目标岗位关键字' --json
boss search '推理加速' --json
boss preview '唯一候选人姓名' --json
boss greet '唯一候选人姓名' --job '岗位关键字' --json
```

recommend岗位模糊匹配；核对实际完整名称。search关键词最多20字符，不带词只读取当前状态；不支持--job、不设置不限职位、不提供加载更多。preview保存在线简历截图并关闭弹层，会消耗查看次数；不做OCR。姓名歧义先停止。greet仅推荐／深度搜索可用，会消耗次数并可能发送平台默认问候，必须核对实际结果，不凭clicked计成功。

```powershell
boss deep-search --core '模型推理优化' --core '源码实现经验' --bonus 'CUDA' --json
boss deep-search --clear-bonus --json
boss deep-search --match --json
```

deep-search支持岗位位置参数或--job；--core/--bonus可重复，按给定列表同步分组，多余项会被删除；--clear-core/--clear-bonus清空。默认返回表单及剩余额度，只有--match点击匹配并消耗额度，返回顶部最新20条。此入口不是常规搜索SOP，不能自动替换。

## 发送与当前会话动作

```powershell
boss send --name '张三' --data-id '123-0' --check --text '已确认的话术' --json
boss action resume --json
boss action remark --remark '用户要求的备注' --json
```

send支持--text/-t；不带联合键时发送当前会话，自动化应先核对身份。--check命中当前ID时只读核对，未命中会正常定位全部。--request-resume会在发消息后追加求简历动作，不用于消息3。send使用剪贴板粘贴，会覆盖系统剪贴板。

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
boss accept-resume '张三' --data-id '123-0' --check --json
boss download-resume '张三' --data-id '123-0' --check --output-dir 'C:\Recruitment\runtime\resumes' --json
```

probe-resume进入全部核对附件与默认求简历话术；--download才下载，不接受--check。accept-resume只在出现待同意卡片时操作并等待附件，不发文字。download-resume下载已收到的原附件，返回path、bytes、sha256等。三者整命令15秒预算；超时终止子进程不撤销已发送给浏览器的动作。

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
