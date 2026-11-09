---
title: "岗位规范文件（job spec）"
read_when: "本轮初始化写入 JD/规则、评估前按需读取、上下文交接"
updated: "2026-11-08"
scope: "job-spec-file"
---

# 岗位规范文件

JD、评估规则与操作边界以文件为唯一依据，按需读取，不驻留上下文。本文件只约定位置与结构，不新增 CLI 命令，不改变 `boss jd` 的既有行为。

## 目录与命名

| 项 | 约定 |
| --- | --- |
| 目录 | `~/.boss-cli/jobs/`（即 `APP_HOME/jobs`），与 `~/.boss-cli/jd/` 并列 |
| 文件名 | `<完整岗位名>.json`；岗位名取账本岗位键（完整岗位名 + 城市 + 去薪资，见 [路径约定](paths.md)），文件名中的 `\ / : * ? " < > |` 替换为 `_`，并去掉末尾的点与空格 |
| 兼容 | `~/.boss-cli/jd/` 继续作为 `boss jd` 抓取职位的 `.md` 缓存，内容与用途不变；评估规范只放 `jobs/`，两者不混用、不互为回退 |

## 结构

以下结构是写入/读取约定，无代码强制校验；Agent 写入后按需读取。

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| schemaVersion | number | 是 | 固定 `1` |
| job | string | 是 | 账本岗位键（完整岗位名 + 城市 + 去薪资） |
| jdText | string | 否 | 职位描述原文（可用 `boss jd` 抓取的 `.md` 内容填充） |
| mustHave | string[] | 否 | 必备条件 |
| veto | string[] | 否 | 否决项 |
| bonus | string[] | 否 | 加分项 |
| weights | object | 否 | 维度→权重；本轮不求和、不解释 |
| threshold | number | 否 | 阈值 |
| boundaries | object | 否 | 操作边界：`entry`（collect/recommend/search）、`allowed`、`observeLimit`、`contact`、`messageScript` |

```json
{
  "schemaVersion": 1,
  "job": "全栈软件开发工程师 _ 深圳",
  "jdText": "岗位职责与要求原文",
  "mustHave": ["三年以上后端经验", "熟悉 Go 或 Java"],
  "veto": ["不接受外包经历"],
  "bonus": ["有 ToB 平台经验"],
  "weights": { "mustHave": 0.6, "bonus": 0.4 },
  "threshold": 60,
  "boundaries": {
    "entry": "collect",
    "allowed": ["probe-resume", "download-resume"],
    "observeLimit": 20,
    "contact": ["greet"],
    "messageScript": "对外可发送的话术"
  }
}
```

## 使用流程

1. **初始化**：Agent 将使用者确认的 JD、必备条件、否决项、加分项、权重、阈值、操作边界写入 `<岗位>.json`。
2. **按需读取**：评估某岗位候选人时读取该文件；读完整理后放下，不长期驻留上下文。
3. **交接**：只传文件绝对路径；接收方先读文件再评估，不复制或复述原文。
4. **变更**：使用者明确修改某一项后更新文件；后续评估以文件当前内容为准。

## 边界

- 文件名仅用于定位；评估身份以文件内 `job` 字段为准，读取后核对该字段与目标岗位一致。
- 文件由 Agent 以 UTF-8 写入/读取；人工手改请保持 UTF-8，避免 ANSI/GBK 导致乱码。
- 无哈希、无版本锁定：按需重读即为最新内容，不检测中途改动（有意的简化，非遗漏）。
