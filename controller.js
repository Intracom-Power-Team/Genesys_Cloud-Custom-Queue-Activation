import { AppError, validateProfiles, queueMap, planSwitch, profileMatches } from './profiles.js';

export class QueueController {
  constructor(api, profiles, onChange = () => {}, sleep = ms => new Promise(resolve => setTimeout(resolve, ms))) {
    validateProfiles(profiles);
    this.api = api; this.profiles = profiles; this.onChange = onChange; this.sleep = sleep;
    this.state = { user: null, queues: [], busy: false, fresh: false, phase: 'login', updatedAt: null };
  }
  emit(values) { Object.assign(this.state, values); this.onChange(this.state); }
  async read() {
    const queues = await this.api.getQueues();
    queueMap(queues);
    this.emit({ queues, fresh: true, updatedAt: Date.now() });
    return queues;
  }
  async initialize() {
    if (this.state.busy) throw new AppError('busy');
    this.emit({ busy: true, fresh: false, phase: 'loadingAgent' });
    try {
      const user = await this.api.getMe();
      this.emit({ user, phase: 'loadingQueues' });
      await this.read();
    } finally { this.emit({ busy: false, phase: 'ready' }); }
  }
  async refresh() {
    if (this.state.busy) throw new AppError('busy');
    if (!this.state.user) return this.initialize();
    this.emit({ busy: true, fresh: false, phase: 'loadingQueues' });
    try { return await this.read(); }
    finally { this.emit({ busy: false, phase: 'ready' }); }
  }
  async switchProfile(name) {
    if (this.state.busy) throw new AppError('busy');
    if (!this.state.user || !this.state.fresh) throw new AppError('refreshRequired');
    this.emit({ busy: true, phase: 'switching', fresh: false });
    let attempted = false;
    try {
      // Always read immediately before planning: other Genesys clients can change queue activation.
      const current = await this.read();
      const changes = planSwitch(this.profiles, name, current);
      if (!changes.length) return { kind: 'noChange', name };
      attempted = true;
      this.emit({ fresh: false });
      await this.api.patchQueues(changes);
      for (const delay of [500, 1000, 2000, 3000]) {
        await this.sleep(delay);
        const actual = await this.read();
        if (profileMatches(this.profiles, name, actual)) return { kind: 'success', name };
      }
      throw new AppError('partial');
    } catch (error) {
      if (attempted) {
        // A failed/timeout PATCH may have applied some changes. No retry or rollback.
        this.emit({ phase: 'reconciling', fresh: false });
        try { await this.read(); }
        catch { this.emit({ fresh: false }); }
      }
      if (error.status === 401) this.emit({ fresh: false });
      throw error;
    } finally { this.emit({ busy: false, phase: 'ready' }); }
  }
}
