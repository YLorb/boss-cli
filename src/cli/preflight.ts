import type { Frame } from 'puppeteer-core';
import { withBossSessionLock } from '../common/boss_session_lock.js';
import { withReadOnlyPage } from '../toolset/check.js';
import { readLoginState } from '../toolset/check_login.js';
import { checkSkillCompatibility } from './skill_compatibility.js';
import { checkTaskConfig } from './task_config.js';
import { TASK_INIT_ARGV } from './command_spec.js';

type FailureCode = 'VERSION_CHECK_FAILED' | 'VERSION_MISMATCH' | 'TASK_CONFIG_INVALID' |
  'BROWSER_CHECK_FAILED' | 'PAGE_CHANGED' | 'LOGIN_REQUIRED' | 'LOGIN_STATE_UNKNOWN' | 'PAGE_NOT_READY';

type PreflightResult = { status: 'passed'; next: { argv: typeof TASK_INIT_ARGV } } | {
  status: 'failed';
  reason: { code: FailureCode; message: string; details?: unknown };
};

function failed(code: FailureCode, error: unknown, details?: unknown): PreflightResult {
  return {
    status: 'failed',
    reason: { code, message: error instanceof Error ? error.message : String(error), details },
  };
}

export async function runPreflight(): Promise<PreflightResult> {
  let failureCode: FailureCode = 'VERSION_CHECK_FAILED';
  try {
    const version = await checkSkillCompatibility();
    if (!version.compatible) return failed('VERSION_MISMATCH', 'CLI 与 Skill 版本不匹配', version);

    failureCode = 'TASK_CONFIG_INVALID';
    const { task } = await checkTaskConfig();
    if (task.stop.deadline && Date.now() >= Date.parse(task.stop.deadline)) {
      return failed(failureCode, '本轮已到截止时间');
    }

    failureCode = 'BROWSER_CHECK_FAILED';
    return await withBossSessionLock(() => withReadOnlyPage(async (page): Promise<PreflightResult> => {
      const url = page.url();
      const mainFrame = page.mainFrame();
      let navigated = false;
      const onNavigation = (frame: Frame) => { if (frame === mainFrame) navigated = true; };
      page.on('framenavigated', onNavigation);
      try {
        const login = await readLoginState(page);
        if (navigated || page.isClosed() || page.url() !== url || login.url !== url) {
          return failed('PAGE_CHANGED', '检查期间 BOSS 页面发生变化');
        }
        if (login.loggedIn === false) return failed('LOGIN_REQUIRED', '当前 BOSS 标签页需要登录');
        if (login.loggedIn === null) return failed('LOGIN_STATE_UNKNOWN', '当前 BOSS 标签页无法确认登录态');
        const location = new URL(url);
        if (location.origin !== 'https://www.zhipin.com' || !location.pathname.startsWith('/web/chat/')) {
          return failed('PAGE_NOT_READY', '当前标签页不在 BOSS 招聘工作台');
        }
        if (task.scope === 'collect' && location.pathname.replace(/\/+$/, '') !== '/web/chat/index') {
          return failed('PAGE_NOT_READY', '收集任务要求当前位于沟通页');
        }
        return { status: 'passed', next: { argv: TASK_INIT_ARGV } };
      } finally {
        page.off('framenavigated', onNavigation);
      }
    }), 0);
  } catch (error) {
    return failed(failureCode, error);
  }
}
