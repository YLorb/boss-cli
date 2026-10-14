---
title: "下载、安装与版本兼容"
read_when: "首次部署、换机、升级或命令缺失"
updated: "2026-10-14"
scope: "local-installation"
---

# 下载、安装与版本兼容

## 环境

需要 Node.js（本包按 Node 24 验证；上游 README 声明最低20）、npm、Chrome／Chromium，以及允许调用本机 shell 的 Agent。源码从 GitHub 获取时还需 Git。Windows PowerShell 是本包主要示例环境；不宣称其他系统已实测。

官方工具下载：Node.js https://nodejs.org/ ，Git https://git-scm.com/ ，Chrome https://www.google.com/chrome/ 。版本要求以交付源码的 package.json、构建结果及命令核验为准。

## 路径一：使用随包源码快照（对应本文档）

解压 `boss-cli-source-2026-10-14.zip` 到自选目录，进入其 `boss-cli` 子目录：

```powershell
node --version
npm --version
npm ci
npm run build
node .\dist\cli\index.js help
```

这是已推送的 CLI 0.6.7 源码，功能基线为 `457c5ef`，仓库为 `YLorb/boss-cli`。`source-manifest.json` 记录 commit 与文件哈希；不表示同名 npm 包已发布此版本。构建失败直接处理错误，不换用其他版本掩盖。

## 路径二：从 GitHub 下载源码

```powershell
git clone --branch dev https://github.com/YLorb/boss-cli.git
Set-Location boss-cli
git checkout 457c5ef
git rev-parse HEAD
npm ci
npm run build
node .\dist\cli\index.js help
```

以上固定到已验证的 CLI 提交，Skill 由独立压缩包提供。后续升级需由交付者提供新的已验收 ref。原上游为 https://github.com/joohw/boss-cli ，不保证与此分支能力一致；更换来源须重新核验。

## npm 发布版（单独选择，不是失败回退）

```powershell
npm install -g @joohw/boss-cli
boss help
```

npm 版可能缺少本包依赖的 collect、联合键、JSON、check-login 等能力；`boss update` 会更新全局 npm 包，不会同步本地源码快照。不要在运行中自动升级。本文后续统一使用源码入口，避免命中另一份全局 boss。

## 必须核验的能力

help 应包含：`collect`、`--check-login`、业务 `--json`、`chat --data-id`、`send --check`、`accept-resume --check`、`download-resume --check`、`search`、`preview`。help 只能证明入口存在，页面选择器仍需登录验收。当前缺口见 [迁移与边界](manual-migration.md)。

## 安装 Skill

将完整 `boss-recruitment/` 文件夹交给宿主的 Skill 导入机制；保留 SKILL.md、references、assets 的相对路径。不同 WorkBuddy 版本的导入路径需以实际界面为准，本包不假定固定目录。宿主不支持 Skill 时，让 Agent 先读取该文件夹的 SKILL.md，并按其链接按需读取；只粘贴启动 prompt 不会自动加载文件。

CLI 源码目录与 Skill 目录可以分开，在运行配置中填写实际路径。安装不复制他人的浏览器配置、Cookie、账本、简历或候选人记录。
