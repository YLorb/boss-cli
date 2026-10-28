---
title: "沟通页岗位切换边界"
read_when: "收集前需要读取或切换沟通岗位"
updated: "2026-10-28"
scope: "chat-job-switch"
---

# 岗位切换：用户操作，CLI 核验

`scripts/switch-job.mjs` 通过独立 CDP 连接操作页面，不是公开 boss-cli 子命令。按用户“绕过 CLI 的操作必须全部拒绝”的要求，撤销其连接真实浏览器的旧许可；不运行、不复制、不包装该脚本绕过入口。源码及隔离测试保留用于开发参考。

1. 按[启动规范](start-and-use.md)通过公开 CLI 启动和核验登录。
2. 通过 `boss status --json` 读取当前页面与 `chatFilterJob`，按用户提供的完整岗位及城市核对，不猜测缺失信息。
3. 当前岗位不符或无法确认时，停止依赖步骤，由用户自行切换沟通岗位；CLI 目前没有 `boss switch-job` 子命令，不编造命令。
4. 用户切换后再次通过公开 CLI 核验 `chatFilterJob`，确认后才读取本轮起始列表并启动对应账本。`collect --job` 只选择账本，不切换页面岗位。

用户手动操作不授予 Agent 其他浏览器或桌面工具权限；读取失败或岗位不明确时保存回执并报告，不走替代路径。完整限制见[工具使用边界](tool-boundary.md)。
