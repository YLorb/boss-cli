// 一次性探针：连上已运行的持久化 Chrome，读 boss 页面登录态线索
const puppeteer = require('puppeteer-core');

(async () => {
  const browser = await puppeteer.connect({
    browserURL: 'http://127.0.0.1:53470',
    defaultViewport: null,
  });
  const pages = await browser.pages();
  for (const p of pages) {
    const url = p.url();
    if (!url.includes('zhipin.com')) continue;
    const info = await p.evaluate(() => {
      const t = (document.body && document.body.innerText || '').replace(/\s+/g, ' ').trim();
      const hasLogin = !!document.querySelector('.login-btn, .btn-login, [ka="header-login"]');
      const hasAvatar = !!document.querySelector('.nav-figure, .user-nav, .header-user, img.avatar');
      return { url: location.href, title: document.title, hasLoginBtn: hasLogin, hasAvatar, text: t.slice(0, 400) };
    });
    console.log(JSON.stringify(info, null, 1));
  }
  await browser.disconnect();
})().catch(e => { console.error('PROBE_ERR', e.message); process.exit(1); });
