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

## 校验入口

```
boss task-check [--json]
```

- 读 `BOSS_TASK_CONFIG` 指向的文件，校验结构、permit 文件存在且有效。
- 交叉校验：permit 若声明 `job`/`entry`，必须与任务配置一致，否则 fail-closed。
- 返回 `{ok:true, task, permit, permitFile}`；失败报错定位字段。

## 与其它配置的关系

- **permit**（`permit.allowed`）仍负责"能做什么"；task config 负责"做什么/边界到哪/何时停"。
- **runId、flow-state、账本、版本的绑定**在「统一启动」一步生成，本文件只声明静态任务结构与校验入口。
- 这是编排级声明，不是系统级权限隔离；不阻止 Agent 另起炉灶直连 CDP（见 tool-boundary）。