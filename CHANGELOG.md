# 功能变化日志

## 2026-11-08 · 正式任务与本地跨宿主验收

- 严格任务/岗位规范校验、任务与权限内容绑定；损坏记录拒绝，新轮状态独立，岗位账本固定。
- 阶段前置回执、collect入口与stdin纳管，跨轮联系/消息防重放。
- 新增隔离managed测试与.sh入口，生成WorkBuddy/DeepSeek Harness 90项本地矩阵，分别记录参考、实际宿主及阻塞；不代表90项已通过。

按提交记录面向使用者的功能变化。新提交在提交前新增条目；若提交只涉及文档、构建或维护配置，也需注明“无用户可见功能变化”。历史记录从 2026-10-02 开始，更早提交以 Git 历史为准。

## 2026-11-08 · fix(cli): 统一启动/配置缺陷修复（run 消费、账本绑定、版本核验、严格字段、原子写）

- run 记录被消费：`activateRunBindings` 在命令入口加载 current 指针，自动启用 permit/flow-state/账本目录。
- task-init 核验实际 Skill 版本（checkSkillCompatibility），记录 actual 而非常量；版本不匹配拒绝初始化。
- collect 账本目录与 run.ledgerDir 一致性检查，不一致拒绝。
- task config 拒绝未知字段（防拼写错误静默接受），新增 mode/jobSpec/messageScript 字段。
- run 文件改为 link 独占 + 临时文件原子落盘（不再留半截 JSON）；RUNS_DIR 支持 BOSS_RUNS_DIR 隔离。

## 2026-11-08 · feat(cli): 阶段校验（phase）

- task config 新增 `phases`（`[{name, allowed}]`）；`src/cli/phase_state.ts` 阶段级命令白名单。
- `boss phase-set --phase <名>` / `phase-status`；动作执行前 permit → phase 双重校验，越界 PhaseDeniedError 退出码 2。
- 阶段控制与只读诊断永不拦截；test:phase-state 6 例。

## 2026-11-08 · feat(cli): 统一启动（task-init）+ run 状态绑定

- 新增 `src/cli/run_state.ts`：`boss task-init` 生成确定性 runId（job 哈希 + 秒级时间戳），原子写入 `~/.boss-cli/runs/<runId>.json`。
- 绑定 permit/flow-state/账本目录/CLI-Skill 版本/stop 条件；同岗位同秒重复启动 wx 独占拒绝。
- stop 条件本阶段只记录不判定；test:run-state 3 例。

## 2026-11-08 · feat(cli): 统一任务配置（task config）

- 新增 `src/cli/task_config.ts`：任务结构（job/scope/permit/stop）+ `checkTaskConfig` 校验入口。
- `BOSS_TASK_CONFIG` + `boss task-check --json`；交叉校验 permit 的 job/entry 一致性；停止条件 observeLimit/contactLimit/deadline/maxConsecutiveFailures（均可选）。
- 新增 `references/task-config.md`；test:task-config 5 例。

## 2026-11-08 · fix(cli): permit action 解析对齐 CLI、附件命令拒绝退出码 2

- action 子动作改用与 CLI 一致的解析（rest[0] ?? opts.type ?? opts.action + 别名映射），选项值不再被误认为子动作，`--type=resume` 正确放行。
- 附件命令经 worker IPC 后按 `name` 判断 PermitDeniedError，拒绝退出码稳定为 2；test:permit 增至 9 例。

## 2026-11-08 · feat(cli): 命令白名单审批（permit）+ 版本 0.6.17-dev.0 / Skill 1.0.26

- 新增 `src/cli/permit.ts`：单一审批入口 `assertPermittedCommand`，挂在 `executeCommand` 开头；`BOSS_RUN_PERMIT` 开关，deny-by-default。
- `action` 子动作白名单（如 `action:["resume"]`）防连带放行 not-fit/wechat；拒绝退出码 2；文件缺失/损坏 fail-closed。
- 新增 `references/run-permit.md`；test:permit 5 例；版本 +0.0.1。

## 2026-11-08 · feat(cli): 多岗位收集编排 + 消歧证据先带 + 搜索岗位态恢复

- 新增 `boss spec-list --json` 枚举 `~/.boss-cli/jobs/` 的岗位规范文件，作为多岗位收集的岗位清单来源。
- 新增 `references/multi-job-collection.md`：枚举→固定清单→逐岗收集→分岗记账→收尾恢复；逐岗 `--mode screen|collect-only`。
- 定位规范改为「消歧证据（data-id/info）先带后搜」，快照即消歧依据，不先空参搜索诱发重名。
- 搜索 SOP 增加「搜索前记录岗位态、搜索后恢复」；switch-job 增加沟通页切岗收尾恢复。

## 2026-11-08 · feat(cli): collect 评估门（screen/collect-only 模式）

- `boss collect --mode screen|collect-only`；screen（默认）决策必须带评估证据（PASS↔fit、FAIL↔not-fit，可选 ref），collect-only 仅收集不评估。
- 会话支持 `{"op":"mode"}` 显式切换并审计；决策审计流 `<账本>.decisions.jsonl`。unknown 结论保持 PENDING。
- 新增 test:collection 3 例（screen 证据门/一致性与 collect-only 免证据）。

## 2026-11-08 · fix(cli): send 确定失败可重试 + 版本 0.6.16-dev.0 / Skill 1.0.25

- send 防重放改为仅 unknown 拒绝，failed（确定失败未发送）放行重试。
- 版本：CLI 0.6.15-dev.0 → 0.6.16-dev.0，Skill 1.0.24 → 1.0.25。

## 2026-11-08 · fix(cli): 补 send 未决重发门与联系分支统一防重放

- send 防重放改为"上次结果 unknown/failed 禁止重发"；confirm-contact 成功后禁止再次 greet（按业务效果统一防重放）；普通 send 补重放检查。

## 2026-11-08 · fix(cli): 普通 send 接护栏、confirm-contact 收口、preview 失败接续、证据机械关联

- 普通 send（--data-id）接入全局暂停检查与 journal（key=data-id）；confirm-contact 成功释放 open 并判 done；preview 失败（未建 open）建议 preview 而非 decide；preview result 机械附带 evidence.screenshot。

## 2026-11-08 · fix(cli): 接续判断补 send/confirm 未决；监测补 not-started 与阈值接入

- `deriveFlowContinuation` 将 greet/send/confirm-contact/select-job 的 failed/unknown/有意图无结果统一判为 needs-verify，修复"send 未知仍报 done""confirm-contact 中断仍建议 greet"。
- `flowWatch` 增加 `not-started`（状态文件缺失不再误报 ok），`BOSS_FLOW_STALL_MS` 已接入默认阈值读取。

## 2026-11-08 · feat(cli): send/选岗/确认联系纳入 journal 与重放禁止

- send（--embedded）与 select-job/confirm-contact 纳入 journal（intent/result）；同候选人同动作只允许一次，结果未知不得重放。

## 2026-11-08 · feat(cli): 必须暂停与独立停滞监测

- 流程状态新增 `paused` 与 `lastProgressAt`；新增 `flow-pause`/`flow-resume`；已暂停时拒绝一切候选人动作。
- 自动暂停：OCR 失败、在线简历连续 3 次打开失败、greet 付费/风控受阻。
- `flow-status` 输出 paused/lastProgressAt/idleMs/watchState；flowWatch 区分 ok/paused/stalled（默认 2 分钟阈值）。
- withFlowJournal 对 EmbeddedSendUnconfirmedError/AttachmentTimeoutError 记 result=unknown。

## 2026-11-08 · fix(cli): 重新查看同一人不再混用旧状态

- full preview 重新打开同一候选人时清除其旧 decide（fresh=true），旧 fit 不再被决策门接受；`--open-only` 不清除。
- `deriveFlowContinuation` 当前打开的候选人不再因旧 back/greet success 被报为 done。

## 2026-11-08 · fix(cli): 选岗/确认联系分支补决策门

- 决策门（decide fit）原仅作用于 plain greet，`greet --select-job` 与 `greet --confirm-contact` 绕过；现统一作用于所有联系动作（greet/select-job/confirm-contact）。重放门仍只在 plain greet。

## 2026-11-08 · fix(cli): 接续判断修正 greet 中断/未知的需核验

- 修正 `deriveFlowContinuation`：greet 仅有 intent 无 result（进程中断）或 greet 结果 failed/unknown 均判为 needs-verify，且优先级高于 back，避免"建议触达但重放门拒绝"的冲突，以及"greet 未知后被 back 覆盖成 done"的漏判。

## 2026-11-08 · feat(cli): 确定的接续判断（flow-status + greet 重放禁止）

- 新增 `boss flow-status --json`：从 journal 确定性推导每个候选人的 done/continue/needs-verify 与下一步动作。
- greet 触达前强制「同一候选人本轮只允许一次 greet」：已有 greet 意图/结果即拒绝，结果未知不得重放。
- 新增离线测试（test:flow-lock 8 例）。

## 2026-11-08 · feat(cli): 逐人闭环执行日志（意图→结果）

- 流程状态文件新增 `journal` 数组，preview/greet/back/decide 动作由 CLI 机械落盘「意图（前）→ 结果（后）」：result ∈ success/failed/unknown，failed 带 error，decide 带 evidence.verdict。
- 为接续判断与停滞监测提供可复算的动作链；仅锁模式（BOSS_FLOW_STATE）下写入。新增离线测试（test:flow-lock 6 例）。

## 2026-11-08 · feat(cli): 评估先于触达（decide 门）

- 逐人闭环锁增加决策记录：新增 `boss decide --candidate-id X --verdict fit|not-fit|unknown`，仅能针对当前打开的候选人记录评估结论。
- 实际 `greet` 触达前强制 `decided[X].verdict==='fit'`，否则拒绝；unknown 报告但不阻断，back 后继续下一位。
- 流程状态文件扩展 `decided` 字段；新增离线测试（test:flow-lock 5 例）。

## 2026-11-08 · feat: 简历解析提速（mode=screen + 确定性字段 + 首滚延迟缩短）

- `resume-analysis-session.mjs` 新增 `--spec` 评分模式（mode=screen）：结构化 verdict + 证据行号，脚本展开校验；新增确定性字段提取（邮箱/手机/城市/年限，唯一命中）返回 `suggested` 提示；unknown 报告但不停止。
- 在线简历首次滚动前随机等待从 2000~10000ms 缩短为 2000~5000ms。
- 新增 screen 模式与 suggested 的离线测试（test:resume-analysis 5 例）；更新 resume-analysis.md。

## 2026-11-08 · feat(cli): 搜索/推荐逐人闭环锁（BOSS_FLOW_STATE）

- 新增逐人闭环锁：设置 `BOSS_FLOW_STATE=<状态文件绝对路径>` 后，`preview` 成功上锁、`greet`/`back` 成功解锁，未对当前候选人决策前拒绝打开下一位，防止「批量看完才评估导致列表刷新后无法联系」。
- 新增 `src/sop/flow_state.ts` 与 `scripts/test-flow-lock.mjs`（`test:flow-lock`）；锁仅作用于携带 `--candidate-id` 的 search/recommend 流程，未设置环境变量时行为不变。
- 新增 `skills/boss-recruitment/references/flow-lock.md`。

## 2026-11-08 · docs(skill): 岗位评估规范改为按需读取的 JSON 文件

- 新增岗位规范文件约定：JD、必备条件、否决项、加分项、权重、阈值及操作边界写入 `~/.boss-cli/jobs/<岗位>.json`，评估时按需读取，不驻留上下文；交接只传文件绝对路径。
- 新增 `skills/boss-recruitment/references/job-spec.md`；同步更新 SKILL.md 与 AGENTS.md 的上下文交接约束。
- 兼容：`~/.boss-cli/jd/`（`boss jd` 抓取的 .md 缓存）保持不变，与评估规范 JSON 目录并存。
- 无用户可见 CLI 功能变化。

## 2026-10-10 · fix(cli): close attachment previews between resume operations

- 下载原附件并校验文件后收起预览弹层；下次按显示名称和 `data-id` 定位会话前，也会先收起仍打开的附件预览，避免弹层挡住列表。
- 释放已启动 Chrome 的日志管道，避免一次性 CLI 命令完成后仍被浏览器子进程占住而无法退出。

## 2026-10-06 · `d622810` · fix(cli): locate resume conversations in custom scroll lists

- 联合键定位改用鼠标滚轮驱动 Boss 的自定义会话列表，只点击完整可见的目标行，并保持姓名、`data-id` 与详情校验。

## 2026-10-04 · feat: show live steps for login and candidate list

- 设置 `BOSS_CLI_TRACE=true` 后，`boss login` 和 `boss list` 会在终端实时输出浏览器连接、页面切换、筛选与列表扫描等步骤；不设置时保持原有输出。
- 步骤日志使用 stderr，`boss list --json` 的 stdout 格式不变。

## 2026-10-02 · docs: document source setup and per-commit logs

- 无用户可见功能变化；README 增加当前 `dev` 分支运行说明，并建立受 Git 跟踪的功能变化日志和仅本地保存的开发日志。

## 2026-10-02 · `f6a79d8` · Add targeted Boss resume collection commands

- `boss list --chatting --json` 输出“沟通中”会话的显示名称、`data-id`、当前沟通职位等结构化信息。
- `boss chat`、`boss accept-resume`、`boss download-resume` 支持按显示名称和 `data-id` 联合定位；身份不一致时停止操作。
- `boss download-resume` 下载原附件并返回保存路径、文件大小和 SHA-256；指定目标的 `boss send` 在发送前后核对会话并确认页面出现新消息。

## 2026-10-02 · `3bc77d2` · Disable Boss CLI resume OCR calls

- 在线简历截图不再调用 Boss CLI 内置 OCR；截图仍可保存并返回路径。
