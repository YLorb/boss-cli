---
title: "启动、配置与使用示例"
read_when: "首次运行或编排新一轮任务"
updated: "2026-10-14"
scope: "startup"
---

# 启动与使用

操作真实 BOSS 前必须读取[工具使用边界](tool-boundary.md)。限制覆盖启动、登录和全部业务阶段；不得用直接 CDP、内部模块或自写脚本代替 CLI，即使只是截图、监测或验收。命令缺失时停止并报告，不自行换工具。

## 配置

首次部署先读取[环境配置](environment.md)完成Node.js、Chrome、PATH、CDP端口与数据目录设置。无需Git的下载及解压步骤见[安装说明](install.md)。

复制 [配置模板](../assets/config.example.json) 到自己的工作目录，填入绝对路径。**此 JSON 是 Agent 编排配置，CLI 不会自动读取它。** `resumeDir` 映射 download-resume 的 `--output-dir`，`ledgerDir` 映射 collect 的 `--ledger-dir`。`cdpUrl` 应与浏览器调试端口一致；CLI 原生支持的是端口环境变量，不是 `--cdpUrl` 参数。

`timeoutBudgetSec:15` 表示当前附件命令的内置预算，改 JSON 不会改变 CLI 超时。其他命令没有同样的整命令预算。`messages.example.json` 为话术模板；消息3保留用户给定两段，但含公司信息，交付其他公司时须先由使用者修改确认。

```powershell
Set-Location 'C:\Recruitment\boss-cli'
$env:BOSS_BROWSER_REMOTE_DEBUGGING_PORT = '53470'
# 仅当自动发现 Chrome 失败时，由用户明确配置已安装的可执行文件：
# $env:CHROME_PATH = 'C:\Program Files\Google\Chrome\Application\chrome.exe'
node .\dist\cli\index.js --check-login --json
```

## Chrome启动与登录（强制入口）

Agent必须使用boss-cli提供的入口完成浏览器启动与登录流程，不得自行启动Chrome或用其他工具代替：

```powershell
node .\dist\cli\index.js login --json
```

首次启动或已确认未登录时使用此命令；CLI负责启动／复用Chrome、配置CDP及打开登录页。已由check-login确认登录时直接复用，不反复login。check-login本身不启动浏览器；连接失败必须区分尚未启动和其他错误，不将所有错误解释为需要重启。

扫码、验证码由用户在CLI打开的浏览器中完成。随后执行 `node .\dist\cli\index.js --check-login --json`，只有明确已登录才继续。login返回不等于已登录，unknown或异常不能当成功；浏览器账号和招聘岗位由使用者确认。

**禁止替代启动／登录路径**：直接运行chrome.exe、Start-Process、Puppeteer／Playwright launch、自写CDP连接及导航脚本、其他浏览器控制工具。不得复制他人的Cookie或自动更换用户数据目录来绕过故障。CHROME_PATH及端口配置仅交给CLI读取，不授权Agent另起浏览器。

boss-cli入口不存在、启动失败或登录核验不明时，停止依赖登录的步骤，报告原始错误和配置上下文；不做静默重试或换工具兜底。岗位切换脚本只能在CLI准备好的已登录会话上使用，不能承担启动或登录职责。

## 账本启动

启动前必须读取[路径与账本核验](paths.md)，确认固定ledgerDir并计算expectedLedgerFile；核对collect返回的file完全匹配后才处理候选人。

有账本写入的正式业务运行，在独立终端保持下面进程及 stdin 打开：

```powershell
node .\dist\cli\index.js collect --job '目标岗位完整名称' --ledger-dir 'C:\Recruitment\shared\ledgers'
```

等待 started，核对 job、file、recoveryRequired。向**同一进程的 stdin** 写入一行 `{"op":"show"}`，等待响应。其他 CLI 命令在另一终端串行执行；collect stdin 只接受 JSON，不接受 shell。每条等待返回，不一次性灌入全部命令。结束写 `{"op":"stop"}` 并等待 stopped 及进程退出。

仅查看评估的验收不启动正式账本写会话；保存独立运行记录即可。现存恢复状态若影响本轮去重，仍需读出并说明，不能跳过未决身份。

## 启动 prompt

以下业务 prompt 须同时带上[严格工具约束 prompt](tool-boundary.md#可复用执行-prompt)；“仅查看”或“验收”不构成非 CLI 工具例外。

推荐：
> 使用 boss-recruitment Skill 执行推荐 SOP。目标岗位及 JD：……；评分标准：……；否决项：无；观察上限：5；触达门槛：……；允许查看、评估并对符合条件者发送已确认的消息3。运行目录：……。

搜索验收：
> 使用 boss-recruitment Skill 执行搜索 SOP。目标岗位及 JD：……；关键词：……；岗位筛选不限职位；评分标准：……；观察上限：1。本轮仅查看评估，不联系、不入正式账本。

收集：
> 使用 boss-recruitment Skill 收集“……”岗位本轮起始快照中的未读简历。按所附标准评估，允许发送已确认的求简历和收件确认消息；附件保存到……；不上传。循环内不刷新未读列表。

恢复：
> 仅检查并恢复指定岗位的本地账本，禁止操作 BOSS 页面。读取已有回执，报告能恢复的证据和必须由人工对账的部分。

## 运行时创建

账本由 collect 创建；运行回执、JD／评估配置和导出目录由 Agent 创建；浏览器用户目录及截图由 CLI 创建。上述运行文件均不需要预装，不打包回 Skill。默认数据根目录为用户的 `~/.boss-cli/`，截图位于 `.cache/resume-screenshots/`，附件位于 `resume-files/`；下载可指定自选目录。
