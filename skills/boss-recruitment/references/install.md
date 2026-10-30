---
title: "下载、安装与版本兼容"
read_when: "首次部署、换机、升级或命令缺失"
updated: "2026-10-30"
scope: "local-installation"
---

# 下载、安装与版本兼容

## 环境

需要 Node.js（本包按 Node 24 验证；上游 README 声明最低20）、npm、Chrome／Chromium，以及允许调用本机 shell 的 Agent。**ZIP下载及安装不需要Git**；仅选择git clone时需要Git。Windows PowerShell 是本包主要示例环境；不宣称其他系统已实测。具体安装、PATH、端口和目录配置见[环境配置](environment.md)。

Node.js/npm缺失时，先按[环境配置的授权安装流程](environment.md#nodejsnpm缺失时的授权安装流程)告知用户，取得明确同意后再由Agent从 https://nodejs.org/ 下载并配置。Chrome仅作浏览器推荐，Agent不下载、不安装；缺少兼容浏览器时由用户自行准备。版本要求以交付源码的package.json、构建结果及命令核验为准。

## 当前版本：v0.6.11

CLI 0.6.11 配套 Skill 1.0.20，兼容标识为 `2026-10-30-resume-analysis-v1`。本版包含受守卫保护的公开 `switch-job`、截图后按收集／推荐搜索区分退出或停留、下载命令30秒总时限，以及本地文字解析交接脚本。截图滚轮速度与随机停顿不变。

使用下文的 `v0.6.11` 标签源码，安装依赖并构建；源码归档不包含 dist 或 node_modules。构建后运行 `node .\dist\cli\index.js version-check --json`，确认 `compatible=true`。全局 `boss` 若链接到此源码目录，重新构建后即使用新版本；其他安装须单独核验。

完整 Skill 位于源码的 `skills/boss-recruitment/`，包括操作前必读的 `AGENTS.md`。不要沿用旧版独立 Skill。端口配置、各命令参数及前置条件见[逐项调用手册](invocation-guide.md)。下节旧版快照仅供历史复现。

## 历史路径一：2026-10-22源码快照

解压 `boss-cli-source-2026-10-22.zip` 到自选目录，进入其 `boss-cli` 子目录：

```powershell
node --version
npm --version
npm ci
npm run build
node .\dist\cli\index.js help
```

这是已推送的 CLI 0.6.9 源码，功能基线为 `2346714`，仓库为 `YLorb/boss-cli`。`delivery-manifest.json` 记录 commit 与文件哈希；不表示同名 npm 包已发布此版本。构建失败直接处理错误，不换用其他版本掩盖。

本地已构建包 `boss-cli-0.6.9-local.zip` 含 dist、源码、package-lock 和同步 skill；解压进入 boss-cli，执行 `npm ci` 后可直接运行 `node .\dist\cli\index.js help`。不含 node_modules、浏览器登录态、账本或候选人资料。组合包内的独立 boss-recruitment 文件夹可安装到 Agent 的技能目录。

## 路径二：GitHub 标签 ZIP下载（无需Git）

v0.6.11 的下载地址：

[下载CLI源码ZIP：v0.6.11](https://github.com/YLorb/boss-cli/archive/refs/tags/v0.6.11.zip)

可在浏览器中直接下载，也可使用PowerShell；下面目标目录须尚不存在，避免覆盖现有安装：

```powershell
$installRoot = 'C:\Recruitment'
$archive = Join-Path $installRoot 'boss-cli-v0.6.11.zip'
$extractDir = Join-Path $installRoot 'boss-cli-v0.6.11'
New-Item -ItemType Directory -Path $installRoot -Force | Out-Null
if ((Test-Path -LiteralPath $archive) -or (Test-Path -LiteralPath $extractDir)) { throw '下载目标已存在，请选择新的目录或核验现有文件' }
Invoke-WebRequest -Uri 'https://github.com/YLorb/boss-cli/archive/refs/tags/v0.6.11.zip' -OutFile $archive
Expand-Archive -LiteralPath $archive -DestinationPath $extractDir
Set-Location (Join-Path $extractDir 'boss-cli-0.6.11')
npm.cmd ci
if ($LASTEXITCODE -ne 0) { throw '依赖安装失败，停止' }
npm.cmd run build
if ($LASTEXITCODE -ne 0) { throw '构建失败，停止' }
node .\dist\cli\index.js help
```

GitHub ZIP带顶层目录，进入含package.json的目录后才执行npm；使用同一标签内的CLI与配套Skill。ZIP无.git，不能运行git pull或git rev-parse；记录下载URL和标签即可。

也可访问[dev分支页面](https://github.com/YLorb/boss-cli/tree/dev)，选择 **Code → Download ZIP**，或下载[dev ZIP](https://github.com/YLorb/boss-cli/archive/refs/heads/dev.zip)。解压后进入boss-cli-dev。dev持续变化，不保证等于本Skill已验证版本；优先使用固定提交或随包源码。若仓库访问需要权限，由使用者正常登录获取，不把下载错误网页当ZIP解压。

GitHub归档格式与固定提交下载依据：[GitHub官方文档](https://docs.github.com/en/repositories/working-with-files/using-files/downloading-source-code-archives)。

## Git方式（可选，已有方法保留）

```powershell
git clone --branch v0.6.11 https://github.com/YLorb/boss-cli.git
Set-Location boss-cli
git checkout v0.6.11
git rev-parse HEAD
npm ci
npm run build
node .\dist\cli\index.js help
```

以上固定到 v0.6.11 标签，Skill 使用该标签内的配套目录。后续升级需由交付者提供新的已验收 ref。原上游为 https://github.com/joohw/boss-cli ，不保证与此分支能力一致；更换来源须重新核验。

## npm 发布版（单独选择，不是失败回退）

```powershell
npm install -g @joohw/boss-cli
boss help
```

npm 版可能缺少本包依赖的 collect、联合键、JSON、check-login 等能力；`boss update` 会更新全局 npm 包，不会同步本地源码快照。不要在运行中自动升级。本文后续统一使用源码入口，避免命中另一份全局 boss。

## 必须核验的能力

help 应包含：`collect`、`--check-login`、业务 `--json`、`chat --data-id`、`send --check`、`accept-resume --check`、`download-resume --check`、`search`、`preview --candidate-id`、`greet --candidate-id`、`chat --inspect-embedded`、`send --embedded`。help 只能证明入口存在，页面选择器仍需登录验收。当前缺口见 [迁移与边界](manual-migration.md)。

## 安装 Skill

将完整 `boss-recruitment/` 文件夹交给宿主的 Skill 导入机制；保留 SKILL.md、AGENTS.md、references、assets 的相对路径。不同 WorkBuddy 版本的导入路径需以实际界面为准，本包不假定固定目录。宿主不支持 Skill 时，让 Agent 先读取该文件夹的 SKILL.md，并按其链接按需读取；只粘贴启动 prompt 不会自动加载文件。

CLI 源码目录与 Skill 目录可以分开，在运行配置中填写实际路径。安装不复制他人的浏览器配置、Cookie、账本、简历或候选人记录。
