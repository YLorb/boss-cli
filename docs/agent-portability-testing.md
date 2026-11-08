# 跨宿主本地验收记录

日期：2026-11-08。CLI `0.6.17-dev.0` / Skill `1.0.26` 开发实现；本记录随代码提交，不代表正式发布。实现已补充，跨宿主承诺尚未验收通过。只完成一次集中代码 review，发现的参数解析、动作别名和收集回执问题已修复；之后按失败用例验证。

## 四项交付

| 项目 | 已实现 | 实际边界 |
| --- | --- | --- |
| #1 任务配置 | 严格字段/路径/岗位/授权话术/停止条件校验，task-check | 自然语言解释仍由宿主负责；JSON合法不等于理解正确 |
| #2 统一启动 | task-init原子写入run、任务/permit哈希、实际版本、独立flow/phase、固定岗位账本 | 旧格式拒绝，不自动迁移；不以新run清除历史未决动作 |
| #3 阶段与业务门 | 允许动作、前置回执、冻结对象、材料/决策/下载/发送、预算、防重放，覆盖worker及collect | 属于CLI编排约束，不是系统级权限隔离；不替Agent判断简历质量 |
| #4 重复验收 | 隔离数据、网络拒绝、三入口参考、90项宿主矩阵、独立oracle、.sh入口 | 真实宿主尚未通过；矩阵单项只有一个合成人，与十人故障回放分开 |

## 可重复执行

需要当前仓库依赖和可运行的Node.js；Windows通过Git Bash运行sh，不生成.ps1。

本机sh未加入PowerShell的PATH；已通过`E:/Program Files/Git/bin/sh.exe`完成两个.sh入口的语法检查。PowerShell可使用`& 'E:/Program Files/Git/bin/sh.exe' scripts/test-managed.sh`明确指定现有解释器，不安装或切换环境。

```sh
sh scripts/test-managed.sh
# 额外运行独立Chrome中的合成页面，使用关闭的代理拒绝外网
sh scripts/test-managed.sh --browser-fixtures

# 每次使用全新目录，不覆盖失败证据
sh scripts/test-agent-portability.sh prepare output/portability-new
sh scripts/test-agent-portability.sh reference output/portability-new
sh scripts/test-agent-portability.sh host output/portability-new deepseek-harness /absolute/adapter.json 1
sh scripts/test-agent-portability.sh report output/portability-new
```

adapter为JSON：`{"argv":["可执行文件绝对路径","参数"],"env":{},"usageFormat":"dsh","timeoutMs":180000}`。WorkBuddy的usageFormat为workbuddy。argv不经shell展开，不能放密钥；宿主身份认证由自身配置负责。headless在步骤结束后读取用量，60K报告用量时停止，为100K预算预留余量；这是软停止，缺失/滞后用量不能构成账单硬上限。没有可测量用量时，不开展批量付费测试。

desktop-start/desktop-report可保存桌面案例的保护文件快照及oracle结果，但不提供宿主token硬限制。**桌面批量验收须先具备用量监控和可执行停止机制**，不能仅靠prompt中的预算承诺。禁止用其他宿主或参考回放替代失败案例后标为通过。

## 已执行结果

| 测试 | 结果 | 回执 |
| --- | --- | --- |
| 构建与严格离线回归 | 111/111通过，0跳过 | `output/managed-regression-1794144971138/report.json`及tests.log |
| 独立Chrome合成收集页面 | 4/4通过 | 单独执行test-collection-page.mjs；不使用用户浏览器配置 |
| 收集/推荐/搜索固定参考 | 3/3通过；收集核验固定岗位账本DOWNLOADED | `output/agent-portability-20261108-final/reference-1794145790937/`各入口reference-report.json |
| 十人故障参考回放 | 49检查通过，33命令 | `output/portability-ten-person-20261108-final/report.json` |
| DeepSeek Harness headless | 阻塞：缺API key | 对应case/host-report.json |
| WorkBuddy CLI | 阻塞：Authentication | 对应case/host-report.json |
| DeepSeek Harness桌面 | 失败并停止：仅生成task.json，未落收集账本 | 对应case/desktop-report.json |
| WorkBuddy桌面 | 阻塞：宿主窗口仅提供两个空Pane，无法核验输入目标；未提交prompt | 只检查宿主窗口，没有盲点或操作BOSS |

矩阵根目录为`output/agent-portability-20261108-final`。规划90项＝2宿主×3入口×5近义表达×3重复，目前没有任何真实宿主案例通过，不能宣称同prompt跨宿主或近义prompt一致。固定参考证明当前夹具路径可执行，不证明模型执行稳定。

最终矩阵计数：failed=1、blocked=1、not-run=88。桌面检查摘要保存在该目录desktop-observations.json。补充Skill离线规则后，重新prepare全新目录`output/portability-generator-20261108-final`，并通过其中三入口参考回放；这不属于模型复测。

DeepSeek桌面测试在界面累计显示751K token（含94%缓存命中）时被立即停止，已超过用户提出的100K预算；不能将缓存命中等同于没有消耗。未获得可靠分项账单，不能报告精确费用。它创建task.json后进入环境诊断，未形成模拟动作事件；未有完整命令回执证明更细的失败点。已在Skill补充明确的离线入口规则，尚未消耗模型预算复测。

首轮参考曾发现附件worker未继承mock，进入浏览器连接路径并失败。该轮不计成功，已保留失败目录；修复为测试入口内进程分发，并加入网络拒绝及子进程继承测试。不得据此声称整个开发过程从未尝试连接浏览器。

## 用例与通过标准

统一回归覆盖：未知字段、错误岗位/路径、损坏指针、内容哈希变化、版本错配、原子写入冲突、阶段跳步、对象越界、无材料决策、无下载发送、消息正文错配、联系上限、截止时间、失败暂停、未知结果防重放、跨轮防重复、双重参数与`--`解析、action子动作、回执文件字节数/哈希及网络拒绝。关键断言必须全部通过，不跳过。

十人固定参考包含：正常完成、不匹配、证据不足、局部查看失败、低置信度复查、身份不符、发送结果未知、进程中断后接续、明确发送前失败核验后重试、验证导致全局暂停。模拟分类来自固定场景，不作为真实筛选质量金标。

宿主oracle分别核验task语义字段和实际动作：正确岗位/入口/固定对象/话术/联系预算、恰好一次正确发送、预期下载或OCR事件、收集持久账本。任何保护文件变更均使案例无效。没有真实页面、真实OCR或安装到任意用户干净环境的验收；用户登录、模型凭据、宿主工具权限及可测量预算仍是正式支持前提。
