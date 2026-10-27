# 招聘操作手册入口

当前公开调用统一见[逐项调用手册](../skills/boss-recruitment/references/invocation-guide.md)：包含登录、状态检查、岗位切换、列表、昵称定位、消息、附件、推荐／搜索／深度搜索、预览、联系、内嵌会话及账本的参数、前置条件、结果和停止规则。

执行对应业务前，从[boss-recruitment Skill](../skills/boss-recruitment/SKILL.md)按任务读取SOP。页面要求以[URL与命令规范](boss-url-map.md)为准；账本协议见[账本与恢复](../skills/boss-recruitment/references/ledger-and-recovery.md)。

## 2026-10-27 当前行为

- 昵称定位不主动切换或恢复岗位；BOSS自行重置筛选不算失败。姓名、会话ID及详情姓名一致才通过。已核验的当前会话优先复用，不再次搜索。
- 重名暂停，不按已有ID选择；明确查询完成且为零返回not-found，业务调用抛CandidateNotFound停止；加载未确认仍是超时，不自动重试或跨页恢复。
- check和业务--check严格只读、返回true/false；status读取详情。沟通页check --job比较候选人详情岗位，不是顶部筛选。
- 账本job由Agent保留完整职称与城市、去掉薪资后确定；CLI按传入字符串区分。旧账本不自动迁移，缺少城市归属不能宣告完整对账。
- 卡片院校信息可核验时先按用户条件预筛，证据缺失不直接否决；完整评估仍须读简历，分别记录卡片数和打开人数。
- 推荐同岗位不重复选岗；返回简历使用back --if-open。搜索内嵌会话入口已实现，完整真实发送仍待验收。

真实BOSS操作默认仅公开CLI及scripts/switch-job.mjs岗位脚本。完整限制见[工具边界](../skills/boss-recruitment/references/tool-boundary.md)。不把旧日志、历史临时脚本或说明中的源码路径当成替代操作许可。

本轮范围、筛选条件、话术、输出位置和外部动作由用户确认。手册不是自动执行全部命令的授权；不将“可调用”当作“已验证整套招聘流程”。
