# Boss URL 与功能对照

## 启动前配套版本检查

每轮先设置实际加载的 Skill 路径，再运行离线检查（不连接浏览器、不写账本）：

```powershell
$env:BOSS_SKILL_DIR = 'C:\Recruitment\workspace\.workbuddy\skills\boss-recruitment'
node .\dist\cli\index.js version-check --json
```

CLI 0.6.11 配套 Skill 1.0.20，兼容标识为 `2026-10-30-resume-analysis-v1`。独立版本号按配套关系比较。未设置 BOSS_SKILL_DIR 时明确使用当前 CLI 安装附带的 Skill；加载外部 Skill 的 Agent 必须指定外部实际目录，不能以包内版本替代检查。文件缺失、格式错误直接报错，不搜索其他路径。

匹配返回 compatible:true，退出码 0；不匹配返回 compatible:false、requiresConfirmation:true、实际与期望版本、路径及 confirmationToken，退出码 2。所有业务命令（含 login、只读 status/check、附件子进程和 collect）在连接浏览器或写账本前阻止启动。help、version、update、version-check 可用于诊断和修复。

不匹配时将结果展示给用户，**等待用户明确确认后**，才可在本轮命令末尾附加 `--confirm-version-mismatch <返回令牌>`；不得自行确认、写入长期默认参数或从旧任务沿用授权。令牌绑定 CLI 版本、Skill 路径和完整正文，任一改变都会失效。确认仅解除版本门槛，不解除会话锁、身份校验或其他守护。CLI 校验令牌，执行 Agent 负责取得并记录用户确认。优先同步配套版本；确认不意味着兼容性已验证。


各入口的完整语法、参数语义、返回判断和顺序，见[逐项调用手册](../skills/boss-recruitment/references/invocation-guide.md)。

本文件记录 boss-cli 已知页面 URL、对应命令和当前位置要求。修改页面导航、命令入口或报错文案前，先对照这里，避免把某个命令改成隐式跳转或多路径兜底。

招聘 Agent 必须遵守[工具使用边界](../skills/boss-recruitment/references/tool-boundary.md)：真实页面只允许公开 CLI；岗位切换脚本的直连许可已撤销。本文的源码位置、CDP 技术说明或开发测试命令不授予直接连接浏览器的权限；非 CLI 线上监测、截图和测试全部拒绝，不提供临时绕过路径。

WorkBuddy 执行顺序、每步指令和 2026-10-13 实测注意事项见 [招聘采集执行手册](workbuddy-recruitment-runbook.md)。

2026-10-14 确认的推荐/搜索主动寻访 SOP、消息3及停止规则见上述执行手册“主动寻访 SOP”章节。搜索筛选为“不限岗位”，沟通与账本仍对应目标 JD 岗位；流程约定不代表命令已经实现，以下表格保留现有能力说明。

## 页面 URL

| URL / Path | 页面功能 | 相关命令 | 当前行为 |
| --- | --- | --- | --- |
| `https://www.zhipin.com/web/user/?ka=header-login` | 登录入口 | `boss login` | 直接打开登录页，交还给人工扫码/验证。 |
| `/web/chat/index` | 沟通列表、候选人会话页 | `boss list [--unread] [--chatting] [--json]`、`boss chat <姓名>`、`boss chat [姓名] --index <序号> [--unread]`、`boss chat <姓名> --data-id <会话ID>`、`boss accept-resume <姓名> --data-id <会话ID>`、`boss download-resume <姓名> --data-id <会话ID> [--output-dir <目录>]`、`boss send [--name <姓名> --data-id <会话ID>]`、`boss action` | `list --chatting` 明确选择顶部「沟通中」，`--json` 输出会话行 `data-id` 和当前沟通职位；姓名、序号及联合键命令统一通过昵称搜索，重名暂停，不滚动查找。`accept-resume` 仅点击当前候选人的附件请求卡片并等待附件到达；`download-resume` 要求附件已经收到，打开预览并经 Boss 下载按钮保存原文件。指定目标的 `send` 在发送前后核对会话并确认新消息出现在页面。传统 `send` / `action` 仍要求当前会话已打开。 |
| `/web/chat/recommend` | 推荐候选人列表 | `boss recommend`、`boss preview <姓名>`、`boss greet <姓名>` | `recommend` 会先检查当前位置，不在该页时直接进入；`preview` / `greet` 要求当前已在该页且列表已加载。 |
| `/web/chat/aiform` | 深度搜索 / Agent 搜索 | `boss deep-search [--core <要求>] [--bonus <加分项>] [--clear-core] [--clear-bonus] [--match]`、`boss preview <姓名>`、`boss greet <姓名>` | `deep-search` 会先检查当前位置，不在该页时直接进入；默认只输出招聘要求表单、核心要求、加分项、今日剩余匹配次数和按钮状态，不输出候选列表；`--core` / `--bonus` 可重复，并按传入列表同步对应分组（多余行会删除，不足会新增），`--clear-core` / `--clear-bonus` 清空对应分组；只有 `--match` 会消耗今日匹配次数并输出列表顶部最新 20 条；`preview` / `greet` 要求当前已在该页且列表已加载。 |
| `/web/chat/search` | 常规搜索 | `boss search [关键词]`、`boss preview <姓名>`、`boss greet <姓名> [--check]` | `search` 会先检查当前位置，不在该页时直接进入；带关键词时填入搜索框并回车搜索；`preview` 要求当前已在该页且列表已加载，不支持 `--job`。 |
| `/web/chat/job/list` | 职位管理列表 | `boss positions`、`boss jd <name>` | 可通过侧栏进入职位管理页后读取。 |

## 约定

沟通选岗菜单展开时标签会替换为搜索输入框；`switch-job` 读取唯一 active 选项确认原岗位，以 `ui-dropmenu-visible` 判断开关。列举结束在侧栏右侧、候选列表左侧的空白边距内随机取一个点，留12个 CSS 像素内边距；命中背景与布局核验后通过浏览器鼠标点击一次，再核验菜单关闭、URL/岗位/当前会话未变。使用实时视口 CSS 坐标，区域不足或被遮挡直接停止，不重选点、不使用失焦兜底。2026-10-29 真实列举与关闭验收成功，命令耗时859ms，后续 status 验证岗位为“全部职位”、会话为空；实际岗位切换尚未验收。

### 有上限的扩池与显式历史返回（2026-10-28）

- `boss search-more --max-scrolls <1-20> --max-candidates <1-500> [--timeout-ms <1000-15000>] [--json]`：只在当前 `/web/chat/search` 执行，要求无在线简历弹层、搜索 iframe 已就绪。两个上限必填；每轮响应及页面核验共用超时，默认 10000ms。复用 `withBossSessionPage` 的会话锁和页面守护，不切岗位／关键词，不调用 search 重查。
- 单一路径滚动搜索 iframe 的 `document.scrollingElement` 到底，监听页面自然发起的下一页 geeks.json 请求；不直接发接口请求、不调用组件加载方法。容器不可滚动或已到底而无法再滚动时明确报错，不改用其他容器。每轮只接受一次、当前关键词＋岗位 ID＋下一页码的成功响应，核对响应 ID/lid 与组件及 DOM；变化、重复请求、接口错误、超时均停止，不返回部分池冒充成功。
- 返回池按 candidateId 去重并核验同 ID 姓名；人数上限包含起始列表，限制返回的唯一候选人数量，平台单次响应可能加载更多卡片。达到任一上限、成功空响应或成功响应没有新增 ID 后正常结束；没有响应是失败，不推断已到底。JSON 含 keyword、jobId、上限、scrolls、initialCount、addedCount、duplicatesSkipped、stopReason、candidates。跨命令去重仍由运行回执维护；命令不预览、不联系、不发送。
- `boss back --previous --expect-url <完整URL> [--json]`：显式返回前一条浏览器历史，仅一步。当前页只允许上述四种已知列表、`/web/frame/c-resume/...` 或 `/web/chat/business/mine`；目标须为 HTTPS `www.zhipin.com` 的已知列表完整 URL（含查询参数）。登录、验证、未知页面、无前项、同 URL、目标不符、弹层仍打开均停止。先检查相邻历史及当前 URL，再调用一次 `goBack`，返回后核对历史索引、条目 ID 和完整 URL。
- 这是失败回执保存后的独立显式动作，不是自动失败回退。任何业务异常都不会自动调用它，不刷新、不 goto／重新设置路由、不重新执行失败命令；返回失败也不再次返回。现有 `back --if-open` 继续处理简历弹层，两种模式互斥。
- 离线测试：`npm run test:search-more-back`，另运行 CLI JSON、搜索关键词、既有返回及不自动恢复回归。模拟 DOM／网络／历史测试通过不代表当前真实 BOSS 页面结构已验收；不得通过临时脚本补救结构差异。


- `collect reconcile` 的完整盘点使用主沟通列表 `.chat-user .user-container > .user-list`，不依赖内嵌聊天的 `.chat-global-list`。读取唯一可见根节点的 `loading$`／`hasMore$`，仅在加载结束、无后续页、`.load-tips` 非加载态可见且滚动到底后完成；已加载组件会话ID必须全部出现在盘点结果中。空态须同时有零数据、无更多页及可见“暂无牛人”。结构缺失、状态异常、漏项或加载超时明确报错，不返回部分列表、不回退旧容器。

- 推荐选岗按“岗位名称＋城市”比较，忽略薪资后缀；如 `recommend '全栈软件开发工程师 _ 深圳' --ensure-job --json`。下拉搜索只输入岗位名称，读取选项后再比较名称和城市；任何模式出现多项匹配均停止。当前岗位键相同不重复点击；`check --page recommend --job`／`recommend --check-job` 使用同一比较口径，返回的岗位标签仍保留页面原文。

- 推荐列表只读取 `.candidate-card-wrap`，不同时把外层列表项作为候选人；新增 `work`、`education` 数组，`experience` 保留两者合并的文字。字段为空不阻止查看简历。推荐 preview/greet 支持 `--candidate-id`：完整姓名精确匹配，无 ID 重名暂停；提供 ID 时要求联合唯一、该 ID 在列表唯一，且卡片 DOM 和组件姓名/ID 一致。preview 打开后再核对两处简历组件 ID；缺失、不符或重复直接报错，不尝试其他卡片。推荐 greet 只在列表执行，`--check` 不点击；简历覆盖列表时为 false。
- 常规搜索带关键词时仅提交一次，等待该 frame 本次关键词、当前岗位 ID、第1页对应的 geeks.json 响应成功，再比较组件及 DOM 列表的候选人 ID 和查询标识 lid。只有成功响应的空数组且页面同步为空才是零结果；响应超时、接口错误、列表不一致分别报错，无固定延迟、旧结果或重新查询回退。无关键词只等待当前列表加载完成后读取；不主动设置搜索岗位。
- `status` 在推荐页输出 `recommendJob`，`searchJob` 为空；常规搜索页使用 `searchJob`。`check --page recommend --job` 比较 `recommendJob`，不是设置岗位。

- 昵称搜索匹配项统一输出 `name`、`uniqueId`、`label`、`info`、`tag`：`info` 直接取组件 `workDesc`（可为公司或院校描述），`tag` 直接取 `exchangeDesc`（交换信息提示），保留原字符串，缺失为null、空字符串仍为空字符串、非字符串时报错。不拆分label推测字段。覆盖chat-search的match/matches、status.chatSearch.matches及失败diagnostics.search[].matches；status无需重搜即可读取当前结果。chat-search及chat --data-id支持可选 --info：仅使用此前已获取并与目标关联的原文，在昵称查询返回后按完整姓名和info精确筛选，不向页面输入公司关键词。筛选后唯一且ID相符才点击；同名同info或群聊歧义仍暂停；零匹配停止，不退回仅姓名。tag仅输出，不支持--tag。当前会话身份一致仍直接复用，不因info再次搜索。


- 2026-10-27 诊断：昵称搜索每次等待默认20000ms，可用环境变量 `BOSS_CHAT_SEARCH_TIMEOUT_MS` 设置1000–60000的整数毫秒（例如30000），不是整条命令总时限，不改变附件命令独立的总时限（下载30秒、非下载15秒）。`ChatLocateError` 表示尚未完成候选人定位核验；`ChatStateError` 表示候选人身份曾核验成功，但定位结束时的页面或身份复核失败。chat/chat-search/send的JSON错误保留 `error.details`：stage、timeoutMs、clickState、locationVerified、verifiedConversation及diagnostics。locationVerified只代表此前身份核验的历史事实，不保证错误发生后的当前身份，也不表示业务动作成功。附件子进程保留错误名称及含诊断的message，受总时限约束可能先退出。
- 失败诊断仅执行一次只读DOM快照，记录关键选择器total/visible数量、当前选中行姓名/ID、详情姓名/岗位、职位标签、搜索输入及组件匹配、主页面路径和视口；不读取聊天正文、不包含URL查询参数。诊断读取失败单独标注diagnosticError，保留原异常，不重试业务。重名规则及身份比较条件未因诊断而放宽；尚不将“10秒超时”解释为根因，不采用跨页面往返恢复或按同公司自动合并会话。

- 2026-10-27：`chat --data-id` 及指定对象的send/accept-resume/download-resume/probe-resume共用入口先只读核验当前会话：选中行唯一、姓名、data-id及详情姓名均须匹配。匹配则直接使用当前会话，不打开搜索、不切换职位；不匹配才直接进入昵称搜索，不主动切换或恢复岗位。现有附件预览清理仍保留，清理后及业务操作前再次核验身份。读取异常、清理失败或后续身份变化直接报错，不catch后转去搜索、不重试。搜索出现重名仍保持现场暂停。只有姓名的chat和显式chat-search不采用此复用判断。

- 2026-10-27（最新约定）：直接在当前页面状态下搜索候选人，不打开岗位下拉、不主动切全部职位、不恢复岗位。唯一结果打开后，以姓名、会话ID及详情姓名一致确认定位成功；BOSS自行重置职位筛选不算失败，筛选不再作为前后置条件。显式提供--job时仍比较实际沟通岗位，它不是筛选设置。删除临时--keep-current-job选项，保持单一默认路径。重名或群聊歧义暂停；身份不符、错误页面仍报错，无回退。覆盖chat-search、chat姓名/ID/序号及共用定位入口；当前身份一致的联合键操作仍直接复用。

- status/check识别推荐及常规搜索iframe时，对pathname统一去掉末尾斜杠后精确比较，兼容 `/web/frame/search/` 与 `/web/frame/recommend/` 的实际URL；查询参数不参与路径比较。缺失或多个匹配仍报错，并附主页面及frame路径，不导航、不刷新。

- 2026-10-26 原 `chat "刘海罗" --data-id "692932186-0" --json` 接入昵称搜索后已真实验证成功，返回正确会话ID及岗位；未发送消息。38项相关隔离回归通过。

- 2026-10-26 `chat-search` 真实验证：按用户指定搜索“刘海罗”，唯一结果打开成功，返回 `status=opened`，搜索uniqueId与会话data-id一致，岗位已读取核验。重名暂停已通过隔离测试，尚无真实重名验收；未发送消息，未关闭浏览器。

- 2026-10-26 新增[沟通页候选人定位流程](../skills/boss-recruitment/references/chat-candidate-location.md)：`boss chat-search "完整昵称" [--info "已知原文"] [--data-id "预期ID"] [--job "预期完整岗位"] --json`，当前位置必须为 `/web/chat/index`，不隐式导航。不操作岗位下拉，点击 `.chat-search-btn`，在“搜索姓名/群聊”输入昵称，读取完整 `.geek-search-list` 及组件searchList（包括隐藏项）；唯一精确匹配才点击一次，核对搜索uniqueId与实际data-id、姓名及岗位。重名或其他歧义返回 `status=needs-confirmation`、`clicked=false` 和匹配项，等待用户手动确认或进一步指令，比较参数不用于自动选择重名。成功为 `status=opened`；已完成零结果返回status=not-found且不点击；未完成查询超时、旧搜索未清空或核验失败直接报错，不自动重试。不支持--check，不发送；`status --json` 新增只读chatSearch输入／结果及chatFilterJob。与 `/web/chat/search` 和顶部分类“全部”不同，现有chat及指定对象发送／附件／探测均接入此搜索，不保留滚动回退；起始快照仍限定本轮对象范围。离线测试：`node --experimental-test-module-mocks --test scripts/test-chat-search.mjs`。

- 沟通页新增 `boss switch-job --list [--json]` 和 `boss switch-job --job "实时完整文案" [--timeout-ms 1..60000] [--json]`。须已在 `/web/chat/index`，两者复用会话锁和页面守卫；--list 展开读取并收起菜单，非只读；--job 精确唯一匹配，相同岗位不点击。草稿、遮挡、禁用、重名及超时直接停止。回执核对标签及菜单关闭，再由 `status --json` 核验 chatFilterJob；不导航、不切分类、不联系，不宣称候选列表已加载完成。`scripts/switch-job.mjs` 直连真实浏览器的旧许可已撤销，禁止作为替代入口。完整边界见 [Skill岗位切换](../skills/boss-recruitment/references/switch-job.md)。

- 正常招聘SOP只从指定岗位未读列表逐人处理，评估一人后完成其发送/收件或等待，再处理下一人；本轮附件收集完成后统一上传。对账、复查、仅收集须人工明确指定。当前 `collect round` 遍历全账本、`chat --data-id` 通过昵称搜索已指定对象、`--check` 未命中只返回false，不能保证严格未读边界；不得将这些技术能力作为正常SOP扩大范围的授权。

- `boss --check-login [--json]` 通过已配置的本机 CDP 端口，只读检查首个 `www.zhipin.com` 页面；不启动浏览器、不导航、不安装页面守卫。登录入口返回 false；可见工作台菜单或账号入口返回 true；验证页或缺乏证据报无法判断错误。连接失败、没有 BOSS 标签页、页面失效直接报错，不能解释为未登录。此命令检查页面信号，不验证服务端会话有效期。

- `boss probe-resume <姓名> --data-id <会话ID> [--download] [--output-dir <目录>] [--json]` 使用 `/web/chat/index`：进入「沟通—全部」，定位后先读附件再读己方已发送的默认求简历话术。未观察到不等于无附件或未发送；`--download` 才下载。`download-resume` 与 `probe-resume --download` 整条命令限时30秒（含定位、预览、下载和核验）；非下载 probe-resume 与 accept-resume 仍为15秒，确认子进程退出后报错。
- `boss collect --job <岗位完整名称> [--ledger-dir <目录>]` 为候选人处理流程的第一个常驻步骤：等待 started、核对岗位与 recoveryRequired、读取 show 后才处理候选人；有恢复要求时等待人工 reconcile 完成。启动 collect 本身不导航页面。round 处理普通记录；人工 recheck 复查 RECHECK；人工 reconcile 遍历「沟通—全部」，按岗位全量逐项对账；stop 写回。见 [岗位账本](collection-ledger.md)。
- 候选人姓名、序号和联合键定位统一使用昵称搜索；原列表扫描、向下／向上滚动及目标居中点击代码已删除，不存在滚动回退。重名时即使有会话ID也通过CandidateSelectionRequired暂停，等待用户确认；指定对象的发送／收件／下载／探测不会继续。全量对账的列表盘点属于独立功能，仍需用户明确要求，不参与候选人定位或充当回退。
- DOM 信息读取本身不刷新页面、不点击或导航；滚轮可能触发 BOSS 的虚拟列表更新或加载更多，点击候选人会更新详情。完整 `list`/定位命令包含页面和分类筛选准备，不能把整条命令称为纯读取。已经在沟通页时 URL 检查不导航；公共层不再把非工作台页面自动导航到沟通首页，风险页只记录错误上下文、不自动返回；执行上下文销毁直接报错，不重跑业务回调。

- 列表准备按「进入沟通页 → 切换所需顶部分类 → 选择全部/未读筛选 → 等待列表」顺序执行。已选中的分类和筛选不重复点击；需要切换筛选时只调用一次 `.click()`。此列表准备只用于列表读取及序号取身份；指定姓名或联合键定位直接使用昵称搜索，不再准备并扫描列表。
- `send` 将整段话术写入剪贴板，全选后粘贴，核对输入内容再发送；任何一步失败直接报错，不回退到逐字符输入。该操作会覆盖系统剪贴板文本。
- `download-resume`、`accept-resume` 和指定姓名及 `data-id` 的 `send --check` 严格只读，分别判断当前目标是否有附件、待同意请求、可发送状态，只返回 true/false。身份不匹配返回 false，不定位或执行动作；读取异常报错。实际业务必须去掉 --check。

- 所有业务命令支持 `--json`：`login/list/chat/action/accept-resume/download-resume/send/positions/jd/recommend/search/deep-search/preview/greet`。默认文本行为保留，`download-resume` 默认已输出 JSON；JSON 字段与用法见 [CLI JSON 输出](cli-json-output.md)。JSON 模式 stdout 仅输出一个结果，日志走 stderr，参数或执行失败输出 JSON 错误并返回非零退出码。
- `chat --data-id --json` 在身份核对后读取人才摘要、当前已加载的消息和附件存在标记；默认文本仍仅输出定位确认。`jd --json` 继续保存和复用 Markdown，返回正文、文件路径与 `cache/page` 来源，不解析 Markdown 或强制刷新。

- 联合键定位前会关闭当前可见的附件预览（`.resume-detail-chat` 内的 `iframe.attachment-iframe` 或 `img` 所属弹层），防止预览遮挡会话列表；原附件下载成功并完成完整性校验后也会收起该预览，支持连续调用。图片预览会等待图片加载完成，再通过同一 Boss 下载按钮保存原文件；图片预览地址不提供 `geekId`，返回值为 `null`，会话仍通过姓名和 `data-id` 核对。
- 当前 URL 校验优先于 DOM 猜测。命令依赖特定页面时，先检查 path，再执行页面读取或点击。
- 不为高风险操作添加隐式兜底跳转。需要用户处于特定页面的命令，应直接报出当前 URL 与目标 URL。
- 页面入口发生变化时，同步更新本文件和相关命令 help 文案。
- `positions` 读取当前分页，不自动遍历所有页。2026-10-14 验证的职位页是 `/web/frame/job_v2/list` iframe：行 `.job-item-container`、标题 `.job-title .job-name`、标签 `.job-title .job-labels`、状态 `.job-status-wrapper .status-box`，信息标签和三项统计仍由各行读取。DOM 未暴露 data-id 时 id 保持空字符串，不伪造。共享 JD 编辑入口为对应行 `.operation-container .operate-btn` 中文字严格等于“编辑”的唯一按钮。
- `positions` 以实际职位行确定所在 frame，不把主页面统计文字视为列表已就绪；16 秒内未识别职位行、或已识别行缺少标题/状态/三项统计时明确报出 URL 和解析上下文，不过滤后返回 `jobs=[]`，不将缺失统计补零。真实页面结构变更必须依据当前 DOM 证据修复，不能猜测选择器。离线回归：`npm run test:positions`。
- 侧栏导航使用实际调用的字符串脚本：点击菜单后必须等待 pathname 等于目标路径，不能只返回函数对象就视为导航完成。
- `boss action resume` 与 `boss preview` 返回原截图路径及 `ocr` 调用描述（`status=not-started`）；Agent 随即后台调用 `boss ocr <PNG绝对路径> [--timeout-ms <1000-120000>] --json`，完成后优先读取重排文字。该命令不要求 BOSS 当前页面、不连接浏览器；上传至显式 `BOSS_OCR_URL`（默认 `http://ylorb.top:9002/ocr`）。单栏/双栏坐标重排、文件与失败契约见[OCR规范](../skills/boss-recruitment/references/resume-ocr.md)。原图保留，滚轮和随机停顿不变，`--open-only` 不触发 OCR。
- 在线简历截图保持当前视口尺寸，打开后随机等待 2000–10000ms，再通过简历区域内的滚轮逐屏截取并拼接；每段滚动采用随机加减速，保留约 35% 重叠，以实际滚动位置裁剪重复部分并检查重叠像素。确认顶部、稳定底部后直接拼接并写入 PNG，不再向上恢复；失败也不自动恢复滚动。支持 iframe 内部滚动和完整高度 iframe 的外层容器滚动；按实际布局唯一识别滚动容器。重叠校验使用区域平均像素差，兼容非整数显示缩放的抗锯齿差异。推荐、常规搜索、深度搜索的 `preview` 与沟通页 `action resume` 共用此实现。截图不再使用 `BOSS_RESUME_SCREENSHOT_VIEWPORT_HEIGHT`，不主动刷新页面。随机滚动不构成平台风控安全保证。
- 完整性检查失败直接报错，不保存为完整简历、不改用拉高视口截图。多个滚动容器、横向溢出、区域超出视口、内容高度变化、滚轮无响应或重叠校验失败均停止。固定/吸顶遮挡在推荐页及常规搜索页按下述规则提示，其他页面仍停止。最多 100 屏、8000 万累计截图像素；动态加载或特殊布局需要先解决原因。本地已验证合成图像与模拟滚动流程，测试脚本不随本次正式代码交付。
- 首次固定/吸顶遮挡检测在打开后的 2000–10000ms 阅读等待结束后执行，避免尚未经过初始等待就将加载层判为截图失败；等待后持续遮挡在推荐页及常规搜索页输出提示，其他页面直接报错；不隐藏元素、不重复尝试。2026-10-22 修正时序，后续两份完整截图实测成功；未重开此前失败的候选人，不声明已确认该遮挡元素的具体用途。
- 相邻完整滚动段之间随机等待 500～3000ms（含截图开始前的顶部定位），与每个滚轮脉冲的 16～32ms 间隔分开；首次滚动前仍随机等待 2000～10000ms。成功截图写入后：沟通页 action resume 随机等待 1000～5050ms，再单次点击左侧随机安全空白退出；推荐／搜索／深度搜索 preview 保持简历打开在底部。两者均等Agent结果再决定下一步；截图失败不自动关闭。离线回归：`npm run test:resume-timing`。
- `BOSS_CLI_TRACE=true/1` 时，简历截图在 stderr 输出 `[boss-cli][resume]` JSON事件：阅读/分段等待、滚动起止、分屏、实际DPR/重叠校验、写入和关闭顺序；不改变业务 stdout。拼接使用实际devicePixelRatio，不能从取整后的PNG宽度反推缩放；确认底部后按实际末屏像素范围输出。关闭后仍可见在线简历时直接报错。2026-10-14补测已验证完整截图及成功后的3562ms延迟关闭；`jd` 详情读取仍因编辑页结构变化失败。具体边界见 [实测记录](live-validation-2026-10-14.md)。
- 历史浏览器验收覆盖内外滚动容器、150% 像素缩放、首轮阅读等待及当时的滚动恢复和无重载检查；2026-10-29 改为不恢复滚动、按入口决定退出，目前只完成离线验证。拼接保证范围为当前展开内容；页面自身折叠的“查看全部”等内容不因滚动而自动展开。
- `data-id` 是 Boss 页面会话行标识；联合键使用候选人显示名称和 `data-id`，两者不一致时停止操作。附件预览地址出现的 `geekId` 单独返回，但尚不作为定位主键。

## 推荐页状态保持与返回（2026-10-15）

- 2026-10-26：按用户确认，在线简历截图时仅主页面为 `https://www.zhipin.com/web/chat/recommend` 或 `https://www.zhipin.com/web/chat/search`（允许末尾斜杠和查询参数）将固定/吸顶元素检测降为提示；stderr 保留主页面路径、元素、定位方式及矩形，同一提示每次截图只输出一次，不污染 JSON stdout。此规则针对检测类别，不声称已识别具体状态栏；不隐藏或删除元素，截图仍包含可见内容。其他页面仍因同类遮挡报错。滚动到底、重叠一致性、尺寸/高度、像素预算等校验保持不变（后续2026-10-29已取消位置恢复）；提示本身不证明正文无遮挡。离线回归：`node --experimental-test-module-mocks --test scripts/test-resume-obstruction.mjs scripts/test-resume-capture-timing.mjs`。

- 2026-10-26：`selectRecommendJob()` 内部默认比较当前岗位，所有调用均生效，包括普通recommend及greet --job，不依赖--ensure-job。完整岗位名忽略空白和大小写后相同，直接返回，不打开下拉、不搜索、不点击；简称搜索后匹配到当前岗位时，仅收起下拉并核验关闭，不点击岗位项。匹配到不同岗位时才选择一次；比较或关闭失败直接报错，不重试。

- `boss recommend "岗位名称 _ 城市" --ensure-job [--json]`：先读取当前岗位，去除薪资后缀并忽略空白和大小写后比较；同键不打开下拉、不搜索、不点击，不同才搜索岗位名称并按名称＋城市唯一选择。该开关需要岗位名称，不接受赋值。未带开关保留关键词匹配，但多匹配也暂停。
- `boss back --if-open [--json]`（交互别名 `/back`）：当前已知列表上存在在线简历弹层时关闭并核验；列表无弹层时返回 `action=noop`，不执行历史回退。独立 `/web/frame/c-resume/...` 页面仅在前一条历史属于同域的推荐、搜索、深度搜索或沟通列表时回退一步，并核验最终 URL。无历史、未知历史目标、未知当前页面或关闭失败直接报错，不以历史回退兜底。无检查开关且未打开简历时报错。
- 公共层不自动调用 back。出现异常后先检查当前状态，再显式执行返回命令；不得盲目重试刚才的选岗、预览或发送动作。
- `greet` 不再临时拉高视口或恢复视口尺寸；读取当前已挂载卡片，找不到目标直接报错。已可见页面不再重复 bringToFront。
- 简历截图采用当前可见视口截图，`fullPage=false`、`captureBeyondViewport=false`，不传浏览器 clip；按实际 DPR 在本地裁剪所需区域、拼接，裁剪边界或视口变化直接报错。外层滚动时复用首屏，避免重复截图。保留原有阅读等待、分段等待和完整性校验；关闭等待仅用于收集截图。此改动减少浏览器裁剪渲染干扰，不宣称未经现场验证的闪烁已完全消失。
- 离线回归：`node --experimental-test-module-mocks --test scripts/test-recommend-navigation.mjs scripts/test-session-no-recovery.mjs`，以及 `npm run test:json`、`npm run test:resume-timing`。

## 搜索页立即沟通（2026-10-20，本地实现）

- `boss greet "完整显示姓名" --check --json`：只读判断当前搜索页在线简历身份与可用联系按钮，返回 true/false；未打开简历为 false，不打开或切换候选人。
- `boss greet "完整显示姓名" --json`：搜索页要求已加载卡片中姓名严格唯一；搜索卡片组件的姓名须与显示姓名一致，并提供非空 `encryptGeekId`；若简历已打开，主页面唯一 `.resume-middle-wrap` 须包含该简历 iframe，右侧唯一 `.resume-simple-box` 的 `geekInfo.encryptGeekId` 和 `resumeInfo.encryptGeekId` 必须同时与卡片 ID 一致。按钮仅在该右侧操作区内定位。Canvas 简历不以 iframe 内姓名 DOM 核验身份，不调用组件方法或接口。仅点击唯一、可见、可用且未被遮挡的「立即沟通」「打招呼」或带数字后缀的「搜索畅聊卡」，前两种支持带额度数字的按钮文字。2026-10-28 已在同一候选人的右侧操作区核验实际文案「搜索畅聊卡(2/25)」；只识别此类完整文案，不推断数字含义，不自动购买或确认弹层。只读状态与实际联系采用相同文案范围，身份、唯一性、遮挡、单次点击和成功核验保持不变。搜索页拒绝 `--job`，普通 greet 不代选联系岗位；选岗使用下述 --select-job 独立步骤。不处理购买或二次确认。
- 返回 `ready` 表示预检可点击；`already-contacted` 表示按钮已为「继续沟通」，不再点击；只有点击后同一身份的按钮变为「继续沟通」才返回 `contact-confirmed`。该状态不证明消息3已发送或账本已写入。
- 点击后按钮消失、页面跳转、出现确认弹层或超时等无法确认结果时，明确报出“已点击一次，禁止自动重试”；应先人工核对，不连续执行 greet。平台可能自动发送默认问候并消耗权益，预检不会消耗这些点击权益。
- 姓名不唯一、候选人 ID 缺失或不符、按钮结构与现有依据不符、按钮在视口外等情况直接停止。选择器与组件字段依据为 2026-10-20 真实搜索页面只读检查；n** 的真实预检已返回 `identityVerified=true`、`status=ready`、`clicked=false`，随后按用户授权点击一次，出现联系岗位选择弹层；未选岗或二次确认，尚未完成沟通。组件字段变化直接报错，不退回按姓名或全局按钮猜测。
- 离线回归：`node --experimental-test-module-mocks --test scripts/test-search-greet.mjs`。测试独立浏览器，网络请求全部由模拟内容响应，不连接真实会话。

### 只打开搜索在线简历

`boss preview "完整显示姓名" --open-only --json` 仅支持当前常规搜索页。先唯一精确匹配卡片；已有可见简历时不再点卡片，等待 Canvas 就绪并按候选人 ID 核验当前简历；没有简历时只点击匹配卡片的 `.name-label`，等待可见 iframe 和 Canvas 加载后按同一 ID 规则核验。ID 不符、姓名重复或超时直接报错，不自动关闭重开。

返回 `status=open`、`reused`、`candidateId`、`identityVerified=true`、`controls`（该简历右侧可见控件文字，仅供观察，可为空，不证明允许联系）、`screenshot=false`、`closed=false`。不截图、不滚动简历、不点击沟通按钮，不执行截图成功后的自动关闭。加载就绪与身份核验分开执行，等待条件不能吞掉身份错误。预览独立核验卡片姓名／ID、主页面唯一简历面板及关联 iframe、右侧组件的两处 ID，不再要求沟通按钮存在或可用；畅聊卡等按钮差异不阻止读取简历，也不会自动放宽 greet 的联系校验。后续使用 `greet --check` 预检，确认后再执行真实沟通。不带 `--open-only` 的 preview 仍是原截图流程。离线身份回归：`node --experimental-test-module-mocks --test scripts/test-search-preview-identity.mjs`。

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

`boss chat "姓名" --check [--data-id ID] --json` 只读比较当前沟通页选中行与详情身份，返回 true/false；摘要和消息使用 `status --json`。不接受 index 定位。

已联系后打开会话：`boss greet "姓名" --continue-chat --candidate-id "成功回执中的候选人ID" --json`。要求当前简历仍打开，核对该 ID 的两处组件数据；不依赖联系后可能移除候选人的搜索列表。可加 `--check` 只读核对。`continue-clicked` 只确认点击，不证明已打开独立沟通页。

搜索页内嵌聊天使用显式 `--embedded` 入口核验身份及发送；普通 chat/send 使用独立沟通页。继续沟通点击回执不能证明会话或消息成功。


## 搜索页内嵌聊天（2026-10-22）

- `status --json` 额外只读返回 `contactGeometry`（按钮矩形、视口、中心点命中元素及父元素）、`embeddedControls`（当前内嵌窗口可见控件的有限属性）和 `contactNotices`（最多5个可见 `.dialog-wrap.active` 的有限文本及“关闭／查看对话”控件属性）。用于记录畅聊卡后遮挡和人工操作前后状态；不点击、不隐藏遮挡、不构成连续鼠标录制，也不放宽联系校验。

- `chat --inspect-embedded --json` 只读输出当前窗口的最小身份及已加载消息，不代表身份核验通过；无窗口或多窗口报错。
- `chat "实际姓名" --embedded --check --candidate-id "触达回执ID" --job "完整岗位" --json`：仅 `/web/chat/search`，核对卡片 conversation.encryptUid/name/toPosition、容器 friendId 和输入组件 uniqueId；不依赖脱敏姓名猜测。
- `chat "实际姓名" --embedded --close --candidate-id "触达回执ID" --job "完整岗位" --json`：在现有会话锁和页面守护内，核验同一身份及会话，保护未发送草稿，仅点击该窗口唯一可见、启用且未遮挡的 `.iboss.iboss-close` 一次；5 秒内确认窗口消失且 URL 不变。无窗口、多窗口、超时或身份变化直接报错，不刷新、不导航、不重试。`--close` 与 `--check` 互斥，后者只做身份检查，不代表关闭可执行。
- `send --embedded --name "实际姓名" --candidate-id "触达回执ID" --job "完整岗位" --text "正文" [--check] --json`：同一身份核验后发送一次；此入口的 `--check` 严格只读，不输入或发送。已有同文消息返回 already-visible，不重复发送；已有草稿拒绝覆盖。聚焦页面后粘贴，核对换行、发送禁用状态和身份，再按 Enter；发送后要求新消息 ID、己方、接收者、可见正文均匹配。超时不重试。
- 不导航、不刷新、不重新打招呼、不修改页面禁用状态，不支持在此入口请求附件。独立沟通页命令行为不变。
- 返回 conversationId 是内嵌组件原生 uniqueId。尚未核对它与沟通列表 DOM data-id 的映射时，不能直接作为 collect dataId；先保留待关联回执。
- 验证：2026-10-28 内嵌真实发送及新消息核验通过；关闭入口离线验证通过，并在真实同人窗口完成单次关闭验证。
- 畅聊卡现场记录（2026-10-28）：用户确认步骤为“关闭畅聊卡使用提示 → 继续沟通 → 小窗聊天 → 关闭小窗”。CLI 已记录联系成功、继续沟通因遮挡而未点击，以及人工打开后的同一候选人会话；随后通过正式 status 在新候选人现场采集到已知成功文案及 `.boss-dialog__footer .boss-dialog__button` 的“关闭”控件。正式入口 `dismiss-contact-notice <姓名> --candidate-id <已联系ID> --job <完整岗位> --json` 仅在当前 `/web/chat/search`、同人简历、岗位及已联系状态一致时，点击已知成功提示的关闭一次；复用会话锁／页面守护，5 秒核验提示消失及搜索条件未变。失败不重复联系，不将未知付费／确认弹窗当作此提示；不点“查看对话”，不自动继续。离线测试通过，2026-10-28 已在真实成功提示上关闭一次并核验，随后继续沟通、发送消息3及关闭内嵌小窗均成功。


## 搜索同名候选人定位（2026-10-22）

`search --json` 返回每张卡片的 `candidateId`（组件 encryptGeekId）；无关键词时只读当前搜索页列表。先将姓名、院校、年限与同一卡片 ID 对照保存，不使用旧序号。

- `preview "姓名" --candidate-id "ID" [--open-only] --json`：仅常规搜索页，按姓名和 ID 联合唯一定位，打开后核对简历组件 ID；截图回执也返回 candidateId 和 identityVerified。
- `greet "姓名" --candidate-id "ID" [--check] --json`：同一 ID 贯穿首次联系、预检及选岗/确认。继续沟通仍必须携带成功回执 ID。
- 无 ID 时维持姓名必须唯一；ID 缺失、姓名不符、重复 ID 或目标不在当前列表直接报错，不回退按姓名匹配，不刷新寻找。
- 此规则替代前文“同名一律不能操作”的限制：只有获得当前卡片的可靠 ID 后才可处理同名者。推荐与深度搜索不支持该参数。

真实验证：同一搜索列表中两位唐**按不同 candidateId 区分，指定6年/新南威尔士大学者的完整 preview 返回 identityVerified=true；无再次查询。该候选人未达到岗位证据要求，未实际测试此 ID 的联系或发送。

## 2026-10-23 check语义统一

以 [只读check/status规范](../skills/boss-recruitment/references/check-status.md) 为当前定义。所有业务 --check 和旧检查别名只返回true/false；异常报错。status输出info。实际业务调用去掉--check；原条件选岗/返回分别为--ensure-job、--if-open。独立检查连接不会安装页面守卫、启动浏览器或导航。此次只本地验证，无真实页面验收。

- 2026-10-26：沟通姓名、序号与联合键定位已替换为昵称搜索，原分段滚动定位实现及对应测试已删除。check/status继续严格只读；在线简历截图及明确全量对账的滚动不属于候选人查找回退。

- 2026-10-27：沟通昵称搜索区分初始布尔false与完成数字0，完成零结果返回not-found，业务定位抛CandidateNotFound停止；不将加载中或搜索框消失视为零结果。人才搜索关键词waitForFunction修正为执行字符串IIFE并比较实际输入；此修复只证明输入条件，不证明结果列表已随关键词更新，SOP仍要求核对新结果。账本命名由Agent保留完整职称与城市、去掉薪资后传入collect；已有账本不自动迁移。
