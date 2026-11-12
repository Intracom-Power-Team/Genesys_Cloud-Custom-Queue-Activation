import { AppError } from './profiles.js';

export const AUTH_MESSAGE = 'genesys.queue-profiles.oauth.v1';
const SESSION_KEY = 'queue-profiles.session.v1';
const PENDING_KEY = 'queue-profiles.pkce.v1';
const MAX_AUTH_AGE = 10 * 60 * 1000;
const base64url = bytes => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

export async function createTransaction(crypto, redirectUri, now = Date.now()) {
  const verifier = base64url(crypto.getRandomValues(new Uint8Array(64)));
  const state = base64url(crypto.getRandomValues(new Uint8Array(32)));
  const challenge = base64url(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)));
  return { verifier, state, challenge, redirectUri, createdAt: now };
}

export function validateCallback(transaction, params, now = Date.now()) {
  if (!transaction || typeof transaction.state !== 'string' || !transaction.state ||
      params.getAll('state').length !== 1 || params.get('state') !== transaction.state ||
      !Number.isFinite(transaction.createdAt) || now < transaction.createdAt || now - transaction.createdAt > MAX_AUTH_AGE) {
    throw new AppError('oauthState');
  }
  if (params.has('error')) throw new AppError('oauthDenied');
  if (params.getAll('code').length !== 1 || !params.get('code')) throw new AppError('oauthCode');
  return params.get('code');
}

export function isTrustedMessage(event, popup, origin, state) {
  return !!popup && event.source === popup && event.origin === origin &&
    event.data?.type === AUTH_MESSAGE && event.data?.state === state;
}

export class Auth {
  constructor(config, deployment, win = window, fetcher = fetch) {
    this.config = config;
    this.deployment = deployment;
    this.win = win;
    this.fetcher = fetcher;
    this.session = null;
    this.generation = 0;
    this.busy = false;
    this.cancelPending = null;
    this.key = `${SESSION_KEY}:${config.clientId}`;
    try {
      const saved = JSON.parse(win.sessionStorage.getItem(this.key));
      if (typeof saved?.accessToken === 'string' && Number.isFinite(saved.expiresAt) && saved.expiresAt > Date.now()) this.session = saved;
      else win.sessionStorage.removeItem(this.key);
    } catch { /* Storage may be blocked in a third-party frame. Memory still works. */ }
  }

  token() {
    if (!this.session || this.session.expiresAt <= Date.now()) {
      this.clear();
      throw new AppError('expired', { status: 401 });
    }
    return this.session.accessToken;
  }

  hasSession() { return !!this.session && this.session.expiresAt > Date.now(); }

  clear() {
    this.generation++;
    this.session = null;
    try { this.win.sessionStorage.removeItem(this.key); this.win.sessionStorage.removeItem(PENDING_KEY); } catch { /* Memory cleared. */ }
  }

  logout() { this.cancelPending?.(); this.clear(); }

  assertOrigin() {
    const redirect = new URL(this.deployment.redirectUri);
    if (redirect.origin !== this.win.location.origin || redirect.search || redirect.hash ||
      (redirect.protocol !== 'https:' && !['localhost', '127.0.0.1'].includes(redirect.hostname))) {
      throw new AppError('redirectConfig');
    }
  }

  authorizeUrl(transaction) {
    const url = new URL('/oauth/authorize', this.config.loginUrl);
    url.search = new URLSearchParams({ response_type: 'code', client_id: this.config.clientId,
      redirect_uri: transaction.redirectUri, code_challenge: transaction.challenge,
      code_challenge_method: 'S256', state: transaction.state, scope: this.config.scopes.join(' ') }).toString();
    return url.href;
  }

  async exchange(transaction, params, isCurrent = () => true) {
    const generation = this.generation;
    this.assertOrigin();
    if (transaction?.redirectUri !== this.deployment.redirectUri) throw new AppError('redirectConfig');
    const code = validateCallback(transaction, params);
    let response;
    try {
      response = await this.fetcher(`${this.config.loginUrl}/oauth/token`, {
        method: 'POST', credentials: 'omit', cache: 'no-store', redirect: 'error',
        signal: AbortSignal.timeout(20000), headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ grant_type: 'authorization_code', client_id: this.config.clientId,
          redirect_uri: transaction.redirectUri, code, code_verifier: transaction.verifier }),
      });
    } catch { throw new AppError('oauthNetwork'); }
    if (!response.ok) throw new AppError('oauthExchange', { status: response.status });
    const body = await response.json().catch(() => null);
    if (typeof body?.access_token !== 'string' || !body.access_token ||
        !Number.isFinite(body.expires_in) || body.expires_in <= 0 || String(body.token_type).toLowerCase() !== 'bearer') {
      throw new AppError('response');
    }
    if (generation !== this.generation || !isCurrent()) throw new AppError('oauthTimeout');
    // Keep only the access token, never a refresh token. Use actual server expiry with a small safety margin.
    this.session = { accessToken: body.access_token, expiresAt: Date.now() + Math.max(1, body.expires_in - 30) * 1000 };
    try { this.win.sessionStorage.setItem(this.key, JSON.stringify(this.session)); } catch { /* Memory-only session. */ }
  }

  async loginPopup() {
    if (this.busy) throw new AppError('busy');
    this.assertOrigin();
    this.busy = true;
    // Must open synchronously inside the user click, before awaiting Web Crypto.
    let popup;
    try { popup = this.win.open('about:blank', '_blank', 'popup,width=540,height=730'); } catch { /* Sandbox blocked. */ }
    if (!popup) { this.busy = false; throw new AppError('popupBlocked'); }
    try {
      const transaction = await createTransaction(this.win.crypto, this.deployment.redirectUri);
      await new Promise((resolve, reject) => {
        let settled = false;
        let exchanging = false;
        const cleanup = () => {
          this.win.removeEventListener('message', listener);
          clearInterval(poll); clearTimeout(timeout); this.cancelPending = null;
          try { popup.close(); } catch { /* Already closed. */ }
        };
        const finish = error => {
          if (settled) return;
          settled = true; cleanup(); error ? reject(error) : resolve();
        };
        const listener = async event => {
          if (settled || exchanging || !isTrustedMessage(event, popup, this.win.location.origin, transaction.state)) return;
          exchanging = true;
          const params = new URLSearchParams({ state: event.data.state });
          if (typeof event.data.error === 'string') params.set('error', event.data.error);
          if (typeof event.data.code === 'string') params.set('code', event.data.code);
          try { await this.exchange(transaction, params, () => !settled); finish(); }
          catch (error) { finish(error); }
        };
        this.win.addEventListener('message', listener);
        const poll = setInterval(() => { if (!exchanging && popup.closed) finish(new AppError('popupClosed')); }, 500);
        const timeout = setTimeout(() => finish(new AppError('oauthTimeout')), MAX_AUTH_AGE);
        this.cancelPending = () => finish(new AppError('popupClosed'));
        try { popup.location.replace(this.authorizeUrl(transaction)); } catch { finish(new AppError('popupBlocked')); }
      });
    } finally {
      this.busy = false;
      try { popup.close(); } catch { /* No-op. */ }
    }
  }

  async loginRedirect() {
    if (this.busy) throw new AppError('busy');
    if (this.win.self !== this.win.top) throw new AppError('standaloneOnly');
    this.assertOrigin(); this.busy = true;
    try {
      const transaction = await createTransaction(this.win.crypto, this.deployment.redirectUri);
      try { this.win.sessionStorage.setItem(PENDING_KEY, JSON.stringify(transaction)); }
      catch { throw new AppError('storage'); }
      this.win.location.assign(this.authorizeUrl(transaction));
    } finally { this.busy = false; }
  }

  takeRedirectTransaction() {
    let transaction;
    try {
      transaction = JSON.parse(this.win.sessionStorage.getItem(PENDING_KEY));
      this.win.sessionStorage.removeItem(PENDING_KEY);
    } catch { throw new AppError('storage'); }
    return transaction;
  }
}
