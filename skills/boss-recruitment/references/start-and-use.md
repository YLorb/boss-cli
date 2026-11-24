# 启动与使用

1. 读取实际使用的 SKILL.md、AGENTS.md 和对应 SOP，核对公开 CLI 安装路径。
2. 将用户要求写入一个任务 JSON，设置 BOSS_TASK_CONFIG。外部 Skill 通过 BOSS_SKILL_DIR 指向实际目录。
3. 使用 version-check --json 核对版本。所有业务调用继续执行 CLI/Skill 配套校验。
4. 浏览器已就绪时直接执行 status --json。首次使用由宿主后台运行 browser-session --json 并等待 ready；仅确认需要登录时执行 login --json。
5. 按 SOP 调用工具，每步取得回执后读取结果并保存 Agent 判断，串行循环直到满足用户的停止条件。

```powershell
$env:BOSS_SKILL_DIR = 'C:\Recruitment\boss-cli\skills\boss-recruitment'
$env:BOSS_TASK_CONFIG = 'C:\Recruitment\task.json'
boss version-check --json
boss status --json
```

启动前无需创建运行实例或权限文件。task-check --json 可用于离线检查任务 JSON。工具参数以 boss commands <命令名> --json 为准。

browser-session 使用固定专用目录和调试端口，断开 CDP 后继续输出 ready、alive 和 stopped。业务命令只连接已有 Chrome。浏览器身份校验和端口冲突错误应直接报告。宿主负责后台进程生命周期，招聘循环由 Agent 执行。

中断后读取原任务 JSON、固定结果文件和岗位账本，核对当前页面及未确认动作，从明确未完成的步骤继续。任务没有强制过期时间，Agent 继续遵守用户给出的停止要求。版本不匹配、身份不明或风控时按 SOP 停止并保留原始错误。
