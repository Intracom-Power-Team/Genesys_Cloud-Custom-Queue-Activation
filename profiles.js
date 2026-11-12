export class AppError extends Error {
  constructor(code, details = {}) {
    super(code);
    this.name = 'AppError';
    this.code = code;
    Object.assign(this, details);
  }
}

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function validateProfiles(profiles) {
  const entries = Object.entries(profiles ?? {});
  if (entries.length !== 3) throw new AppError('configuration');
  const ids = new Set();
  for (const [name, queues] of entries) {
    if (!name || !Array.isArray(queues) || queues.length !== 3) throw new AppError('configuration');
    for (const queue of queues) {
      if (!queue || !UUID.test(queue.id) || !queue.name || ids.has(queue.id.toLowerCase())) {
        throw new AppError('configuration');
      }
      ids.add(queue.id.toLowerCase());
    }
  }
}

export function queueMap(queues) {
  if (!Array.isArray(queues)) throw new AppError('response');
  const result = new Map();
  for (const queue of queues) {
    if (!queue || !UUID.test(queue.id) || typeof queue.joined !== 'boolean' || result.has(queue.id.toLowerCase())) {
      throw new AppError('response');
    }
    result.set(queue.id.toLowerCase(), queue);
  }
  return result;
}

export function profileMatches(profiles, name, queues) {
  const actual = queueMap(queues);
  const selected = new Set(profiles[name].map(q => q.id.toLowerCase()));
  return Object.values(profiles).flat().every(q => {
    const state = actual.get(q.id.toLowerCase());
    // Non-membership in an unselected queue means it cannot be joined.
    return selected.has(q.id.toLowerCase()) ? state?.joined === true : state?.joined !== true;
  });
}

export function detectProfile(profiles, queues) {
  return Object.keys(profiles).find(name => profileMatches(profiles, name, queues)) ?? null;
}

export function planSwitch(profiles, name, queues) {
  validateProfiles(profiles);
  if (!Object.hasOwn(profiles, name)) throw new AppError('configuration');
  const actual = queueMap(queues);
  const missing = profiles[name].filter(q => !actual.has(q.id.toLowerCase()));
  if (missing.length) throw new AppError('membership', { queues: missing.map(q => q.name) });
  const target = new Set(profiles[name].map(q => q.id.toLowerCase()));
  return Object.values(profiles).flat().flatMap(q => {
    const current = actual.get(q.id.toLowerCase());
    const joined = target.has(q.id.toLowerCase());
    // Never add a membership, never touch an unmanaged queue.
    return current && current.joined !== joined ? [{ id: q.id, joined }] : [];
  });
}
