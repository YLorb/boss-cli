---
title: "运行环境安装与配置（无需Git）"
read_when: "首次安装、换机或排查环境问题"
updated: "2026-10-14"
scope: "environment-setup"
---

# 运行环境

本Skill核心流程需要Node.js、npm、本机兼容浏览器和可调用shell的Agent，推荐Chrome。不要求Python、OCR服务或Git。Python仅是Skill开发者的可选校验工具，不是招聘运行依赖。安装Skill不自动安装环境，也不代表用户已授权环境修改。

## 下载和安装

| 组件 | 下载与配置 |
| --- | --- |
| Node.js与npm | 先检测；缺失或不兼容时告知用户并取得明确同意，再由Agent从[Node.js官方](https://nodejs.org/en/download)下载适配系统架构的发行包，安装并配置PATH。本包以Node 24验证，npm随Node提供 |
| Chrome（推荐） | 只检测和使用本机已安装的兼容浏览器，Agent不下载、不安装Chrome。缺少浏览器时告知用户自行准备；准备后启动及BOSS登录仍必须走boss-cli |
| boss-cli | 使用[安装说明](install.md)中的随包ZIP或GitHub固定提交ZIP，解压到可写目录 |
| Skill | 导入整个boss-recruitment目录或ZIP，保留相对路径；宿主须有本机文件与shell权限，纯网页聊天不能直接运行CLI |

环境检查：

```powershell
Get-Command node, npm.cmd
node --version
npm.cmd --version
```

如果命令未找到，检查Node安装及PATH并重新打开宿主，不用另一个来源的临时运行时掩盖问题。PowerShell拦截npm.ps1时明确使用npm.cmd，无需降低系统执行策略。

## Node.js/npm缺失时的授权安装流程

1. 只读检查系统、架构、node/npm版本、可执行文件位置和PATH；区分未安装、已安装但PATH缺失、版本不兼容。环境已满足时不重复下载、不自动升级。
2. 安装前向用户说明检测结果、拟使用的Node版本（优先本包验证的24系列）、npm随附版本、官方来源、安装目录、用户级或系统级范围，以及是否修改PATH／需要管理员权限。询问是否同意由Agent下载并配置。等待明确同意；沉默、安装Skill或要求启动招聘不等于授权。
3. 已获得该安装方案的明确同意后无需反复询问。Agent从Node.js官方发行页取得对应OS／架构的具体发行包和校验信息，核对文件校验值，按已批准方式安装或解压到持久目录。优先用户级可写目录；不得覆盖现有版本、改变全局默认或提升为系统级安装，除非这些变化已在授权中说明。没有已批准安装方式时，不失败后偷偷改方案。
4. 配置实际执行Agent使用的环境；用户级PATH去重追加，保留已有条目，不覆盖整个PATH。让当前CLI子进程获得对应环境；宿主继承旧环境时告知需要重启宿主。不把临时下载目录作为长期运行时。
5. 验证node、npm版本和可执行文件路径；在CLI源码目录安装依赖并构建，逐步检查退出码。报告版本、来源、安装位置、PATH改动和验证结果，再进入boss-cli登录流程。
6. 用户拒绝则停止依赖该环境的步骤，提供手动准备说明；下载、校验、安装或配置失败时保留错误并报告，不改用不受信镜像、不关闭校验、不盲重试。需要额外管理员授权时明确说明来源和原因，不能绕过。

该授权仅针对Node.js/npm及所说明的配置，不包括下载Chrome或开始联系候选人。npm缺失但Node已存在时，先诊断原安装和PATH；不得直接用全局npm升级命令掩盖环境不完整。

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
| BOSS_BROWSER_REMOTE_DEBUGGING_PORT | 默认53470；使用1–65535有效整数。与config.cdpUrl一致；不调用独立岗位切换脚本 |
| BOSS_BROWSER_HEADLESS | 正常登录使用false，需要可见页面完成扫码；不把无头模式当成绕过验证的方法 |
| BOSS_BROWSER_USER_DATA_DIR | 默认用户目录下 `.boss-cli/.cache/browser-data`；可选指定自己的专用目录，不复用他人配置或日常Chrome目录。故障时不得自动换目录 |
| BOSS_CLI_TRACE | 需要排错时设true；主要覆盖登录、会话和列表日志，写stderr，不保证覆盖所有命令 |

保持调试端口仅供本机使用。端口冲突时先定位占用者，不擅自杀进程或悄悄换端口；确需变更时同步全部配置，仍由CLI启动。

## 数据目录和编排配置

必须先按[路径核验规范](paths.md)区分cliDir与workspaceDir；所有目录持久化为绝对路径，ledgerDir固定跨轮次使用，不随本轮runtime目录新建。

复制[config.example.json](../assets/config.example.json)并填写：cliDir指向含package.json和构建后dist的源码根目录；resumeDir、ledgerDir、runDir指向当前用户可写目录。目录可在首次运行创建，不需要携带示例账本。下载--output-dir和collect --ledger-dir由Agent显式传递。

config.cdpUrl不是CLI原生参数；CLI用端口环境变量，岗位切换脚本直连真实浏览器的旧许可已撤销。timeoutBudgetSec不会改变CLI内部超时。不要输出或提交Cookie、浏览器数据、真实简历及凭据。

## 安装验收

1. node和npm命令可用；进入正确源码目录执行npm.cmd ci、npm.cmd run build，任一步失败停止。
2. help含所需公开入口；版本核验可用 `node -p "JSON.parse(require('fs').readFileSync('package.json','utf8')).version"`，无需Git。
3. 按[启动规范](start-and-use.md)通过boss-cli login启动并由用户完成登录，再用--check-login确认。禁止替代启动或自写CDP登录脚本。
4. 用真实岗位确认页面条件后才开始业务SOP；安装成功不等于真实账号全部业务已验收。

网络错误直接报告。需要代理时由使用者提供受信配置，不擅自切换npm镜像、关闭TLS校验、关闭安全软件或提升系统权限。更新ZIP时解压到新目录，核验后显式切换cliDir；不要覆盖运行中的源码或删除运行数据。
