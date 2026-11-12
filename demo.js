import { QUEUE_PROFILES } from './config.js';
import { AppError } from './profiles.js';

export function createDemoApi() {
  const queues = Object.entries(QUEUE_PROFILES).flatMap(([profile, items]) =>
    items.map(queue => ({ ...queue, joined: profile === 'Eparchia' })));
  queues.push({ id: '11111111-1111-4111-8111-111111111111', name: 'General_Support', joined: true });
  const pause = () => new Promise(resolve => setTimeout(resolve, 350));
  return {
    async getMe() { await pause(); return { id: '22222222-2222-4222-8222-222222222222', name: 'Demo Agent' }; },
    async getQueues() { await pause(); return structuredClone(queues); },
    async patchQueues(changes) {
      await pause();
      for (const change of changes) {
        const queue = queues.find(q => q.id === change.id);
        if (!queue) throw new AppError('membership');
        queue.joined = change.joined;
      }
    },
  };
}
