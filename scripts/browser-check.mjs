// Optional real-browser QA. Uses an installed Chromium browser; never uses a live Genesys token.
import { spawn } from 'node:child_process';
import { mkdir, writeFile, access } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { once } from 'node:events';
import assert from 'node:assert/strict';
import { serve } from './serve.mjs';
import { GENESYS, QUEUE_PROFILES } from '../config.js';
const root = resolve(import.meta.dirname, '..');
const qa = join(root, '.qa');
await mkdir(qa, { recursive: true });
const candidates = [process.env.CHROME_PATH, 'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', '/usr/bin/chromium', '/usr/bin/google-chrome'].filter(Boolean);
let executable;
for (const candidate of candidates) { try { await access(candidate); executable = candidate; break; } catch { /* Next installed browser. */ } }
if (!executable) throw new Error('Set CHROME_PATH to an installed Chromium browser.');
const server = serve(0);
await once(server, 'listening');
const base = `http://127.0.0.1:${server.address().port}/Genesys_Cloud-Custom-Queue-Activation/`;
const chrome = spawn(executable, ['--headless=new', '--disable-gpu', '--disable-background-networking', '--no-first-run', '--no-default-browser-check', '--remote-debugging-port=0', `--user-data-dir=${join(qa, `browser-${process.pid}`)}`, 'about:blank'], { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
let socket;
try {
  const endpoint = await new Promise((resolveEndpoint, reject) => {
    const timeout = setTimeout(() => reject(new Error('Browser startup timed out')), 20000);
    chrome.on('error', reject);
    chrome.stderr.on('data', chunk => {
      const match = chunk.toString().match(/DevTools listening on (ws:\/\/\S+)/);
      if (match) { clearTimeout(timeout); resolveEndpoint(new URL(match[1])); }
    });
  });
  const tabs = await (await fetch(`http://${endpoint.host}/json/list`)).json();
  socket = new WebSocket(tabs.find(tab => tab.type === 'page').webSocketDebuggerUrl);
  await new Promise((resolveOpen, reject) => { socket.addEventListener('open', resolveOpen, { once: true }); socket.addEventListener('error', reject, { once: true }); });
  let nextId = 0; const pending = new Map(); const errors = []; const liveRequests = [];
  socket.addEventListener('message', event => {
    const message = JSON.parse(event.data);
    if (message.id) {
      const item = pending.get(message.id); if (!item) return;
      pending.delete(message.id); clearTimeout(item.timeout);
      message.error ? item.reject(new Error(JSON.stringify(message.error))) : item.resolve(message.result);
    }
    if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails.text);
    if (message.method === 'Network.requestWillBeSent' && /https:\/\/(?:api|login)\.mypurecloud\.de/.test(message.params.request.url)) liveRequests.push(message.params.request.url);
  });
  const send = (method, params = {}) => new Promise((resolveResult, reject) => {
    const id = ++nextId;
    const timeout = setTimeout(() => { pending.delete(id); reject(new Error(`CDP timeout: ${method}`)); }, 15000);
    pending.set(id, { resolve: resolveResult, reject, timeout }); socket.send(JSON.stringify({ id, method, params }));
  });
  const evaluate = async expression => {
    const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
    return result.result.value;
  };
  const waitFor = async expression => {
    for (let i = 0; i < 100; i++) { if (await evaluate(expression)) return; await new Promise(resolveWait => setTimeout(resolveWait, 100)); }
    throw new Error(`Page condition timed out: ${expression}`);
  };
  const screenshot = async name => {
    const metrics = await send('Page.getLayoutMetrics');
    const { data } = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true,
      clip: { x: 0, y: 0, width: metrics.cssContentSize.width, height: metrics.cssContentSize.height, scale: 1 } });
    await writeFile(join(qa, name), Buffer.from(data, 'base64'));
  };
  await send('Runtime.enable'); await send('Network.enable'); await send('Page.enable');
  await send('Network.setBlockedURLs', { urls: ['https://api.mypurecloud.de/*', 'https://login.mypurecloud.de/*'] });
  await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 1000, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: base });
  await waitFor(`document.querySelectorAll('[data-profile]').length === 3`);
  assert.equal(await evaluate(`document.documentElement.lang`), 'el');
  assert.equal(await evaluate(`[...document.querySelectorAll('[data-profile]')].every(b => b.disabled)`), true);
  await screenshot('signin-desktop.png');
  await send('Page.navigate', { url: `${base}?demo=1` });
  await waitFor(`document.querySelector('#current-profile')?.textContent === 'Eparchia' && !document.querySelector('[data-profile]').disabled`);
  await screenshot('demo-desktop.png');
  await evaluate(`document.querySelector('[data-profile="Athina01"]').click(); document.querySelector('[data-profile="Thessaloniki01"]').click()`);
  await waitFor(`document.querySelector('#current-profile')?.textContent === 'Athina01' && !document.querySelector('[data-profile]').disabled`);
  assert.equal(await evaluate(`document.querySelectorAll('#queue-list .active').length`), 3);
  assert.equal(await evaluate(`document.querySelectorAll('#all-queue-list .active').length`), 3);
  await evaluate(`document.querySelector('#language').value = 'en'; document.querySelector('#language').dispatchEvent(new Event('change')); document.querySelector('#theme').click()`);
  assert.equal(await evaluate(`document.documentElement.lang`), 'en');
  await screenshot('demo-dark.png');
  await send('Emulation.setDeviceMetricsOverride', { width: 375, height: 812, deviceScaleFactor: 1, mobile: true });
  assert.equal(await evaluate(`document.documentElement.scrollWidth <= innerWidth`), true, 'Mobile must not overflow horizontally');
  await screenshot('demo-mobile.png');

  // Exercise the real UI/controller/API connection with fetch mocked before module evaluation.
  const mockQueues = Object.entries(QUEUE_PROFILES).flatMap(([name, queues]) => queues.map(q => ({ ...q, joined: name === 'Eparchia' })));
  const fakeUser = { id: '11111111-2222-4333-8444-555555555555', name: 'Browser Test Agent' };
  await send('Page.addScriptToEvaluateOnNewDocument', { source: `
    sessionStorage.setItem('queue-profiles.session.v1:${GENESYS.clientId}', JSON.stringify({ accessToken: 'mock-browser-only', expiresAt: Date.now() + 3600000 }));
    window.mockQueues = ${JSON.stringify(mockQueues)};
    window.patchCount = 0;
    window.mockFailure = null;
    window.fetch = async (url, options = {}) => {
      if (!String(url).startsWith('https://api.mypurecloud.de/')) throw new Error('Unexpected network request');
      if (url.endsWith('/users/me')) return Response.json(${JSON.stringify(fakeUser)});
      if (options.method === 'PATCH') {
        window.patchCount++;
        if (window.mockFailure) return new Response('', { status: window.mockFailure });
        for (const change of JSON.parse(options.body)) window.mockQueues.find(q => q.id === change.id).joined = change.joined;
        return Response.json({});
      }
      const joined = new URL(url).searchParams.get('joined') === 'true';
      const entities = window.mockQueues.filter(q => q.joined === joined);
      return Response.json({ entities, total: entities.length, pageNumber: 1, pageCount: 1 });
    };
  ` });
  await send('Page.navigate', { url: base });
  await waitFor(`document.querySelector('#agent-name')?.textContent === 'Browser Test Agent' && !document.querySelector('[data-profile]').disabled`);
  await evaluate(`document.querySelector('[data-profile="Thessaloniki01"]').click()`);
  await waitFor(`document.querySelector('#current-profile')?.textContent === 'Thessaloniki01' && !document.querySelector('[data-profile]').disabled`);
  assert.equal(await evaluate('window.patchCount'), 1);
  await evaluate(`document.querySelector('[data-profile="Thessaloniki01"]').click()`);
  await waitFor(`document.querySelector('#notice')?.textContent.includes('No update was needed')`);
  assert.equal(await evaluate('window.patchCount'), 1);
  await evaluate(`window.mockQueues = window.mockQueues.filter(q => q.id !== '${QUEUE_PROFILES.Athina01[0].id}'); document.querySelector('[data-profile="Athina01"]').click()`);
  await waitFor(`document.querySelector('#notice')?.textContent.includes('Athina_Argiroupoli')`);
  assert.equal(await evaluate('window.patchCount'), 1);
  await evaluate(`window.mockFailure = 403; document.querySelector('[data-profile="Eparchia"]').click()`);
  await waitFor(`document.querySelector('#notice')?.textContent.includes('Insufficient permissions')`);
  assert.equal(await evaluate(`document.querySelector('#current-profile').textContent`), 'Thessaloniki01');
  await evaluate(`document.querySelector('#signout').click()`);
  assert.equal(await evaluate(`document.querySelector('#login-panel').hidden`), false);
  assert.equal(await evaluate(`sessionStorage.getItem('queue-profiles.session.v1:${GENESYS.clientId}')`), null);
  assert.deepEqual(errors, [], 'No browser runtime errors');
  assert.deepEqual(liveRequests, [], 'QA must not attempt live Genesys requests');
  console.log('Browser QA passed: login, Greek/English, demo switches, duplicate click, themes, 375px mobile, mocked API switch, no-op, missing membership, 403 reconciliation, sign-out, subdirectory assets. No live Genesys requests.');
  console.log(`Screenshots: ${qa}`);
} finally {
  socket?.close(); chrome.kill(); server.close();
}
