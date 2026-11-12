import { GENESYS, DEPLOYMENT, QUEUE_PROFILES } from './config.js';
import { Auth } from './auth.js';
import { GenesysApi } from './genesys-api.js';
import { QueueController } from './controller.js';
import { createDemoApi } from './demo.js';
import { detectProfile, queueMap } from './profiles.js';
import { translate } from './i18n.js';

const $ = id => document.getElementById(id);
const demo = new URLSearchParams(location.search).get('demo') === '1';
const preferencesKey = 'queue-profiles.preferences.v1';
let preferences = {};
try { preferences = JSON.parse(localStorage.getItem(preferencesKey)) ?? {}; } catch { /* Optional preferences only. */ }
let language = preferences.language === 'en' ? 'en' : 'el';
let theme = ['light', 'dark'].includes(preferences.theme) ? preferences.theme : matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
let selected = 'Eparchia';
let notice = { key: '', values: {}, tone: '' };
let signingIn = false;
let expiryTimer;
let controller;
const auth = new Auth(GENESYS, DEPLOYMENT);
const api = demo ? createDemoApi() : new GenesysApi(GENESYS, () => auth.token());
const t = (key, values) => translate(language, key, values);
const cityIcon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" aria-hidden="true"><path d="M3 21V9h6v12M9 21V3h7v18M16 21V12h5v9M1 21h22M12 7h1M12 11h1M12 15h1M5 13h2M5 17h2M18 16h1"/></svg>';

function savePreferences() {
  try { localStorage.setItem(preferencesKey, JSON.stringify({ language, theme })); } catch { /* Optional. */ }
}

function setNotice(key, tone = '', values = {}) { notice = { key, tone, values }; renderNotice(); }
function renderNotice() {
  const phase = controller?.state.phase;
  const loading = signingIn ? 'signingIn' : controller?.state.busy ? phase : null;
  $('notice').textContent = loading ? t(loading) : t(notice.key, notice.values);
  $('notice').dataset.tone = loading ? 'loading' : notice.tone;
}

function row(queue, index, map, fresh) {
  const actual = map.get(queue.id);
  const status = !fresh ? 'unknown' : !actual ? 'unavailable' : actual.joined ? 'active' : 'inactive';
  const element = document.createElement('div'); element.className = 'queue-row';
  const identity = document.createElement('div'); identity.className = 'queue-identity';
  const number = document.createElement('span'); number.className = 'queue-index'; number.textContent = String(index + 1).padStart(2, '0');
  const name = document.createElement('span'); name.className = 'queue-name'; name.textContent = queue.name;
  identity.append(number, name);
  const badge = document.createElement('span'); badge.className = `queue-state ${status}`;
  const dot = document.createElement('span'); dot.className = 'status-dot'; dot.setAttribute('aria-hidden', 'true');
  badge.append(dot, document.createTextNode(t(status)));
  element.append(identity, badge); return element;
}

function render() {
  document.documentElement.lang = language;
  document.documentElement.dataset.theme = theme;
  document.querySelectorAll('[data-i18n]').forEach(el => { el.textContent = t(el.dataset.i18n); });
  $('language').value = language;
  $('theme').setAttribute('aria-label', t('theme'));
  $('demo-banner').hidden = !demo;
  const state = controller?.state ?? { queues: [], fresh: false, busy: false };
  const loggedIn = !!state.user;
  const busy = state.busy || signingIn;
  const map = queueMap(state.queues);
  const active = state.fresh ? detectProfile(QUEUE_PROFILES, state.queues) : null;
  $('login-panel').hidden = loggedIn || demo;
  $('agent-panel').hidden = !loggedIn;
  $('agent-name').textContent = state.user?.name ?? '—';
  $('avatar').textContent = (state.user?.name ?? '').split(/\s+/).slice(0, 2).map(word => word[0]).join('').toUpperCase();
  $('standalone').href = new URL('./', location.href).href;
  $('redirect-signin').hidden = window.self !== window.top;
  $('signin').disabled = busy;
  $('redirect-signin').disabled = busy;
  $('signout').disabled = busy;
  $('refresh').disabled = busy || !(demo || auth.hasSession());
  $('current-profile').textContent = state.fresh ? active ?? t('custom') : '—';
  $('last-updated').textContent = state.updatedAt ? state.fresh ? t('updated', { time: new Date(state.updatedAt).toLocaleTimeString(language === 'el' ? 'el-GR' : 'en-GB') }) : t('stale') : '';
  for (const [name, items] of Object.entries(QUEUE_PROFILES)) {
    let button = document.querySelector(`[data-profile="${name}"]`);
    if (!button) {
      button = document.createElement('button'); button.type = 'button'; button.dataset.profile = name;
      // All interpolated strings here are constant markup. User/API content uses textContent below.
      button.innerHTML = `<span class="card-top"><span class="card-icon">${cityIcon}</span><span class="card-status"></span></span><span class="card-name"></span><span class="card-description"></span><span class="card-bottom"><span></span><strong></strong></span>`;
      button.addEventListener('click', () => switchTo(name)); $('profiles').append(button);
    }
    button.className = `profile-card${active === name ? ' is-active' : ''}`;
    button.disabled = busy || !loggedIn || !state.fresh;
    button.setAttribute('aria-pressed', String(active === name));
    button.setAttribute('aria-label', `${name}. ${t(name)}. ${t(active === name ? 'activeProfile' : 'activate')}`);
    button.querySelector('.card-name').textContent = name;
    button.querySelector('.card-description').textContent = t(name);
    button.querySelector('.card-status').textContent = t(active === name ? 'activeProfile' : 'available');
    button.querySelector('.card-bottom span').textContent = `${items.length} ${t('queues')}`;
    button.querySelector('.card-bottom strong').textContent = t(!loggedIn ? 'loginNeeded' : active === name ? 'selected' : 'activate');
  }
  $('queues-heading').textContent = selected;
  $('queue-summary').textContent = `${QUEUE_PROFILES[selected].length} ${t('queues')}`;
  $('queue-list').replaceChildren(...QUEUE_PROFILES[selected].map((q, i) => row(q, i, map, state.fresh)));
  $('all-queue-list').replaceChildren(...Object.values(QUEUE_PROFILES).flat().map((q, i) => row(q, i, map, state.fresh)));
  $('profiles').setAttribute('aria-busy', String(!!busy));
  renderNotice();
}

function handleError(error) {
  if (error.status === 401 || error.code === 'expired') {
    auth.clear(); clearTimeout(expiryTimer);
    controller.emit({ user: null, queues: [], fresh: false, updatedAt: null });
  }
  setNotice(error.code ?? 'unexpected', 'error', {
    queues: error.queues?.join(', ') ?? '',
    seconds: Math.max(1, Math.ceil(((error.retryAt ?? Date.now() + 60000) - Date.now()) / 1000)),
  });
  if (error.code === 'partial') $('all-statuses').open = true;
  render();
}

function scheduleExpiry() {
  clearTimeout(expiryTimer);
  if (demo || !auth.session) return;
  expiryTimer = setTimeout(() => {
    // An in-flight request handles its own token failure and verification first.
    if (controller.state.busy) { expiryTimer = setTimeout(scheduleExpiry, 1000); return; }
    handleError({ code: 'expired', status: 401 });
  }, Math.min(2147483647, Math.max(0, auth.session.expiresAt - Date.now())));
}

async function initialize() {
  try {
    await controller.initialize();
    selected = detectProfile(QUEUE_PROFILES, controller.state.queues) ?? selected;
    setNotice(''); scheduleExpiry(); render();
  } catch (error) { handleError(error); }
}

async function switchTo(name) {
  if (controller.state.busy || signingIn) return;
  selected = name;
  try {
    const result = await controller.switchProfile(name);
    setNotice(result.kind, 'success', { name }); render();
  } catch (error) { handleError(error); }
}

async function signIn(redirect = false) {
  if (signingIn || controller.state.busy) return;
  signingIn = true; render();
  try {
    if (redirect) await auth.loginRedirect();
    else { await auth.loginPopup(); signingIn = false; await initialize(); }
  } catch (error) { handleError(error); }
  finally { signingIn = false; render(); }
}

$('signin').addEventListener('click', () => signIn());
$('redirect-signin').addEventListener('click', () => signIn(true));
$('signout').addEventListener('click', () => {
  if (demo) { location.href = new URL('./', location.href).href; return; }
  auth.logout(); clearTimeout(expiryTimer);
  controller.emit({ user: null, queues: [], fresh: false, updatedAt: null });
  setNotice(''); render();
});
$('refresh').addEventListener('click', async () => {
  try {
    await controller.refresh(); selected = detectProfile(QUEUE_PROFILES, controller.state.queues) ?? selected;
    setNotice(demo ? 'refreshedDemo' : 'refreshed', 'success'); render();
  } catch (error) { handleError(error); }
});
$('language').addEventListener('change', event => { language = event.target.value; savePreferences(); render(); });
$('theme').addEventListener('click', () => { theme = theme === 'dark' ? 'light' : 'dark'; savePreferences(); render(); });
try {
  controller = new QueueController(api, QUEUE_PROFILES, () => render());
  render();
  if (demo || auth.hasSession()) await initialize();
} catch (error) { setNotice(error.code ?? 'configuration', 'error'); }
