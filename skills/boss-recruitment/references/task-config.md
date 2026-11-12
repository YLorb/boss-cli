---
title: "统一任务配置与运行绑定"
updated: "2026-11-08"
scope: "task-config"
---

# 正式任务

自然语言由宿主 Agent 整理为本地任务 JSON，CLI 负责校验。`BOSS_TASK_CONFIG` 指向绝对路径，先执行 `boss preflight --json`，通过后使用 `next.argv` 调用同一 CLI 初始化。已设置 `BOSS_TASK_CONFIG` 且没有运行绑定时，业务命令返回 `TASK_INIT_REQUIRED`；先按回执执行预检。`task-check` 可独立进行离线配置诊断。只对缺项、业务范围或授权有实质歧义时询问用户；不增加每轮重复确认。

```json
{
  "schemaVersion": 1,
  "job": "完整岗位名 _ 城市",
  "scope": "collect",
  "mode": "collect-only",
  "permit": "C:\\Recruitment\\permit.json",
  "jobSpec": "C:\\Recruitment\\job-spec.json",
  "ledgerDir": "C:\\Recruitment\\ledgers",
  "targets": [{"id":"实际会话data-id","name":"实际姓名"}],
  "messageScript": "用户已确认的完整对外话术",
  "stop": {"observeLimit":20,"contactLimit":0,"maxConsecutiveFailures":3,"deadline":"2026-12-01T18:00:00+08:00"}
}
```

- scope：collect/recommend/search/view-only。mode 仅用于 collect：screen（默认）或明确授权的 collect-only。
- jobSpec 若提供，必须是存在、可解析、schemaVersion=1且 job 匹配的绝对路径。规则内容仍按需读取，不能自行改标准。
- targets 是已核验的本轮名单；没有预先名单时，岗位核验后从第一次 list/recommend/search 的结构化回执冻结。ID 按入口区分，不凭姓名扩大对象范围。
- messageScript 是完整授权正文。未设置时不能发消息。消息2仍需下载成功，寻访消息仍需 fit 和联系确认。
- ledgerDir 是跨轮固定岗位账本目录；未填使用应用的 ledgers 目录。不可为每个 run 新建空账本规避历史。
- contactLimit 允许0，其他数值上限为正安全整数；deadline 必须含明确时区。未知字段或拼写错误直接拒绝。
- phases 可选，结构见 phase-state.md。不填时正式任务仍执行身份、材料、授权、停止和防重放检查。

## task-init 的结果

初始化回执包含 `runId` 和初始 `phase`。运行记录 schemaVersion=2，保存任务快照、任务/permit 内容哈希、实际 CLI/Skill 版本与路径、固定账本目录，并为本轮创建独立 flow/phase 文件。新任务替换本进程旧绑定，不能继承旧权限。

后续公开 CLI 自动加载当前运行指针；需要固定指定运行时可设置 BOSS_RUN_ID。显式环境变量和绑定冲突则报错，不能覆盖绑定。task-init 不消费旧运行绑定，因此可以明确创建新任务；新任务不能代替旧未决动作的核验。

指针损坏、指向丢失记录、任务/permit 改变、Skill错配一律停止。只有从未初始化且没有当前指针时保留手工命令模式。旧 schemaVersion=1 不自动迁移，明确重新初始化；保留历史账本与证据。

**`--keep-observed`（可选）**：只续用「上一轮同岗位运行」的 `observed`（已开过的简历 id）与 `material`（对应的截图/OCR 文本路径），其余字段仍从零开始。它不续用 `decisions`/`contacts`/`sent`/`downloaded`——评估结论、触达与下载回执必须按新任务重新取得，防重放仍由 flow journal 与岗位账本负责。上一轮状态不可读时降级为空起重来并打印原因，不阻断初始化。用途：改任务配置或重建运行时，不必把同一个人的简历再读一遍。

**版本漂移**：`cliVersion` 只作构建号，与已绑定运行不一致时默认**就地续绑**（写回运行记录并追加 `versionHistory` 审计项），观察/材料/未决全部保留；`skillDir`、`skillVersion`、`compatibilityId` 属契约身份，任一不一致仍必须重新 `task-init`。需要旧语义的严格校验时设 `BOSS_STRICT_VERSION_BIND=1`。

正式任务按 `boss commands <命令名> --json` 返回的 `formalUsage` 传参。使用公开命令名、长选项及独立参数值，业务命令加 `--json`，常驻 `collect` 按逐行 JSON 协议执行。BOSS_APP_HOME/BOSS_RUNS_DIR 是显式数据/测试隔离目录，必须使用固定绝对路径；不要在正常轮次间切换账户数据目录。

正式 collect 必须与绑定的 job、mode、ledgerDir 一致；stdin也受相同前置条件约束。联系/消息回执按岗位持久保存，未知结果不能因新建 run 而重放。

这是 CLI 入口的编排约束，不是宿主或操作系统权限隔离。