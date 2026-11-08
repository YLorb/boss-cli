---
title: "统一任务配置（task config）"
read_when: "本轮启动前创建任务配置、task-check 校验失败或需要调整岗位/范围/停止条件"
updated: "2026-11-08"
scope: "task-config"
---

# 统一任务配置

本轮任务的唯一声明入口：岗位、范围、permit 引用、停止条件。启用后由 `boss task-check` 校验，失败即停止。

## 开关

```
BOSS_TASK_CONFIG=<任务配置绝对路径>
```

未设置时，其它命令不受影响；但 `task-check` 必须设置后才能运行。

## 结构

```json
{
  "schemaVersion": 1,
  "job": "全栈软件开发工程师 _ 深圳",
  "scope": "collect",
  "permit": "C:\\...\\permit.json",
  "stop": {
    "observeLimit": 20,
    "contactLimit": 5,
    "deadline": "2026-11-08T19:00:00Z",
    "maxConsecutiveFailures": 3
  }
}
```

| 字段 | 必填 | 说明 |
| --- | --- | --- |
| schemaVersion | 是 | 固定 `1` |
| job | 是 | 账本岗位键（完整岗位名 + 城市 + 去薪资） |
| scope | 是 | `collect` / `recommend` / `search` / `view-only` |
| permit | 是 | 指向独立 permit 文件的绝对路径（授权 `allowed` 在 permit 层） |
| stop.observeLimit | 否 | 本轮允许打开的在线简历数上限 |
| stop.contactLimit | 否 | 本轮允许主动触达（greet/confirm-contact）人数上限 |
| stop.deadline | 否 | 本轮绝对截止时间（可解析 ISO 字符串） |
| stop.maxConsecutiveFailures | 否 | 同类动作连续失败达到阈值即自动暂停 |
| phases | 否 | 阶段序列（见[阶段校验](phase-state.md)）：`[{name, allowed}]`，声明后启用阶段级白名单 |

## 校验入口

```
boss task-check [--json]
```

- 读 `BOSS_TASK_CONFIG` 指向的文件，校验结构、permit 文件存在且有效。
- 交叉校验：permit 若声明 `job`/`entry`，必须与任务配置一致，否则 fail-closed。
- 返回 `{ok:true, task, permit, permitFile}`；失败报错定位字段。

## 统一启动（task-init）

```
boss task-init [--json]
```

- 校验 task config 与 permit（同上），然后生成确定性 runId（job 哈希前缀 + 秒级时间戳）。
- 原子写入 `~/.boss-cli/runs/<runId>.json`，绑定：permit 路径、flow-state 路径（若设 BOSS_FLOW_STATE）、账本目录（`~/.boss-cli/ledgers`）、CLI/Skill 版本、stop 条件。
- 同岗位同秒重复启动由文件 `wx` 独占检测拒绝，不覆盖已有实例。
- 返回 `{ok:true, runId, createdAt, job, scope, permit, flowState, ledgerDir, cliVersion, skillVersion, compatibilityId, stop}`。

## 与其它配置的关系

- **permit**（`permit.allowed`）仍负责"能做什么"；task config 负责"做什么/边界到哪/何时停"；run 状态文件是"本轮运行实例"的绑定快照。
- **stop 条件本阶段只记录，不自动判定**；Agent 编排时读取 run 状态文件的 stop 字段自行执行停机。下一阶段再接进 CLI 自动判定。
- 这是编排级声明，不是系统级权限隔离；不阻止 Agent 另起炉灶直连 CDP（见 tool-boundary）。