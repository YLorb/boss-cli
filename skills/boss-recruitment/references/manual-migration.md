---
title: "现有手册迁移与验收边界"
read_when: "核查旧规范差异或判断可交付能力"
updated: "2026-10-22"
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

- 搜索尚无搜索栏选岗和加载更多入口；关键词等待实现仍有限制，须核对实际结果。
- 搜索现支持 candidateId 输出及姓名＋ID 定位；同名完整预览已实测。无ID时仍要求姓名唯一，不使用旧序号。
- 在线简历采用逐屏滚轮截图、重叠与底部校验；只保证当前展开内容，不自动展开“查看全部”。持续遮挡报错。
- 搜索联系、选岗和继续沟通已有实测；内嵌会话身份核验已实测，发送代码通过离线回归，完整真实发送仍待合适候选人实测。
- 严格固定起始未读集合的调度未封装；chat --data-id及probe使用昵称搜索且不主动切岗，重名暂停且无滚动回退，--check未命中只返回false。
- 外部CLI结果不自动进collect；内嵌 conversationId 尚需核验与正式 dataId 的映射，先保存待关联回执；持久化依赖正常stop。
- 公共层执行上下文销毁直接报错，不重跑业务回调；不得自行刷新或重试未知结果。

因此这是可安装的规范包和已推送源码快照，不是宣称所有流程均已自动化验收的产品。交付者在目标账号上验证登录、岗位、读取和单人预览后，才逐步验收已获准的联系流程。

CLI仓库保留 `scripts/switch-job.mjs` 源码及隔离测试，但其直连真实浏览器的旧许可已撤销；沟通岗位由用户切换、公开CLI核验，见[岗位切换边界](switch-job.md)。旧临时脚本不再作为正式入口。cut_screenshot、merge-receipts、export-resumes未形成通用验证版本，不附带；下载已有--output-dir。
