---
title: "绝对路径、固定账本及collect路径核验"
read_when: "配置目录、换工作区、启动或停止collect"
updated: "2026-10-14"
scope: "runtime-paths"
---

# 路径约定（强制）

| 字段 | 含义与约束 |
| --- | --- |
| cliDir | 含package.json与dist的CLI执行目录，业务命令cwd固定为此绝对路径 |
| workspaceDir | 本轮Agent工作区绝对路径，不等于cliDir |
| runDir | 本轮配置、快照、回执的绝对路径，可位于workspaceDir下 |
| resumeDir | 下载附件的绝对路径，通过--output-dir显式传递 |
| screenshotDir | 本轮切片／导出目录的绝对路径；不是CLI原图保存配置 |
| ledgerDir | 跨工作区、跨轮次固定的岗位账本根目录，使用已确认的历史目录；不能每轮新建一份替代 |

禁止把裸 `runtime/ledgers`、`runtime/resumes` 等传给CLI，或依赖Bash默认cwd。相对配置必须在运行前按明确的workspaceDir一次性解析并持久化成绝对路径；没有指定基准则先澄清。Bash参数用带引号的正斜杠Windows路径，PowerShell使用引号保护空格；不能跨shell复用未经处理的反斜杠转义。

默认账本目录是当前用户的 `.boss-cli/ledgers`。首次选择自定义目录时先确认是否已有同岗位账本；已存在的任务专用账本不能不经核对直接视为长期主账本。发现多个目录同岗文件时，记录各自路径及状态，停止依赖历史去重的流程；由用户明确主账本与处理方案。未经指令不合并、不覆盖、不搬迁、不清除锁或恢复标记。

## collect启动核验

1. 启动前记录完整岗位名、固定ledgerDir、cliDir、workspaceDir。目录通过绝对路径规范化；不要用岗位展示中的城市／薪资后缀替代账本完整岗位名。
2. 使用UTF-8岗位名计算SHA-256，得到 `expectedLedgerFile = resolve(ledgerDir, sha256(job) + '.json')`。该值在启动前确定，不得根据工具返回file反向改成“匹配”。
3. 在cliDir运行 `node ./dist/cli/index.js collect --job '完整岗位名' --ledger-dir '固定绝对目录'`，保持stdin。等待 `ok:true,event:started`。
4. 必须核验：返回job与预期完全一致；file是绝对路径，规范化后与expectedLedgerFile为同一文件路径；检查recoveryRequired。只核对文件名或岗位哈希不够，因为不同目录可有同名账本。符号链接／junction产生歧义时，明确解析到同一物理路径再继续，不猜测。
5. 通过后才发送show和后续业务指令。路径或岗位不符时，不add、不decision、不round、不处理候选人；记录错误与两条绝对路径，只对刚创建的会话正常stop并等待退出，不直接杀进程，不删除生成文件。
6. stop返回file也必须与预期一致，确认stopped及进程退出。回执保存expectedLedgerFile、started.file、stopped.file及本轮实际CLI版本和路径，供恢复核查。

岗位账本锁只在所属目录有效；同岗不同目录的两个进程不会互斥。文件名相同不代表共享账本。

## 截图与消息错误

CLI原图目前保存到用户 `.boss-cli/.cache/resume-screenshots`，以preview/action返回的绝对path为准；screenshotDir仅保存本轮切片。记录两者关联，不假定配置能改变原图目录。

目录核验解决存储和去重问题，不证明发送输入框故障已解决。消息结果不明继续按发送停止规则处理，不因修正路径而自动补发。
