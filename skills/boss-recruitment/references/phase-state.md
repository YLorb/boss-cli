---
title: "阶段校验（phase）"
read_when: "本轮按阶段推进、切换阶段、或动作被阶段拒绝"
updated: "2026-11-08"
scope: "phase-state"
---

# 阶段校验

本轮任务按声明顺序分阶段推进（如先 collect、再 recommend、再 search），当前阶段只放行该阶段声明的命令。Agent 选动作，CLI 检查并拒绝越界。

## 开关

- 阶段定义：task config 的 `phases` 数组（见[任务配置](task-config.md)）。
- 当前阶段：`BOSS_PHASE_STATE` 指向阶段状态文件（`{version:1, phase, at}`）。

`BOSS_PHASE_STATE` 未设置时不拦截；设置了但 task config 未声明 `phases`、或阶段状态未初始化，则 fail-closed。

## phases 结构

```json
{
  "phases": [
    { "name": "collect",   "allowed": { "collect": [], "list": [], "chat": [], "probe-resume": [], "ocr": [], "action": ["resume"] } },
    { "name": "recommend", "allowed": { "recommend": [], "preview": [], "greet": [], "decide": [] } },
    { "name": "search",    "allowed": { "search": [], "search-more": [], "preview": [], "greet": [], "back": [], "decide": [] } }
  ]
}
```

- `name` 唯一，按声明顺序推进。
- `allowed` 复用 permit 的「命令名 → 变体数组」结构；`[]` = 命令名级放行，非空 = 变体白名单（仅 `action` 支持子动作粒度）。

## 命令

```
boss phase-set --phase <阶段名> [--json]   # 校验阶段名存在，写入当前阶段
boss phase-status [--json]                  # 读当前阶段
```

- `phase-set` 校验阶段名必须在 task config 的 phases 中，否则拒绝。
- 阶段切换动作本身可审计（写入阶段状态文件的 at 时间戳）。

## 越界拒绝

- 每个动作执行前，CLI 先过 permit（全局），再过 phase（阶段级）。
- 当前阶段未放行该命令 → `PhaseDeniedError`，退出码 2，fail-closed。
- 永不拦截：`phase-set`/`phase-status` 及只读诊断（status/check/flow-status/spec-list/task-check/task-init 等）。

## 与 permit 的关系

- **permit**：全局"能做什么"（跨阶段兜底）。
- **phase**：当前阶段"能做什么"（时间维度收紧）。
- 两者叠加：命令必须同时通过 permit 和当前阶段白名单。