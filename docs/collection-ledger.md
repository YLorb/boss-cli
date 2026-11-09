# 附件轮次与岗位账本

当前逐项调用方法见[调用手册](../skills/boss-recruitment/references/invocation-guide.md)。账本job使用完整岗位名称及城市，去掉薪资后缀；CLI按传入字符串区分，旧账本不自动迁移。下文无城市的示例只演示协议，不用于推断真实岗位归属。

## 主动寻访入口

2026-10-14 用户确认新增推荐、搜索 SOP，详见 [招聘采集执行手册](workbuddy-recruitment-runbook.md)“主动寻访 SOP”。评估合适后建立沟通，核对姓名、目标岗位及会话 data-id，去重入账并记录 PASS，再确认发送消息3。消息3用于首次机会沟通，不是附件请求，不能记作附件请求 SENT；等待回复及本轮处理进度使用独立回执保存，不擅自扩展现有账本状态。后续仅在候选人出现指定岗位未读时进入正常处理，不巡查全部等待者。该入口仍需实现及验收，不改变下文现有命令的能力边界。

## 流程起点

`boss collect --job "岗位完整名称" [--mode <screen|collect-only>]`：

- `screen`（默认）：完整收集 SOP = 评估 + 决策 + 收件。`decision` 必须带 `evidence.verdict`，且与决策一致（PASS↔fit、FAIL↔not-fit），`evidence.ref` 可选指向评估回执；无评估证据或结论不一致即拒绝。
- `collect-only`：仅收集简历/材料，不做匹配评估。`decision` 不要求评估证据。
- 会话中途切换用 `{"op":"mode","value":"screen|collect-only"}`，切换记录写入 `<账本>.decisions.jsonl` 审计流。
- `decision PASS` 与 `decision FAIL` 都携带同款 `evidence`；评估结论为 unknown 时保持 `decision=PENDING`，不改账本。

2026-10-13 用户纠正：正常SOP只在目标岗位“未读”中逐人执行，评估一人后完成其消息/收件或等待处理，再读取下一人；附件先存本地，本轮收集结束后统一上传。对账、复查或仅收集须人工明确声明。**下文round是现有全账本命令的技术说明，不是正常SOP默认步骤**；严格未读及单对象调度尚未由round实现。详见 [WorkBuddy执行手册](workbuddy-recruitment-runbook.md)。

登录和岗位确认完成后，候选人处理流程必须按以下顺序开始：

1. 首先启动 `boss collect --job "岗位完整名称"`，保持该常驻进程及其 stdin 打开；后续轮次复用同一会话。
2. 等待 `ok:true,event:started`，核对返回的 job、file 和 recoveryRequired。启动失败立即停止流程，不能继续处理候选人。
3. recoveryRequired 为 true 时，暂停普通处理，等待人工显式发出 `{"op":"reconcile","recoveryAuthorized":true}`。全量逐项对账成功、`show` 返回 recoveryRequired=false 后才能继续；不得自动触发对账或绕过恢复状态。
4. 在该会话发送 `{"op":"show"}` 读取已有账本，再读取 BOSS 未读列表，核对岗位并将新候选人 add 到同一会话。已有决策和进度继续复用，RECHECK 仍只由人工 recheck 指令触发。
5. 正常模式按未读逐人执行筛选决策和后续动作，不调用全账本round。特殊模式在人工明确范围内使用round或原子命令；每条完成后再执行下一条。停止时向同一会话发送 `{"op":"stop"}`，收到 `ok:true,event:stopped` 后才确认账本已写回。

collect 是流程第一个常驻步骤。读取列表等独立 CLI 命令由外部编排器或另一个终端串行调用，不在 collect 的 stdin 输入 shell 命令，也不与正在执行的轮次并发操作 BOSS 页面。

## 常驻会话

```powershell
boss collect --job "模型评估工程师"
```

stdin 每行接收一个 JSON 对象，stdout 每行返回一个 JSON 结果。保持同一个进程，等待上一条结果后再发下一条命令。

```json
{"op":"show"}
{"op":"add","job":"模型评估工程师","dataId":"123-0","name":"测试候选人"}
{"op":"round"}
{"op":"decision","dataId":"123-0","decision":"PASS"}
{"op":"round"}
{"op":"show"}
{"op":"stop"}
```

现有round命令处理已经加入账本的候选人，仅在人工明确的特殊范围内使用。正常SOP由外部编排器从 `boss list --unread --json` 逐人取得对象后显式add，完成一人的评估与发送/收件或等待后再处理下一人。代码在**有监督环境下**可以自行筛选、上传招聘系统、**严格根据流程**自主发送消息。附件先存本地，收集完成后统一上传。FAIL决策直接删除账本记录，不点击BOSS的“不合适”按钮。

当前 collect 已实现账本、附件探测与下载，筛选执行、招聘系统上传和自主消息发送编排尚未接入。接入后仍须遵守本文的超时停止、人工复查触发和发送前核对规则。

默认目录 `~/.boss-cli/ledgers`，可用 `--ledger-dir` 指定。每个岗位完整名称对应一个 SHA-256 文件名，header 保存岗位名。同一岗位只能有一个存活会话。job 必须与沟通职位的完整名称一致，不支持区分名称完全相同的不同职位 ID。

stop 到达后不再接受新任务，取消尚未开始的排队任务，等当前候选人命令退出后原子写回，不继续下一人。不要一次输入所有命令和 stop，否则排队任务会被取消。Ctrl+C / SIGTERM 也视为停止指令；直接关闭 stdin 或进程中断保留逐人已提交结果，在途附件操作留为该人的 RECHECK。

写回使用同目录临时文件、文件同步和原子 rename。失败直接报错，保留原文件及临时文件。

## 七字段

```json
{
  "header":{"version":1,"job":"模型评估工程师"},
  "candidates":[{
    "dataId":"123-0",
    "name":"测试候选人",
    "createdAt":"2026-10-13T00:00:00.000Z",
    "updatedAt":"2026-10-13T00:00:00.000Z",
    "attachment":{"probe":null,"lastError":null},
    "status":"PENDING",
    "decision":"PENDING"
  }]
}
```

- status：PENDING、WAITING_ATTACHMENT、DOWNLOADED、RECHECK。
- decision：PENDING、PASS；提交 FAIL 后立即从正式账本原子删除。
- attachment.probe：最近成功探测的附件、请求消息证据和下载详情；lastError 保存失败上下文。超时保留已有证据和决策，只更新状态、错误与修改时间。

## 超时和人工复查

2026-10-26：已有候选人定位统一改为全部职位昵称搜索，不再滚动查找。重名通过CandidateSelectionRequired暂停当前轮次，等待用户手动确认或进一步指令；不继续下一人，不改写候选人状态或附件错误。姓名、会话ID及岗位核验仍须通过，已有ID不能用于自动跳过重名暂停。

```powershell
boss probe-resume "测试候选人" --data-id "123-0" --json
boss probe-resume "测试候选人" --data-id "123-0" --download --json
```

probe-resume、accept-resume、download-resume 使用独立子进程，整条命令限时 15 秒，覆盖连接、定位、检查、可选下载和退出清理。超时杀死执行进程，确认 close 后返回 AttachmentTimeoutError。已经发到 Chrome 的动作不会撤销，浏览器已经开始的下载也可能继续。

普通 round 跳过 RECHECK，不在同轮重试；只有此前筛选 PASS 的候选人才在普通轮次下载。人工发出 `{"op":"recheck","recoveryAuthorized":true}` 才逐人复查，每次指令每人一次，与未读列表无关。流程为「沟通—全部 → 姓名和 data-id 定位 → 检查附件 → 检查已发送请求」。复查只读取证据，不下载、筛选或发送，后续显式 round 根据已有决策继续。

探测仅证明已加载消息中的事实：attachment=RECEIVED 表示看到附件，request=SENT 表示看到己方完整话术“你好，方便发一份你的简历过来吗？”或历史版本“方便发一份你的简历过来吗？”。未看到时返回 NOT_OBSERVED，不能解释成无附件或未发送；自定义话术和未加载历史需人工核对，不能据此自动补发。已确认的发送证据和下载进度不因本次未观察到而清空。

普通错误也保留候选人为 RECHECK，但直接终止当前轮次并报错；只有确认执行进程退出的附件超时允许处理下一人。外部编排器在超时后不得继续该候选人的筛选、发消息或上传。任何补发或平台求附件前都必须核对发送结果；招聘系统重传幂等由服务端保证，仓库当前没有上传适配器。

## 故障恢复

新会话以岗位锁互斥，每笔候选人变更在成功回执之前保存。旧版 reading:true 或未完成的 reconciliationRequired:true 要求全量恢复，普通 round、recheck、add 和 decision 暂停。仅有个人 RECHECK 时保留其他人的进度。没有明确恢复授权时只提示“有信息需要恢复。”

人工发出 `{"op":"reconcile","recoveryAuthorized":true}` 后，从顶部遍历「沟通—全部」主列表 `.chat-user .user-container > .user-list`。只有组件 `loading$=0`、`hasMore$=false`、`.load-tips` 非加载态可见且滚动到底，才可结束；同时检查组件中已加载的会话ID均已读取，折叠或虚拟化漏项不能当成完整结果。零结果须有无更多数据与可见“暂无牛人”的共同证据。容器/标志/加载状态缺失、加载超过20秒、未回到顶部或超过扫描上限均报错，不回退旧容器、不返回部分列表。按完整岗位名补回上次只存在内存中的候选人，与原账本合并，再逐项检查附件、请求消息；原账本记录不会因列表缺失而直接删除。

全部成功才解除恢复限制。全量对账开始前持久化 reconciliationRequired:true，发生超时、错误或中途停止时保留该标记。对账只恢复 BOSS 页面证据，新补回记录 decision 为 PENDING。全量列表扫描经过其他岗位的行，但逐项检查仅针对本岗位。

旧锁所属进程退出后可重新获取岗位锁。锁获取由 `.opening` 文件串行保护；若恰在获取期间崩溃，错误指出此文件，需要确认文件中的进程已退出后删除它。损坏 JSON、身份冲突、不可识别的锁均直接报错，不自动覆盖。

## 验证

`npm run build`、`npm run test:collection` 覆盖内存写回、reading 恢复、岗位隔离、FAIL 删除、进程退出、人工复查和停止。真实 BOSS 选择器、话术和下载仍需登录环境验收；测试不向真实候选人发送消息。
