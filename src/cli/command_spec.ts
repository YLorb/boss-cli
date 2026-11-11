// 命令注册表：boss-cli 全部公开命令的机器可读用法真源。
// --help、boss commands --json、以及 Skill 文档均由本表生成/校验，禁止手抄。
// 每条命令：名称、用法模板、参数说明、前置条件、副作用、适用页面。
export const PREFLIGHT_ARGV = ['preflight', '--json'] as const;
export const TASK_INIT_ARGV = ['task-init', '--json'] as const;

export type CommandParam = { flag: string; desc: string };
export type ValueSpec = {
  label: string;
  choices?: readonly string[];
  integer?: readonly [number, number];
  allowEmpty?: boolean;
  absolutePath?: boolean;
  maxLength?: number;
};
export type CommandOption = {
  name: string;
  value?: ValueSpec;
  repeatable?: boolean;
  conflictsWith?: string;
  requires?: string;
};
export type CommandForm = {
  id: string;
  positional?: ValueSpec;
  optionalCommandName?: boolean;
  required: readonly CommandOption[];
  optional: readonly CommandOption[];
  minOptions?: number;
  pages?: string;
};
export type CommandSpec = {
  name: string;
  usage?: string;
  params: CommandParam[];
  requires: string;
  sideEffects: string;
  pages: string;
  stdin?: CommandParam[];
  formalForms?: CommandForm[];
  startupForm?: CommandForm;
};

const flag = (name: string, conflictsWith?: string): CommandOption => ({ name, conflictsWith });
const value = (name: string, label: string, rules: Omit<ValueSpec, 'label'> = {}): CommandOption =>
  ({ name, value: { label, ...rules } });
const form = (
  id: string,
  required: CommandOption[] = [],
  optional: CommandOption[] = [],
  positional?: string | ValueSpec,
  pages?: string,
): CommandForm => ({
  id, required, optional, pages,
  positional: typeof positional === 'string' ? { label: positional } : positional,
});

const name = value('--name', '姓名');
const dataId = value('--data-id', '会话ID');
const candidateId = value('--candidate-id', '候选人ID');
const job = value('--job', '完整岗位');
const text = value('--text', '正文');
const info = value('--info', '已知原文');
const outputDir = value('--output-dir', '输出目录');
const check = flag('--check');
const json = flag('--json');
const timeout = (min: number, max: number) =>
  value('--timeout-ms', '毫秒', { integer: [min, max] });
const attachmentTarget = [dataId];
const embeddedTarget = [flag('--embedded'), candidateId, job];
const deepSearchOptions = [
  value('--job', '岗位关键字'),
  { ...value('--core', '核心要求'), repeatable: true, conflictsWith: '--clear-core' },
  { ...value('--bonus', '加分项'), repeatable: true, conflictsWith: '--clear-bonus' },
  flag('--clear-core'), flag('--clear-bonus'), flag('--match'),
];

export const COMMAND_SPECS: CommandSpec[] = [
  // ── 登录与会话 ──
  {
    name: 'browser-session',
    startupForm: form('start-browser-session', [json]),
    params: [],
    requires: '配套的 CLI 与 Skill；固定 Chrome 专用配置目录与调试端口',
    sideEffects: '启动或核验复用 Chrome；断开 CDP 后常驻并逐行报告 ready/alive/stopped',
    pages: '不导航；首次登录另用 login',
  },
  {
    name: 'login',
    formalForms: [form('open-login')],
    usage: 'login [--json]',
    params: [{ flag: '--json', desc: '返回 {url,status:awaiting-manual-login}；不代表登录成功' }],
    requires: '已由常驻宿主运行 browser-session --json 并返回 ready，Chrome 窗口可见',
    sideEffects: '打开登录页；命令同步结束，不等待/不轮询登录结果',
    pages: '登录页 /web/user',
  },
  {
    name: '--check-login',
    formalForms: [form('check-login')],
    usage: '--check-login [--json]',
    params: [{ flag: '--json', desc: '返回 true/false' }],
    requires: '已有可连接 Chrome 且存在 BOSS 标签页',
    sideEffects: '无（只读）；无法判定时报错',
    pages: '任意 BOSS 页',
  },
  // ── 只读检查 ──
  {
    name: 'status',
    formalForms: [form('read-status')],
    usage: 'status [--json]',
    params: [{ flag: '--json', desc: '结构化返回当前页面信息' }],
    requires: '唯一 BOSS 标签页',
    sideEffects: '无（只读）',
    pages: '任意 BOSS 页',
  },
  {
    name: 'check',
    formalForms: [{
      ...form('compare', [], [
        value('--page', '页面类型', { choices: ['chat', 'search', 'recommend', 'deep-search', 'online-resume', 'positions', 'login', 'other'] }),
        value('--overlay', '弹层', { choices: ['online-resume', 'none'] }),
        value('--state', '状态'), name,
        { ...dataId, requires: '--name', conflictsWith: '--candidate-id' },
        { ...candidateId, requires: '--name' }, job,
        value('--keyword', '关键词', { allowEmpty: true }), text, flag('--embedded'),
      ]),
      minOptions: 1,
    }],
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
    formalForms: [form('read-sidebar')],
    usage: 'search-sidebar [--json]',
    params: [{ flag: '--json', desc: '结构化返回侧栏文字与元素' }],
    requires: '当前常规搜索页',
    sideEffects: '无（只读）；不点击订阅、不应用条件',
    pages: '搜索页 /web/chat/search',
  },
  // ── 列表与定位 ──
  {
    name: 'list',
    formalForms: [form('list-conversations', [], [flag('--unread'), flag('--chatting')])],
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
    formalForms: [form('open-conversation', [dataId], [info], '姓名', '沟通页'),
      form('check-conversation', [check, dataId], [], '姓名', '沟通页'),
      form('open-recommend-chat', [flag('--recommend'), flag('--open'), candidateId, value('--recommend-job', '岗位与城市'), job], [], '卡片姓名', '推荐页'),
      form('check-embedded', [...embeddedTarget, check], [], '实际姓名', '推荐或搜索页'),
      form('close-embedded', [...embeddedTarget, flag('--close')], [], '实际姓名', '推荐或搜索页')],
    usage: 'chat <姓名> [--strict] [--info <原文>] [--data-id <会话ID>] [--json] | ' +
      'chat [姓名] --index <序号> [--unread] [--strict] [--json] | ' +
      'chat <姓名> --check [--data-id <会话ID>] [--json] | ' +
      'chat <卡片姓名> --recommend --open --candidate-id <ID> --recommend-job <岗位与城市> --job <聊天岗位原文> [--json] | ' +
      'chat <实际姓名> --embedded (--check|--close) --candidate-id <ID> --job <聊天岗位原文> [--json] | ' +
      'chat --inspect-embedded [--json]',
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
    formalForms: [form('locate-conversation', [], [info, dataId, job], '完整昵称'),
      form('clear-chat-search', [flag('--clear'), value('--expect-keyword', '当前完整昵称')])],
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
    formalForms: [form('list-jobs', [flag('--list')], [timeout(1, 60_000)]),
      form('switch-job', [job], [timeout(1, 60_000)])],
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
    formalForms: [form('read-search'),
      form('set-city', [value('--city', '城市', { allowEmpty: true })]),
      form('set-job', [job]),
      form('set-keyword', [value('--keyword', '关键词', { allowEmpty: true, maxLength: 20 })]),
      form('submit-search', [flag('--submit')]),
      form('search-current-filters', [], [], '关键词'),
      form('search-explicit-filters', [job], [value('--city', '城市', { allowEmpty: true })], { label: '关键词', allowEmpty: true, maxLength: 20 }, '常规搜索页'),
      form('search-explicit-filters-no-keyword', [value('--city', '城市', { allowEmpty: true }), job], [], undefined, '常规搜索页')],
    usage: 'search [关键词] | search <关键词或空串> --job <岗位> [--city <城市或空串>] | search --city <城市或空串> --job <岗位> | search --city <城市或空串> | search --job <岗位> | search --keyword <关键词或空串> | search --submit',
    params: [
      { flag: '--city', desc: '指定城市时设置筛选，省略或留空沿用页面城市' },
      { flag: '--job', desc: '唯一完整名称优先，其次唯一前缀。未能唯一匹配时返回待确认' },
      { flag: '--keyword', desc: '独立设置关键词（≤20 字符），空串清空输入框' },
      { flag: '--submit', desc: '仅点击一次搜索提交，不与设置混用' },
    ],
    requires: '常规搜索页；按城市（可省略）、岗位、关键词（可为空）、提交的顺序操作',
    sideEffects: '设置筛选或点击一次搜索。岗位待确认时本轮任务保持可继续',
    pages: '搜索页 /web/chat/search',
  },
  {
    name: 'search-more',
    formalForms: [form('expand-search', [
      value('--max-scrolls', '滚动次数', { integer: [1, 20] }),
      value('--max-candidates', '人数', { integer: [1, 500] }),
    ], [timeout(1000, 15_000)])],
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
    formalForms: [form('deep-search', [], deepSearchOptions)],
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
    formalForms: [form('read-recommendations'),
      form('recommend-for-job', [flag('--ensure-job')], [], '岗位与城市')],
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
    formalForms: [form('capture-resume', [candidateId], [], '姓名', '推荐或常规搜索页'),
      form('open-resume', [candidateId, flag('--open-only')], [flag('--reopen-on-frame-error')], '姓名', '常规搜索页'),
      form('capture-with-authorized-reopen', [candidateId, flag('--reopen-on-frame-error')], [], '姓名', '常规搜索页')],
    usage: 'preview <姓名> [--candidate-id <ID>] [--json] | ' +
      'preview <姓名> --candidate-id <ID> [--open-only] [--reopen-on-frame-error] [--json]（仅常规搜索页）',
    params: [
      { flag: '--candidate-id', desc: '卡片候选人ID（geekId）；锁模式下必填' },
      { flag: '--open-only', desc: '仅常规搜索页；打开并核验身份，保持展开，不截图' },
      { flag: '--reopen-on-frame-error', desc: '仅搜索页；Frame失败时关闭同人预览重开一次' },
    ],
    requires: '推荐/深度搜索/常规搜索页且列表已加载',
    sideEffects: '打开在线简历并截图到底；不自动跳转；每日查看次数有限',
    pages: '推荐/深度搜索/常规搜索页',
  },
  {
    name: 'greet',
    formalForms: [form('greet-candidate', [candidateId], [check, job], '姓名'),
      form('select-contact-job', [candidateId, value('--select-job', '联系岗位')], [check], '姓名'),
      form('confirm-contact', [candidateId, value('--select-job', '联系岗位'), flag('--confirm-contact')], [check], '姓名'),
      form('select-contact-mode', [candidateId, value('--contact-mode', '开聊模式')], [check], '姓名', '常规搜索页'),
      form('continue-chat', [candidateId, flag('--continue-chat')], [check], '姓名')],
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
    formalForms: [form('send-conversation', [name, dataId, text], [check], undefined, '沟通页'),
      form('send-embedded', [...embeddedTarget, name, text], [check], undefined, '推荐或搜索页')],
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
    formalForms: [form('capture-chat-resume', [], [], { label: '操作', choices: ['resume'] })],
    usage: 'action <resume|not-fit|remark|agree-resume|request-attachment-resume|history|wechat> [--remark <备注>] [--json]',
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
    formalForms: [form('close-resume'),
      form('close-resume-if-open', [flag('--if-open')]),
      form('go-back-one', [flag('--previous'), value('--expect-url', '上一条已核验URL')])],
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
    formalForms: [form('favorite-resume', [candidateId], [check])],
    usage: 'favorite --candidate-id <当前简历ID> [--check] [--json]',
    params: [{ flag: '--check', desc: '只读收藏状态' }],
    requires: '搜索/推荐页已打开简历',
    sideEffects: '仅未收藏时点击一次；不取消收藏',
    pages: '搜索/推荐页',
  },
  {
    name: 'dismiss-contact-notice',
    formalForms: [form('dismiss-contact-notice', [candidateId, job], [], '姓名')],
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
    formalForms: [form('probe-attachment', attachmentTarget, [], '姓名'),
      form('probe-and-download', [...attachmentTarget, flag('--download')], [outputDir], '姓名')],
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
    formalForms: [form('accept-attachment', attachmentTarget, [check], '姓名')],
    usage: 'accept-resume <姓名> --data-id <会话ID> [--check]',
    params: [{ flag: '--check', desc: '只读比较身份与附件状态' }],
    requires: '指定会话有附件请求',
    sideEffects: '同意附件简历请求，不发送文字',
    pages: '沟通页',
  },
  {
    name: 'download-resume',
    formalForms: [form('download-attachment', attachmentTarget, [check, outputDir], '姓名')],
    usage: 'download-resume <姓名> --data-id <会话ID> [--output-dir <目录>] [--check]',
    params: [{ flag: '--output-dir', desc: '输出目录' }, { flag: '--check', desc: '只读' }],
    requires: '指定会话已收到附件',
    sideEffects: '下载原附件，返回路径/大小/SHA-256',
    pages: '沟通页',
  },
  // ── 收集与账本 ──
  {
    name: 'collect',
    formalForms: [form('collect', [job], [value('--ledger-dir', '账本目录'), value('--mode', '模式', { choices: ['screen', 'collect-only'] })])],
    usage: 'collect --job <岗位完整名称> [--ledger-dir <目录>] [--mode <screen|collect-only>]',
    params: [
      { flag: '--job', desc: '账本岗位键（完整岗位名+城市，去薪资）' },
      { flag: '--ledger-dir', desc: '账本目录，跨轮固定' },
      { flag: '--mode', desc: 'screen（默认，决策须评估证据）；collect-only（仅收集）' },
    ],
    requires: '无（常驻会话，stdin 每行一个 JSON 命令）',
    sideEffects: '打开岗位账本；stdin op：show/add/decision/mode/round/recheck/reconcile/receipt/stop',
    pages: '启动不操作页面；round/recheck/reconcile 会读取沟通页',
    stdin: [
      { flag: '{"op":"show"}', desc: '读取账本' },
      { flag: '{"op":"add","job":"<岗位>","dataId":"<ID>","name":"<姓名>"}', desc: '加入本岗位候选人' },
      { flag: '{"op":"decision","dataId":"<ID>","decision":"PASS|FAIL","evidence":{"verdict":"fit|not-fit","ref":"<回执路径>"}}',
        desc: 'screen 必须提供对应 verdict（PASS↔fit、FAIL↔not-fit），ref 可选；collect-only 可省略 evidence；FAIL 移除账本记录' },
      { flag: '{"op":"mode","value":"screen|collect-only"}', desc: '正式任务须与冻结模式一致' },
      { flag: '{"op":"round"}', desc: '仅在明确授权范围内进行一次探测轮次' },
      { flag: '{"op":"recheck","recoveryAuthorized":true}', desc: '须取得明确授权，逐人核验待复查回执' },
      { flag: '{"op":"reconcile","recoveryAuthorized":true}', desc: '须取得明确授权，全量对账' },
      { flag: '{"op":"receipt","dataId":"<ID>"}', desc: '将本轮核验过的下载回执写入活动账本' },
      { flag: '{"op":"stop"}', desc: '停止会话，等待回执和退出' },
    ],
  },
  {
    name: 'collect-sync',
    formalForms: [form('sync-attachment', attachmentTarget)],
    usage: 'collect-sync --data-id <会话ID> --json',
    params: [{ flag: '--data-id', desc: '已下载会话ID' }],
    requires: 'collect 已停止；正式收集任务绑定',
    sideEffects: '核验下载回执字节/SHA-256 后写入固定岗位账本',
    pages: '无（离线）',
  },
  // ── 流程护栏 ──
  {
    name: 'decide',
    formalForms: [form('record-verdict', [candidateId, value('--verdict', '结论', { choices: ['fit', 'not-fit', 'unknown'] })])],
    usage: 'decide --candidate-id <ID> --verdict <fit|not-fit|unknown> [--json]',
    params: [{ flag: '--verdict', desc: 'fit|not-fit|unknown' }],
    requires: '锁模式（BOSS_FLOW_STATE）且候选人已打开',
    sideEffects: '记录评估结论；greet 前须 fit',
    pages: '无（离线）',
  },
  {
    name: 'flow-status',
    formalForms: [form('read-flow')],
    usage: 'flow-status [--json]',
    params: [],
    requires: '锁模式',
    sideEffects: '无（只读接续状态与停滞）',
    pages: '无',
  },
  {
    name: 'flow-pause',
    formalForms: [form('pause-flow', [value('--reason', '原因')])],
    usage: 'flow-pause --reason <原因> [--json]',
    params: [{ flag: '--reason', desc: '暂停原因' }],
    requires: '锁模式',
    sideEffects: '全局暂停，拒绝一切候选人动作',
    pages: '无',
  },
  {
    name: 'flow-resume',
    formalForms: [form('resume-flow')],
    usage: 'flow-resume [--json]',
    params: [],
    requires: '锁模式；未决动作须先核验',
    sideEffects: '解除暂停',
    pages: '无',
  },
  {
    name: 'phase-set',
    formalForms: [form('set-phase', [value('--phase', '阶段名')])],
    usage: 'phase-set --phase <阶段名> [--json]',
    params: [{ flag: '--phase', desc: '任务配置 phases 中声明的阶段名' }],
    requires: '正式任务绑定；当前阶段有成功回执',
    sideEffects: '按声明顺序相邻推进；禁止跳步/倒退',
    pages: '无',
  },
  {
    name: 'phase-status',
    formalForms: [form('read-phase')],
    usage: 'phase-status [--json]',
    params: [],
    requires: '正式任务绑定',
    sideEffects: '无（只读允许动作/阻断原因/下一步）',
    pages: '无',
  },
  {
    name: 'spec-list',
    formalForms: [form('list-specs')],
    usage: 'spec-list [--json]',
    params: [],
    requires: '无',
    sideEffects: '无（枚举 ~/.boss-cli/jobs/ 岗位规范）',
    pages: '无',
  },
  {
    name: 'commands',
    startupForm: { ...form('read-command-catalog', [], [json]), optionalCommandName: true },
    params: [],
    requires: '无',
    sideEffects: '无；读取当前安装的全部或单条命令用法',
    pages: '无（离线）',
  },
  {
    name: 'help',
    usage: 'help',
    params: [],
    requires: '无',
    sideEffects: '无；显示同一命令目录的文本版',
    pages: '无（离线）',
  },
  {
    name: 'version',
    usage: 'version',
    params: [],
    requires: '无',
    sideEffects: '读取本机版本并检查更新',
    pages: '无',
  },
  {
    name: 'version-check',
    startupForm: form('check-version', [], [json]),
    params: [{ flag: 'BOSS_SKILL_DIR', desc: '外部 Skill 的实际绝对路径' }],
    requires: '能读取实际安装的 Skill',
    sideEffects: '无；报告版本与兼容性',
    pages: '无（离线）',
  },
  {
    name: 'preflight',
    startupForm: form('run-preflight', [json]),
    params: [
      { flag: 'BOSS_SKILL_DIR', desc: '实际加载的外部 Skill 绝对目录' },
      { flag: 'BOSS_TASK_CONFIG', desc: '本轮任务配置文件绝对路径' },
    ],
    requires: '配套的 CLI/Skill、合法任务与 permit、已登录的唯一 BOSS 标签页',
    sideEffects: '只读；返回 passed 或 failed 及首个阻塞原因',
    pages: 'BOSS 招聘工作台；collect 要求沟通页',
  },
  {
    name: 'task-check',
    startupForm: form('check-task', [], [json]),
    params: [{ flag: 'BOSS_TASK_CONFIG', desc: '任务配置文件的绝对路径' }],
    requires: 'BOSS_TASK_CONFIG 指向任务配置',
    sideEffects: '无（离线校验）',
    pages: '无',
  },
  {
    name: 'task-init',
    startupForm: form('initialize-task', [], [json, flag('--keep-observed')]),
    params: [
      { flag: 'BOSS_TASK_CONFIG', desc: '任务配置文件的绝对路径' },
      { flag: '--keep-observed', desc: '续用上一轮同岗位已观察的简历与本地材料' },
    ],
    requires: 'BOSS_TASK_CONFIG；版本匹配',
    sideEffects: '生成 runId，写入运行绑定',
    pages: '无',
  },
  // ── 其它 ──
  {
    name: 'ocr',
    formalForms: [form('ocr-resume', [], [
      value('--layout', '版式', { choices: ['auto', 'boss-online-resume'] }), timeout(1000, 120_000),
    ], { label: 'PNG绝对路径', absolutePath: true })],
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
    formalForms: [form('list-positions')],
    usage: 'positions',
    params: [],
    requires: '职位管理页',
    sideEffects: '读取职位列表；会导航到 /web/chat/job/list（离开搜索页）',
    pages: '职位管理页',
  },
  {
    name: 'jd',
    formalForms: [form('read-job-description', [], [], '岗位名称')],
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

export function requiredFormalOptions(spec: CommandSpec, form: CommandForm): readonly CommandOption[] {
  return spec.name === 'collect' ? form.required : [...form.required, json];
}

function renderUsage(name: string, form: CommandForm, required: readonly CommandOption[]): string {
  function renderValue(value: ValueSpec): string {
    if (value.choices?.length === 1) return value.choices[0]!;
    if (value.choices) return `<${value.choices.join('|')}>`;
    if (value.integer) return `<${value.integer.join('-')}>`;
    return `<${value.label}>`;
  }
  function renderOption(option: CommandOption): string {
    return option.value ? `${option.name} ${renderValue(option.value)}` : option.name;
  }
  return [
    name,
    ...(form.positional ? [renderValue(form.positional)] : []),
    ...(form.optionalCommandName ? ['[命令名]'] : []),
    ...required.map(renderOption),
    ...form.optional.map(option => `[${renderOption(option)}${option.repeatable ? ' …' : ''}]`),
  ].join(' ');
}

export function commandUsage(spec: CommandSpec): string | undefined {
  return spec.startupForm ? renderUsage(spec.name, spec.startupForm, spec.startupForm.required) : spec.usage;
}

export function formalUsage(spec: CommandSpec): string[] | undefined {
  return spec.formalForms?.map(form => renderUsage(spec.name, form, requiredFormalOptions(spec, form)));
}

export function describeCommand(spec: CommandSpec) {
  return {
    ...spec,
    usage: commandUsage(spec),
    formalForms: spec.formalForms?.map(form => ({ ...form, required: requiredFormalOptions(spec, form) })),
    formalUsage: formalUsage(spec),
  };
}

export function renderCommandHelp(): string {
  const entries = COMMAND_SPECS.map(spec => [
    `  boss ${commandUsage(spec)}`,
    ...(formalUsage(spec) ?? []).map(usage => `    正式任务：boss ${usage}`),
    `    前置条件：${spec.requires}`,
    `    行为：${spec.sideEffects}`,
    `    页面：${spec.pages}`,
    ...spec.params.map(param => `    ${param.flag}  ${param.desc}`),
    ...(spec.stdin ?? []).map(param => `    stdin ${param.flag}  ${param.desc}`),
  ].join('\n'));
  return ['boss-cli', '命令规格见 boss commands <命令名> --json，完整目录见 boss commands --json。', ...entries].join('\n\n');
}
