# Boss URL 与功能对照

本文件记录 boss-cli 已知页面 URL、对应命令和当前位置要求。修改页面导航、命令入口或报错文案前，先对照这里，避免把某个命令改成隐式跳转或多路径兜底。

招聘 Agent 必须遵守[工具使用边界](../skills/boss-recruitment/references/tool-boundary.md)：真实页面默认仅用公开 CLI 及列明的岗位切换脚本。本文的源码位置、CDP 技术说明或开发测试命令不授予直接连接浏览器的权限；非 CLI 线上监测、截图和测试均需用户明确特殊声明。

WorkBuddy 执行顺序、每步指令和 2026-10-13 实测注意事项见 [招聘采集执行手册](workbuddy-recruitment-runbook.md)。

2026-10-14 确认的推荐/搜索主动寻访 SOP、消息3及停止规则见上述执行手册“主动寻访 SOP”章节。搜索筛选为“不限岗位”，沟通与账本仍对应目标 JD 岗位；流程约定不代表命令已经实现，以下表格保留现有能力说明。

## 页面 URL

| URL / Path | 页面功能 | 相关命令 | 当前行为 |
| --- | --- | --- | --- |
| `https://www.zhipin.com/web/user/?ka=header-login` | 登录入口 | `boss login` | 直接打开登录页，交还给人工扫码/验证。 |
| `/web/chat/index` | 沟通列表、候选人会话页 | `boss list [--unread] [--chatting] [--json]`、`boss chat <姓名>`、`boss chat [姓名] --index <序号> [--unread]`、`boss chat <姓名> --data-id <会话ID>`、`boss accept-resume <姓名> --data-id <会话ID>`、`boss download-resume <姓名> --data-id <会话ID> [--output-dir <目录>]`、`boss send [--name <姓名> --data-id <会话ID>]`、`boss action` | `list --chatting` 明确选择顶部「沟通中」，`--json` 输出会话行 `data-id` 和当前沟通职位；联合键命令会在顶部「全部」查找并核对详情。`accept-resume` 仅点击当前候选人的附件请求卡片并等待附件到达；`download-resume` 要求附件已经收到，打开预览并经 Boss 下载按钮保存原文件。指定目标的 `send` 在发送前后核对会话并确认新消息出现在页面。传统 `send` / `action` 仍要求当前会话已打开。 |
| `/web/chat/recommend` | 推荐候选人列表 | `boss recommend`、`boss preview <姓名>`、`boss greet <姓名>` | `recommend` 会先检查当前位置，不在该页时直接进入；`preview` / `greet` 要求当前已在该页且列表已加载。 |
| `/web/chat/aiform` | 深度搜索 / Agent 搜索 | `boss deep-search [--core <要求>] [--bonus <加分项>] [--clear-core] [--clear-bonus] [--match]`、`boss preview <姓名>`、`boss greet <姓名>` | `deep-search` 会先检查当前位置，不在该页时直接进入；默认只输出招聘要求表单、核心要求、加分项、今日剩余匹配次数和按钮状态，不输出候选列表；`--core` / `--bonus` 可重复，并按传入列表同步对应分组（多余行会删除，不足会新增），`--clear-core` / `--clear-bonus` 清空对应分组；只有 `--match` 会消耗今日匹配次数并输出列表顶部最新 20 条；`preview` / `greet` 要求当前已在该页且列表已加载。 |
| `/web/chat/search` | 常规搜索 | `boss search [关键词]`、`boss preview <姓名>`、`boss greet <姓名> [--check]` | `search` 会先检查当前位置，不在该页时直接进入；带关键词时填入搜索框并回车搜索；`preview` 要求当前已在该页且列表已加载，不支持 `--job`。 |
| `/web/chat/job/list` | 职位管理列表 | `boss positions`、`boss jd <name>` | 可通过侧栏进入职位管理页后读取。 |

## 约定

- 沟通岗位切换使用 `node scripts/switch-job.mjs --list` 读取实时完整label，再用 `--job "完整label"` 唯一匹配并核验；要求已登录、仅一个BOSS标签且当前在 `/web/chat/index`。可显式传 `--cdp-url` 和 `--timeout-ms`，不导航、不改分类、不联系候选人、不重试；错误非零退出。完整操作规范见 [Skill岗位切换](../skills/boss-recruitment/references/switch-job.md)。

- 正常招聘SOP只从指定岗位未读列表逐人处理，评估一人后完成其发送/收件或等待，再处理下一人；本轮附件收集完成后统一上传。对账、复查、仅收集须人工明确指定。当前 `collect round` 遍历全账本、`chat --data-id` 进入全部、`--check` 未命中会完整定位，不能保证严格未读边界；不得将这些技术能力作为正常SOP扩大范围的授权。

- `boss --check-login [--json]` 通过已配置的本机 CDP 端口，只读检查首个 `www.zhipin.com` 页面；不启动浏览器、不导航、不安装页面守卫。登录入口返回 logged-out；可见工作台菜单或账号入口返回 logged-in；验证页或缺乏证据返回 unknown。连接失败、没有 BOSS 标签页、页面失效直接报错，不能解释为未登录。此命令检查页面信号，不验证服务端会话有效期。

- `boss probe-resume <姓名> --data-id <会话ID> [--download] [--output-dir <目录>] [--json]` 使用 `/web/chat/index`：进入「沟通—全部」，定位后先读附件再读己方已发送的默认求简历话术。未观察到不等于无附件或未发送；`--download` 才下载。与 `accept-resume`、`download-resume` 一样，CLI 整条命令限时 15 秒，确认子进程退出后报错。
- `boss collect --job <岗位完整名称> [--ledger-dir <目录>]` 为候选人处理流程的第一个常驻步骤：等待 started、核对岗位与 recoveryRequired、读取 show 后才处理候选人；有恢复要求时等待人工 reconcile 完成。启动 collect 本身不导航页面。round 处理普通记录；人工 recheck 复查 RECHECK；人工 reconcile 遍历「沟通—全部」，按岗位全量逐项对账；stop 写回。见 [岗位账本](collection-ledger.md)。
- 联合键定位先检查当前列表；未找到时在列表区域内使用滚轮分段扫描，每段不超过视口高度的 65% 且不超过 500px，不再强制跳到顶部。先向下扫描，连续三轮可见行位置与身份未变化后转向上扫描；双向扫描仍未定位或超过 120 轮直接报错，不将未找到解释为候选人不存在。目标已挂载但位于视口外时，分段滚动使其可见。`--check` 命中当前正确会话时仍只读、不滚动。全量对账的完整列表盘点仍从顶部开始。
- DOM 信息读取本身不刷新页面、不点击或导航；滚轮可能触发 BOSS 的虚拟列表更新或加载更多，点击候选人会更新详情。完整 `list`/定位命令包含页面和分类筛选准备，不能把整条命令称为纯读取。已经在沟通页时 URL 检查不导航；公共层不再把非工作台页面自动导航到沟通首页，风险页只记录错误上下文、不自动返回；执行上下文销毁直接报错，不重跑业务回调。

- 列表准备按「进入沟通页 → 切换所需顶部分类 → 选择全部/未读筛选 → 等待列表」顺序执行。已选中的分类和筛选不重复点击；需要切换筛选时只调用一次 `.click()`。联合键定位只准备一次列表。
- `send` 将整段话术写入剪贴板，全选后粘贴，核对输入内容再发送；任何一步失败直接报错，不回退到逐字符输入。该操作会覆盖系统剪贴板文本。
- `download-resume`、`accept-resume` 和指定姓名及 `data-id` 的 `send` 支持无值开关 `--check`。加开关时直接只读读取当前沟通页选中行的 `data-id`；相同 ID 时仅核对姓名、选中行和详情，不关闭预览、不切分类、不滚动、不再次点击会话。不相同时正常按联合键定位。相同 ID 但姓名或详情不符直接报错，不改走定位路径。未加开关仍执行完整定位。直接比较页面现状，不安装全局变量或 DOM 观察器；当前选中行数量异常直接报错。

- 所有业务命令支持 `--json`：`login/list/chat/action/accept-resume/download-resume/send/positions/jd/recommend/search/deep-search/preview/greet`。默认文本行为保留，`download-resume` 默认已输出 JSON；JSON 字段与用法见 [CLI JSON 输出](cli-json-output.md)。JSON 模式 stdout 仅输出一个结果，日志走 stderr，参数或执行失败输出 JSON 错误并返回非零退出码。
- `chat --data-id --json` 在身份核对后读取人才摘要、当前已加载的消息和附件存在标记；默认文本仍仅输出定位确认。`jd --json` 继续保存和复用 Markdown，返回正文、文件路径与 `cache/page` 来源，不解析 Markdown 或强制刷新。

- 联合键定位前会关闭当前可见的附件预览（`.resume-detail-chat` 内的 `iframe.attachment-iframe` 或 `img` 所属弹层），防止预览遮挡会话列表；原附件下载成功并完成完整性校验后也会收起该预览，支持连续调用。图片预览会等待图片加载完成，再通过同一 Boss 下载按钮保存原文件；图片预览地址不提供 `geekId`，返回值为 `null`，会话仍通过姓名和 `data-id` 核对。
- 当前 URL 校验优先于 DOM 猜测。命令依赖特定页面时，先检查 path，再执行页面读取或点击。
- 不为高风险操作添加隐式兜底跳转。需要用户处于特定页面的命令，应直接报出当前 URL 与目标 URL。
- 页面入口发生变化时，同步更新本文件和相关命令 help 文案。
- `positions` 读取当前分页，不自动遍历所有页。2026-10-14 验证的职位页是 `/web/frame/job_v2/list` iframe：行 `.job-item-container`、标题 `.job-title .job-name`、标签 `.job-title .job-labels`、状态 `.job-status-wrapper .status-box`，信息标签和三项统计仍由各行读取。DOM 未暴露 data-id 时 id 保持空字符串，不伪造。共享 JD 编辑入口为对应行 `.operation-container .operate-btn` 中文字严格等于“编辑”的唯一按钮。
- `positions` 以实际职位行确定所在 frame，不把主页面统计文字视为列表已就绪；16 秒内未识别职位行、或已识别行缺少标题/状态/三项统计时明确报出 URL 和解析上下文，不过滤后返回 `jobs=[]`，不将缺失统计补零。真实页面结构变更必须依据当前 DOM 证据修复，不能猜测选择器。离线回归：`npm run test:positions`。
- 侧栏导航使用实际调用的字符串脚本：点击菜单后必须等待 pathname 等于目标路径，不能只返回函数对象就视为导航完成。
- `boss action resume` 与 `boss preview` 当前只保存并返回在线简历截图路径；Boss CLI 的截图 OCR 调用已关闭，不自动解析简历。
- 在线简历截图保持当前视口尺寸，打开后随机等待 2000–10000ms，再通过简历区域内的滚轮逐屏截取并拼接；每段滚动采用随机加减速，保留约 35% 重叠，以实际滚动位置裁剪重复部分并检查重叠像素。确认顶部、稳定底部后恢复原滚动位置，再写入 PNG。支持 iframe 内部滚动和完整高度 iframe 的外层容器滚动；按实际布局唯一识别滚动容器。重叠校验使用区域平均像素差，兼容非整数显示缩放的抗锯齿差异。推荐、常规搜索、深度搜索的 `preview` 与沟通页 `action resume` 共用此实现。截图不再使用 `BOSS_RESUME_SCREENSHOT_VIEWPORT_HEIGHT`，不主动刷新页面。随机滚动不构成平台风控安全保证。
- 完整性检查失败直接报错，不保存为完整简历、不改用拉高视口截图。多个滚动容器、横向溢出、固定/吸顶遮挡、区域超出视口、内容高度变化、滚轮无响应或重叠校验失败均停止。最多 100 屏、8000 万累计截图像素；动态加载或特殊布局需要先解决原因。本地已验证合成图像与模拟滚动流程，测试脚本不随本次正式代码交付。
- 首次固定/吸顶遮挡检测在打开后的 2000–10000ms 阅读等待结束后执行，避免尚未经过初始等待就将加载层判为截图失败；等待后持续遮挡仍直接报错，不隐藏元素、不重复尝试。2026-10-22 修正时序，后续两份完整截图实测成功；未重开此前失败的候选人，不声明已确认该遮挡元素的具体用途。
- 相邻完整滚动段之间随机等待 500～3000ms（含顶部定位和原位置恢复），与每个滚轮脉冲的 16～32ms 间隔分开；首次滚动前仍随机等待 2000～10000ms。成功完成截图、恢复位置并写入文件后，随机等待 1000～5050ms 再关闭简历；截图失败直接报错，不走成功关闭流程。离线回归：`npm run test:resume-timing`。
- `BOSS_CLI_TRACE=true/1` 时，简历截图在 stderr 输出 `[boss-cli][resume]` JSON事件：阅读/分段等待、滚动起止、分屏、实际DPR/重叠校验、写入和关闭顺序；不改变业务 stdout。拼接使用实际devicePixelRatio，不能从取整后的PNG宽度反推缩放；确认底部后按实际末屏像素范围输出。关闭后仍可见在线简历时直接报错。2026-10-14补测已验证完整截图及成功后的3562ms延迟关闭；`jd` 详情读取仍因编辑页结构变化失败。具体边界见 [实测记录](live-validation-2026-10-14.md)。
- 实际浏览器验收覆盖内外滚动容器、150% 像素缩放、首轮阅读等待、滚动恢复和无重载检查。拼接保证范围为当前展开内容；页面自身折叠的“查看全部”等内容不因滚动而自动展开。
- `data-id` 是 Boss 页面会话行标识；联合键使用候选人显示名称和 `data-id`，两者不一致时停止操作。附件预览地址出现的 `geekId` 单独返回，但尚不作为定位主键。

## 推荐页状态保持与返回（2026-10-15）

- `boss recommend "岗位完整名称" --check-job [--json]`：先读取当前岗位，忽略空白和大小写后完整相等则不打开下拉、不搜索、不点击；不相等时只选择完整相等的岗位。该开关需要岗位名称，不接受赋值。未带开关仍保留原来的关键词选择语义。
- `boss back --check-in_online_resume [--json]`（交互别名 `/back`）：当前已知列表上存在在线简历弹层时关闭并核验；列表无弹层时返回 `action=noop`，不执行历史回退。独立 `/web/frame/c-resume/...` 页面仅在前一条历史属于同域的推荐、搜索、深度搜索或沟通列表时回退一步，并核验最终 URL。无历史、未知历史目标、未知当前页面或关闭失败直接报错，不以历史回退兜底。无检查开关且未打开简历时报错。
- 公共层不自动调用 back。出现异常后先检查当前状态，再显式执行返回命令；不得盲目重试刚才的选岗、预览或发送动作。
- `greet` 不再临时拉高视口或恢复视口尺寸；读取当前已挂载卡片，找不到目标直接报错。已可见页面不再重复 bringToFront。
- 简历截图采用当前可见视口截图，`fullPage=false`、`captureBeyondViewport=false`，不传浏览器 clip；按实际 DPR 在本地裁剪所需区域、拼接，裁剪边界或视口变化直接报错。外层滚动时复用首屏，避免重复截图。保留原有阅读等待、分段等待、完整性校验及关闭等待。此改动减少浏览器裁剪渲染干扰，不宣称未经现场验证的闪烁已完全消失。
- 离线回归：`node --experimental-test-module-mocks --test scripts/test-recommend-navigation.mjs scripts/test-session-no-recovery.mjs`，以及 `npm run test:json`、`npm run test:resume-timing`。

## 搜索页立即沟通（2026-10-20，本地实现）

- `boss greet "完整显示姓名" --check --json`：仅常规搜索页支持预检；读取当前候选人身份、作用域和按钮状态，不点击、不关闭简历、不搜索、不切岗位。默认检查当前已打开的在线简历；无可见在线简历时检查搜索卡片。两条路径按页面状态明确选择，失败不切换另一条路径。
- `boss greet "完整显示姓名" --json`：搜索页要求已加载卡片中姓名严格唯一；搜索卡片组件的姓名须与显示姓名一致，并提供非空 `encryptGeekId`；若简历已打开，主页面唯一 `.resume-middle-wrap` 须包含该简历 iframe，右侧唯一 `.resume-simple-box` 的 `geekInfo.encryptGeekId` 和 `resumeInfo.encryptGeekId` 必须同时与卡片 ID 一致。按钮仅在该右侧操作区内定位。Canvas 简历不以 iframe 内姓名 DOM 核验身份，不调用组件方法或接口。仅点击唯一、可见、可用且未被遮挡的「立即沟通」或「打招呼」，支持带额度数字的按钮文字。搜索页拒绝 `--job`，普通 greet 不代选联系岗位；选岗使用下述 --select-job 独立步骤。不处理购买或二次确认。
- 返回 `ready` 表示预检可点击；`already-contacted` 表示按钮已为「继续沟通」，不再点击；只有点击后同一身份的按钮变为「继续沟通」才返回 `contact-confirmed`。该状态不证明消息3已发送或账本已写入。
- 点击后按钮消失、页面跳转、出现确认弹层或超时等无法确认结果时，明确报出“已点击一次，禁止自动重试”；应先人工核对，不连续执行 greet。平台可能自动发送默认问候并消耗权益，预检不会消耗这些点击权益。
- 姓名不唯一、候选人 ID 缺失或不符、按钮结构与现有依据不符、按钮在视口外等情况直接停止。选择器与组件字段依据为 2026-10-20 真实搜索页面只读检查；n** 的真实预检已返回 `identityVerified=true`、`status=ready`、`clicked=false`，随后按用户授权点击一次，出现联系岗位选择弹层；未选岗或二次确认，尚未完成沟通。组件字段变化直接报错，不退回按姓名或全局按钮猜测。
- 离线回归：`node --experimental-test-module-mocks --test scripts/test-search-greet.mjs`。测试独立浏览器，网络请求全部由模拟内容响应，不连接真实会话。

### 只打开搜索在线简历

`boss preview "完整显示姓名" --open-only --json` 仅支持当前常规搜索页。先唯一精确匹配卡片；已有可见简历时不再点卡片，等待 Canvas 就绪并按候选人 ID 核验当前简历；没有简历时只点击匹配卡片的 `.name-label`，等待可见 iframe 和 Canvas 加载后按同一 ID 规则核验。ID 不符、姓名重复或超时直接报错，不自动关闭重开。

返回 `status=open`、`reused`、`candidateId`、`identityVerified=true`、`controls`（该简历右侧已核验按钮的文字）、`screenshot=false`、`closed=false`。不截图、不滚动简历、不点击沟通按钮，不执行截图成功后的自动关闭。加载就绪与身份核验分开执行，等待条件不能吞掉身份错误。后续使用 `greet --check` 预检，确认后再执行真实沟通。不带 `--open-only` 的 preview 仍是原截图流程。

2026-10-20 点击后验证：`common-job-list-dialog` 提示“请选择与牛人沟通的职位”，不是沟通成功。现有公共付费提示检测因文案“VVIP账号沟通权益”将其归类为付费弹层，仍须依据只读诊断正文区分；普通 greet 的付费提示分类仍可能误报选岗弹层；选岗与二次确认使用下述显式入口。

### 搜索联系弹层选岗

`boss greet "姓名" --select-job "联系岗位完整名称" [--check] --json` 仅用于搜索页已打开的 `.common-job-list-dialog`。按卡片与简历操作组件 ID 核对候选人，完整名称唯一匹配岗位，选择后验证唯一 active 行；只选岗，不点击弹层的“立即沟通”。`--check` 不滚动、不点击。不能与 `--job` 混用。已有明确招聘目标岗位时直接按该岗位选择；没有明确岗位时必须先询问用户，不采用弹层默认选中项。搜索条件“不限职位”不代表联系岗位。

真实选岗验收：为 n** 执行 `--select-job "大模型推理加速专家"` 返回 `job-selected`、`selected=true`、`clicked=true`、`contactConfirmed=false`，未点击弹层确认按钮。

### 确认搜索联系

`boss greet "姓名" --select-job "已选岗位完整名称" --confirm-contact [--check] --json`：只处理已打开的联系选岗弹层，核对候选人 ID 与唯一选中岗位，不自动改选。`--check` 仅预检；去掉后只点击一次弹层 footer 中的“立即沟通”。弹层关闭且同一候选人的简历按钮变为“继续沟通”才返回 `contactConfirmed=true`；超时或身份变化明确报错，禁止自动重试。不等于消息3发送或账本入账完成。

确认联系使用 `boss greet "完整显示姓名" --select-job "已选岗位完整名称" --confirm-contact --json`，可先加 `--check` 只读核对。要求候选人身份与已选岗位一致，不自动改选，只点击弹层确认一次。弹层关闭且同一候选人的按钮变为“继续沟通”后返回 `contact-confirmed`、`contactConfirmed=true`；失败不得重试。仅在用户已授权联系时执行，消息3及入账仍为独立步骤。

2026-10-20 实测：n** / 大模型推理加速专家已完成弹层确认，CLI 返回 `contactConfirmed=true`。本次未单独发送消息3或写入账本。

### 打开已联系候选人的沟通

`boss greet "姓名" --continue-chat --candidate-id "成功回执中的候选人ID" [--check] --json` 仅支持搜索页及当前在线简历。核对候选人 ID 后，要求按钮严格为“继续沟通”，显式点击一次；`--check` 只读。不与选岗、确认联系或 `--job` 混用。不发送消息。返回 `continue-clicked` 仅表示点击已执行，不证明会话加载或消息发送成功；执行异常不得自动重试。

继续沟通要求当前在线简历已打开，ID 必须来自先前成功回执，并与当前简历的两处 ID 一致；此路径不依赖联系后可能移除目标的搜索列表，不自动回退到姓名匹配。

`boss chat "姓名" --check --json` 只读核对当前沟通页：唯一选中行姓名、data-id 与详情姓名必须匹配，返回当前摘要和消息；不导航、不点击、不切筛选，不与 index/data-id 定位选项混用。

已联系后打开会话：`boss greet "姓名" --continue-chat --candidate-id "成功回执中的候选人ID" --json`。要求当前简历仍打开，核对该 ID 的两处组件数据；不依赖联系后可能移除候选人的搜索列表。可加 `--check` 只读核对。`continue-clicked` 只确认点击，不证明已打开独立沟通页。

已知边界：2026-10-20 实测“继续沟通”打开了搜索页内聊天窗口，姓名可能由掩码变为完整显示名。当前 `chat --check` 与 `send` 仅支持 `/web/chat/index`，尚未支持该搜索页内窗口；禁止据点击回执直接发送，需先解决该窗口的身份核验和发送支持。本轮消息未发送。


## 搜索页内嵌聊天（2026-10-22）

- `chat --inspect-embedded --json` 只读输出当前窗口的最小身份及已加载消息，不代表身份核验通过；无窗口或多窗口报错。
- `chat "实际姓名" --embedded --check --candidate-id "触达回执ID" --job "完整岗位" --json`：仅 `/web/chat/search`，核对卡片 conversation.encryptUid/name/toPosition、容器 friendId 和输入组件 uniqueId；不依赖脱敏姓名猜测。
- `send --embedded --name "实际姓名" --candidate-id "触达回执ID" --job "完整岗位" --text "正文" [--check] --json`：同一身份核验后发送一次；此入口的 `--check` 严格只读，不输入或发送。已有同文消息返回 already-visible，不重复发送；已有草稿拒绝覆盖。聚焦页面后粘贴，核对换行、发送禁用状态和身份，再按 Enter；发送后要求新消息 ID、己方、接收者、可见正文均匹配。超时不重试。
- 不导航、不刷新、不重新打招呼、不修改页面禁用状态，不支持在此入口请求附件。独立沟通页命令行为不变。
- 返回 conversationId 是内嵌组件原生 uniqueId。尚未核对它与沟通列表 DOM data-id 的映射时，不能直接作为 collect dataId；先保留待关联回执。
- 验证：内嵌真实身份读取已通过；离线覆盖多行粘贴、身份错配、去重、草稿与禁用保护。首次发送在剪贴板焦点阶段失败（未输入/发送），已补焦点步骤；之后用户窗口已关闭，完整真实发送待下一位合适人选验证。


## 搜索同名候选人定位（2026-10-22）

`search --json` 返回每张卡片的 `candidateId`（组件 encryptGeekId）；无关键词时只读当前搜索页列表。先将姓名、院校、年限与同一卡片 ID 对照保存，不使用旧序号。

- `preview "姓名" --candidate-id "ID" [--open-only] --json`：仅常规搜索页，按姓名和 ID 联合唯一定位，打开后核对简历组件 ID；截图回执也返回 candidateId 和 identityVerified。
- `greet "姓名" --candidate-id "ID" [--check] --json`：同一 ID 贯穿首次联系、预检及选岗/确认。继续沟通仍必须携带成功回执 ID。
- 无 ID 时维持姓名必须唯一；ID 缺失、姓名不符、重复 ID 或目标不在当前列表直接报错，不回退按姓名匹配，不刷新寻找。
- 此规则替代前文“同名一律不能操作”的限制：只有获得当前卡片的可靠 ID 后才可处理同名者。推荐与深度搜索不支持该参数。

真实验证：同一搜索列表中两位唐**按不同 candidateId 区分，指定6年/新南威尔士大学者的完整 preview 返回 identityVerified=true；无再次查询。该候选人未达到岗位证据要求，未实际测试此 ID 的联系或发送。
