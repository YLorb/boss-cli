// All identities, employers and resume claims are fictional.
export const MESSAGE='本地模拟确认：材料已收到。';
export const CASES=[
 {id:'sim-01',name:'模拟甲',skills:['Go','SQL','消息队列'],fault:null,expected:'completed',verdict:'fit',messages:1},
 {id:'sim-02',name:'模拟乙',skills:['CSS','React'],fault:null,expected:'not-fit',verdict:'not-fit',messages:0},
 {id:'sim-03',name:'模拟丙',skills:['Go','数据库经验未说明'],fault:null,expected:'insufficient-evidence',verdict:'unknown',messages:0},
 {id:'sim-04',name:'模拟丁',skills:['Go','SQL'],fault:'frame-detached',expected:'local-view-failure',messages:0},
 {id:'sim-05',name:'模拟戊',skills:['Go','S?L'],fault:'low-confidence',expected:'completed-reviewed',verdict:'fit',messages:1},
 {id:'sim-06',name:'模拟同名',skills:['Go','SQL'],fault:'identity-mismatch',expected:'identity-mismatch',messages:0},
 {id:'sim-07',name:'模拟同名',skills:['Go','SQL'],fault:'send-unconfirmed',expected:'send-unconfirmed',verdict:'fit',messages:1},
 {id:'sim-08',name:'模拟辛',skills:['Go','SQL'],fault:'process-interrupted',expected:'completed-recovered',verdict:'fit',messages:1},
 {id:'sim-09',name:'模拟壬',skills:['Go','SQL'],fault:'send-precondition',expected:'completed-after-safe-retry',verdict:'fit',messages:1},
 {id:'sim-10',name:'模拟癸',skills:['Go','SQL'],fault:'verification-required',expected:'global-blocked',verdict:'fit',messages:0},
];
export const RULES={job:'本地模拟服务器开发岗',mustHave:['Go','SQL'],unknown:'证据缺失记unknown，不猜补',
 message:MESSAGE,permissions:'只在模拟入口内执行；不连接真实BOSS；逐人串行；发送结果未知不重发；验证码为全局暂停',
 recovery:'已确认局部查看失败可跳过。sim-08进程中断后，核验同人已打开，可用preview --open-only复用一次。sim-09明确未发送且inspect核验编辑器恢复后，允许重试一次。'};
