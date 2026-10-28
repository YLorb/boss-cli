---
title: "未读简历收集SOP"
read_when: "用户要求收集指定岗位未读简历"
updated: "2026-10-14"
scope: "collect-unread"
---

# 未读简历收集 SOP

在线简历截图成功后，立即按[异步 OCR 规范](resume-ocr.md)由 Agent 后台执行公开 `ocr` 命令；等本人的结果完成后优先读文字评估，保留原图核验。不得以异步为由跳过逐人处理、提前评分或触达。


读取[共用规则](common-rules.md)、[账本](ledger-and-recovery.md)。输入目标岗位、JD及评估条件、获准消息、输出目录和本轮范围。禁止把 collect round 当成本 SOP。

1. 确认登录；按[岗位切换边界](switch-job.md)由用户切换后通过公开 CLI 的 status.chatFilterJob 核验目标沟通岗位，不把 collect --job 当成页面切换。启动 collect，等待 started，核对 job 和恢复状态，show 读取账本。
2. **本轮只获取一次起始未读快照**：`node .\dist\cli\index.js list --unread --json`，核对岗位，保存姓名、data-id及顺序。本轮不反复刷新列表，新到未读留下一轮。
3. 仅按起始快照中的姓名、data-id及目标岗位定位下一人。依照用户确认的新[定位流程](chat-candidate-location.md)，`chat "完整昵称" --data-id "快照ID"` 直接按昵称搜索，不主动切换或恢复岗位，唯一匹配才打开，再核验原对象ID及岗位；搜索范围不构成新增候选人授权。此前已取得并与该对象关联的info，可通过chat的--info传入原文，按完整姓名和info精确筛选；不重新取未读、不猜填、不因无匹配移除条件。筛选后仍重名时暂停等待用户手动确认或进一步指令，不按ID挑选、不滚动查找、不处理下一人。`chat --index` 仅从调用时列表取得身份再搜索，不能直接套用保存的旧序号；搜索后BOSS可能重置岗位及未读视图，后续使用原快照联合键，不刷新未读或重新取序号。无法维持快照边界时停止并报告。
4. 进入后核对实际 data-id、姓名、目标岗位。打开使未读消失不影响继续处理已核对的当前人。依照获准范围读取摘要／在线简历及评估；新对象 add 到当前账本，保存结论；FAIL 从正式账本移除但本轮保留原因，不点页面“不合适”。
5. 需要求附件且获准时，先核对已发送证据，再用当前会话联合键发送已确认话术。默认探测话术为“你好，方便发一份你的简历过来吗？”，其他话术应依赖实际消息证据，NOT_OBSERVED 不能触发重复发送。
6. 已有附件则下载；出现待同意卡片才 accept；尚无附件只记等待。`--check` 严格只读并返回布尔；检查通过后，获准的真实业务动作需去掉 --check，出现异常停止。
7. 下载使用 `--output-dir`，核对文件存在、bytes、SHA-256；保存回执。已获准且未发过收件确认才发送消息2。
8. 完成当前人后才继续起始快照下一人，不刷新未读，不巡查全账本等待者。不批量评估后再批量发送。
9. 保存本轮回执，collect stop 并等待写回。外部下载结果不会自动回写 collect，按账本说明合并。用户要求上传时才在收集完成后进入可选导入阶段。

典型命令（姓名与 ID 必须替换为已核对的真实对象）：

```powershell
node .\dist\cli\index.js action resume --json
node .\dist\cli\index.js send --name '候选人姓名' --data-id '实际ID' --check --text '你好，方便发一份你的简历过来吗？' --json # 只读检查，返回true/false
# 仅检查为true且获得本轮授权后执行：
node .\dist\cli\index.js send --name '候选人姓名' --data-id '实际ID' --text '你好，方便发一份你的简历过来吗？' --json
node .\dist\cli\index.js accept-resume '候选人姓名' --data-id '实际ID' --check --json # 只读检查，返回true/false
# 仅检查为true且获得本轮授权后执行：
node .\dist\cli\index.js accept-resume '候选人姓名' --data-id '实际ID' --json
node .\dist\cli\index.js download-resume '候选人姓名' --data-id '实际ID' --check --output-dir 'C:\Recruitment\runtime\resumes' --json # 只读检查，返回true/false
# 仅检查为true且获得本轮授权后执行：
node .\dist\cli\index.js download-resume '候选人姓名' --data-id '实际ID' --output-dir 'C:\Recruitment\runtime\resumes' --json
```

当前限制：严格固定起始未读集合的完整 CLI 调度尚未实现；不能把以上 SOP 宣称为一条命令即可完成。probe-resume 的指定对象定位已采用相同昵称搜索，但不提供未读边界保证，正常循环仍按本SOP逐人执行。附件命令15秒超时后先确认子进程退出，记录 RECHECK；不重试该人，不继续其消息或上传。重名暂停不是附件失败，不写RECHECK；普通错误停止本轮。

收件状态遵循 [check/status规范](check-status.md#收件字段不可混用)：probe-resume.request 是我方求简历话术证据，不是对方待同意请求，禁止用它决定是否跳过同意。
