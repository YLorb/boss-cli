import { spawn, spawnSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { createInterface } from 'node:readline';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

if (process.platform !== 'win32') throw new Error('此验收脚本用于 Windows 本机 PowerShell。');
const root = fileURLToPath(new URL('../', import.meta.url));
const reportFile = join(root, 'output', `chrome-lifecycle-${Date.now()}`, 'report.json');
const directory = dirname(reportFile);
const profile = join(directory, 'profile');
await mkdir(directory, { recursive: true });

const port = await new Promise((resolve, reject) => {
  const server = createServer();
  server.once('error', reject);
  server.listen(0, '127.0.0.1', () => {
    const port = server.address().port;
    server.close(error => error ? reject(error) : resolve(port));
  });
});
const child = spawn(process.execPath, [join(root, 'dist', 'cli', 'index.js'), 'browser-session', '--json'], {
  cwd: root,
  env: {
    ...process.env,
    BOSS_APP_HOME: join(directory, 'home'),
    BOSS_SKILL_DIR: join(root, 'skills', 'boss-recruitment'),
    BOSS_BROWSER_USER_DATA_DIR: profile,
    BOSS_BROWSER_PROFILE_DIRECTORY: 'Default',
    BOSS_BROWSER_REMOTE_DEBUGGING_PORT: String(port),
    BOSS_BROWSER_HEADLESS: 'true',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
  windowsHide: true,
});

const receipts = [];
let stderr = '';
let ready;
let detachedMs = 0;
let closed = false;
let timer;
let failure;
let cleanupFailure;
child.stderr.setEncoding('utf8');
child.stderr.on('data', data => { stderr += data; });

function stopIsolatedChrome(pid) {
  const command = [
    '$p = Get-CimInstance -ClassName Win32_Process -Filter ("ProcessId = " + $env:BOSS_TEST_CHROME_PID) -ErrorAction Stop',
    'if (!$p) { exit 0 }',
    'if ($p.Name -ne "chrome.exe" -or !$p.CommandLine -or !$p.CommandLine.Contains($env:BOSS_TEST_CHROME_PROFILE) -or !$p.CommandLine.Contains("--remote-debugging-port=" + $env:BOSS_TEST_CHROME_PORT)) { throw "隔离 Chrome 身份不符" }',
    'Stop-Process -Id $p.ProcessId -ErrorAction Stop',
  ].join('\n');
  const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], {
    env: {
      ...process.env,
      BOSS_TEST_CHROME_PID: String(pid),
      BOSS_TEST_CHROME_PROFILE: profile,
      BOSS_TEST_CHROME_PORT: String(port),
    },
    windowsHide: true, timeout: 10_000, encoding: 'utf8',
  });
  if (result.error || result.status !== 0) {
    throw new Error(`隔离 Chrome 清理失败：${result.error?.message ?? result.stderr}`);
  }
}

try {
  await new Promise((resolve, reject) => {
    timer = setTimeout(() => reject(new Error('165 秒内未取得 120 秒存活回执')), 165_000);
    child.once('error', reject);
    child.once('close', (code, signal) => {
      closed = true;
      reject(new Error(`常驻任务提前退出，code=${code} signal=${signal}`));
    });
    createInterface({ input: child.stdout }).on('line', line => {
      try {
        const receipt = JSON.parse(line);
        receipts.push(receipt);
        if (receipt.ok === false) throw new Error(receipt.error?.message ?? 'CLI 返回错误');
        if (receipt.status === 'ready') {
          if (ready || receipt.reused !== false || receipt.cdp !== 'detached' ||
              receipt.userDataDir !== profile || receipt.port !== port ||
              !Number.isSafeInteger(receipt.pid) || receipt.pid <= 0) {
            throw new Error('隔离 Chrome 就绪回执不符合预期');
          }
          ready = receipt;
          console.log(JSON.stringify(receipt));
        }
        if (receipt.status === 'alive') {
          if (!ready || receipt.pid !== ready.pid || receipt.port !== port ||
              !Number.isFinite(receipt.elapsedMs) || receipt.elapsedMs <= detachedMs) {
            throw new Error('存活回执的 PID、端口或计时不符');
          }
          detachedMs = receipt.elapsedMs;
          if (detachedMs >= 120_000) resolve();
        }
      } catch (error) {
        reject(error);
      }
    });
  });
} catch (error) {
  failure = error instanceof Error ? error.message : String(error);
} finally {
  clearTimeout(timer);
  if (!closed) child.kill();
  if (ready) {
    try { stopIsolatedChrome(ready.pid); }
    catch (error) { cleanupFailure = error.message; }
  }
}

const result = { passed: !failure && !cleanupFailure, detachedMs, port, reportFile, failure, cleanupFailure };
await writeFile(reportFile, JSON.stringify({ ...result, receipts, stderr }, null, 2));
console.log(JSON.stringify(result));
if (!result.passed) process.exitCode = 1;
