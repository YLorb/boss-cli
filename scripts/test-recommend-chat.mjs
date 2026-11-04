import test,{mock} from 'node:test';
import assert from 'node:assert/strict';
import puppeteer from 'puppeteer-core';
let page, sessions=0;
mock.module('../dist/common/boss_session_page.js',{namedExports:{withBossSessionPage:async(fn,options)=>{
  assert.deepEqual(options,{ensureChatShell:false,ensureMenuList:false});sessions++;return fn(page);
}}});
const {openRecommendChat}=await import('../dist/toolset/recommend-chat.js');
const {sendEmbeddedChat,closeEmbeddedChat}=await import('../dist/toolset/embedded-chat.js');
const {readStatus,matchesStatus}=await import('../dist/toolset/check.js');
const {executeCommand}=await import('../dist/cli/cliRouter.js');
const target={name:'测**',candidateId:'candidate-1',job:'测试岗位',recommendJob:'测试岗位 _ 深圳'};
const args=['chat',target.name,'--recommend','--open','--candidate-id',target.candidateId,'--recommend-job',target.recommendJob,'--job',target.job,'--json'];

test('recommendation continuation stays in place and uses the verified embedded conversation',async t=>{
  const browser=await puppeteer.launch({executablePath:'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',headless:true});
  try {
    page=await browser.newPage();await page.setViewport({width:1100,height:850});
    await page.setRequestInterception(true);
    page.on('request',r=>void r.respond({status:200,contentType:'text/html',body:'<html><body></body></html>'}));
    async function setup(options={}) {
      await page.goto('https://www.zhipin.com/web/chat/recommend');
      await page.setContent('<style>iframe{width:750px;height:700px;border:0}.chat-global-conversation{position:fixed;right:0;top:0;background:white;width:300px;height:420px;z-index:10}#boss-chat-global-input{height:100px;width:270px}.iboss-close{width:25px;height:25px}.message-item{white-space:pre-wrap}</style><iframe name="recommendFrame" src="/web/frame/recommend/"></iframe>');
      const host=await page.$('iframe');const frame=await host.contentFrame();
      await frame.setContent('<div class="job-selecter-wrap"><span class="ui-dropmenu-label">测试岗位 _ 深圳 20-40K</span></div><div class="candidate-card-wrap"><div class="card-inner" data-geekid="candidate-1"><div class="name-wrap"><span class="name">测**</span></div></div><div class="button-chat-wrap"><button type="button">继续聊</button></div></div>');
      await page.evaluate(`(() => {
        const options=${JSON.stringify(options)};window.continues=0;window.greets=0;window.sends=0;
        window.openFixtureChat=()=>{
          if(options.navigate){history.replaceState({},'','/web/chat/index');return;}
          if(options.stall)return;
          const root=document.createElement('div');root.className='chat-global-conversation';
          root.innerHTML='<button class="iboss iboss-close">x</button><div class="bosschat-chat-global-card">测试</div><div class="conversation-global-editor"><div id="boss-chat-global-input" contenteditable="true"></div></div>';
          root.__vue__={$props:{friendId:11}};
          root.querySelector('.bosschat-chat-global-card').__vue__={$props:{conversation:{name:'测试全名',encryptUid:options.wrongChat?'other':'candidate-1',toPosition:options.wrongChatJob?'其他岗位':'测试岗位',uniqueId:'11-0',friendId:11}}};
          if(options.delayedName){const c=root.querySelector('.bosschat-chat-global-card').__vue__.$props.conversation;c.name='';if(!options.neverReady)setTimeout(()=>c.name='测试全名',180);}
          const editor=root.querySelector('.conversation-global-editor');editor.__vue__={$props:{uniqueId:'11-0'},$data:{disabled:true}};
          if(options.delayedEditor){const component=editor.__vue__;delete editor.__vue__;setTimeout(()=>editor.__vue__=component,180);}
          const input=root.querySelector('#boss-chat-global-input');input.textContent=options.draft||'';
          input.addEventListener('input',()=>editor.__vue__.$data.disabled=false);
          input.addEventListener('keydown',event=>{
            if(event.key!=='Enter')return;event.preventDefault();window.sends++;
            const text=input.innerText;const row=document.createElement('div');row.className='message-item';row.textContent=text;
            row.__vue__={$props:{message:{mid:'sent-'+window.sends,text,isSelf:true,toId:11}}};root.appendChild(row);input.textContent='';
          });
          root.querySelector('.iboss-close').onclick=()=>root.remove();document.body.appendChild(root);
        };
        if(options.existing)window.openFixtureChat();
        if(options.blocked){const cover=document.createElement('div');cover.style='position:fixed;inset:0;z-index:20';document.body.appendChild(cover);}
      })()`);
      await frame.evaluate(`(() => {
        const options=${JSON.stringify(options)},card=document.querySelector('.candidate-card-wrap'),inner=card.querySelector('.card-inner'),button=card.querySelector('button');
        inner.__vue__={$props:{geekInfo:{encryptGeekId:options.wrongCard?'other':'candidate-1',geekName:'测**'}}};
        button.textContent=options.label||'继续聊';
        button.onclick=()=>{if(button.textContent==='打招呼')top.greets++;else top.continues++;top.openFixtureChat();};
        if(options.disabled)button.disabled=true;
        if(options.duplicate)card.querySelector('.button-chat-wrap').appendChild(button.cloneNode(true));
        if(options.duplicateId)document.body.appendChild(card.cloneNode(true));
        if(options.resume){const panel=document.createElement('div');panel.className='resume-middle-wrap';panel.textContent='简历';document.body.appendChild(panel);}
      })()`);
      return frame;
    }
    for(const [label,options,pattern] of [
      ['never re-greet',{label:'打招呼'},/禁止重复触达/],
      ['unknown assistant control',{label:'助手沟通中'},/缺失或不唯一/],
      ['disabled continuation',{disabled:true},/不可用/],
      ['duplicate button',{duplicate:true},/不唯一/],
      ['card component mismatch',{wrongCard:true},/组件不符/],
      ['duplicate candidate ID',{duplicateId:true},/不唯一/],
      ['resume covering list',{resume:true},/遮挡/],
      ['parent overlay',{blocked:true},/遮挡/],
    ])await t.test(label,async()=>{
      await setup(options);await assert.rejects(openRecommendChat(target),pattern);
      assert.equal(await page.evaluate('window.continues+window.greets+window.sends'),0);
    });
    await t.test('wrong selected job and invalid CLI flags do not click',async()=>{
      await setup();await assert.rejects(openRecommendChat({...target,recommendJob:'测试岗位 _ 北京'}),/推荐岗位不符/);
      for(const bad of [args.filter(x=>x!=='--open'),[...args,'--check'],[...args,'--embedded'],[...args,'--text','hello']])await assert.rejects(executeCommand(bad));
      assert.equal(await page.evaluate('window.continues+window.greets'),0);
    });
    for(const [label,options] of [['wrong resulting candidate',{wrongChat:true}],['wrong resulting job',{wrongChatJob:true}]])await t.test(label,async()=>{
      await setup(options);await assert.rejects(openRecommendChat(target),/身份／岗位不符/);
      assert.equal(await page.evaluate('window.continues'),1);assert.equal(await page.evaluate('window.sends+window.greets'),0);
    });
    await t.test('existing wrong conversation is preserved without another click',async()=>{
      await setup({existing:true,wrongChat:true});await assert.rejects(openRecommendChat(target),/校验失败/);
      assert.equal(await page.evaluate('window.continues'),0);
    });
    for(const options of [{delayedName:true},{delayedEditor:true}])await t.test('waits for initial identity readiness '+JSON.stringify(options),async()=>{
      await setup(options);const opened=JSON.parse(await openRecommendChat(target));
      assert.equal(opened.status,'embedded-opened');assert.equal(opened.identityVerified,true);
      assert.equal(await page.evaluate('window.continues'),1);assert.equal(await page.evaluate('window.sends+window.greets'),0);
    });
    await t.test('populated wrong ID is terminal even when name is pending',async()=>{
      await setup({delayedName:true,wrongChat:true});await assert.rejects(openRecommendChat(target),/身份／岗位不符/);
      assert.equal(await page.evaluate('window.continues'),1);
    });
    await t.test('permanently missing name stops with a readiness diagnostic',async()=>{
      await setup({delayedName:true,neverReady:true});await assert.rejects(openRecommendChat(target),/5000ms.*name/);
      assert.equal(await page.evaluate('window.continues'),1);assert.equal(await page.evaluate('window.sends+window.greets'),0);
    });
    await t.test('timeout and navigation stop without retry or send',async()=>{
      for(const options of [{stall:true},{navigate:true}]){
        await setup(options);await assert.rejects(openRecommendChat(target),/5000ms|导航/);
        assert.equal(await page.evaluate('window.continues'),1);assert.equal(await page.evaluate('window.greets+window.sends'),0);
      }
    });
    await t.test('CLI opens once, unmasks by ID, sends message3 once and closes on recommendation',async()=>{
      await setup();const initial=page.url(),before=sessions;
      const opened=JSON.parse(await executeCommand(args));assert.equal(opened.status,'embedded-opened');
      assert.equal(opened.target.name,'测试全名');assert.equal(opened.target.candidateId,target.candidateId);
      assert.equal(JSON.parse(await executeCommand(args)).status,'embedded-already-open');
      assert.equal(await page.evaluate('window.continues'),1);assert.equal(await page.evaluate('window.greets+window.sends'),0);
      const text='你好，关注到你的经历。\n想聊聊我们的岗位。';
      const status=await readStatus(page);
      assert.equal(matchesStatus(status,{page:'recommend',embedded:true,state:'send-ready',...opened.target,text}),true);
      assert.equal(matchesStatus(status,{page:'recommend',embedded:true,state:'conversation',...opened.target,job:'其他岗位'}),false);
      const sendArgs=['send','--embedded','--name',opened.target.name,'--candidate-id',target.candidateId,'--job',target.job,'--text',text,'--json'];
      const sent=JSON.parse(await executeCommand(sendArgs));assert.equal(sent.status,'message-visible');assert.equal(sent.messageIds.length,1);
      assert.equal(JSON.parse(await executeCommand(sendArgs)).status,'already-visible');
      assert.equal(await page.evaluate('window.sends'),1);
      assert.equal(matchesStatus(await readStatus(page),{page:'recommend',embedded:true,state:'message-visible',...opened.target,text}),true);
      assert.equal(JSON.parse(await closeEmbeddedChat(opened.target)).closed,true);
      assert.equal(page.url(),initial);assert.equal(await page.evaluate('window.greets'),0);assert.ok(sessions>=before+5);
    });
    await t.test('draft stays untouched and no send occurs',async()=>{
      await setup({existing:true,draft:'未发草稿'});const opened=JSON.parse(await openRecommendChat(target));
      await assert.rejects(sendEmbeddedChat(opened.target,'消息3'),/草稿/);
      await assert.rejects(closeEmbeddedChat(opened.target),/草稿/);
      assert.equal(await page.evaluate("document.querySelector('#boss-chat-global-input').textContent"),'未发草稿');
      assert.equal(await page.evaluate('window.sends+window.continues+window.greets'),0);
    });
  } finally {await browser.close();}
});
