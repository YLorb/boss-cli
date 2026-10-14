import assert from 'node:assert/strict';
import { test, mock } from 'node:test';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

// No browser is started or connected: execute the shipped browser strings on DOM fixtures.
let page;
mock.module('../dist/common/boss_session_page.js', { namedExports: { withBossSessionPage: async callback => callback(page) } });
mock.module('../dist/toolset/action.js', { namedExports: { runRequestAttachmentResume: async () => { throw Error('Unexpected attachment request'); } } });
mock.module('../dist/toolset/target_chat.js', { namedExports: {
  assertSelectedConversation: async () => { throw Error('Unexpected live conversation check'); },
  openConversationByTarget: async () => { throw Error('Unexpected live conversation navigation'); },
} });
mock.module('../dist/browser/index.js', { namedExports: {
  randomIntInclusive: () => 0, selectAllModifierKey: () => 'Control', sleepRandom: async () => {},
  SEND_AFTER_ENTER_MS: { min: 0, max: 0 }, SEND_INPUT_CLICK_MS: { min: 0, max: 0 },
} });
const { CHAT_INPUT_TEXT_READER } = await import('../dist/common/chat_input_text.js');
const { runSendChatMessage } = await import('../dist/toolset/send.js');
const text = data => ({ nodeType: 3, data });
const element = (tagName, ...childNodes) => ({ nodeType: 1, tagName, childNodes });
const editor = (...children) => Object.assign(element('DIV', ...children), { isContentEditable: true });
const read = el => vm.runInNewContext(`(${CHAT_INPUT_TEXT_READER})(el)`, { el });
const message3 = JSON.parse(readFileSync(new URL('../skills/boss-recruitment/assets/messages.example.json', import.meta.url), 'utf8')).message3;
const [first, second] = message3.split('\n\n');
// Captured Chrome paste shape: <div>first</div><div><br></div><div>second</div>.
const messageEditor = () => Object.assign(editor(element('DIV', text(first)), element('DIV', element('BR')), element('DIV', text(second))), { innerText: first + '\n\n\n' + second });

test('captured contenteditable message3 DOM has exactly one blank line, despite innerText layout artifact', () => {
  const el = messageEditor();
  assert.notEqual(el.innerText, message3);
  assert.equal(read(el), message3);
});

test('preserve explicit BR, block lines, empty lines, Unicode and repeated spaces', () => {
  assert.equal(read(editor(text('甲'), element('BR'), element('BR'), text('乙'))), '甲\n\n乙');
  assert.equal(read(editor(text('甲'), element('DIV', text('乙')))), '甲\n乙');
  assert.equal(read(editor(element('DIV',text('甲')),element('DIV',element('BR')),element('DIV',element('BR')),element('DIV',text('乙')))), '甲\n\n\n乙');
  assert.equal(read(editor(element('SPAN', text('中文  🙏')), element('B', text('“引号”')))), '中文  🙏“引号”');
  assert.equal(read(editor(text('甲'),element('SPAN',element('BR')),text('乙'))), '甲\n乙');
  assert.equal(read(editor(element('DIV',text('甲'),element('BR'),text('乙')),element('DIV',text('丙')))), '甲\n乙\n丙');
  assert.equal(read(editor(element('BR'))), '');
  assert.equal(read({tagName:'TEXTAREA',value:'甲\n\n乙'}), '甲\n\n乙');
  assert.throws(() => read(editor(element('IMG'))), /不支持的元素/);
});

function setup(pastedEditor) {
  const state = { clipboard: '', presses: [], messages: [], el: editor() };
  const context = {
    navigator: { clipboard: { writeText: async value => { state.clipboard = value; } } },
    document: { querySelector: () => state.el, querySelectorAll: () => state.messages },
  };
  page = {
    url: () => 'https://www.zhipin.com/web/chat/index',
    $: async () => ({ click: async () => {} }),
    createCDPSession: async () => ({ send: async () => {}, detach: async () => {} }),
    keyboard: { down: async () => {}, up: async () => {}, press: async key => {
      state.presses.push(key);
      if (key === 'KeyV') state.el = pastedEditor;
      if (key === 'Enter') state.messages.push({innerText: state.clipboard});
    } },
    evaluate: async script => vm.runInNewContext(script, context),
    waitForFunction: async (script, options) => {
      if (!vm.runInNewContext(script, context)) throw Error('Waiting failed: ' + options.timeout + 'ms exceeded');
    },
  };
  return state;
}

test('send flow validates contenteditable message3 before Enter without changing clipboard text', async () => {
  const state = setup(messageEditor());
  const result = JSON.parse(await runSendChatMessage({text:message3,json:true}));
  assert.equal(state.clipboard,message3);
  assert.equal(result.text,message3);
  assert.equal(result.status,'message-visible');
  assert.equal(state.presses.filter(k=>k==='KeyV').length,1);
  assert.equal(state.presses.filter(k=>k==='Enter').length,1);
});

test('missing or extra blank lines and changed content still stop before Enter', async () => {
  for (const el of [editor(element('DIV',text(first)),element('DIV',text(second))),
    editor(element('DIV',text(first)),element('DIV',element('BR')),element('DIV',element('BR')),element('DIV',text(second))),
    editor(text(message3.replace('你好','您好'))), editor()]) {
    const state=setup(el);
    await assert.rejects(runSendChatMessage({text:message3}),/5000ms/);
    assert.equal(state.presses.includes('Enter'),false);
  }
});
