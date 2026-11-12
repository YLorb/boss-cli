import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import {
  clearSpawnedChromeProcessRef, connectBrowserWithMetadata, probeRemoteDebuggingWsEndpoint,
  REMOTE_DEBUGGING_PORT,
} from '../browser/cdp_browser.js';
import { withBossSessionLock } from '../common/boss_session_lock.js';

const HEALTH_CHECK_MS = 5_000;
const RECEIPT_FILE = '.boss-cli-browser-session.json';

type BrowserIdentity = { endpointHash: string; pid: number; profileDirectory: string };
const fingerprint = (endpoint: string) => createHash('sha256').update(endpoint).digest('hex');

async function verifyExisting(endpoint: string, userDataDir: string, profileDirectory: string): Promise<number> {
  const file = join(userDataDir, RECEIPT_FILE);
  let identity: BrowserIdentity;
  try {
    identity = JSON.parse(await readFile(file, 'utf8')) as BrowserIdentity;
  } catch (error) {
    throw new Error(`调试端口 ${REMOTE_DEBUGGING_PORT} 已在使用，无法从 ${file} 核验浏览器实例：${String(error)}`, { cause: error });
  }
  if (identity?.endpointHash !== fingerprint(endpoint) || identity.profileDirectory !== profileDirectory ||
      !Number.isSafeInteger(identity.pid) || identity.pid <= 0) {
    throw new Error(`调试端口 ${REMOTE_DEBUGGING_PORT} 的浏览器与专用配置目录记录不符：${file}`);
  }
  return identity.pid;
}

/** The host keeps this CLI task running. Chrome stays available without an attached CDP client. */
export async function runBrowserSession(emit: (line: string) => void): Promise<string> {
  const session = await withBossSessionLock(async () => {
    const connection = await connectBrowserWithMetadata({}, verifyExisting);
    try {
      const { endpoint, pid, profileDirectory, userDataDir, reused } = connection;
      if (!pid || !connection.browser.connected) throw new Error('Chrome 连接已断开或无法核验启动进程 PID');
      if (!reused) {
        const identity: BrowserIdentity = { endpointHash: fingerprint(endpoint), pid, profileDirectory };
        await writeFile(join(userDataDir, RECEIPT_FILE), JSON.stringify(identity), 'utf8');
      }
      return { endpoint, pid, profileDirectory, userDataDir, reused };
    } catch (error) {
      if (!connection.reused) {
        try {
          await connection.browser.close();
        } catch (closeError) {
          throw new AggregateError([error, closeError], `Chrome 启动回执失败：${String(error)}；清理新进程失败：${String(closeError)}`);
        }
      }
      throw error;
    } finally {
      try {
        if (connection.browser.connected) await connection.browser.disconnect();
      } finally {
        clearSpawnedChromeProcessRef();
      }
    }
  }, 0);

  const verifyAlive = async () => {
    const current = await probeRemoteDebuggingWsEndpoint(REMOTE_DEBUGGING_PORT, 1_000);
    if (current !== session.endpoint) throw new Error(`Chrome 会话已退出或变更：port=${REMOTE_DEBUGGING_PORT} pid=${session.pid}`);
  };
  await verifyAlive();

  const stop = new AbortController();
  const onStop = () => stop.abort();
  process.on('SIGINT', onStop);
  process.on('SIGTERM', onStop);
  try {
    const report = { pid: session.pid, reused: session.reused, userDataDir: session.userDataDir, profileDirectory: session.profileDirectory };
    const startedAt = performance.now();
    emit(JSON.stringify({ status: 'ready', ...report, port: REMOTE_DEBUGGING_PORT, cdp: 'detached' }));
    while (!stop.signal.aborted) {
      try {
        await delay(HEALTH_CHECK_MS, undefined, { signal: stop.signal });
      } catch (error) {
        if (stop.signal.aborted) break;
        throw error;
      }
      await verifyAlive();
      if (stop.signal.aborted) break;
      emit(JSON.stringify({ status: 'alive', pid: report.pid, port: REMOTE_DEBUGGING_PORT, elapsedMs: Math.floor(performance.now() - startedAt) }));
    }
    return JSON.stringify({ status: 'stopped', pid: report.pid, port: REMOTE_DEBUGGING_PORT });
  } finally {
    process.off('SIGINT', onStop);
    process.off('SIGTERM', onStop);
  }
}
