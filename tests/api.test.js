import test from 'node:test';
import assert from 'node:assert/strict';
import { GenesysApi, retryAfterMs } from '../genesys-api.js';
import { GENESYS, QUEUE_PROFILES } from '../config.js';
const user = { id: '11111111-2222-4333-8444-555555555555', name: 'Test Agent' };
const queues = Object.entries(QUEUE_PROFILES).flatMap(([name, list]) => list.map(q => ({ ...q, joined: name === 'Eparchia' })));
const listing = (entities, extra = {}) => ({ entities, pageNumber: 1, pageCount: 1, total: entities.length, ...extra });
function fixture(handler = () => undefined) {
  const calls = [];
  const fetcher = async (url, options) => {
    calls.push({ url: new URL(url), options });
    const custom = await handler(new URL(url), options, calls);
    if (custom) return custom;
    if (url.endsWith('/users/me')) return Response.json(user);
    if (options.method === 'PATCH') return Response.json({});
    return Response.json(listing(queues.filter(q => String(q.joined) === new URL(url).searchParams.get('joined'))));
  };
  return { calls, api: new GenesysApi(GENESYS, () => 'mock-token', { fetcher }) };
}

test('identity is obtained only from /users/me; reads explicitly include active and inactive memberships', async () => {
  const { api, calls } = fixture(); await api.getMe(); const result = await api.getQueues();
  assert.equal(result.length, 9);
  assert.deepEqual(calls.slice(1).map(c => c.url.searchParams.get('joined')), ['true', 'false']);
  assert.ok(calls.slice(1).every(c => c.url.pathname === `/api/v2/users/${user.id}/queues`));
  assert.equal(calls[0].options.headers.Authorization, 'Bearer mock-token');
});
test('all pages of both filters are read; external nextUri is never followed', async () => {
  const f = fixture((url, options) => {
    if (!url.pathname.endsWith('/queues')) return;
    const joined = url.searchParams.get('joined') === 'true';
    const filtered = queues.filter(q => q.joined === joined);
    const page = Number(url.searchParams.get('pageNumber'));
    const entities = filtered.slice((page - 1) * 2, page * 2);
    return Response.json(listing(entities, { total: filtered.length, pageSize: 2, pageNumber: page, pageCount: Math.ceil(filtered.length / 2), nextUri: page * 2 < filtered.length ? 'https://evil.example/steal' : undefined }));
  });
  await f.api.getMe(); assert.equal((await f.api.getQueues()).length, 9);
  assert.equal(f.calls.length, 6); assert.ok(f.calls.every(c => c.url.origin === GENESYS.apiUrl));
});
test('duplicate/repeated pages and malformed responses fail closed', async () => {
  for (const body of [{ entities: 'bad' }, listing([{ ...queues[0], joined: 'true' }]), listing([queues[0], queues[0]])]) {
    const f = fixture(url => url.pathname.endsWith('/queues') ? Response.json(body) : undefined);
    await f.api.getMe(); await assert.rejects(f.api.getQueues(), { code: 'response' });
  }
});
test('changing totals during pagination fail closed', async () => {
  const f = fixture(url => {
    if (!url.pathname.endsWith('/queues')) return;
    const page = Number(url.searchParams.get('pageNumber'));
    return Response.json(listing([queues[page - 1]], { pageNumber: page, pageCount: 3, total: page === 1 ? 3 : 4 }));
  });
  await f.api.getMe(); await assert.rejects(f.api.getQueues(), { code: 'response' });
});
test('API layer also rejects unmanaged IDs and non-activation fields', async () => {
  const f = fixture(); await f.api.getMe(); await f.api.getQueues();
  await assert.rejects(f.api.patchQueues([{ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', joined: false }]), { code: 'configuration' });
  await assert.rejects(f.api.patchQueues([{ id: queues[0].id, joined: false, name: 'changed' }]), { code: 'configuration' });
  assert.equal(f.calls.filter(c => c.options.method === 'PATCH').length, 0);
});
test('PATCH sends minimal body and requires another read before a second update', async () => {
  const f = fixture(); await f.api.getMe(); await f.api.getQueues();
  const changes = [{ id: queues[0].id, joined: false }]; await f.api.patchQueues(changes);
  assert.deepEqual(JSON.parse(f.calls.at(-1).options.body), changes);
  await assert.rejects(f.api.patchQueues(changes), { code: 'refreshRequired' });
});
test('PATCH rate limiting never blindly retries and honors Retry-After across subsequent calls', async () => {
  const f = fixture((url, options) => options.method === 'PATCH' ? new Response('', { status: 429, headers: { 'Retry-After': '120' } }) : undefined);
  await f.api.getMe(); await f.api.getQueues();
  await assert.rejects(f.api.patchQueues([{ id: queues[0].id, joined: false }]), error => error.code === 'rateLimit' && error.retryAt > Date.now() + 118000);
  const callCount = f.calls.length; await assert.rejects(f.api.getQueues(), { code: 'rateLimit' });
  assert.equal(f.calls.length, callCount); assert.equal(f.calls.filter(c => c.options.method === 'PATCH').length, 1);
});
test('short GET rate limit retries after the required interval', async () => {
  let time = 1000; let calls = 0; const waits = [];
  const api = new GenesysApi(GENESYS, () => 'mock', {
    now: () => time, sleep: async ms => { waits.push(ms); time += ms; },
    fetcher: async () => ++calls === 1 ? new Response('', { status: 429, headers: { 'Retry-After': '2' } }) : Response.json(user),
  });
  await api.getMe(); assert.deepEqual(waits, [2000]); assert.equal(calls, 2);
});
test('Retry-After supports seconds and HTTP dates', () => {
  assert.equal(retryAfterMs('15', 1000), 15000);
  assert.equal(retryAfterMs('Thu, 01 Jan 1970 00:00:20 GMT', 1000), 19000);
  assert.equal(retryAfterMs(null), 60000);
});
for (const [status, code] of [[400, 'badRequest'], [401, 'expired'], [403, 'forbidden'], [404, 'notFound'], [500, 'service']]) {
  test(`HTTP ${status} produces a safe actionable error`, async () => {
    const f = fixture(() => new Response('Do not display untrusted server content', { status }));
    await assert.rejects(f.api.getMe(), { code, status }); assert.equal(f.calls.length, 1);
  });
}
test('network failure is never automatically retried', async () => {
  const f = fixture(() => { throw new TypeError('offline'); });
  await assert.rejects(f.api.getMe(), { code: 'network' }); assert.equal(f.calls.length, 1);
});
