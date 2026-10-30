# 简历解析的紧凑交接与计时

适用：已有成功且不需要图片复核的 OCR 文本，进行本地结构化收集。不是评分器，不连接 BOSS，不重复 OCR，也不调用其他模型。

先读取完整文本，再由 Agent 一次给出字段及证据行号；固定脚本展开原文、校验引用并保存 JSON。不要每人重新编写 PowerShell/Python 保存程序，也不要让 Agent 抄写整段已存在的证据。

```powershell
node '<实际Skill目录>/scripts/resume-analysis-session.mjs' start --receipt '<成功OCR回执.json>' --output '<新的本次解析目录>'
node '<实际Skill目录>/scripts/resume-analysis-session.mjs' finish --output '<同一解析目录>' --result '<Agent根据本人的编号文字生成的JSON>'
```

`start` 验证原图哈希、OCR成功状态及 needsReview=false，读取全文一次并输出从1开始的非空行编号。目录中的 session.json 已存在时拒绝覆盖；已有同人成功结果应按原图哈希复用，而不是重新建立测试会话。只有用户明确要求基准复测才对同图生成新的解析结果。

`finish` 支持以下两种明确格式：

- 完整字段：name、role、city、email 为字符串，experienceYears 为数字；education、skills、employment 为证据行号数组，projects 为每个项目的行号数组，issues 为 `{issue:简短说明,evidence:行号数组}` 的数组。
- `format="line-map"`：用 profile 数组依次指定姓名、意向岗位、城市、邮箱、工作年限的行号，其他四类证据及 issues 同上；无 name/role/city/email/experienceYears 字段。岗位、城市、邮箱、年限原文须为冒号分隔的标签值，年限须为明确的数字加“年”。不凭旧样本行号套用新简历。字段缺失或格式不支持时报错，不猜填，不绕过核验以追求速度。

脚本输出 agent-result.json 和 timing.json。计时含缓存读取核验、Agent分组、工具调度和结果写盘，不包含原始 OCR；agentAndToolGapMs 不是纯模型推理耗时。生成脚本、排查及初次授权不纳入这个单人处理区间，需报告该口径。需要图片核验、真实岗位评分或更复杂字段的任务不应据此宣称已测得同样速度。

2026-10-30 同一份已知竖版模拟样本：原流程 OCR 之后50.02秒；预置保存程序后30.85秒；紧凑行号交接后17.20秒。最后一轮缓存核验8ms，Agent及工具间隙17189ms，校验保存3ms。未重跑OCR；加历史OCR命令3.91秒约21.11秒仅为估算。该样本不是盲测，不能外推真实简历吞吐量。

同日另生成不同内容的33行单栏模拟简历，首次调用OCR1次：OCR命令3.992秒，衔接0.101秒，Agent解析及保存6.848秒，全程10.941秒。未复用此前样本OCR或解析结果；计时从OCR命令启动到结果保存，包含工具间隙，不含造图、授权与事后质量核验。helper中的ocrReused=true仅表示读取刚生成的成功回执，不能据此称为历史缓存命中；ocrCalls=0仅是helper自身调用数，整个流程仍调用OCR1次。服务预热和模型提示词缓存未测量，一次简单版面测试不保证所有简历耗时。
