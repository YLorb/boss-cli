import test, {mock} from 'node:test';
import assert from 'node:assert/strict';
import puppeteer from 'puppeteer-core';
let page;
mock.module('../dist/common/boss_session_page.js',{namedExports:{withBossSessionPage:async(fn,opts)=>{
  assert.deepEqual(opts,{ensureChatShell:false,ensureMenuList:false});return fn(page);
}}});
const {closeEmbeddedChat,embeddedCloseScript}=await import('../dist/toolset/embedded-chat.js');
const {executeCommand}=await import('../dist/cli/cliRouter.js');
const target={name:'测试',candidateId:'candidate-1',job:'测试岗位'};

test('embedded close preserves drafts, scopes identity and clicks once without navigation',async t=>{
  const browser=await puppeteer.launch({executablePath:'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',headless:true});
  try {
    page=await browser.newPage();
    await page.setRequestInterception(true);
    page.on('request',r=>void r.respond({status:200,contentType:'text/html',body:'<html><body></body></html>'}));
    await page.goto('https://www.zhipin.com/web/chat/search');
    const setup=async (options={})=>{
      await page.setContent(`<style>.chat-global-conversation{width:400px;height:300px}.iboss-close{width:30px;height:30px}#boss-chat-global-input{width:200px;height:40px}</style>
        <div class="iboss iboss-close" id="outside">outside</div>
        <div class="chat-global-conversation"><div class="iboss iboss-close" id="close">x</div>
        <div class="bosschat-chat-global-card">测试</div><div class="conversation-global-editor"><div id="boss-chat-global-input" contenteditable="true"></div></div></div>`);
      await page.evaluate(`(() => {
        const opts=${JSON.stringify(options)},root=document.querySelector('.chat-global-conversation');
        window.closeClicks=0;window.outsideClicks=0;
        root.__vue__={$props:{friendId:11}};
        document.querySelector('.bosschat-chat-global-card').__vue__={$props:{conversation:{name:'测试',encryptUid:'candidate-1',toPosition:'测试岗位',uniqueId:'11-0',friendId:11}}};
        document.querySelector('.conversation-global-editor').__vue__={$props:{uniqueId:'11-0'},$data:{disabled:false}};
        document.querySelector('#boss-chat-global-input').textContent=opts.draft||'';
        document.querySelector('#outside').onclick=()=>window.outsideClicks++;
        document.querySelector('#close').onclick=()=>{window.closeClicks++;if(opts.navigate)history.replaceState({},'','/web/chat/index');if(!opts.stall)root.remove();};
        if(opts.duplicate)root.appendChild(document.querySelector('#close').cloneNode(true));
        if(opts.blocked){const block=document.createElement('div');block.style='position:fixed;inset:0;z-index:999';document.body.appendChild(block);}
        if(opts.disabled)document.querySelector('#close').setAttribute('aria-disabled','true');
        if(opts.offscreen)document.querySelector('#close').style='position:absolute;left:2000px';
        if(opts.multi)document.body.appendChild(root.cloneNode(true));
      })()`);
    };
    for(const [label,options,error] of [
      ['draft',{draft:'未发草稿'},/草稿/],['duplicate',{duplicate:true},/不唯一/],
      ['blocked',{blocked:true},/遮挡/],['disabled',{disabled:true},/不可用/],
      ['offscreen',{offscreen:true},/视口外/],['multiple conversations',{multi:true},/数量异常/]
    ])await t.test(label,async()=>{
      await setup(options);await assert.rejects(closeEmbeddedChat(target),error);
      assert.equal(await page.evaluate('window.closeClicks'),0);
      if(options.draft)assert.equal(await page.$eval('#boss-chat-global-input',e=>e.textContent),options.draft);
    });
    await t.test('wrong identity and changed conversation do not click',async()=>{
      await setup();await assert.rejects(closeEmbeddedChat({...target,candidateId:'other'}),/校验失败/);
      await assert.rejects(page.evaluate(embeddedCloseScript(target,'other-conversation')),/身份变化/);
      assert.equal(await page.evaluate('window.closeClicks'),0);
    });
    await t.test('CLI rejects conflicting flags before closing',async()=>{
      await setup();
      for(const args of [
        ['chat','测试','--close'],
        ['chat','测试','--embedded','--close','--check','--candidate-id','candidate-1','--job','测试岗位'],
        ['chat','测试','--embedded','--close','--candidate-id','candidate-1'],
      ])await assert.rejects(executeCommand(args));
      assert.equal(await page.evaluate('window.closeClicks'),0);
    });
    await t.test('CLI closes exactly the verified window once',async()=>{
      await setup();const result=JSON.parse(await executeCommand(['chat','测试','--embedded','--close','--candidate-id','candidate-1','--job','测试岗位','--json']));
      assert.equal(result.status,'embedded-closed');assert.equal(result.conversationId,'11-0');
      assert.equal(await page.evaluate('window.closeClicks'),1);assert.equal(await page.evaluate('window.outsideClicks'),0);
      assert.equal(page.url(),'https://www.zhipin.com/web/chat/search');
      await assert.rejects(closeEmbeddedChat(target),/数量异常/);
      assert.equal(await page.evaluate('window.closeClicks'),1);
    });
    await t.test('timeout exposes failure without a second click',async()=>{
      await setup({stall:true});await assert.rejects(closeEmbeddedChat(target),/5000ms/);
      assert.equal(await page.evaluate('window.closeClicks'),1);
    });
    await t.test('unexpected navigation is an error, never recovery',async()=>{
      await setup({navigate:true});await assert.rejects(closeEmbeddedChat(target),/导航/);
      assert.equal(await page.evaluate('window.closeClicks'),1);
    });
  }finally{await browser.close();}
});
