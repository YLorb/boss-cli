---
title: "命令白名单审批（permit）"
read_when: "本轮启动前创建 permit、动作被拒绝或需要增删允许命令"
updated: "2026-11-08"
scope: "run-permit"
---

# 命令白名单审批

统一管理本轮允许执行的 boss-cli 动作。启用后 deny-by-default：不在白名单的动作一律拒绝。审批集中在单个 `permit.ts` 入口，不散落在各命令。

## 开关

```
BOSS_RUN_PERMIT=<permit 文件绝对路径>
```

未设置时行为不变（交互式/一次性脚本不受影响）。设置后校验动作。

## permit 文件

```json
{
  "schemaVersion": 1,
  "roundId": "…",
  "job": "全栈软件开发工程师 _ 深圳",
  "entry": "collect",
  "allowed": {
    "list": [],
    "chat": [],
    "preview": [],
    "greet": [],
    "send": [],
    "back": [],
    "action": ["resume"],
    "probe-resume": [],
    "accept-resume": [],
    "download-resume": [],
    "ocr": [],
    "switch-job": []
  }
}
```

- `allowed` 为「命令名 → 变体数组」映射；`[]` 表示命令名级放行（任意合法参数），非空数组表示变体白名单（v1 仅对 `action` 生效）。
- `action` 的子动作是第一个非 `-` 开头的位置参数。SOP 红线（`not-fit`、`wechat` 等）默认不进任何 permit，须使用者显式加入。
- `roundId/job/entry` 为审计用途，本轮不参与校验。

## 永不拦截（ALWAYS_ALLOWED）

只读安全/诊断命令不需声明：`status`、`check`、`search-sidebar`、`--check-login`、`flow-status`、`spec-list`、`help`、`version`、`version-check`。

其余命令（含 `decide`、`flow-pause`、`flow-resume`、`login`、`send`、`greet`、`ocr` 等）都须在 `allowed` 中显式声明。

## 拒绝语义

- 不在白名单 → 抛 `PermitDeniedError`，退出码 2（与 version-check 对齐「阻断、需重新确认」）。
- permit 文件缺失/损坏/schema 违规 → fail-closed（拒绝并报错定位），不自动放行。
- 错误信息展示：命令、允许集、action 允许子动作。

## 边界

- 这是编排级收紧，不是系统级权限隔离；不阻止 Agent 另起炉灶直连 CDP（见 tool-boundary）。
- `collect` 命令本身不经过 permit（其 stdin op 由 mode/evidence/recovery 自有门管控）；collect 内部的 `probe-resume` 会经 worker 回到统一入口，因此仍受 permit 约束——collect 场景须在 `allowed` 显式列出 `probe-resume`/`download-resume`。
- 审批校验纯本地、毫秒级，不碰浏览器。