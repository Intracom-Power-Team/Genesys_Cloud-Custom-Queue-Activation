import test from 'node:test';
import assert from 'node:assert/strict';
import { QUEUE_PROFILES as profiles } from '../config.js';
import { validateProfiles, detectProfile, planSwitch } from '../profiles.js';
import { QueueController } from '../controller.js';

const outside = { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', name: 'General_Support', joined: true };
const stateFor = name => [...Object.entries(profiles).flatMap(([profile, queues]) => queues.map(q => ({ ...q, joined: name === profile }))), { ...outside }];
function fixture(name) {
  let state = stateFor(name);
  const patches = [];
  const api = {
    async getMe() { return { id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', name: 'Test Agent' }; },
    async getQueues() { return structuredClone(state); },
    async patchQueues(changes) { patches.push(changes); changes.forEach(change => { state.find(q => q.id === change.id).joined = change.joined; }); },
  };
  return { api, patches, get state() { return state; }, set state(value) { state = value; }, controller: new QueueController(api, profiles, () => {}, async () => {}) };
}

for (const [from, to] of [['Eparchia', 'Athina01'], ['Athina01', 'Thessaloniki01'], ['Thessaloniki01', 'Eparchia']]) {
  test(`${from} → ${to}: one bulk PATCH, only six changed managed queues`, async () => {
    const f = fixture(from); await f.controller.initialize();
    assert.equal((await f.controller.switchProfile(to)).kind, 'success');
    assert.equal(f.patches.length, 1); assert.equal(f.patches[0].length, 6);
    assert.equal(detectProfile(profiles, f.state), to);
    assert.deepEqual(f.state.find(q => q.id === outside.id), outside);
  });
}
test('already active profile performs no PATCH', async () => {
  const f = fixture('Eparchia'); await f.controller.initialize();
  assert.equal((await f.controller.switchProfile('Eparchia')).kind, 'noChange'); assert.equal(f.patches.length, 0);
});
test('custom state and all inactive state have no matching profile', () => {
  assert.equal(detectProfile(profiles, stateFor(null)), null);
  const mixed = stateFor('Eparchia'); mixed.find(q => q.id === profiles.Athina01[0].id).joined = true;
  assert.equal(detectProfile(profiles, mixed), null);
});
for (const count of [1, 3]) test(`missing ${count} target memberships prevents every update`, async () => {
  const f = fixture('Eparchia'); const missing = profiles.Athina01.slice(0, count);
  f.state = f.state.filter(q => !missing.some(m => m.id === q.id)); await f.controller.initialize();
  await assert.rejects(f.controller.switchProfile('Athina01'), error => error.code === 'membership' && error.queues.length === count);
  assert.equal(f.patches.length, 0); assert.equal(detectProfile(profiles, f.state), 'Eparchia');
});
test('missing non-target queues are not added or patched', () => {
  const state = stateFor('Eparchia').filter(q => q.id !== profiles.Thessaloniki01[0].id);
  assert.equal(planSwitch(profiles, 'Athina01', state).length, 6);
});
test('permissions failure reconciles actual state and never retries PATCH', async () => {
  const f = fixture('Eparchia'); let calls = 0;
  f.api.patchQueues = async () => { calls++; throw Object.assign(new Error(), { code: 'forbidden', status: 403 }); };
  await f.controller.initialize(); await assert.rejects(f.controller.switchProfile('Athina01'), { code: 'forbidden' });
  assert.equal(calls, 1); assert.equal(f.controller.state.fresh, true);
  assert.equal(detectProfile(profiles, f.controller.state.queues), 'Eparchia');
});
test('partial accepted update is not success and is never rolled back', async () => {
  const f = fixture('Eparchia'); let calls = 0;
  f.api.patchQueues = async changes => { calls++; f.state.find(q => q.id === changes[0].id).joined = changes[0].joined; };
  await f.controller.initialize(); await assert.rejects(f.controller.switchProfile('Athina01'), { code: 'partial' });
  assert.equal(calls, 1); assert.equal(detectProfile(profiles, f.controller.state.queues), null); assert.equal(f.controller.state.fresh, true);
});
test('failed PATCH that actually applied changes still reports the failure with actual state', async () => {
  const f = fixture('Eparchia'); const patch = f.api.patchQueues;
  f.api.patchQueues = async changes => { await patch(changes); throw Object.assign(new Error(), { code: 'network' }); };
  await f.controller.initialize(); await assert.rejects(f.controller.switchProfile('Athina01'), { code: 'network' });
  assert.equal(detectProfile(profiles, f.controller.state.queues), 'Athina01'); assert.equal(f.patches.length, 1);
});
test('failed reconciliation locks switches until a successful refresh', async () => {
  const f = fixture('Eparchia'); const get = f.api.getQueues;
  f.api.patchQueues = async () => { f.api.getQueues = async () => { throw new Error('offline'); }; throw new Error('offline'); };
  await f.controller.initialize(); await assert.rejects(f.controller.switchProfile('Athina01'));
  assert.equal(f.controller.state.fresh, false);
  await assert.rejects(f.controller.switchProfile('Eparchia'), { code: 'refreshRequired' });
  f.api.getQueues = get; await f.controller.refresh(); assert.equal(f.controller.state.fresh, true);
});
test('expired token prevents subsequent changes even when reconciliation works', async () => {
  const f = fixture('Eparchia'); f.api.patchQueues = async () => { throw Object.assign(new Error(), { code: 'expired', status: 401 }); };
  await f.controller.initialize(); await assert.rejects(f.controller.switchProfile('Athina01'), { code: 'expired' });
  assert.equal(f.controller.state.fresh, false);
});
test('invalid and duplicate queue UUID configuration fails closed', () => {
  const invalid = structuredClone(profiles); invalid.Eparchia[0].id = 'not-a-uuid';
  assert.throws(() => validateProfiles(invalid), { code: 'configuration' });
  const duplicate = structuredClone(profiles); duplicate.Athina01[0].id = duplicate.Eparchia[0].id.toUpperCase();
  assert.throws(() => validateProfiles(duplicate), { code: 'configuration' });
});
test('refresh detects external changes and never trusts previous selected profile', async () => {
  const f = fixture('Eparchia'); await f.controller.initialize(); f.state = stateFor('Thessaloniki01');
  await f.controller.refresh(); assert.equal(detectProfile(profiles, f.controller.state.queues), 'Thessaloniki01');
});
test('preflight reads fresh external state before building a delta', async () => {
  const f = fixture('Eparchia'); await f.controller.initialize(); f.state = stateFor('Athina01');
  assert.equal((await f.controller.switchProfile('Athina01')).kind, 'noChange'); assert.equal(f.patches.length, 0);
});
test('rapid clicks cannot run parallel switches', async () => {
  const f = fixture('Eparchia'); await f.controller.initialize();
  const first = f.controller.switchProfile('Athina01');
  await assert.rejects(f.controller.switchProfile('Thessaloniki01'), { code: 'busy' });
  await first; assert.equal(f.patches.length, 1);
});
test('malformed joined value blocks a switch', () => {
  const state = stateFor('Eparchia'); state[0].joined = 'false';
  assert.throws(() => planSwitch(profiles, 'Athina01', state), { code: 'response' });
});
