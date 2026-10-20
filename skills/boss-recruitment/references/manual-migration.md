---
title: "现有手册迁移与验收边界"
read_when: "核查旧规范差异或判断可交付能力"
updated: "2026-10-14"
scope: "provenance-and-limitations"
---

# 手册迁移与能力边界

本Skill整理自当前仓库的 `docs/workbuddy-recruitment-runbook.md`、`docs/collection-ledger.md`、`docs/boss-url-map.md`、`docs/cli-json-output.md`、README及源码help。这些是来源说明，不是运行时外部文件依赖。本包内规范按主题拆分，避免再装一份含冲突指令和私人配置的旧手册。

| 旧手册内容 | 本包位置或处理 |
| --- | --- |
| 登录、环境、启动 | install、start-and-use |
| 指令和页面要求 | cli-reference |
| 收集、推荐、搜索 | 三份独立SOP |
| 账本七字段、回执和恢复 | ledger-and-recovery |
| 消息1／2／3 | messages.example.json，必须按使用者确认内容执行 |
| 招聘系统导入 | optional-hr-import；移除私人地址、凭据、岗位ID |
| 每人之后重新list未读 | 不采纳；按用户后续要求，固定起始范围，循环内不刷新 |
| 历史round示例 | 仅特殊模式，不作为正常未读SOP |
| 学校、大厂、竞赛、60分等本机条件 | 不作为通用默认值；由本轮使用者给定 |
| 岗位状态跳变 | 已澄清为用户手动纠正，不能归因平台不稳定 |

## 尚未由Skill补齐的工具能力

- 搜索没有不限职位参数、加载更多和稳定候选人ID；关键词等待实现不充分。
- 同名姓名匹配会选第一条；预览包含备用点击路径。Skill要求先唯一定位，不能宣称源码已经修复。
- 在线截图没有通用完整性验证；一个可见页尾样本不代表所有长简历完整。
- 2026-10-20本地实现增加搜索greet及--check预检，尚待真实页面验收；旧安装仍可能不支持。触达后身份关联、入账和消息证据仍需编排核验。
- 严格固定起始未读集合的调度未封装；chat --data-id及probe进入全部，--check未命中仍会定位。
- 外部CLI结果不自动进collect；持久化依赖正常stop，恢复需要证据。
- 现有页面包装器仍会在上下文销毁时内部重试；本Skill不添加重试或隐式回退。

因此这是可安装的规范包和已推送源码快照，不是宣称所有流程均已自动化验收的产品。交付者在目标账号上验证登录、岗位、读取和单人预览后，才逐步验收已获准的联系流程。

CLI仓库已提供并以隔离页面验证 `scripts/switch-job.mjs`；Skill不携带脚本副本，使用前必须读取[岗位切换规范](switch-job.md)。旧临时脚本不再作为正式入口。cut_screenshot、merge-receipts、export-resumes未形成通用验证版本，不附带；下载已有--output-dir。
