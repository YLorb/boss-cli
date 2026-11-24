# 任务 JSON 中的岗位要求

Agent 将用户提供的 JD、评估标准、否决项、未知信息处理、人数、获准动作和完整话术保存在任务 JSON 中，后续按原文执行。

可使用 jd、criteria、unknownPolicy、observeLimit、contactLimit、allowedActions、messageScript 等字段。CLI 读取实际使用的岗位及结果路径，其余字段由 Agent 按 SOP 解释。没有固定的评分阈值、学校限制或过期时间。

用户修改某项要求时只更新该项。中断或交接时保留任务 JSON 及结果文件路径，恢复后重新读取原文。评估证据、动作回执和未确认事项逐步保存到结果记录。

内部评估标准只供 Agent 判断，候选人可见内容使用用户确认可发送的话术。

示例见 [单个任务 JSON](task-config.md)。
