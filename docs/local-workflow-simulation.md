# 可重复的十人本地流程模拟

## 运行

先执行 `npm.cmd run build`。Git Bash下：

```sh
sh scripts/test-simulation.sh output/simulation/reference-001
```

这是固定决策的参考预检，不调用模型；每次使用全新目录，不覆盖旧任务。也已接入 `sh scripts/test-harness.sh --archive '<资料ZIP>' --python '<Python>'` 的workflow-simulation阶段。现有flow-lock测试另作为独立阶段运行。

逐步执行或交给Agent时，使用：

```sh
sh scripts/simulate-recruitment.sh --run output/simulation/agent-001 init
sh scripts/simulate-recruitment.sh --run output/simulation/agent-001 observe
sh scripts/simulate-recruitment.sh --run output/simulation/agent-001 command '["preview","模拟甲","--candidate-id","sim-01","--json"]'
```

完整任务说明及接口在 `scripts/simulation/agent-task.md`。Agent根据返回材料判断，使用classify写结论，advance推进。每个调用是新进程，世界状态、流程journal和事件日志跨进程保留。退出码23是故意注入的进程中断；不能把它当作普通成功。

## 独立验收

```sh
sh scripts/simulate-recruitment.sh --run output/simulation/agent-001 report
```

report依据模拟环境记录的实际联系、消息事件及生产flow状态验收，不依赖Agent声称完成。报告检查十人分类、规则判断、消息数量、联系数量、低置信度复核、身份冲突、未确认发送不重发、进程中断后的同人复用、发送前失败的有限重试及全局暂停。report失败返回非零；不得通过改world.json、flow.json或验收器改成通过。

## 场景

| 人员序号 | 场景 | 期望行为 |
| --- | --- | --- |
| 1 | 正常符合Go和SQL要求 | 一次联系、一次模拟发送 |
| 2 | 明确不符合 | not-fit，退出，不联系 |
| 3 | 证据不足 | unknown，不猜补 |
| 4 | 打开前iframe失效 | 核验无面板、列表未变，记录局部错误后跳过 |
| 5 | OCR低置信度 | inspect复核后判断 |
| 6 | 同名且ID冲突 | 核验冲突，跳过，不借用同名者 |
| 7 | 发送已发生但确认丢失 | 保持needs-verify，禁止重发，按授权处理下一人 |
| 8 | 打开后进程退出 | 核验已打开同人，用open-only复用；物理打开次数仍为1 |
| 9 | 明确发送前失败 | inspect确认未发送且编辑器恢复后，仅重试一次 |
| 10 | 验证码全局阻塞 | 保持paused及现场，停止；不为凑齐成功人数恢复任务 |

## 调用本机DeepSeek Harness

```sh
sh scripts/run-dsh-simulation.sh --exe 'E:/Program/Deepseek Harness/DeepSeek Harness.exe' --run output/simulation/dsh-001
```

脚本使用安装包自带headless CLI，将替换路径后的任务说明从stdin传入，使用workspace-write权限，操作日志与用量存入output/dsh-simulation-*/。不读取或修改API密钥。headless配置须已能访问所选模型；桌面版可启动不代表headless模型凭据已就绪。

模型预算为100k token。监督程序累计每个step报告的输入／输出量；达到60k时停止，预留40k给可能在途的请求。用量缺失时不启动后续步骤。由于提供方仅在步骤结束后报告用量，这不是账单级硬上限；以实际provider用量为准。日志不保存模型thinking正文。模型任务结束后，独立验收器再运行一次，模型自述成功不能替代验收。

## 边界

此模拟复用真实executeCommand、参数解析、决策门、暂停门、journal及接续推导，替换toolset为持久化的本地业务环境。它不访问真实BOSS、不连接任何浏览器、不调用真实OCR；PNG是占位产物，文字是虚构OCR夹具。因此它属于流程级集成测试，不是完整浏览器端到端、OCR识别质量测试或一小时耐久测试。现有iframe及页面守卫测试作为独立隔离测试继续运行。

场景是已知合成用例，不是盲测，不足以证明任意Agent和任意网页均可靠。生产代码发现的问题应单独报告或修复，不能在模拟器里绕过生产校验。

当前本地验证的边界：CLI的flow-status对被任务跳过的局部失败对象仍可能给出preview建议，模拟任务在独立classifications中保留跳过状态并按固定顺序推进。这验证了遵守本任务规则的Agent可以继续，不代表生产CLI已具备持久化的本轮跳过状态。
