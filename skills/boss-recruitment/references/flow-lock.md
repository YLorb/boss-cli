---
title: "逐人闭环锁（搜索/推荐）"
read_when: "执行搜索或推荐寻访的 preview/greet/back 流程"
updated: "2026-11-08"
scope: "search-recommend-flow-lock"
---

# 逐人闭环锁

搜索/推荐 SOP 要求「打开 → 评估 → 立刻决策（greet 或 back）→ 下一个」。若 Worker 先批量打开多人再评估，Boss 列表在翻走后刷新，之前的候选人卡片会消失，导致无法联系。本锁由 CLI 在代码层强制这一顺序，不依赖 Worker 自觉。

## 开关

对 `preview`、`greet`、`back` 三条命令统一设置环境变量：

```
BOSS_FLOW_STATE=<本轮状态文件绝对路径>
```

未设置时行为不变（交互式、一次性脚本不受影响）。建议状态文件放本轮固定 runDir（如 `<runDir>/flow-state.json`）。

## 状态文件

```json
{ "version": 1, "open": { "candidateId": "…", "name": "…", "openedAt": "…" } | null }
```

`open` 表示「当前已打开、尚未决策」的候选人；缺失文件视为 `open:null`。

## 规则（deny 时 CLI 直接拒绝，不碰浏览器）

| 命令 | 上锁/解锁 | 拒绝条件 |
| --- | --- | --- |
| `preview [--open-only]` | 成功打开后上锁 `open=X` | 已有 `open=Y≠X` 未决策 → 拒绝：「候选人 Y 已打开未决策：不合适先 back，合适先 greet」 |
| `greet`（实际触达；不含 `--check`/`--select-job`/`--confirm-contact`/`--continue-chat`） | 成功触达后解锁 | 已有 `open=Y≠X` → 拒绝 |
| `back [--if-open]` | 成功关闭简历后解锁 | — |

- `preview` 失败（未实际打开）不落锁，Worker 可重试或按 SOP 继续；
- `greet --check`、`--select-job`、`--confirm-contact`、`--continue-chat` 是只读检查或触达后续步骤，不参与锁；
- `back --previous`、`back --check-in_online_resume` 是历史返回/只读检查，不解锁。

## 边界

- 仅作用于携带 `--candidate-id` 的 search/recommend 流程；深度搜索无 `--candidate-id`，不支持本锁，请勿对深度搜索设置该环境变量。
- 锁强制的是「逐人闭环」顺序，不判断「该不该联系」（fitness 判断仍是人/Worker）。「评估先于触达」是后续第二道门，见 TODO。
- 状态文件损坏 → 拒绝并报错（fail closed），不自动修复。
- 这是编排级护栏，不是系统级权限隔离。
