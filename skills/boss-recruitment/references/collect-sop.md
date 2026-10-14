---
title: "未读简历收集SOP"
read_when: "用户要求收集指定岗位未读简历"
updated: "2026-10-14"
scope: "collect-unread"
---

# 未读简历收集 SOP

读取[共用规则](common-rules.md)、[账本](ledger-and-recovery.md)。输入目标岗位、JD及评估条件、获准消息、输出目录和本轮范围。禁止把 collect round 当成本 SOP。

1. 确认登录、当前岗位。启动 collect，等待 started，核对 job 和恢复状态，show 读取账本。
2. **本轮只获取一次起始未读快照**：`node .\dist\cli\index.js list --unread --json`，核对岗位，保存姓名、data-id及顺序。本轮不反复刷新列表，新到未读留下一轮。
3. 在仍保持本轮列表的前提下，根据当前可见行的身份重新定位起始快照中的下一人。`chat --index` 会重读当前列表，不能直接套用保存的旧序号；`chat --data-id` 会进入“全部”，不能冒充严格未读模式。若现有 CLI 无法维持边界，停止并报告，不能偷偷扩大范围。
4. 进入后核对实际 data-id、姓名、目标岗位。打开使未读消失不影响继续处理已核对的当前人。依照获准范围读取摘要／在线简历及评估；新对象 add 到当前账本，保存结论；FAIL 从正式账本移除但本轮保留原因，不点页面“不合适”。
5. 需要求附件且获准时，先核对已发送证据，再用当前会话联合键发送已确认话术。默认探测话术为“方便发一份你的简历过来吗？”，其他话术应依赖实际消息证据，NOT_OBSERVED 不能触发重复发送。
6. 已有附件则下载；出现待同意卡片才 accept；尚无附件只记等待。`--check` 仅在命中当前对象时不重新定位，不是绝对禁止进入全部。调用前必须确认当前身份，出现异常停止。
7. 下载使用 `--output-dir`，核对文件存在、bytes、SHA-256；保存回执。已获准且未发过收件确认才发送消息2。
8. 完成当前人后才继续起始快照下一人，不刷新未读，不巡查全账本等待者。不批量评估后再批量发送。
9. 保存本轮回执，collect stop 并等待写回。外部下载结果不会自动回写 collect，按账本说明合并。用户要求上传时才在收集完成后进入可选导入阶段。

典型命令（姓名与 ID 必须替换为已核对的真实对象）：

```powershell
node .\dist\cli\index.js action resume --json
node .\dist\cli\index.js send --name '候选人姓名' --data-id '实际ID' --check --text '方便发一份你的简历过来吗？' --json
node .\dist\cli\index.js accept-resume '候选人姓名' --data-id '实际ID' --check --json
node .\dist\cli\index.js download-resume '候选人姓名' --data-id '实际ID' --check --output-dir 'C:\Recruitment\runtime\resumes' --json
```

当前限制：严格固定起始未读集合的完整 CLI 调度尚未实现；不能把以上 SOP 宣称为一条命令即可完成。probe-resume 固定进入全部，正常严格未读循环不调用。附件命令15秒超时后先确认子进程退出，记录 RECHECK；不重试该人，不继续其消息或上传。普通错误停止本轮。
