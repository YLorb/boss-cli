import assert from 'node:assert/strict';
import test, { mock } from 'node:test';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import puppeteer from 'puppeteer-core';

const cdp = await import('../dist/browser/cdp_browser.js');
const port = cdp.REMOTE_DEBUGGING_PORT;
const endpoint = `ws://127.0.0.1:${port}/devtools/browser/synthetic`;

test('CDP probing distinguishes a vacant port from inaccessible or invalid endpoints', async t => {
  let response;
  t.mock.method(globalThis, 'fetch', async () => response());
  response = () => { throw new TypeError('fetch failed', { cause: Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' }) }); };
  assert.equal(await cdp.probeRemoteDebuggingWsEndpoint(port, 200), undefined);
  response = () => { throw new TypeError('fetch failed', { cause: Object.assign(new Error('connect EACCES'), { code: 'EACCES' }) }); };
  await assert.rejects(cdp.probeRemoteDebuggingWsEndpoint(port, 200), /EACCES/);
  response = () => ({ ok: false, status: 401 });
  await assert.rejects(cdp.probeRemoteDebuggingWsEndpoint(port, 200), /HTTP 401/);
  response = () => ({ ok: true, json: async () => ({ webSocketDebuggerUrl: 'ws://unverified.test/devtools/browser/unknown' }) });
  await assert.rejects(cdp.probeRemoteDebuggingWsEndpoint(port, 200), /地址与本机/);
  response = () => ({ ok: true, json: async () => ({ webSocketDebuggerUrl: endpoint }) });
  assert.equal(await cdp.probeRemoteDebuggingWsEndpoint(port, 200), endpoint);
});

test('business connection reports an absent session and attaches only when Chrome is ready', async t => {
  let ready = false;
  t.mock.method(globalThis, 'fetch', async () => {
    if (!ready) throw new TypeError('fetch failed', { cause: Object.assign(new Error('ECONNREFUSED'), { code: 'ECONNREFUSED' }) });
    return { ok: true, json: async () => ({ webSocketDebuggerUrl: endpoint }) };
  });
  const attached = { connected: true };
  const connect = t.mock.method(puppeteer, 'connect', async options => {
    assert.equal(options.browserWSEndpoint, endpoint);
    return attached;
  });
  await assert.rejects(cdp.connectBrowser(), /Chrome 会话未就绪.*browser-session --json/);
  assert.equal(connect.mock.callCount(), 0);
  ready = true;
  assert.equal(await cdp.connectBrowser(), attached);
  assert.equal(connect.mock.callCount(), 1);
});

const directory = await mkdtemp(join(tmpdir(), 'boss-browser-session-'));
const profile = join(directory, 'profile');
await mkdir(profile);
let locked = false;
let reused = false;
let disconnects = 0;
let probes = 0;
let liveEndpoint;
const browser = {
  connected: true,
  disconnect: async () => { assert.equal(locked, true); disconnects++; },
  close: async () => { throw new Error('test browser should not be closed'); },
};
mock.module('../dist/common/boss_session_lock.js', { namedExports: {
  withBossSessionLock: async (work, waitMs) => {
    assert.equal(waitMs, 0);
    locked = true;
    try { return await work(); } finally { locked = false; }
  },
} });
mock.module('../dist/browser/cdp_browser.js', { namedExports: {
  ...cdp,
  connectBrowserWithMetadata: async (_, verifyReuse) => {
    const pid = reused ? await verifyReuse(endpoint, profile, 'Default') : 321;
    return { browser, endpoint, pid, reused, userDataDir: profile, profileDirectory: 'Default' };
  },
  probeRemoteDebuggingWsEndpoint: async () => {
    assert.equal(locked, false);
    probes++;
    return liveEndpoint;
  },
  clearSpawnedChromeProcessRef: () => {},
} });
mock.module('node:timers/promises', { namedExports: { setTimeout: async () => {} } });
const { runBrowserSession } = await import('../dist/cli/browser-session.js');

test('Chrome supervision reports health after disconnect and releases the startup lock', async () => {
  liveEndpoint = endpoint;
  const events = [];
  const stopped = JSON.parse(await runBrowserSession(line => {
    const event = JSON.parse(line);
    events.push(event);
    assert.equal(locked, false);
    assert.equal(disconnects, 1);
    if (event.status === 'alive') process.emit('SIGTERM');
  }));
  assert.deepEqual(events.map(event => event.status), ['ready', 'alive']);
  assert.equal(events[0].cdp, 'detached');
  assert.equal(stopped.status, 'stopped');
  assert.equal(probes, 2);
  const identity = JSON.parse(await readFile(join(profile, '.boss-cli-browser-session.json'), 'utf8'));
  assert.equal(identity.pid, 321);
  assert.equal(identity.endpoint, undefined);
});

test('existing verified Chrome is reused and a changed endpoint stops monitoring', async () => {
  reused = true;
  liveEndpoint = endpoint;
  const events = [];
  await assert.rejects(runBrowserSession(line => {
    events.push(JSON.parse(line));
    liveEndpoint = undefined;
  }), /已退出或变更/);
  assert.equal(events[0].reused, true);
  assert.equal(events[0].pid, 321);
  assert.equal(disconnects, 2);
});

test('the command refuses reuse when the saved browser identity does not match', async () => {
  await writeFile(join(profile, '.boss-cli-browser-session.json'), '{"endpointHash":"different","pid":321,"profileDirectory":"Default"}');
  await assert.rejects(runBrowserSession(() => assert.fail('unverified instance must not emit ready')), /记录不符/);
  assert.equal(disconnects, 2);
});
