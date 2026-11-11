import { detachBrowserSession, ensureBrowserSession, getPageRef } from '../browser/index.js';

const BOSS_LOGIN_URL = 'https://www.zhipin.com/web/user/?ka=header-login';

function traceLoginStep(message: string): void {
  if (process.env.BOSS_CLI_TRACE === 'true' || process.env.BOSS_CLI_TRACE === '1') {
    console.error(`[boss-cli][login] ${message}`);
  }
}

/**
 * 登录（手动）：只负责打开 Boss 登录页，让用户在浏览器中自行完成登录。
 * 不做登录态校验/等待/超时判断；成功与否由后续命令自行体现。
 */
export async function runLogin(json = false): Promise<string> {
  traceLoginStep('准备连接常驻浏览器');
  try {
    await ensureBrowserSession();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`连接浏览器失败：${message}`, { cause: error });
  }

  const page = getPageRef();
  if (!page) throw new Error('常驻浏览器没有可用登录页');
  await page.bringToFront();
  traceLoginStep('页面已置于前台，打开 Boss 登录页');
  await page.goto(BOSS_LOGIN_URL, { waitUntil: 'load', timeout: 60_000 });
  traceLoginStep('Boss 登录页已加载，交由用户手动登录');

  await detachBrowserSession();
  traceLoginStep('CLI 已断开连接，浏览器窗口保持打开');

  if (json) return JSON.stringify({ url: BOSS_LOGIN_URL, status: 'awaiting-manual-login' });

  // 不做任何登录校验：只把浏览器打开到登录页；立即断开 CDP，CLI 不与浏览器进程长期绑定。
  return [
    `已在浏览器中打开 Boss 登录页：${BOSS_LOGIN_URL}`,
    '本命令已同步结束并立即返回，CLI 不会等待 / 轮询 / 校验登录结果。',
    'Agent调用方：把控制权交还给人类，不要在这一步自行 sleep / poll / retry',
  ].join('\n');
}

