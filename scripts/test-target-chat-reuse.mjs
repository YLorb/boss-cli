import test, { mock } from 'node:test';
import assert from 'node:assert/strict';

mock.module('../dist/toolset/chat_search.js', { namedExports: {
  requireChatSearch: async (page, target) => {
    page.events.push('search');
    await page.search(target);
  },
} });
const { openConversationByTarget } = await import('../dist/toolset/target_chat.js');
const target = { name: '测试候选人', dataId: '123-0' };
const matching = { count: 1, name: target.name, dataId: target.dataId, detailName: target.name };

function fixture(initial = matching) {
  return {
    events: [], current: { ...initial }, reads: 0,
    url: () => 'https://www.zhipin.com/web/chat/index',
    async evaluate(script) {
      if (script.includes('const previews =')) {
        this.events.push('preview-check');
        if (this.previewError) throw this.previewError;
        return false;
      }
      assert.ok(script.includes(".geek-item.selected"), 'only current identity may be read');
      this.events.push('identity');
      this.reads++;
      if (this.readErrorAt === this.reads) throw new Error('identity read failed');
      return { ...this.current };
    },
    async search() { this.current = { ...matching }; },
  };
}

test('matching name, ID and detail reuse the conversation and never search', async () => {
  const page = fixture();
  await openConversationByTarget(page, target);
  await openConversationByTarget(page, target);
  assert.deepEqual(page.events, ['identity', 'preview-check', 'identity', 'identity', 'preview-check', 'identity']);
});

test('missing or mismatched current identity selects the search path once', async () => {
  for (const difference of [
    { count: 0, name: '', dataId: '', detailName: '' },
    { name: '其他人' }, { dataId: '456-0' }, { detailName: '其他人' }, { count: 2 },
  ]) {
    const page = fixture({ ...matching, ...difference });
    await openConversationByTarget(page, target);
    assert.deepEqual(page.events, ['identity', 'preview-check', 'search', 'identity']);
  }
});

test('known info is passed unchanged only when searching; a verified current ID still reuses', async () => {
  const known={...target,info:' 已知_公司 '};
  const matchingPage=fixture();
  await openConversationByTarget(matchingPage,known);
  assert.ok(!matchingPage.events.includes('search'));
  const different=fixture({...matching,dataId:'other'});
  different.search=async received=>{assert.deepEqual(received,known);different.current={...matching};};
  await openConversationByTarget(different,known);
  assert.equal(different.events.filter(x=>x==='search').length,1);
});

test('read errors never trigger search, either before selection or during final verification', async () => {
  for (const readErrorAt of [1, 2]) {
    const page = fixture();
    page.readErrorAt = readErrorAt;
    await assert.rejects(openConversationByTarget(page, target), /identity read failed/);
    assert.ok(!page.events.includes('search'));
  }
});

test('identity change after reuse and preview-close errors stop without searching', async () => {
  const changed = fixture();
  const evaluate = changed.evaluate;
  changed.evaluate = async function (script) {
    const result = await evaluate.call(this, script);
    if (script.includes('const previews =')) this.current.dataId = '456-0';
    return result;
  };
  await assert.rejects(openConversationByTarget(changed, target), /会话身份校验失败/);
  assert.ok(!changed.events.includes('search'));
  const blocked = fixture();
  blocked.previewError = new Error('preview close failed');
  await assert.rejects(openConversationByTarget(blocked, target), /preview close failed/);
  assert.ok(!blocked.events.includes('search'));
});

test('ambiguous search and post-search identity failures stop without retrying', async () => {
  const ambiguous = fixture({ ...matching, dataId: '456-0' });
  const pause = Object.assign(new Error('重名，等待用户确认'), { name: 'CandidateSelectionRequired' });
  ambiguous.search = async () => { throw pause; };
  await assert.rejects(openConversationByTarget(ambiguous, target), error => error === pause);
  assert.deepEqual(ambiguous.events, ['identity', 'preview-check', 'search']);
  const wrong = fixture({ ...matching, dataId: '456-0' });
  wrong.search = async () => {};
  await assert.rejects(openConversationByTarget(wrong, target), /会话身份校验失败/);
  assert.deepEqual(wrong.events, ['identity', 'preview-check', 'search', 'identity']);
});

test('invalid arguments and wrong pages fail before any page reads or search', async () => {
  const page = fixture();
  await assert.rejects(openConversationByTarget(page, { name: ' ', dataId: '123-0' }), /必须同时提供/);
  page.url = () => 'https://www.zhipin.com/web/chat/search';
  await assert.rejects(openConversationByTarget(page, target), /必须已在沟通页/);
  assert.deepEqual(page.events, []);
});
