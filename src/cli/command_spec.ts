// 命令注册表：boss-cli 全部公开命令的机器可读用法真源。
// --help、boss commands --json、以及 Skill 文档均由本表生成/校验，禁止手抄。
// 每条命令：名称、用法模板、参数说明、前置条件、副作用、适用页面。
export type CommandParam = { flag: string; desc: string };
export type CommandSpec = {
  name: string;
  usage: string;
  params: CommandParam[];
  requires: string;
  sideEffects: string;
  pages: string;
};

export const COMMAND_SPECS: CommandSpec[] = [
  // ── 登录与会话 ──
  {
    name: 'login',
    usage: 'login [--json]',
    params: [{ flag: '--json', desc: '返回 {url,status:awaiting-manual-login}；不代表登录成功' }],
    requires: '无（会启动或复用 Chrome）',
    sideEffects: '打开登录页；命令同步结束，不等待/不轮询登录结果',
    pages: '登录页 /web/user',
  },
  {
    name: '--check-login',
    usage: '--check-login [--json]',
    params: [{ flag: '--json', desc: '返回 true/false' }],
    requires: '已有可连接 Chrome 且存在 BOSS 标签页',
    sideEffects: '无（只读）；无法判定时报错',
    pages: '任意 BOSS 页',
  },
  // ── 只读检查 ──
  {
    name: 'status',
    usage: 'status [--json]',
    params: [{ flag: '--json', desc: '结构化返回当前页面信息' }],
    requires: '唯一 BOSS 标签页',
    sideEffects: '无（只读）',
    pages: '任意 BOSS 页',
  },
  {
    name: 'check',
    usage: 'check --page <page> [--overlay <ov>] [--state <state>] [--name <姓名>] [--data-id <ID>] [--candidate-id <ID>] [--job <岗位>] [--keyword <kw>] [--text <正文>] [--embedded]',
    params: [
      { flag: '--page', desc: 'chat|search|recommend|deep-search|online-resume|positions|login|other' },
      { flag: '--overlay', desc: 'online-resume|none 等弹层判定' },
      { flag: '--state', desc: 'conversation|message-visible 等状态' },
      { flag: '--data-id/--candidate-id', desc: '须配姓名；会话ID与卡片ID不可互换' },
    ],
    requires: '对应页面/会话已打开',
    sideEffects: '无（只读）；所有条件须同时成立，返回 true/false',
    pages: '按 --page',
  },
  {
    name: 'search-sidebar',
    usage: 'search-sidebar [--json]',
    params: [{ flag: '--json', desc: '结构化返回侧栏文字与元素' }],
    requires: '当前常规搜索页',
    sideEffects: '无（只读）；不点击订阅、不应用条件',
    pages: '搜索页 /web/chat/search',
  },
  // ── 列表与定位 ──
  {
    name: 'list',
    usage: 'list [--unread] [--chatting] [--json]',
    params: [
      { flag: '--unread', desc: '只读未读列表' },
      { flag: '--chatting', desc: '选择顶部「沟通中」' },
    ],
    requires: '沟通页',
    sideEffects: '无（只读当前已加载行）',
    pages: '沟通页 /web/chat/index',
  },
  {
    name: 'chat',
    usage: 'chat <姓名> [--strict] [--info <原文>] [--data-id <会话ID>] [--index <序号> --unread] | chat --recommend --open --candidate-id <ID> --recommend-job <岗位> --job <岗位原文> | chat --embedded (--check|--close) --candidate-id <ID> --job <岗位> | chat --inspect-embedded',
    params: [
      { flag: '--strict', desc: '兼容保留，姓名始终精确匹配' },
      { flag: '--info', desc: '已知 workDesc 原文，精确筛选同名者' },
      { flag: '--data-id', desc: '会话ID；先核验当前身份一致则直接用' },
      { flag: '--index', desc: '从当前列表 1-based 序号定位，须配 --unread 用于未读' },
      { flag: '--recommend --open', desc: '推荐页打开已联系同人小窗，不打招呼' },
      { flag: '--embedded (--check|--close)', desc: '内嵌小窗只读核验/关闭' },
    ],
    requires: '沟通页（搜索定位）或推荐/搜索页（内嵌）',
    sideEffects: '打开会话/小窗；重名保持现场暂停；不主动切换或恢复岗位',
    pages: '沟通页 / 推荐页 / 搜索页',
  },
  {
    name: 'chat-search',
    usage: 'chat-search <完整昵称> [--info <原文>] [--data-id <预期ID>] [--job <预期岗位>] [--json] | chat-search --clear --expect-keyword <昵称>',
    params: [
      { flag: '--info', desc: '按完整姓名+info 原文精确筛选' },
      { flag: '--data-id', desc: '预期会话ID核验' },
      { flag: '--job', desc: '比较实际沟通岗位' },
      { flag: '--clear', desc: '核对旧搜索词后点击清空一次' },
    ],
    requires: '已在沟通页',
    sideEffects: '输入昵称搜索；唯一匹配才打开；重名返回 needs-confirmation',
    pages: '沟通页 /web/chat/index',
  },
  {
    name: 'switch-job',
    usage: 'switch-job --list [--json] | switch-job --job <实时完整岗位文案> [--timeout-ms <1-60000>] [--json]',
    params: [
      { flag: '--list', desc: '展开下拉读取完整文案与 unavailable，再收起（非只读）' },
      { flag: '--job', desc: '精确唯一选岗；简称/多城市/重名不自动挑' },
    ],
    requires: '沟通页',
    sideEffects: '点击菜单/选岗；相同岗位不点击；禁用岗位拒绝',
    pages: '沟通页 /web/chat/index',
  },
  // ── 搜索与推荐 ──
  {
    name: 'search',
    usage: 'search [关键词] [--city 城市 --job 岗位] | search --city <城市> | search --job <岗位> | search --keyword <关键词> | search --submit',
    params: [
      { flag: '--city', desc: '独立设置城市筛选' },
      { flag: '--job', desc: '独立设置岗位筛选；会清空 keyword，顺序不能颠倒' },
      { flag: '--keyword', desc: '独立设置关键词（≤20 字符）' },
      { flag: '--submit', desc: '仅点击一次搜索提交，不与设置混用' },
    ],
    requires: '常规搜索页；三项独立设置完成后再 submit',
    sideEffects: '设置筛选/提交搜索；失败保存回执并停止',
    pages: '搜索页 /web/chat/search',
  },
  {
    name: 'search-more',
    usage: 'search-more --max-scrolls <1-20> --max-candidates <1-500> [--timeout-ms <1000-15000>] [--json]',
    params: [
      { flag: '--max-scrolls', desc: '最大滚动轮数' },
      { flag: '--max-candidates', desc: '返回池上限（含起始列表）' },
    ],
    requires: '当前常规搜索页，关键词/岗位不变',
    sideEffects: '向下滚动加载；按 candidateId 去重；不联系',
    pages: '搜索页',
  },
  {
    name: 'deep-search',
    usage: 'deep-search [岗位关键字] [--job <岗位>] [--core <要求>] [--bonus <加分>] [--clear-core] [--clear-bonus] [--match]',
    params: [
      { flag: '--core/--bonus', desc: '可重复；同步对应分组' },
      { flag: '--match', desc: '点击立即匹配，消耗今日匹配次数，输出最新 20 条' },
    ],
    requires: '深度搜索页',
    sideEffects: '仅 --match 才点击匹配并消耗次数',
    pages: '深度搜索页 /web/chat/aiform',
  },
  {
    name: 'recommend',
    usage: 'recommend [岗位完整名称] [--ensure-job | --check-job]',
    params: [
      { flag: '--ensure-job', desc: '优先精确匹配岗位名+城市；零匹配再用关键词' },
      { flag: '--check-job', desc: '只比较当前岗位（只读）' },
    ],
    requires: '推荐页',
    sideEffects: '进入推荐页读取列表；--ensure-job 会选岗',
    pages: '推荐页 /web/chat/recommend',
  },
  // ── 候选人动作 ──
  {
    name: 'preview',
    usage: 'preview <姓名> [--candidate-id <ID>] [--open-only] [--reopen-on-frame-error] [--json]',
    params: [
      { flag: '--candidate-id', desc: '卡片候选人ID（geekId）；锁模式下必填' },
      { flag: '--open-only', desc: '仅打开并核验ID，保持展开，不截图' },
      { flag: '--reopen-on-frame-error', desc: '仅搜索页；Frame失败时关闭同人预览重开一次' },
    ],
    requires: '推荐/深度搜索/常规搜索页且列表已加载',
    sideEffects: '打开在线简历并截图到底；不自动跳转；每日查看次数有限',
    pages: '推荐/深度搜索/常规搜索页',
  },
  {
    name: 'greet',
    usage: 'greet <姓名> [--candidate-id <ID>] [--job <岗位关键字>] [--select-job <联系岗位完整名称>] [--contact-mode <开聊模式>] [--confirm-contact | --continue-chat --candidate-id <ID>] [--check]',
    params: [
      { flag: '--candidate-id', desc: '卡片ID；锁模式联系动作必填' },
      { flag: '--select-job', desc: '仅选择联系岗位' },
      { flag: '--confirm-contact', desc: '确认已选岗位' },
      { flag: '--continue-chat', desc: '配合成功回执ID打开已联系会话' },
      { flag: '--contact-mode', desc: '仅搜索页：开聊模式选项' },
      { flag: '--check', desc: '只读核对身份及按钮' },
    ],
    requires: '推荐/深度搜索/常规搜索页；greet 前须 decide fit（锁模式）',
    sideEffects: '点击打招呼/立即沟通；消耗打招呼次数，成本高',
    pages: '推荐/深度搜索/常规搜索页',
  },
  {
    name: 'send',
    usage: 'send [--text <内容> | -t <内容>] [--name <姓名> --data-id <会话ID>] [--request-resume] [--check] | send --embedded --name <姓名> --candidate-id <ID> --job <岗位> --text <正文> [--check]',
    params: [
      { flag: '--text/-t', desc: '消息正文' },
      { flag: '--request-resume', desc: '发送后延迟自动执行「求简历」' },
      { flag: '--embedded', desc: '内嵌小窗发送' },
      { flag: '--check', desc: '只读，不输入不发送' },
    ],
    requires: '正确会话/小窗已打开且身份核验',
    sideEffects: '发送文本消息；--request-resume 追加求简历',
    pages: '沟通页 / 内嵌小窗',
  },
  {
    name: 'action',
    usage: 'action <操作> [--remark <备注>]',
    params: [
      { flag: '操作', desc: 'resume|not-fit|remark|agree-resume|request-attachment-resume|history|wechat' },
      { flag: '--remark', desc: '操作为 remark 时必填' },
    ],
    requires: '当前聊天页已打开候选人详情',
    sideEffects: '执行对应操作；request-attachment-resume 发送默认话术',
    pages: '沟通页',
  },
  {
    name: 'back',
    usage: 'back [--if-open] | back --check-in_online_resume | back --previous --expect-url <URL>',
    params: [
      { flag: '--if-open', desc: '关闭在线简历弹层' },
      { flag: '--check-in_online_resume', desc: '只判断是否打开简历（只读）' },
      { flag: '--previous', desc: '返回上一条历史一步，须配 --expect-url' },
    ],
    requires: '在线简历页/列表页',
    sideEffects: '关闭弹层或回退一步；不刷新、不重跑失败动作',
    pages: '在线简历页/列表页',
  },
  {
    name: 'favorite',
    usage: 'favorite --candidate-id <当前简历ID> [--check] [--json]',
    params: [{ flag: '--check', desc: '只读收藏状态' }],
    requires: '搜索/推荐页已打开简历',
    sideEffects: '仅未收藏时点击一次；不取消收藏',
    pages: '搜索/推荐页',
  },
  {
    name: 'dismiss-contact-notice',
    usage: 'dismiss-contact-notice <姓名> --candidate-id <已联系ID> --job <完整岗位>',
    params: [
      { flag: '--candidate-id', desc: '已联系候选人卡片ID' },
      { flag: '--job', desc: '完整岗位' },
    ],
    requires: '已知畅聊卡使用成功提示存在',
    sideEffects: '点一次关闭提示；不点查看对话',
    pages: '搜索页',
  },
  // ── 附件 ──
  {
    name: 'probe-resume',
    usage: 'probe-resume <姓名> --data-id <会话ID> [--download] [--output-dir <目录>] [--json]',
    params: [
      { flag: '--download', desc: '同时下载已收到附件（总时限30s）' },
      { flag: '--output-dir', desc: '下载输出目录' },
    ],
    requires: '指定会话；不主动切岗',
    sideEffects: '检查附件与已发送请求；--download 才下载；15s/30s 超时',
    pages: '沟通页',
  },
  {
    name: 'accept-resume',
    usage: 'accept-resume <姓名> --data-id <会话ID> [--check]',
    params: [{ flag: '--check', desc: '只读比较身份与附件状态' }],
    requires: '指定会话有附件请求',
    sideEffects: '同意附件简历请求，不发送文字',
    pages: '沟通页',
  },
  {
    name: 'download-resume',
    usage: 'download-resume <姓名> --data-id <会话ID> [--output-dir <目录>] [--check]',
    params: [{ flag: '--output-dir', desc: '输出目录' }, { flag: '--check', desc: '只读' }],
    requires: '指定会话已收到附件',
    sideEffects: '下载原附件，返回路径/大小/SHA-256',
    pages: '沟通页',
  },
  // ── 收集与账本 ──
  {
    name: 'collect',
    usage: 'collect --job <岗位完整名称> [--ledger-dir <目录>] [--mode <screen|collect-only>]',
    params: [
      { flag: '--job', desc: '账本岗位键（完整岗位名+城市，去薪资）' },
      { flag: '--ledger-dir', desc: '账本目录，跨轮固定' },
      { flag: '--mode', desc: 'screen（默认，决策须评估证据）；collect-only（仅收集）' },
    ],
    requires: '无（常驻会话，stdin 每行一个 JSON 命令）',
    sideEffects: '打开岗位账本；stdin op：show/add/decision/mode/round/recheck/reconcile/receipt/stop',
    pages: '无（会话进程，不操作页面）',
  },
  {
    name: 'collect-sync',
    usage: 'collect-sync --data-id <会话ID> --json',
    params: [{ flag: '--data-id', desc: '已下载会话ID' }],
    requires: 'collect 已停止；正式收集任务绑定',
    sideEffects: '核验下载回执字节/SHA-256 后写入固定岗位账本',
    pages: '无（离线）',
  },
  // ── 流程护栏 ──
  {
    name: 'decide',
    usage: 'decide --candidate-id <ID> --verdict <fit|not-fit|unknown> [--json]',
    params: [{ flag: '--verdict', desc: 'fit|not-fit|unknown' }],
    requires: '锁模式（BOSS_FLOW_STATE）且候选人已打开',
    sideEffects: '记录评估结论；greet 前须 fit',
    pages: '无（离线）',
  },
  {
    name: 'flow-status',
    usage: 'flow-status [--json]',
    params: [],
    requires: '锁模式',
    sideEffects: '无（只读接续状态与停滞）',
    pages: '无',
  },
  {
    name: 'flow-pause',
    usage: 'flow-pause --reason <原因> [--json]',
    params: [{ flag: '--reason', desc: '暂停原因' }],
    requires: '锁模式',
    sideEffects: '全局暂停，拒绝一切候选人动作',
    pages: '无',
  },
  {
    name: 'flow-resume',
    usage: 'flow-resume [--json]',
    params: [],
    requires: '锁模式；未决动作须先核验',
    sideEffects: '解除暂停',
    pages: '无',
  },
  {
    name: 'phase-set',
    usage: 'phase-set --phase <阶段名> [--json]',
    params: [{ flag: '--phase', desc: '任务配置 phases 中声明的阶段名' }],
    requires: '正式任务绑定；当前阶段有成功回执',
    sideEffects: '按声明顺序相邻推进；禁止跳步/倒退',
    pages: '无',
  },
  {
    name: 'phase-status',
    usage: 'phase-status [--json]',
    params: [],
    requires: '正式任务绑定',
    sideEffects: '无（只读允许动作/阻断原因/下一步）',
    pages: '无',
  },
  {
    name: 'spec-list',
    usage: 'spec-list [--json]',
    params: [],
    requires: '无',
    sideEffects: '无（枚举 ~/.boss-cli/jobs/ 岗位规范）',
    pages: '无',
  },
  {
    name: 'task-check',
    usage: 'task-check [--json]',
    params: [],
    requires: 'BOSS_TASK_CONFIG 指向任务配置',
    sideEffects: '无（离线校验）',
    pages: '无',
  },
  {
    name: 'task-init',
    usage: 'task-init [--json] [--keep-observed]',
    params: [{ flag: '--keep-observed', desc: '续用上一轮同岗位已观察的简历与本地材料' }],
    requires: 'BOSS_TASK_CONFIG；版本匹配',
    sideEffects: '生成 runId，写入运行绑定',
    pages: '无',
  },
  // ── 其它 ──
  {
    name: 'ocr',
    usage: 'ocr <PNG绝对路径> [--layout <auto|boss-online-resume>] [--timeout-ms <1000-120000>] [--json]',
    params: [
      { flag: '--layout', desc: 'auto|boss-online-resume' },
      { flag: '--timeout-ms', desc: 'OCR 请求总时限' },
    ],
    requires: '无（不连浏览器）',
    sideEffects: '上传截图做 OCR；失败不重试',
    pages: '无',
  },
  {
    name: 'positions',
    usage: 'positions',
    params: [],
    requires: '职位管理页',
    sideEffects: '读取职位列表；会导航到 /web/chat/job/list（离开搜索页）',
    pages: '职位管理页',
  },
  {
    name: 'jd',
    usage: 'jd <name>',
    params: [],
    requires: '职位管理页',
    sideEffects: '抓取职位详情缓存为 .md',
    pages: '职位管理页',
  },
];

/** 按名称查单条命令；未注册返回 null。 */
export function findCommandSpec(name: string): CommandSpec | null {
  return COMMAND_SPECS.find((c) => c.name === name) ?? null;
}
