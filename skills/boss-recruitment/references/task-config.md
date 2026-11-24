# 单个任务 JSON 与逐步结果

Agent 把用户要求写进一个普通 JSON，用 BOSS_TASK_CONFIG 指定绝对路径后直接调用业务命令。CLI 每次读取该文件，版本配套校验继续生效。文件中的人数、获准动作、评估标准及停止条件由 Agent 按 SOP 执行。

```json
{
  "job": "用户确认的完整岗位名 _ 城市",
  "scope": "search",
  "jd": "用户提供的岗位要求原文",
  "criteria": [],
  "allowedActions": ["search", "preview", "ocr", "decide", "back"],
  "resultsFile": "C:/Recruitment/records/position.jsonl",
  "ledgerDir": "C:/Recruitment/ledgers"
}
```

该示例只声明查看评估。联系、发送和下载需要用户授权后在同一 JSON 中记录，发送正文使用 messageScript 原文。observeLimit、contactLimit 等业务要求可以直接放在 JSON 中，由 Agent 逐人核对。任务文件没有强制过期时间，中断后继续读取原文件及结果。JSON 的其他描述字段由 Agent 解释。

job 必须是非空字符串。scope 如提供，应为 collect、recommend、search 或 view-only。resultsFile、ledgerDir 如提供，必须是绝对路径。可选的 task-check --json 只读取 JSON 并报告结果文件位置。创建任务文件后可直接执行工具。

resultsFile 未提供时，按 job 原文的 SHA-256 保存到 ~/.boss-cli/results/<岗位哈希>.jsonl。独立调用未提供任务 JSON 时，回执保存到 ~/.boss-cli/results/commands.jsonl。一次业务应固定同一个结果文件，Agent 在调用前读取既有记录。

联系、发送和开聊确认前追加 intent，执行后追加完整 result 或 error，并同步文件。其他业务命令在取得结果后保存一次回执。每个 attemptId 的最后一条记录代表当前结果。记录包含命令、参数、岗位、候选人 ID、正文和时间。私密凭据配置入口不写入操作回执。Agent 另外保存评分依据、人数统计、下一步和停止原因，引用对应 attemptId 或文件位置。

greet、send 使用稳定 ID 检查历史。已确认联系或已发送同文会阻止重复动作。intent 或 unknown 表示必须先核验。推荐 greet 返回 clicked 时仍待确认，通过同人聊天小窗的身份核验后记录联系确认。消息可通过同人、同岗位、完整正文的 check 回执确认。已确认尚未发出动作的发送前置错误记为 not-attempted，Agent 根据实际情况决定后续步骤。

兼容读取原 ledgerDir 中的 <岗位哈希>.actions.json，保留历史成功和未确认联系的去重效果。旧 runs 目录保留为历史材料，普通命令不读取其中的运行指针。旧任务中的控制字段可作为历史说明保留，CLI 只读取岗位及结果文件等实际使用字段。

单 Agent 串行使用同一浏览器和岗位记录。逐人完成查看、OCR、评估、获准联系、发送及关闭，再处理下一位。结果保存失败时停止新的业务动作。
