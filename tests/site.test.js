import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { GENESYS, DEPLOYMENT } from '../config.js';
import { messages } from '../i18n.js';
const root = new URL('../', import.meta.url);
test('GitHub Pages assets and callback resolve below the repository path', async () => {
  for (const path of ['index.html', 'oauth/callback.html']) {
    const source = await readFile(new URL(path, root), 'utf8');
    const base = new URL(path, DEPLOYMENT.siteUrl);
    for (const match of source.matchAll(/(?:src|href)="([^"?#]+)"/g)) {
      const resource = new URL(match[1], base);
      assert.ok(resource.href.startsWith(DEPLOYMENT.siteUrl), resource.href);
      if (/\.(css|js|svg)$/.test(resource.pathname)) await readFile(new URL(resource.pathname.slice(new URL(DEPLOYMENT.siteUrl).pathname.length), root));
    }
  }
  assert.equal(DEPLOYMENT.redirectUri, new URL('oauth/callback.html', DEPLOYMENT.siteUrl).href);
});
test('Greek and English contain the same labels', () => {
  assert.deepEqual(Object.keys(messages.el).sort(), Object.keys(messages.en).sort());
});
test('requested OAuth scopes match the verified endpoint contract', () => {
  assert.deepEqual(GENESYS.scopes, ['users', 'user-basic-info']);
});
test('callback strips code before processing and has a no-referrer policy', async () => {
  const html = await readFile(new URL('oauth/callback.html', root), 'utf8');
  const script = await readFile(new URL('oauth/callback.js', root), 'utf8');
  assert.match(html, /name="referrer" content="no-referrer"/);
  assert.ok(script.indexOf('history.replaceState') < script.indexOf('auth.exchange'));
  assert.doesNotMatch(script, /console\./);
});
