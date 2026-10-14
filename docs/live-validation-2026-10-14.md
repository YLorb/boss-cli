# 2026-10-14 未覆盖功能实测

范围：上一轮 TODO 1、2、3、7 的剩余覆盖；真实页面操作均通过公开 CLI。保留“不发送任何消息”约束，未调用 send/greet/accept-resume/request-attachment-resume，未提交或发布职位。此前 Chrome/CDP 存活及 positions 已通过，本轮补测共享 JD 详情入口与在线简历截图。

| 检查 | 结果 | 证据与边界 |
| --- | --- | --- |
| `--check-login --json` | 通过 | 返回 logged-in。 |
| `jd <职位名称> --json` | 失败 | 本地无 JD 缓存；新版编辑按钮打开 `/web/chat/job/edit`，读取详情表单超时，未找到旧 `.job-edit-container.edit-job`；未生成 JD 正文。 |
| `list --chatting --json` | 通过 | 读取 40 个已有沟通对象；这次没有重现页面守卫阻塞，不表示已定位历史根因。 |
| `chat <姓名> --data-id <ID> --json` | 通过 | 选择起始列表中 unreadCount=0 的现有对象，核对联合键；没有接受待处理附件请求。 |
| `action resume --json` 首次阅读等待 | 通过 | 外层滚动容器；计划等待 7024ms，实际约 7038ms，在首次滚动前执行。 |
| 相邻分段滚动等待 | 通过 | 包含截图及恢复位置，共12段、11次等待，计划等待561～2920ms，均位于500～3000ms范围内。 |
| 完整简历拼接 | 失败 | 7屏，末屏 top=2462.3999、height=712、total=3174，已到达底部；随后重叠校验失败。恢复原位置top=0后抛错，未写出截图。 |
| 成功截图后的1000～5050ms延迟关闭 | 未覆盖 | 拼接失败，未执行 file-written/close-start，不将失败样本视为成功关闭验收；离线成功流程仍通过。 |

真实数据与完整日志只保存在忽略提交的 `output/todo-live-validation/`：jd/list/chat/resume 的 JSON 与 stderr。公开报告不复制候选人消息和个人简历。失败后的在线简历未执行成功关闭流程。

为取得真实等待证据，增加 `BOSS_CLI_TRACE=true/1` 下的 `[boss-cli][resume]` JSON事件日志，记录计划等待、实际耗时、滚动位置、分屏与写入/关闭顺序；仅写stderr，不包含候选人详情，不修改默认JSON结果。关闭TRACE时不输出。构建与 `test:resume-timing` 3项离线回归通过。

## 成功截图后延迟关闭的补测

前表为首次实测结果。后续截图诊断仍由公开 `action resume --json` 执行，临时在CLI内部保存分屏，未另起连接监测简历页面。根因是PNG尺寸取整：CSS宽690、PNG宽863，旧代码由宽度反推为1.2507246377，但实际devicePixelRatio为1.25，累计像素位置偏差触发重叠校验。clientHeight/scrollHeight的整数CSS像素还会使推算底部多出一个像素。

修复使用实际devicePixelRatio，检查PNG尺寸与该比例一致；确认末屏达到底部后，以实际末屏起点和图像高度计算输出范围，保留所有捕获像素。重叠校验阈值不变，不尝试其它截图路径。临时分屏保存代码已移除，诊断证据仅保留在忽略提交的output目录。补充错误上下文和关闭后可见弹层检查；关闭未成功直接报错。

2026-10-14 23:01～23:02（北京时间）在公开CLI重置页面、重新核对同一联合键后实测通过：

- 7屏、实际DPR1.25；各次重叠校验differentRatio均为0，meanDifference约0.095～0.111。
- 成功生成863×3968 PNG、1590909字节；查看图片确认顶部、底部及各段无明显缺失或重复。
- 恢复原滚动位置top=0，23:02:25.647写入文件，随后开始1000～5050ms关闭等待。
- 实际等待3562ms，23:02:29.211开始关闭，23:02:29.597确认visiblePanel=false；命令退出码0。
- `test:resume-timing` 4项回归通过，包括分数DPR的完整像素保留、错误缩放/缺底部/变化内容拒绝、等待顺序及关闭失败报错。

成功回执与日志为 `output/todo-live-validation/resume-covered.{json,stderr.log}`。此前失败留下的弹层通过公开positions/list/chat页面导航清理后复测，没有忽略遮挡或多iframe异常。全程未发送消息。当前职位编辑页的详情字段读取仍待修复；此前仅限职位页的非CLI只读诊断授权不扩展到简历页面监测。
