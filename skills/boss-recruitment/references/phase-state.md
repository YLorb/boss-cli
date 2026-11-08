---
title: "阶段与业务前置条件"
updated: "2026-11-08"
scope: "phase-state"
---

# Agent 选择合法分支

正式任务执行 task-init 后自动启用阶段/业务状态。Agent通过 `boss phase-status --json` 查看当前阶段、allowedActions、blockedActions、suggestedAction、当前对象及未决动作。建议下一步不构成额外授权；实际执行前再次校验。

## 自由与边界

Agent可以选择多个合法分支、读取已收集材料、判断 fit/not-fit/unknown，并在本轮授权内补充核验。程序不替 Agent 做主观评价。下列条件由真实命令回执建立，不能靠换阶段名声明已完成：

| 动作 | 前置条件 |
| --- | --- |
| 定位/预览/收件 | 当前岗位已核验、稳定ID在冻结范围内 |
| OCR | 图片属于当前人的已返回截图 |
| decide / screen收集决策 | 本人的 OCR 已完整返回 |
| greet | 本人已评估fit，未超过触达上限，历史动作无未决/重复 |
| 收集下载 | screen已评估fit；collect-only按明确授权收集 |
| 消息2 | 已有实际下载文件回执，正文等于本轮授权 |
| 寻访消息 | fit、联系确认、授权正文、没有已发送或未决记录 |

首次用带 `--job <完整岗位>` 的check且返回true，或status实际岗位匹配，建立岗位核验。只读检查通过不是业务动作成功。正式业务命令带 --json；截图/OCR原文件保留，滚轮及随机停顿不变。

## 可选阶段序列

```json
{
  "phases": [
    {"name":"read","allowed":{"list":[],"chat":[],"preview":[],"ocr":[],"decide":[],"back":[]}},
    {"name":"contact","allowed":{"greet":[],"send":[],"back":[]},"requires":["evaluated","no-pending"]}
  ]
}
```

task-init从第一个阶段开始。`phase-set --phase <名字> --json`只能保持当前阶段或前进一个阶段：当前阶段须有成功业务回执、无暂停/未决动作，且目标阶段requires全部满足。禁止跳步和倒退；默认业务门始终有效。

requires支持job-verified、scope-frozen、material-ready、evaluated、download-confirmed、no-pending。它们读取程序保存的回执状态。allowed复用permit命令/子动作格式，并与全局permit取交集。

## 停止、恢复与历史

到截止时间、观察/触达上限、连续失败阈值时拒绝依赖动作。验证/疑似风控会暂停；全局暂停时也不继续访问页面。phase-status和flow-status为本地状态读取。

发送或联系前保存持久意图，失败未知保留未决。只读status不会清除未决。明确的发送前失败可按既有授权核验后重试；结果未知不能按未发送处理。消息核验必须匹配同人、同岗、完整正文；历史未找到不等于未发送。

flow-resume必须在permit里显式授权，且仍有未决动作时不能恢复。旧账本恢复/对账继续遵守 ledger-and-recovery.md 的岗位与恢复范围授权规则。不得直接改状态JSON清锁。

手工模式的 BOSS_PHASE_STATE 仅提供显式阶段能力；正式任务需要task-init建立完整状态。该机制不是操作系统权限隔离。