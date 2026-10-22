---
title: "岗位账本、回执和故障恢复"
read_when: "启动正式业务、停止、恢复或合并外部操作证据"
updated: "2026-10-22"
scope: "ledger"
---

# 账本与恢复

## collect协议

每个完整岗位名对应SHA-256文件名；默认 `~/.boss-cli/ledgers`。同名不同职位ID尚不能区分。每岗只能一个存活会话。

启动前必须按[路径核验规范](paths.md)确认固定ledgerDir及expectedLedgerFile；启动后逐项核对started/job/file/recoveryRequired，file必须与预期绝对路径一致，否则停止业务并正常关闭新会话。下面每行是给**同一进程stdin**的独立命令，等待前一条结果，不一次性提交：

```json
{"op":"show"}
{"op":"add","job":"目标岗位完整名称","dataId":"实际ID","name":"实际姓名"}
{"op":"decision","dataId":"实际ID","decision":"PASS"}
{"op":"stop"}
```

| op | 用法与边界 |
| --- | --- |
| show | 读取账本与恢复状态 |
| add | 新会话入账，核对完整岗位、姓名、dataId；不能用推荐脱敏名伪造ID |
| decision | PASS保存通过；FAIL删除正式账本记录，本轮回执保留原因 |
| round | `{"op":"round"}`遍历已有账本；不扫描新人、不评分、不自动发消息或上传。只用于用户明确范围的特殊模式 |
| recheck | `{"op":"recheck"}`人工明确触发，复查RECHECK；进入全部，仅核对证据，不下载发送 |
| reconcile | `{"op":"reconcile"}`人工明确触发，全量对账解除恢复；会操作页面，禁止页面操作时不能执行 |
| stop | 等在途任务退出，原子写回；等stopped与进程退出才称保存成功 |

## 数据及持久化

candidate字段：dataId、name、createdAt、updatedAt、attachment、status、decision。status为PENDING／WAITING_ATTACHMENT／DOWNLOADED／RECHECK；decision为PENDING／PASS，FAIL会删除。不要扩展为自造“已触达”状态，触达意图与等待回复写独立回执。

启动写reading标记，业务修改主要在内存；正常stop写回。EOF、杀进程、崩溃不是正常保存，内存结果可能丢失。每完成一个动作及时保存独立回执，不等最后才记。

回执至少含：runId、JD与规则、岗位、身份依据、观察计数、来源、评估证据、动作前意图、实际正文和时间、页面确认、附件路径／bytes／sha256、错误、停止原因。模板见[run.example.json](../assets/run.example.json)。忽略对象只放本轮记录。

## 外部结果合并

独立CLI下载或发送不会自动更新collect。先保存真实回执，stop当前collect并确认退出，才允许在离线阶段用当前源码的 `Ledger.load/recordProbe/recordFailure/stop` API写回。stdin没有这些op，不直接改活动JSON。当前包不提供未经测试的通用合并脚本；需要实现时先按实际API及回执schema验证，未合并前明确报告“外部结果已保存，账本尚未同步”。

只有真实附件证据才能写RECEIVED；消息3不能写附件请求SENT；NOT_OBSERVED仅表示已加载历史未看到。新的空探测不能覆盖之前已核验发送或下载证据。RECHECK不能用旧回执自动解除。

## 恢复

reading／reconciliationRequired存在时先停普通业务，保持原文件，展示错误及待恢复内容。reconcile需要用户授权页面全量对账；本轮已明确授权时不重复询问。要求“仅恢复本地、不操作页面”时，只核验本地回执，不清除必须页面对账的标记，保留未决并报告。

过期锁先核实所属PID已退出；损坏JSON、身份冲突、无法识别锁直接报错，不自动覆盖或删锁。恢复不能重发不明消息，也不能从历史未找到就推断没发。

附件超时先确认子进程退出，再记录RECHECK并保留证据；普通错误停止。页面上下文销毁时现有CLI仍可能内部重试一次，这不是本Skill新增授权，不承诺工具已无重试。

## 搜索触达记账

搜索过程的业务记录不能等待消息成功才建立。正式 collect 的 status 枚举保持不变；下列为独立触达回执中的业务阶段，不写入其 status，也不伪造 dataId。

| 回执业务阶段 | 必须保存的事实 |
| --- | --- |
| 待联系 | 候选人 ID、目标岗位、评估证据、触达意图 |
| 联系结果待核验 | 是否已点击、入口、时间、原始回执／错误，不重试 |
| 已联系待发消息 | 联系成功证据、候选人 ID；窗口身份核验失败仍保留此阶段 |
| 发送结果待核验 | 正文、发送动作是否发生、时间、会话依据及错误，不补发 |
| 已发送待回复 | 同一会话新消息可见证据、实际正文、时间 |

触达前将记录保存到已配置 runDir 的持久回执，按目标岗位＋candidateId 去重；未知阶段标待核验，不能补成成功。没有会话 dataId 时标记“待关联正式账本”，保留 expectedLedgerFile 和回执绝对路径，不能将 candidateId 当作 dataId。取得真实会话 ID、实际显示姓名及岗位后，按 add/decision 协议关联正式账本，回执保存双方 ID 映射及证据。重复运行同时检查正式账本与这些待关联回执。

失败必须记录，但不把已联系者写 FAIL（该操作会删除正式记录）。已有正式记录保留；仍未取得会话 ID 的记录持续待关联。发送、内嵌窗口测试或 collect 同步失败时分别记录失败阶段与账本同步状态，报告“回执已保存／正式账本待关联或待同步”，不得谎称完整入账。禁止直接修改活动账本 JSON；合并仍遵守上文协议。回执保存失败时停止新的触达动作。
