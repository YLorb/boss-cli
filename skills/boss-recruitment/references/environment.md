---
title: "运行环境安装与配置（无需Git）"
read_when: "首次安装、换机或排查环境问题"
updated: "2026-10-14"
scope: "environment-setup"
---

# 运行环境

本Skill核心流程需要Node.js、npm、本机Chrome和可调用shell的Agent，不要求Python、OCR服务或Git。Python仅是Skill开发者的可选校验工具，不是招聘运行依赖。

## 下载和安装

| 组件 | 下载与配置 |
| --- | --- |
| Node.js与npm | 从[Node.js官方](https://nodejs.org/en/download)取得适配系统架构的安装程序；本包以Node 24验证，npm随Node安装。保留添加PATH选项，完成后重新打开终端／Agent宿主 |
| Chrome | 从[Chrome官方](https://www.google.com/chrome/)安装；启动及BOSS登录仍必须走boss-cli，不让Agent直接运行Chrome程序 |
| boss-cli | 使用[安装说明](install.md)中的随包ZIP或GitHub固定提交ZIP，解压到可写目录 |
| Skill | 导入整个boss-recruitment目录或ZIP，保留相对路径；宿主须有本机文件与shell权限，纯网页聊天不能直接运行CLI |

环境检查：

```powershell
Get-Command node, npm.cmd
node --version
npm.cmd --version
```

如果命令未找到，检查Node安装及PATH并重新打开宿主，不用另一个来源的临时运行时掩盖问题。PowerShell拦截npm.ps1时明确使用npm.cmd，无需降低系统执行策略。

## 本轮环境变量

在实际执行CLI的同一终端／子进程环境设置；独立工具调用不一定继承上一次shell设置，Agent应将这些值传给每个CLI进程。不要假定编辑Skill配置JSON会设置环境变量。

```powershell
$env:BOSS_BROWSER_REMOTE_DEBUGGING_PORT = '53470'
$env:BOSS_BROWSER_HEADLESS = 'false'
# 可选：仅在需要明确Chrome位置时设置，先验证路径存在。
$chromePath = 'C:\Program Files\Google\Chrome\Application\chrome.exe'
if (-not (Test-Path -LiteralPath $chromePath)) { throw '请填写本机实际Chrome安装路径' }
$env:CHROME_PATH = $chromePath
```

| 配置 | 默认／使用规则 |
| --- | --- |
| CHROME_PATH | 可省略，由CLI发现本机浏览器；设置时必须是已安装可执行文件的绝对路径，不是浏览器数据目录 |
| BOSS_BROWSER_REMOTE_DEBUGGING_PORT | 默认53470；使用1–65535有效整数。与config.cdpUrl和switch-job的--cdp-url一致 |
| BOSS_BROWSER_HEADLESS | 正常登录使用false，需要可见页面完成扫码；不把无头模式当成绕过验证的方法 |
| BOSS_BROWSER_USER_DATA_DIR | 默认用户目录下 `.boss-cli/.cache/browser-data`；可选指定自己的专用目录，不复用他人配置或日常Chrome目录。故障时不得自动换目录 |
| BOSS_CLI_TRACE | 需要排错时设true；主要覆盖登录、会话和列表日志，写stderr，不保证覆盖所有命令 |

保持调试端口仅供本机使用。端口冲突时先定位占用者，不擅自杀进程或悄悄换端口；确需变更时同步全部配置，仍由CLI启动。

## 数据目录和编排配置

复制[config.example.json](../assets/config.example.json)并填写：cliDir指向含package.json和构建后dist的源码根目录；resumeDir、ledgerDir、runDir指向当前用户可写目录。目录可在首次运行创建，不需要携带示例账本。下载--output-dir和collect --ledger-dir由Agent显式传递。

config.cdpUrl不是CLI原生参数；CLI用端口环境变量，岗位切换脚本用--cdp-url。timeoutBudgetSec不会改变CLI内部超时。不要输出或提交Cookie、浏览器数据、真实简历及凭据。

## 安装验收

1. node和npm命令可用；进入正确源码目录执行npm.cmd ci、npm.cmd run build，任一步失败停止。
2. help含所需入口，`scripts/switch-job.mjs`存在；版本核验可用 `node -p "JSON.parse(require('fs').readFileSync('package.json','utf8')).version"`，无需Git。
3. 按[启动规范](start-and-use.md)通过boss-cli login启动并由用户完成登录，再用--check-login确认。禁止替代启动或自写CDP登录脚本。
4. 用真实岗位确认页面条件后才开始业务SOP；安装成功不等于真实账号全部业务已验收。

网络错误直接报告。需要代理时由使用者提供受信配置，不擅自切换npm镜像、关闭TLS校验、关闭安全软件或提升系统权限。更新ZIP时解压到新目录，核验后显式切换cliDir；不要覆盖运行中的源码或删除运行数据。
