import { AppError, UUID, queueMap } from './profiles.js';
import { QUEUE_PROFILES } from './config.js';

export function retryAfterMs(value, now = Date.now()) {
  if (value !== null && value !== '' && Number.isFinite(Number(value)) && Number(value) >= 0) return Number(value) * 1000;
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(0, date - now) : 60000;
}

export class GenesysApi {
  #userId = null;
  #memberships = null;
  // Native Window.fetch rejects calls with a GenesysApi instance as its receiver.
  constructor(config, getToken, { fetcher = (...args) => globalThis.fetch(...args), sleep = ms => new Promise(resolve => setTimeout(resolve, ms)), now = Date.now } = {}) {
    this.config = config; this.getToken = getToken; this.fetcher = fetcher; this.sleep = sleep; this.now = now;
    this.retryAt = 0;
  }

  async request(path, { method = 'GET', body } = {}) {
    for (let attempt = 0; attempt < 3; attempt++) {
      const token = this.getToken();
      const remaining = this.retryAt - this.now();
      if (remaining > 0) {
        if (method === 'GET' && remaining <= 5000) await this.sleep(remaining);
        else throw new AppError('rateLimit', { status: 429, retryAt: this.retryAt });
      }
      let response;
      try {
        response = await this.fetcher(`${this.config.apiUrl}${path}`, {
          method, credentials: 'omit', cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(20000),
          headers: { Authorization: `Bearer ${token}`, Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}) },
          ...(body ? { body: JSON.stringify(body) } : {}),
        });
      } catch { throw new AppError('network'); }
      if (response.status === 429) {
        this.retryAt = this.now() + retryAfterMs(response.headers.get('Retry-After'), this.now());
        if (method === 'GET' && attempt < 2 && this.retryAt - this.now() <= 5000) continue;
        throw new AppError('rateLimit', { status: 429, retryAt: this.retryAt });
      }
      if (!response.ok) {
        const code = { 400: 'badRequest', 401: 'expired', 403: 'forbidden', 404: 'notFound', 408: 'network' }[response.status] ?? (response.status >= 500 ? 'service' : 'unexpected');
        throw new AppError(code, { status: response.status });
      }
      if (method === 'PATCH') return; // Response may precede actual activation; controller verifies with GET.
      try { return await response.json(); } catch { throw new AppError('response'); }
    }
    throw new AppError('rateLimit', { status: 429, retryAt: this.retryAt });
  }

  async getMe() {
    this.#userId = null; this.#memberships = null;
    const user = await this.request('/api/v2/users/me');
    if (!user || !UUID.test(user.id) || typeof user.name !== 'string' || !user.name) throw new AppError('response');
    this.#userId = user.id;
    return { id: user.id, name: user.name };
  }

  #path() {
    if (!this.#userId) throw new AppError('expired', { status: 401 });
    return `/api/v2/users/${encodeURIComponent(this.#userId)}/queues`;
  }

  async getQueues() {
    const path = this.#path();
    this.#memberships = null;
    const all = [];
    for (const joined of [true, false]) {
      let expectedTotal;
      let count = 0;
      let complete = false;
      for (let page = 1; page <= 1000; page++) {
        const query = new URLSearchParams({ pageSize: '100', pageNumber: String(page), joined: String(joined) });
        const result = await this.request(`${path}?${query}`);
        if (!result || !Array.isArray(result.entities) ||
            (result.pageNumber !== undefined && result.pageNumber !== page) ||
            (result.pageCount !== undefined && (!Number.isInteger(result.pageCount) || result.pageCount < 0))) throw new AppError('response');
        queueMap(result.entities);
        if (result.entities.some(q => q.joined !== joined)) throw new AppError('response');
        if (result.total !== undefined) {
          if (!Number.isInteger(result.total) || result.total < 0 || (expectedTotal !== undefined && result.total !== expectedTotal)) throw new AppError('response');
          expectedTotal = result.total;
        }
        all.push(...result.entities); count += result.entities.length;
        // Duplicate IDs also catch repeated pages and inconsistent active/inactive snapshots.
        queueMap(all);
        if (expectedTotal !== undefined && count > expectedTotal) throw new AppError('response');
        const hasMore = result.nextUri || (result.pageCount !== undefined ? page < result.pageCount : expectedTotal !== undefined ? count < expectedTotal : result.entities.length >= (result.pageSize || 100));
        if (!hasMore) {
          if (expectedTotal !== undefined && count !== expectedTotal) throw new AppError('response');
          complete = true; break;
        }
        if (!result.entities.length) throw new AppError('response');
      }
      if (!complete) throw new AppError('response');
    }
    this.#memberships = queueMap(all);
    return all;
  }

  async patchQueues(changes) {
    const path = this.#path();
    if (!Array.isArray(changes) || !this.#memberships) throw new AppError('refreshRequired');
    const managed = new Set(Object.values(QUEUE_PROFILES).flat().map(q => q.id));
    const ids = new Set();
    for (const change of changes) {
      if (!change || !managed.has(change.id) || !this.#memberships.has(change.id) ||
          typeof change.joined !== 'boolean' || ids.has(change.id) ||
          Object.keys(change).some(key => !['id', 'joined'].includes(key))) throw new AppError('configuration');
      ids.add(change.id);
    }
    if (!changes.length) return;
    this.#memberships = null;
    await this.request(path, { method: 'PATCH', body: changes });
  }
}
