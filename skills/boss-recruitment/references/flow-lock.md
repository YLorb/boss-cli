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
{ "version": 1, "open": { "candidateId": "…", "name": "…", "openedAt": "…" } | null, "decided": { "<candidateId>": { "verdict": "fit|not-fit|unknown", "at": "…" } } }
```

`open` 表示「当前已打开、尚未决策」的候选人；`decided` 记录已评估候选人的结论；缺失文件视为 `open:null, decided:{}`。

## 规则（deny 时 CLI 直接拒绝，不碰浏览器）

| 命令 | 上锁/解锁 | 拒绝条件 |
| --- | --- | --- |
| `preview [--open-only]` | 成功打开后上锁 `open=X` | 已有 `open=Y≠X` 未决策 → 拒绝：「候选人 Y 已打开未决策：不合适先 back，合适先 greet」 |
| `decide --candidate-id X --verdict <fit\|not-fit\|unknown>` | 记录当前 `open=X` 的评估结论 | 无 `open` 或 `open≠X` → 拒绝 |
| `greet`（实际触达；不含 `--check`/`--select-job`/`--confirm-contact`/`--continue-chat`） | 成功触达后解锁 | 已有 `open=Y≠X` → 拒绝；`decided[X].verdict≠fit` → 拒绝（评估先于触达） |
| `back [--if-open]` | 成功关闭简历后解锁 | — |

- `preview` 失败（未实际打开）不落锁，Worker 可重试或按 SOP 继续；
- `greet --check`、`--select-job`、`--confirm-contact`、`--continue-chat` 是只读检查或触达后续步骤，不参与锁；
- `back --previous`、`back --check-in_online_resume` 是历史返回/只读检查，不解锁。

## 评估先于触达（decide）

- 评估完当前候选人后，Agent 执行 `decide --candidate-id X --verdict fit|not-fit|unknown` 记录结论；decide 只能针对当前 `open=X`。
- 实际 `greet X` 前，CLI 强制 `decided[X].verdict==='fit'`，否则拒绝：未评估 →「尚未评估，请先 decide」；not-fit →「已评估为不合适，请 back」；unknown →「评估结果待确认，请 back 后继续下一位」。
- `unknown` 只报告、不阻断本轮：back 后继续下一位，不视为淘汰。

## 执行日志（journal）

流程状态文件的 `journal` 数组机械记录每个候选人动作的「意图 → 结果」：

```json
{ "candidateId": "id-A", "name": "张三", "action": "greet", "phase": "intent", "at": "…" },
{ "candidateId": "id-A", "name": "张三", "action": "greet", "phase": "result", "result": "success", "at": "…" }
```

- 动作（preview/greet/back/decide）开始前 CLI 写 `phase=intent`，结束后写 `phase=result`，`result ∈ success/failed/unknown`；`failed` 带 error，`decide` 的 result 带 `evidence.verdict`。
- 详细证据（截图路径、联系状态）仍在命令回执与 Agent 回执中，日志以 `(candidateId, action, at)` 关联。
- 日志只在锁模式（`BOSS_FLOW_STATE`）下写入；未开锁不落日志。

## 接续判断（flow-status）

`boss flow-status --json` 从流程状态确定性推导每个候选人的接续状态：

- `done`（已完成）：greet 或 back 已 success。
- `continue`（可继续）：已打开未评估 → next=decide；decided fit → next=greet；decided not-fit/unknown → next=back。
- `needs-verify`（需核验）：greet 结果 failed/unknown → next=verify-greet，禁止自动重放。

`greet` 触达前 CLI 强制「同一候选人本轮只允许一次 greet」：已有 greet 意图或结果即拒绝（结果未知不得重放）。「必须暂停」是 round 级状态，尚未推导，留待停滞监测一起做。

## 边界

- 仅作用于携带 `--candidate-id` 的 search/recommend 流程；深度搜索无 `--candidate-id`，不支持本锁，请勿对深度搜索设置该环境变量。
- 锁强制「逐人闭环」顺序与「评估先于触达」（greet 前必须已 decide fit）；但 fit/not-fit/unknown 的判断仍由人/Worker 做出，代码只校验记录存在与取值，不判断简历是否真的合适。
- 状态文件损坏 → 拒绝并报错（fail closed），不自动修复。
- 这是编排级护栏，不是系统级权限隔离。
