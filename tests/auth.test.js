import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { Auth, AUTH_MESSAGE, createTransaction, validateCallback, isTrustedMessage } from '../auth.js';
import { GENESYS, DEPLOYMENT } from '../config.js';
const storage = () => {
  const data = new Map();
  return { getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, value), removeItem: key => data.delete(key), data };
};
const win = () => ({ location: { origin: new URL(DEPLOYMENT.siteUrl).origin }, sessionStorage: storage(), crypto: webcrypto });

test('default token transport preserves the browser fetch receiver', async t => {
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async function () {
    assert.equal(this, globalThis, 'Native Window.fetch requires the global receiver');
    calls++;
    return Response.json({ access_token: 'test-only', token_type: 'bearer', expires_in: 3600 });
  });
  const auth = new Auth(GENESYS, DEPLOYMENT, win());
  const tx = await createTransaction(webcrypto, DEPLOYMENT.redirectUri);
  await auth.exchange(tx, new URLSearchParams({ state: tx.state, code: 'test-code' }));
  assert.equal(auth.token(), 'test-only');
  assert.equal(calls, 1);
});

test('PKCE uses high-entropy random nonces and SHA-256', async () => {
  const first = await createTransaction(webcrypto, DEPLOYMENT.redirectUri);
  const second = await createTransaction(webcrypto, DEPLOYMENT.redirectUri);
  assert.match(first.verifier, /^[A-Za-z0-9_-]{86}$/); assert.match(first.state, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(Buffer.from(await webcrypto.subtle.digest('SHA-256', new TextEncoder().encode(first.verifier))).toString('base64url'), first.challenge);
  assert.notEqual(first.state, second.state); assert.notEqual(first.verifier, second.verifier);
});
test('OAuth rejects wrong, missing, duplicate and stale state', async () => {
  const tx = await createTransaction(webcrypto, DEPLOYMENT.redirectUri);
  for (const query of ['code=x', 'state=wrong&code=x', `state=${tx.state}&state=${tx.state}&code=x`]) {
    assert.throws(() => validateCallback(tx, new URLSearchParams(query)), { code: 'oauthState' });
  }
  assert.throws(() => validateCallback(tx, new URLSearchParams({ state: tx.state, code: 'x' }), tx.createdAt + 600001), { code: 'oauthState' });
  assert.throws(() => validateCallback(tx, new URLSearchParams({ state: tx.state, error: 'access_denied' })), { code: 'oauthDenied' });
});
test('popup messaging validates origin, source, message type and state', () => {
  const popup = {}; const event = { source: popup, origin: 'https://example.org', data: { type: AUTH_MESSAGE, state: 'nonce' } };
  assert.equal(isTrustedMessage(event, popup, event.origin, 'nonce'), true);
  for (const bad of [{ ...event, source: {} }, { ...event, origin: 'https://evil.example' }, { ...event, data: { type: AUTH_MESSAGE, state: 'bad' } }]) {
    assert.equal(isTrustedMessage(bad, popup, event.origin, 'nonce'), false);
  }
});
test('blocked popup returns actionable error without starting authorization', async () => {
  const browser = win(); browser.open = () => null;
  const auth = new Auth(GENESYS, DEPLOYMENT, browser, () => { throw new Error('No calls expected'); });
  await assert.rejects(auth.loginPopup(), { code: 'popupBlocked' }); assert.equal(auth.busy, false);
});
test('token exchange uses exact redirect, form encoding and no secret; session restores on reload', async () => {
  const browser = win(); let sent;
  const auth = new Auth(GENESYS, DEPLOYMENT, browser, async (url, options) => {
    sent = { url, options }; return Response.json({ access_token: 'test-only', token_type: 'bearer', expires_in: 3600, refresh_token: 'discard-me' });
  });
  const tx = await createTransaction(webcrypto, DEPLOYMENT.redirectUri);
  await auth.exchange(tx, new URLSearchParams({ state: tx.state, code: 'test-code' }));
  assert.equal(sent.url, 'https://login.mypurecloud.de/oauth/token');
  assert.equal(sent.options.body.get('redirect_uri'), DEPLOYMENT.redirectUri);
  assert.equal(sent.options.body.get('code_verifier'), tx.verifier); assert.equal(sent.options.body.has('client_secret'), false);
  assert.equal(new Auth(GENESYS, DEPLOYMENT, browser).token(), 'test-only');
  assert.equal(JSON.stringify([...browser.sessionStorage.data.values()]).includes('discard-me'), false);
  auth.logout(); assert.equal(browser.sessionStorage.data.size, 0);
});
test('wrong callback state never reaches token endpoint', async () => {
  let calls = 0; const auth = new Auth(GENESYS, DEPLOYMENT, win(), async () => { calls++; });
  const tx = await createTransaction(webcrypto, DEPLOYMENT.redirectUri);
  await assert.rejects(auth.exchange(tx, new URLSearchParams({ state: 'bad', code: 'x' })), { code: 'oauthState' }); assert.equal(calls, 0);
});
test('expired token is cleared and fails before any API request', () => {
  const auth = new Auth(GENESYS, DEPLOYMENT, win()); auth.session = { accessToken: 'expired', expiresAt: Date.now() - 1 };
  assert.throws(() => auth.token(), { code: 'expired' }); assert.equal(auth.session, null);
});
test('redirect is same-origin and exact, not configurable by query parameters', () => {
  const browser = win(); browser.location.origin = 'https://attacker.example';
  assert.throws(() => new Auth(GENESYS, DEPLOYMENT, browser).assertOrigin(), { code: 'redirectConfig' });
});
test('memory-only popup sessions work when iframe sessionStorage is blocked', async () => {
  const browser = win(); Object.defineProperty(browser, 'sessionStorage', { get() { throw new Error('blocked'); } });
  const auth = new Auth(GENESYS, DEPLOYMENT, browser, async () => Response.json({ access_token: 'test-only', token_type: 'bearer', expires_in: 60 }));
  const tx = await createTransaction(webcrypto, DEPLOYMENT.redirectUri);
  await auth.exchange(tx, new URLSearchParams({ state: tx.state, code: 'test-code' })); assert.equal(auth.token(), 'test-only');
  auth.logout(); assert.equal(auth.hasSession(), false);
});

test('complete popup flow validates the message, exchanges once, closes popup and removes listener', async () => {
  const browser = win(); let listener; let calls = 0;
  browser.addEventListener = (_, fn) => { listener = fn; };
  browser.removeEventListener = () => { listener = null; };
  const popup = { closed: false, close() { this.closed = true; }, location: { replace(url) {
    const state = new URL(url).searchParams.get('state');
    queueMicrotask(async () => {
      await listener({ source: {}, origin: browser.location.origin, data: { type: AUTH_MESSAGE, state, code: 'forged' } });
      assert.equal(calls, 0);
      await listener({ source: popup, origin: browser.location.origin, data: { type: AUTH_MESSAGE, state, code: 'mock-code' } });
    });
  } } };
  browser.open = () => popup;
  const auth = new Auth(GENESYS, DEPLOYMENT, browser, async () => { calls++; return Response.json({ access_token: 'test-only', token_type: 'bearer', expires_in: 3600 }); });
  await auth.loginPopup();
  assert.equal(auth.token(), 'test-only'); assert.equal(calls, 1); assert.equal(popup.closed, true);
  assert.equal(listener, null); assert.equal(auth.busy, false);
});

test('a token response arriving after sign-out cannot recreate the session', async () => {
  let release;
  const pending = new Promise(resolve => { release = resolve; });
  const auth = new Auth(GENESYS, DEPLOYMENT, win(), () => pending);
  const tx = await createTransaction(webcrypto, DEPLOYMENT.redirectUri);
  const exchange = auth.exchange(tx, new URLSearchParams({ state: tx.state, code: 'mock-code' }));
  auth.logout(); release(Response.json({ access_token: 'late', token_type: 'bearer', expires_in: 3600 }));
  await assert.rejects(exchange, { code: 'oauthTimeout' }); assert.equal(auth.session, null);
});
