// VPS 管家 · interface. Built on a small set of pure helpers (core.js); every value
// placed into markup goes through `html`, which escapes it unless it is already markup.
import { html, raw, escapeHTML, parseDate, isoDay, renewalOf, daysLeft, dueLabel, dueTone, weekday, shortDate, addMonths, beijingToday, beijingTime, greeting, CYCLES, CURRENCIES, money, hasPrice, priceText, monthlyCNY, STATUS, statusOf, statusCounts, providerName, providerGroups, matchesQuery, byPinnedThenName, renewalBuckets, nextRenewal, normalizeBandwidth, safeURL, sshCommand, changedFields, tagsFrom, SORTS, sortServers, toggledSet } from './core.js';

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const app = $('#app');
const S = { session: null, ws: null, page: 'home', q: '', status: '', view: 'grid', sort: 'smart', provider: null, backups: null, backupRange: 'all', loadingBackups: false, selecting: false, selected: new Set() };
// Per-device conveniences only (view, sort, theme); storage may be unavailable, so every access is guarded.
const prefs = {
  get(key, fallback = null) { try { return localStorage.getItem('vps-' + key) ?? fallback; } catch { return fallback; } },
  set(key, value) { try { localStorage.setItem('vps-' + key, value); } catch { /* storage unavailable */ } }
};
if (['grid', 'list', 'providers'].includes(prefs.get('view'))) S.view = prefs.get('view');
if (Object.hasOwn(SORTS, prefs.get('sort') || '')) S.sort = prefs.get('sort');
function applyTheme(mode) { if (mode === 'light' || mode === 'dark') document.documentElement.dataset.theme = mode; else delete document.documentElement.dataset.theme; }
applyTheme(prefs.get('theme', 'auto'));
const exitSelecting = () => { S.selecting = false; S.selected.clear(); };

// ── Icons ────────────────────────────────────────────────────────────────────
const PATHS = {
  home: '<path d="M4 10.5 12 4l8 6.5V19a1 1 0 0 1-1 1h-4.5v-5.5h-5V20H5a1 1 0 0 1-1-1Z"/>',
  server: '<rect x="3.5" y="4" width="17" height="7" rx="2"/><rect x="3.5" y="13" width="17" height="7" rx="2"/><path d="M7.5 7.5h.01M7.5 16.5h.01M11 7.5h5.5M11 16.5h5.5"/>',
  calendar: '<rect x="3.5" y="5" width="17" height="15.5" rx="2.5"/><path d="M8 3v4M16 3v4M3.5 10h17"/><path d="M8 14h2M14 14h2M8 17h2"/>',
  wallet: '<path d="M4 7.5A2.5 2.5 0 0 1 6.5 5H18v3"/><rect x="3.5" y="7.5" width="17" height="12" rx="2.5"/><path d="M16 13.5h4.5"/><circle cx="16.5" cy="13.5" r=".6" fill="currentColor"/>',
  terminal: '<rect x="3" y="4.5" width="18" height="15" rx="2.5"/><path d="m7 9.5 3 2.5-3 2.5M12.5 15h4.5"/>',
  shield: '<path d="M12 3 19.5 6v6c0 4.6-3.3 7.8-7.5 9-4.2-1.2-7.5-4.4-7.5-9V6Z"/><path d="m8.8 12 2.2 2.2 4.4-4.6"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-1.8-.3 1.6 1.6 0 0 0-1 1.5V21a2 2 0 0 1-4 0v-.1a1.6 1.6 0 0 0-1-1.5 1.6 1.6 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0 .3-1.8 1.6 1.6 0 0 0-1.5-1H3a2 2 0 0 1 0-4h.1a1.6 1.6 0 0 0 1.5-1 1.6 1.6 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 1.8.3H9a1.6 1.6 0 0 0 1-1.5V3a2 2 0 0 1 4 0v.1a1.6 1.6 0 0 0 1 1.5 1.6 1.6 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8V9a1.6 1.6 0 0 0 1.5 1H21a2 2 0 0 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1Z"/>',
  plus: '<path d="M12 5v14M5 12h14"/>', search: '<circle cx="11" cy="11" r="6.5"/><path d="m16 16 4.5 4.5"/>', close: '<path d="m6 6 12 12M18 6 6 18"/>',
  chevron: '<path d="m9 6 6 6-6 6"/>', arrow: '<path d="M5 12h14m-5-5 5 5-5 5"/>', back: '<path d="M19 12H5m5 5-5-5 5-5"/>',
  copy: '<rect x="8.5" y="8.5" width="11.5" height="11.5" rx="2.5"/><path d="M15.5 8.5V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v7.5a2 2 0 0 0 2 2h2.5"/>',
  edit: '<path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16Z"/><path d="m13.5 6.5 4 4"/>', trash: '<path d="M4 7h16M9 7V4.5h6V7M6 7l1 13h10l1-13M10 11v5.5M14 11v5.5"/>',
  eye: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z"/><circle cx="12" cy="12" r="3"/>', eyeOff: '<path d="M3 3l18 18M10.6 6a9.6 9.6 0 0 1 1.4-.1c6 0 9.5 6.1 9.5 6.1a17 17 0 0 1-2.9 3.6M6.6 6.6C3.9 8.3 2.5 12 2.5 12S6 18.5 12 18.5a9 9 0 0 0 4.6-1.2M9.9 9.9a3 3 0 0 0 4.2 4.2"/>',
  lock: '<rect x="4.5" y="10.5" width="15" height="10" rx="2.5"/><path d="M8 10.5V7.5a4 4 0 0 1 8 0v3"/>', key: '<circle cx="8" cy="15" r="4"/><path d="m11 12 9-9M16.5 6.5l3 3M14 9l2 2"/>',
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.5 2.8 3.5 5.8 3.5 9s-1 6.2-3.5 9c-2.5-2.8-3.5-5.8-3.5-9S9.5 5.8 12 3Z"/>',
  refresh: '<path d="M20 11.5a8 8 0 0 0-14.3-4.6L4 9M4 12.5a8 8 0 0 0 14.3 4.6L20 15"/><path d="M4 4.5V9h4.5M20 19.5V15h-4.5"/>', logout: '<path d="M14 4h4a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-4M10 16l-4-4 4-4M6 12h10"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>', external: '<path d="M14 4h6v6M20 4l-9 9M18 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4"/>',
  grid: '<rect x="4" y="4" width="6.5" height="6.5" rx="1.8"/><rect x="13.5" y="4" width="6.5" height="6.5" rx="1.8"/><rect x="4" y="13.5" width="6.5" height="6.5" rx="1.8"/><rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1.8"/>',
  list: '<path d="M9 6h11M9 12h11M9 18h11M4.5 6h.01M4.5 12h.01M4.5 18h.01"/>', layers: '<path d="m12 3.5 9 4.5-9 4.5L3 8Z"/><path d="m3 12.5 9 4.5 9-4.5M3 16.5 12 21l9-4.5"/>',
  pin: '<path d="M9 3.5h6l-1 5 3.5 3.5v2h-11v-2L10 8.5Z"/><path d="M12 14v6.5"/>', bell: '<path d="M6 16.5V11a6 6 0 0 1 12 0v5.5l1.5 2h-15Z"/><path d="M10 20.5a2 2 0 0 0 4 0"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5.5M12 7.5h.01"/>', alert: '<path d="M12 4 21.5 20h-19Z"/><path d="M12 10v4.5M12 17.5h.01"/>',
  link: '<path d="M10 14a4.5 4.5 0 0 0 6.4 0l3-3a4.5 4.5 0 0 0-6.4-6.4l-1 1M14 10a4.5 4.5 0 0 0-6.4 0l-3 3a4.5 4.5 0 0 0 6.4 6.4l1-1"/>',
  more: '<circle cx="5.5" cy="12" r="1.4"/><circle cx="12" cy="12" r="1.4"/><circle cx="18.5" cy="12" r="1.4"/>', send: '<path d="M21 3 10 14M21 3l-7 18-4-7-7-4Z"/>',
  download: '<path d="M12 4v11m-4.5-4.5L12 15l4.5-4.5M5 20h14"/>', spark: '<path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M6 18l2.5-2.5M15.5 8.5 18 6"/>'
};
export const icon = (name, size = 18) => raw(`<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${PATHS[name] || PATHS.server}</svg>`);
const LOGO = raw('<svg class="logo" viewBox="0 0 40 40" aria-hidden="true"><defs><linearGradient id="logo-fill" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#8FA2FF"/><stop offset="1" stop-color="#A37BFA"/></linearGradient></defs><rect x="1" y="1" width="38" height="38" rx="12" fill="url(#logo-fill)"/><path d="M11 15.5h18M11 24.5h18" stroke="#fff" stroke-opacity=".55" stroke-width="7" stroke-linecap="round"/><circle cx="14.5" cy="15.5" r="1.6" fill="#fff"/><circle cx="14.5" cy="24.5" r="1.6" fill="#fff"/></svg>');

// ── Small UI primitives ──────────────────────────────────────────────────────
const btn = (act, label, { ico = '', kind = '', id = '', attrs = '' } = {}) => html`<button type="button" class="btn ${kind}" data-act="${act}"${id !== '' ? raw(` data-id="${escapeHTML(id)}"`) : ''}${raw(attrs ? ' ' + attrs : '')}>${ico ? icon(ico, 16) : ''}${label ? html`<span>${label}</span>` : ''}</button>`;
const iconBtn = (act, label, ico, { id = '', kind = '' } = {}) => html`<button type="button" class="icon-btn ${kind}" data-act="${act}"${id !== '' ? raw(` data-id="${escapeHTML(id)}"`) : ''} aria-label="${label}" title="${label}">${icon(ico, 18)}</button>`;
const pill = (text, tone = 'muted') => html`<span class="pill ${tone}">${text}</span>`;
const statusPill = status => { const s = statusOf(status); return html`<span class="pill ${s.tone} dot">${s.label}</span>`; };
const duePill = server => { const days = daysLeft(server); return pill(dueLabel(days, server), dueTone(days)); };
const empty = (title, text, ico = 'spark', action = '') => html`<div class="empty"><div class="empty-art">${icon(ico, 26)}</div><h3>${title}</h3><p>${text}</p>${action}</div>`;
let toastTimer = 0;
function toast(message, tone = '') {
  const node = $('#toast'); node.textContent = message; node.className = `show ${tone}`;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { node.className = ''; }, 3200);
}

// ── API ──────────────────────────────────────────────────────────────────────
class ApiError extends Error { constructor(message, status) { super(message); this.status = status; } }
async function api(path, { method = 'GET', body, revision = S.ws?.revision ?? 0 } = {}) {
  const headers = { Accept: 'application/json' };
  if (method !== 'GET') {
    headers['Content-Type'] = 'application/json';
    if (S.session?.csrfToken) headers['X-CSRF-Token'] = S.session.csrfToken;
    headers['If-Match'] = String(revision);
  }
  let response;
  try { response = await fetch('/api' + path, { method, headers, credentials: 'same-origin', cache: 'no-store', body: body === undefined ? undefined : JSON.stringify(body) }); }
  catch { throw new ApiError('网络连接中断，请稍后重试。', 0); }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    // An expired session sends everyone back to sign-in, except for re-authentication forms.
    if (response.status === 401 && S.session?.authenticated && !/^\/(security|settings\/telegram|backup$)/.test(path)) { S.session = null; S.ws = null; closeLayers(true); setTimeout(boot); }
    throw new ApiError(typeof data.error === 'string' ? data.error : '请求未完成，请稍后重试。', response.status);
  }
  return data;
}
async function loadWorkspace() {
  const ws = await api('/workspace');
  ws.servers ||= []; ws.commands ||= []; ws.settings ||= {}; ws.costs ||= {}; ws.customMonthly ||= {};
  S.ws = ws;
  return ws;
}
const server = id => S.ws?.servers.find(record => record.id === id);

// ── Layers: modal (centre) and panel (side sheet) ───────────────────────────
// Secrets shown in a layer are wiped whenever it closes or the tab is hidden.
const layers = { modal: null, panel: null };
function openLayer(kind, content, { wide = false, label = '', sticky = false } = {}) {
  const node = $(kind === 'panel' ? '#panel' : '#modal');
  clearSecrets();
  node.innerHTML = String(content);
  node.classList.toggle('wide', wide);
  node.toggleAttribute('data-sticky', sticky);
  node.setAttribute('aria-label', label);
  if (!node.open) node.showModal();
  layers[kind] = node;
  node.querySelector('[autofocus]')?.focus();
  return node;
}
// A draft counts as changed when the form now reads differently from when it opened.
function isDirty(form) {
  const state = form && editorState.get(form);
  if (!state) return false;
  const now = form.dataset.form === 'command' ? readCommandForm(form) : readServerForm(form);
  return JSON.stringify(now) !== JSON.stringify(state.original);
}
const confirmDiscard = node => !isDirty($('form[data-form="server"], form[data-form="command"]', node)) || confirm('有未保存的修改，确定放弃吗？');
function closeLayer(kind, force = false) {
  const node = $(kind === 'panel' ? '#panel' : '#modal');
  if (!node.open) return true;
  if (!force && node.querySelector('form[aria-busy="true"]')) { toast('正在保存，请稍候'); return false; }
  if (!force && !confirmDiscard(node)) return false;
  clearSecrets(node);
  node.close(); node.innerHTML = ''; layers[kind] = null;
  return true;
}
function closeLayers(force = false) { closeLayer('modal', force); closeLayer('panel', force); }
const modal = (title, body, foot = '', { sub = '', wide = false, form = '', id = '', sticky = false } = {}) => openLayer('modal', html`<${raw(form ? 'form' : 'div')} class="sheet"${form ? raw(` data-form="${escapeHTML(form)}" data-id="${escapeHTML(id)}" novalidate`) : ''}><header class="sheet-head"><div><h2>${title}</h2>${sub ? html`<p>${sub}</p>` : ''}</div>${iconBtn('close-modal', '关闭', 'close', { kind: 'ghost' })}</header><div class="sheet-body"><div class="form-error" role="alert"></div>${body}</div>${foot ? html`<footer class="sheet-foot">${foot}</footer>` : ''}</${raw(form ? 'form' : 'div')}>`, { wide, label: title, sticky });
const cancelBtn = (act = 'close-modal') => btn(act, '取消', { kind: 'ghost' });
const submitBtn = (label, kind = 'primary') => html`<button type="submit" class="btn ${kind}">${icon('check', 16)}<span>${label}</span></button>`;

// ── Shell ────────────────────────────────────────────────────────────────────
const PAGES = [
  ['home', '总览', 'home'], ['servers', '服务器', 'server'], ['renewals', '续费', 'calendar'], ['costs', '费用', 'wallet'],
  ['commands', '指令', 'terminal'], ['backups', '备份', 'shield'], ['settings', '设置', 'settings']
];
const PRIMARY_MOBILE = ['home', 'servers', 'renewals', 'costs'];
function routeFromHash() {
  const [page, ...rest] = location.hash.replace(/^#\/?/, '').split('/');
  S.page = PAGES.some(([key]) => key === page) ? page : 'home';
  S.provider = S.page === 'servers' && rest[0] === 'provider' ? decodeURIComponent(rest.slice(1).join('/')) : null;
}
function go(page, { provider = null, keepQuery = false } = {}) {
  if (!keepQuery) { S.q = ''; S.status = ''; }
  S.keepQuery = keepQuery;
  const target = '#/' + page + (provider !== null ? '/provider/' + encodeURIComponent(provider) : '');
  if (location.hash === target) render(); else location.hash = target;
}
function render() {
  if (!S.session?.authenticated || !S.ws) return renderAuth();
  const account = S.session.account || {};
  const views = { home: homePage, servers: serversPage, renewals: renewalsPage, costs: costsPage, commands: commandsPage, backups: backupsPage, settings: settingsPage };
  const current = PAGES.find(([key]) => key === S.page);
  app.innerHTML = String(html`<div class="frame">
    <header class="masthead">
      <a class="brand" href="#/home" aria-label="VPS 管家 · 总览">${LOGO}<span><strong>VPS 管家</strong><small>Private Cloud</small></span></a>
      <label class="omnibox">${icon('search', 17)}<span class="sr-only">搜索服务器</span><input id="omnibox" type="search" placeholder="搜索服务器、IP、服务商或标签" value="${S.page === 'servers' ? S.q : ''}" autocomplete="off" spellcheck="false"><kbd>/</kbd></label>
      <div class="mast-actions">
        ${iconBtn('refresh', '刷新资料', 'refresh')}
        <button type="button" class="me" data-act="account-menu" aria-haspopup="menu"><span class="avatar">${(account.username || 'A').slice(0, 1).toUpperCase()}</span><span class="me-name">${account.username || '管理员'}</span></button>
      </div>
    </header>
    <main class="stage${S.page !== S.shownPage ? ' enter' : ''}" id="stage" data-page="${S.page}">${views[S.page]()}</main>
    <nav class="dock" aria-label="主导航">${PAGES.map(([key, title, ico]) => html`<button type="button" data-go="${key}" class="${key === S.page ? 'on' : ''} ${PRIMARY_MOBILE.includes(key) ? '' : 'wide-only'}"${key === S.page ? raw(' aria-current="page"') : ''}><span class="dock-ico">${icon(ico, 20)}</span><span class="dock-label">${title}</span></button>`)}<button type="button" class="narrow-only ${PRIMARY_MOBILE.includes(S.page) ? '' : 'on'}" data-act="more"><span class="dock-ico">${icon('grid', 20)}</span><span class="dock-label">更多</span></button></nav>
  </div>`);
  S.shownPage = S.page;
  document.title = `${current[1]} · VPS 管家`;
  if (S.page === 'backups' && !S.backups && !S.loadingBackups) loadBackups();
  if (S.focusOmni) { S.focusOmni = false; const box = $('#omnibox'); box?.focus(); box?.setSelectionRange(box.value.length, box.value.length); }
}
function moreSheet() {
  const account = S.session.account || {};
  modal('全部功能', html`<div class="launcher">${PAGES.map(([key, title, ico]) => html`<button type="button" data-go="${key}" class="${key === S.page ? 'on' : ''}"><span>${icon(ico, 22)}</span>${title}</button>`)}</div><div class="me-card"><span class="avatar">${(account.username || 'A').slice(0, 1).toUpperCase()}</span><div><strong>${account.username || '管理员'}</strong><small>${account.totpEnabled ? '已开启双重验证' : '管理账户'}</small></div>${btn('logout', '退出', { ico: 'logout', kind: 'ghost' })}</div>`);
}
function accountMenu() {
  const account = S.session.account || {};
  modal('账户', html`<div class="me-card"><span class="avatar big">${(account.username || 'A').slice(0, 1).toUpperCase()}</span><div><strong>${account.username || '管理员'}</strong><small>${account.totpEnabled ? '已开启双重验证' : '未开启双重验证'}</small></div></div><div class="menu-list">${btn('go-settings', '账户与安全设置', { ico: 'settings', kind: 'ghost' })}${btn('logout', '退出登录', { ico: 'logout', kind: 'ghost danger' })}</div>`);
}

// ── Sign in and first-time setup ─────────────────────────────────────────────
let setupToken = '';
function renderAuth() {
  const setup = S.session?.setupRequired;
  const field = (name, label, type, extra = '') => html`<label class="field"><span>${label}</span><input class="input" name="${name}" type="${type}" ${raw(extra)}></label>`;
  app.innerHTML = String(html`<div class="auth">
    <form class="auth-card" data-form="${setup ? 'setup' : 'login'}" novalidate>
      <div class="auth-brand">${LOGO}<div><strong>VPS 管家</strong><small>你的私人服务器资产台</small></div></div>
      <h1>${setup ? '创建管理账户' : '欢迎回来'}</h1>
      <p class="lede">${setup ? '完成首次设置后即可开始管理。请使用一个独立的密码。' : '登录以继续管理你的服务器、续费与开销。'}</p>
      <div class="form-error" role="alert"></div>
      ${setup && !setupToken ? field('token', '首次设置令牌', 'text', 'required autocomplete="off"') : ''}
      ${field('username', '用户名', 'text', 'required autocomplete="username" minlength="3" maxlength="40" autofocus')}
      ${field('password', '密码', 'password', `required autocomplete="${setup ? 'new-password' : 'current-password'}" maxlength="128"${setup ? ' minlength="14"' : ''}`)}
      ${setup ? field('confirmPassword', '确认密码', 'password', 'required autocomplete="new-password" minlength="14" maxlength="128"') : field('otp', '动态验证码（未开启可留空）', 'text', 'autocomplete="one-time-code" inputmode="numeric" maxlength="64"')}
      <button type="submit" class="btn primary block">${setup ? '创建并进入' : '登录'}${icon('arrow', 17)}</button>
      <p class="auth-foot">${icon('lock', 13)}数据只保存在你自己的服务器上，全程加密存储。</p>
    </form>
  </div>`);
  document.title = 'VPS 管家';
  $('[autofocus]', app)?.focus();
}
async function boot() {
  try {
    S.session = await api('/session');
    if (S.session.authenticated) { await loadWorkspace(); routeFromHash(); }
    render();
  } catch (error) {
    app.innerHTML = String(html`<div class="auth"><div class="auth-card center">${LOGO}<h1>暂时无法连接</h1><p class="lede">${error.message}</p>${btn('boot', '重新连接', { ico: 'refresh', kind: 'primary' })}</div></div>`);
  }
}

// ── Pages ────────────────────────────────────────────────────────────────────
const head = (title, lede, actions = '', kicker = '') => html`<section class="page-head"><div>${kicker ? html`<p class="kicker">${kicker}</p>` : ''}<h1>${title}</h1>${lede ? html`<p class="lede">${lede}</p>` : ''}</div>${actions ? html`<div class="page-actions">${actions}</div>` : ''}</section>`;
const yuan = (value, unit = '') => html`<span class="amount"><span class="cur">¥</span>${money(value)}${unit ? html`<span class="per">${unit}</span>` : ''}</span>`;
function costScope() {
  const servers = S.ws.servers, c = S.ws.costs || {}, selected = servers.filter(s => s.excludeFromCosts !== true).length;
  const invalid = Number(c.invalidCostCount ?? 0);
  return `已选 ${selected} / ${servers.length} 台${servers.length - selected ? ` · 手动排除 ${servers.length - selected} 台` : ''}${invalid ? ` · 其中 ${invalid} 台账单信息不完整，暂未计入` : ''}`;
}
const serverLine = s => html`<button type="button" class="row" data-act="detail" data-id="${s.id}"><span class="row-mark ${statusOf(s.status).tone}"></span><span class="row-main"><strong>${s.name}</strong><small>${[providerName(s) || '未设置服务商', s.region].filter(Boolean).join(' · ')}</small></span><span class="row-side mono" title="${s.ipAddress || ''}">${s.ipAddress || '—'}</span>${icon('chevron', 16)}</button>`;
function dateBlock(server) {
  const date = renewalOf(server);
  return date ? html`<span class="date-block"><b>${date.getDate()}</b><small>${date.getMonth() + 1}月 · ${weekday(date)}</small></span>` : html`<span class="date-block none"><b>—</b><small>未设置</small></span>`;
}
const renewalLine = (s, withAction = false) => html`<div class="row static">${dateBlock(s)}<button type="button" class="row-main link" data-act="detail" data-id="${s.id}"><strong>${s.name}</strong><small>${[providerName(s) || '未设置服务商', priceText(s) || '未记录价格', s.autoRenew ? '自动续费' : ''].filter(Boolean).join(' · ')}</small></button><span class="row-side">${duePill(s)}</span>${withAction ? btn('renew', '已续费', { ico: 'check', kind: 'soft small', id: s.id }) : ''}</div>`;

function homePage() {
  const all = S.ws.servers, counts = statusCounts(all), c = S.ws.costs || {}, now = new Date();
  const buckets = renewalBuckets(all, now), soon = [...buckets.overdue, ...buckets.week, ...buckets.month];
  const next = buckets.overdue[0] || nextRenewal(all, now), account = S.session.account || {};
  const segments = Object.entries(counts).filter(([, n]) => n);
  const summary = all.length ? `${all.length} 台服务器，${counts.online} 台运行中${soon.length ? `，${soon.length} 台在 30 天内需要续费` : '，近期没有需要续费的机器'}。` : '从添加第一台服务器开始，整理你的资产、账单与连接信息。';
  return html`
  ${head(`${greeting(now)}，${account.username || '管理员'}`, summary, btn('server-new', '添加服务器', { ico: 'plus', kind: 'primary' }), `${now.getMonth() + 1} 月 ${now.getDate()} 日 · ${weekday(now)}`)}
  <div class="bento">
    <article class="tile spend">
      <div class="tile-head"><span class="tile-label">${icon('wallet', 16)}每月开销</span>${btn('cost-scope', '统计范围', { ico: 'settings', kind: 'ghost small' })}</div>
      <div class="hero-number">${yuan(c.monthlyTotal, '/ 月')}</div>
      <dl class="trio"><div><dt>年付</dt><dd>${yuan(c.yearlyTotal)}</dd></div><div><dt>单期合计</dt><dd>${yuan(c.recordedTotal)}</dd></div><div><dt>参与统计</dt><dd>${all.filter(s => s.excludeFromCosts !== true).length}<small> / ${all.length} 台</small></dd></div></dl>
      <p class="tile-note">按参考汇率折算为人民币，供预算参考。${Number(c.invalidCostCount) ? ` ${c.invalidCostCount} 台账单信息不完整，暂未计入。` : ''}</p>
    </article>
    <article class="tile fleet">
      <div class="tile-head"><span class="tile-label">${icon('server', 16)}服务器</span><a class="tile-link" href="#/servers">全部${icon('arrow', 14)}</a></div>
      <div class="hero-number">${all.length}<span class="per">台</span></div>
      <div class="meter" role="img" aria-label="状态分布">${segments.length ? segments.map(([key, n]) => html`<span class="${STATUS[key].tone}" style="flex:${n}"></span>`) : html`<span class="muted" style="flex:1"></span>`}</div>
      <ul class="legend">${Object.entries(counts).map(([key, n]) => html`<li><i class="${STATUS[key].tone}"></i>${STATUS[key].label}<b>${n}</b></li>`)}</ul>
    </article>
    <article class="tile next">
      <div class="tile-head"><span class="tile-label">${icon('bell', 16)}${next && next.days < 0 ? '待处理续费' : '下一次续费'}</span></div>
      ${next ? html`<div class="countdown ${dueTone(next.days)}">${next.days < 0 ? html`<span>已过期</span><b>${-next.days}</b><span>天</span>` : next.days === 0 ? html`<b>今天</b>` : html`<b>${next.days}</b><span>天后</span>`}</div>
        <button type="button" class="next-name" data-act="detail" data-id="${next.server.id}">${next.server.name}</button>
        <p class="tile-note">${shortDate(renewalOf(next.server))} ${weekday(renewalOf(next.server))}${priceText(next.server) ? ` · ${priceText(next.server)}` : ''}</p>
        ${btn('renew', '记录续费', { ico: 'check', kind: 'soft small', id: next.server.id })}`
      : html`<div class="countdown calm"><b>—</b></div><p class="tile-note">还没有即将到来的续费。为服务器填写续费日期后会显示在这里。</p>`}
    </article>
    <section class="tile schedule">
      <div class="tile-head"><span class="tile-label">${icon('calendar', 16)}30 天内续费${soon.length ? html` <em>${soon.length}</em>` : ''}</span><a class="tile-link" href="#/renewals">日程${icon('arrow', 14)}</a></div>
      ${soon.length ? html`<div class="rows">${soon.slice(0, 6).map(({ server: s }) => renewalLine(s))}</div>` : empty('一切从容', '未来 30 天没有需要续费的机器。', 'calendar')}
    </section>
    <section class="tile fav">
      <div class="tile-head"><span class="tile-label">${icon('layers', 16)}常用服务器</span><a class="tile-link" href="#/servers">管理${icon('arrow', 14)}</a></div>
      ${all.length ? html`<div class="rows">${[...all].sort(byPinnedThenName).slice(0, 6).map(serverLine)}</div>` : empty('还没有服务器', '添加后，这里会列出置顶和常用的机器。', 'server', btn('server-new', '添加服务器', { ico: 'plus', kind: 'primary small' }))}
    </section>
  </div>`;
}

// Servers: one page for the whole fleet, with grid, list and provider views.
function filteredServers() {
  return sortServers(S.ws.servers.filter(s => (S.provider === null || providerName(s) === S.provider) && (!S.status || s.status === S.status) && matchesQuery(s, S.q)), S.sort, { rates: S.ws.settings.rates });
}
const openAct = () => S.selecting ? 'pick-server' : 'detail';
const pickedCls = s => S.selecting ? (S.selected.has(s.id) ? ' picking picked' : ' picking') : '';
function serverCard(s) {
  return html`<article class="machine${pickedCls(s)}" data-act="${openAct()}" data-id="${s.id}" tabindex="0" role="button" aria-label="${s.name}"${S.selecting ? raw(` aria-pressed="${S.selected.has(s.id)}"`) : ''}>${S.selecting ? html`<span class="pick-mark" aria-hidden="true">${icon('check', 14)}</span>` : ''}
    <div class="machine-top">${statusPill(s.status)}${s.isPinned ? html`<span class="pin" title="置顶">${icon('pin', 14)}</span>` : ''}</div>
    <h3>${s.name}</h3>
    <p class="machine-sub">${[providerName(s) || '未设置服务商', s.region].filter(Boolean).join(' · ')}</p>
    <p class="machine-ip mono">${s.ipAddress || '未记录地址'}</p>
    ${s.plan ? html`<p class="machine-plan">${s.plan}</p>` : ''}
    <div class="machine-foot"><span class="price">${priceText(s) || '未记录价格'}</span>${duePill(s)}</div>
  </article>`;
}
function serverTable(list) {
  return html`<div class="ledger"><div class="ledger-head"><span>服务器</span><span>地址</span><span>状态</span><span>账单</span><span>续费</span></div>${list.map(s => html`<button type="button" class="ledger-row${pickedCls(s)}" data-act="${openAct()}" data-id="${s.id}"${S.selecting ? raw(` aria-pressed="${S.selected.has(s.id)}"`) : ''}>
    <span class="ledger-name"><strong>${s.name}</strong><small>${[providerName(s) || '未设置服务商', s.region].filter(Boolean).join(' · ')}</small></span>
    <span class="mono" data-label="地址">${s.ipAddress || '—'}</span><span data-label="状态">${statusPill(s.status)}</span>
    <span data-label="账单">${priceText(s) || '—'}</span><span data-label="续费">${duePill(s)}</span></button>`)}</div>`;
}
function providerBoard(list) {
  const groups = providerGroups(list);
  return html`<div class="providers">${groups.map(group => {
    const monthly = group.servers.reduce((sum, s) => sum + (s.excludeFromCosts === true ? 0 : (monthlyCNY(s, S.ws.settings.rates) || 0)), 0);
    return html`<section class="provider">
      <button type="button" class="provider-head" data-act="provider" data-id="${group.name}"><span class="provider-badge">${(group.name || '?').slice(0, 1).toUpperCase()}</span><span><strong>${group.name || '未设置服务商'}</strong><small>${group.servers.length} 台 · ${group.servers.filter(s => s.status === 'online').length} 台运行中${monthly ? ` · 约 ¥${money(monthly)} / 月` : ''}</small></span>${icon('chevron', 16)}</button>
      <div class="provider-machines">${group.servers.map(s => html`<button type="button" class="chip-machine${pickedCls(s)}" data-act="${openAct()}" data-id="${s.id}"${S.selecting ? raw(` aria-pressed="${S.selected.has(s.id)}"`) : ''}><i class="${statusOf(s.status).tone}"></i><span class="chip-name">${s.name}</span><small>${dueLabel(daysLeft(s), s)}</small></button>`)}</div>
    </section>`;
  })}</div>`;
}
function serverResults() {
  const list = filteredServers(), note = S.q ? html`<p class="query-note">正在搜索「${S.q}」${btn('clear-filters', '清除', { kind: 'ghost small' })}</p>` : '';
  if (!S.ws.servers.length) return empty('你的机房还空着', '添加第一台服务器，把连接信息、账单和续费日期放在一起。', 'server', btn('server-new', '添加服务器', { ico: 'plus', kind: 'primary' }));
  if (!list.length) return html`${note}${empty('没有找到匹配的服务器', '换个关键词或状态试试。', 'search', btn('clear-filters', '清除筛选', { kind: 'soft' }))}`;
  return html`${note}${S.view === 'list' ? serverTable(list) : S.view === 'providers' ? providerBoard(list) : html`<div class="machine-grid">${list.map(serverCard)}</div>`}`;
}
function serversPage() {
  const all = S.ws.servers, scoped = S.provider === null ? all : all.filter(s => providerName(s) === S.provider), counts = statusCounts(scoped);
  const chip = (value, label, n) => html`<button type="button" class="chip ${S.status === value ? 'on' : ''}" data-act="status" data-id="${value}">${label}<b>${n}</b></button>`;
  const providerBanner = S.provider === null ? '' : html`<div class="scope-banner">${btn('provider-clear', '全部服务器', { ico: 'back', kind: 'ghost small' })}<div><strong>${S.provider || '未设置服务商'}</strong><small>${scoped.length} 台 · ${counts.online} 台运行中 · ${scoped.filter(s => { const d = daysLeft(s); return d !== null && d >= 0 && d <= 7; }).length} 台 7 天内到期</small></div>${btn('server-new', '添加该商家机器', { ico: 'plus', kind: 'soft small', id: S.provider })}</div>`;
  return html`
  ${head('服务器', `共 ${all.length} 台，分布在 ${providerGroups(all).length} 个服务商。`, btn('server-new', '添加服务器', { ico: 'plus', kind: 'primary' }))}
  ${providerBanner}
  <div class="toolbar">
    <div class="chips" role="group" aria-label="按状态筛选">${chip('', '全部', scoped.length)}${Object.entries(STATUS).map(([key, s]) => chip(key, s.label, counts[key]))}</div>
    <div class="tools-right">
      <label class="sort">${icon('list', 15)}<span class="sr-only">排序方式</span><select id="sort-select" class="input" aria-label="排序方式">${Object.entries(SORTS).map(([key, label]) => html`<option value="${key}"${raw(S.sort === key ? ' selected' : '')}>${label}</option>`)}</select></label>
      <div class="switch" role="group" aria-label="显示方式">${[['grid', '卡片', 'grid'], ['list', '列表', 'list'], ['providers', '服务商', 'layers']].map(([key, label, ico]) => html`<button type="button" class="${S.view === key ? 'on' : ''}" data-act="view" data-id="${key}" aria-pressed="${S.view === key}">${icon(ico, 16)}<span>${label}</span></button>`)}</div>
      ${all.length ? btn('select-mode', S.selecting ? '完成' : '多选', { ico: S.selecting ? 'check' : 'grid', kind: S.selecting ? 'primary small' : 'soft small' }) : ''}
    </div>
  </div>
  <div id="results">${serverResults()}</div>
  ${S.selecting ? batchBar() : ''}`;
}
function batchBar() {
  const n = S.selected.size, list = filteredServers(), allPicked = list.length > 0 && list.every(s => S.selected.has(s.id));
  const off = n ? '' : 'disabled';
  return html`<div class="batchbar" role="toolbar" aria-label="批量操作">
    <span class="batch-count"><b>${n}</b> 台已选</span>${btn('pick-visible', allPicked ? '取消全选' : '全选当前', { kind: 'ghost small' })}
    <span class="batch-actions">${btn('batch', '状态', { ico: 'server', kind: 'soft small', id: 'status', attrs: off })}${btn('batch', 'TG 提醒', { ico: 'bell', kind: 'soft small', id: 'tg', attrs: off })}${btn('batch', '费用统计', { ico: 'wallet', kind: 'soft small', id: 'cost', attrs: off })}${btn('batch', '删除', { ico: 'trash', kind: 'ghost danger small', id: 'delete', attrs: off })}</span>
  </div>`;
}
function batchModal(kind) {
  const ids = [...S.selected].filter(id => server(id)), names = ids.map(id => server(id).name);
  if (!ids.length) return;
  const choice = (value, label, sub = '', cls = '') => html`<button type="submit" class="choice ${cls}" name="op" value="${value}"><b>${label}</b>${sub ? html`<small>${sub}</small>` : ''}</button>`;
  const bodies = {
    status: html`<div class="choices">${Object.entries(STATUS).map(([key, v]) => choice(key, v.label, '', v.tone))}</div>`,
    tg: html`<div class="choices">${choice('on', '开启 TG 提醒', '到期前 7 天、前 1 天和当天提醒')}${choice('off', '关闭 TG 提醒', '这些机器不再提醒')}</div><p class="hint">保存后和平时一样，只会给 Telegram 发一条确认消息。</p>`,
    cost: html`<div class="choices">${choice('on', '参与首页统计', '计入月付、年付和单期合计')}${choice('off', '不参与统计', '资料和提醒不受影响')}</div>`,
    delete: html`<p class="lede">将删除下面 ${ids.length} 台服务器及其所有记录，这个操作无法撤销。</p><ul class="plain names">${names.slice(0, 12).map(name => html`<li><strong>${name}</strong></li>`)}${names.length > 12 ? html`<li><small>…另外 ${names.length - 12} 台</small></li>` : ''}</ul><div class="choices one">${choice('delete', `删除 ${ids.length} 台`, '', 'danger')}</div>`
  };
  const titles = { status: '批量修改状态', tg: '批量设置 TG 提醒', cost: '批量设置费用统计', delete: '批量删除' };
  modal(titles[kind], html`${bodies[kind]}<p class="hint" data-progress></p>`, cancelBtn(), { sub: `已选 ${ids.length} 台`, form: 'batch', id: kind });
}
// Runs one request per server so each keeps its own revision check; a lost race is retried once on fresh data.
async function eachServer(ids, form, work, { goneIsDone = false } = {}) {
  const failed = []; let done = 0;
  const progress = $('[data-progress]', form);
  for (const [index, id] of ids.entries()) {
    if (progress) progress.textContent = `正在处理 ${index + 1} / ${ids.length}…`;
    const name = server(id)?.name || '已删除的服务器';
    try { await work(id); done++; }
    catch (error) {
      if (error.status === 404) { done++; continue; }
      if (error.status === 409) { try { await loadWorkspace(); if (!server(id) && goneIsDone) { done++; continue; } if (server(id)) { await work(id); done++; continue; } } catch { /* reported below */ } }
      failed.push(name);
    }
  }
  return { done, failed };
}
async function runBatch(form, submitter) {
  const kind = form.dataset.id, op = submitter?.value || '', ids = [...S.selected].filter(id => server(id));
  if (!ids.length) throw new Error('没有选中的服务器。');
  // Each choice is an explicit button; never infer "off" from a missing value.
  if ((kind === 'tg' || kind === 'cost') && !['on', 'off'].includes(op)) throw new Error('请点击一个选项。');
  if (kind === 'tg') {
    const current = S.ws.servers.filter(s => s.expiryReminder === true).map(s => s.id);
    await submitTgSelection(toggledSet(current, ids, op === 'on')); exitSelecting(); render(); return;
  }
  if (kind === 'cost') {
    const save = () => api('/settings/costs/servers', { method: 'PUT', body: { serverIds: toggledSet(S.ws.servers.filter(s => s.excludeFromCosts !== true).map(s => s.id), ids, op === 'on') } });
    try { await save(); } catch (error) { if (error.status !== 409) throw error; await loadWorkspace(); await save(); }
    await loadWorkspace(); closeLayer('modal', true); exitSelecting(); render(); toast(`${ids.length} 台已${op === 'on' ? '参与' : '退出'}首页统计`); return;
  }
  let result;
  if (kind === 'status') {
    if (!Object.hasOwn(STATUS, op)) throw new Error('请选择一个状态。');
    const todo = ids.filter(id => server(id)?.status !== op);
    result = await eachServer(todo, form, async id => { const r = await api('/servers/' + encodeURIComponent(id), { method: 'PUT', body: { status: op } }); S.ws.revision = r.revision; });
    result.done += ids.length - todo.length;
  } else if (kind === 'delete') {
    if (op !== 'delete') return;
    result = await eachServer(ids, form, async id => { const r = await api('/servers/' + encodeURIComponent(id), { method: 'DELETE' }); S.ws.revision = r.revision; }, { goneIsDone: true });
  } else return;
  await loadWorkspace().catch(() => {}); closeLayer('modal', true); exitSelecting(); render();
  toast(result.failed.length ? `已完成 ${result.done} 台，${result.failed.length} 台未完成：${result.failed.join('、')}` : `已完成 ${result.done} 台`, result.failed.length ? 'bad' : '');
}

function renewalsPage() {
  const buckets = renewalBuckets(S.ws.servers);
  const sections = [['overdue', '已过期', 'danger'], ['week', '7 天内', 'warning'], ['month', '30 天内', 'notice'], ['later', '之后', 'calm'], ['undated', '未设置续费日', 'muted']];
  const stat = (key, label, tone) => html`<button type="button" class="stat ${tone}" data-act="jump" data-id="group-${key}"${buckets[key].length ? '' : raw(' disabled')}><b>${buckets[key].length}</b><span>${label}</span></button>`;
  return html`
  ${head('续费', '按到期时间排好队，续费后点一下「已续费」即可顺延到期日。')}
  <div class="stat-strip">${sections.map(([key, label, tone]) => stat(key, label, tone))}</div>
  ${S.ws.servers.length ? sections.filter(([key]) => buckets[key].length).map(([key, label, tone]) => html`<section class="group" id="group-${key}"><h2><i class="${tone}"></i>${label}<span>${buckets[key].length}</span></h2><div class="tile flush"><div class="rows">${buckets[key].map(({ server: s }) => renewalLine(s, key !== 'undated'))}</div></div></section>`) : html`<div class="tile">${empty('还没有续费日程', '为服务器填写续费日期后，会在这里按时间排列。', 'calendar', btn('server-new', '添加服务器', { ico: 'plus', kind: 'primary' }))}</div>`}`;
}

function costsPage() {
  const c = S.ws.costs || {}, cm = S.ws.customMonthly || {}, rates = S.ws.settings.rates || {};
  const included = S.ws.servers.filter(s => s.excludeFromCosts !== true);
  const byProvider = providerGroups(included).map(group => ({ name: group.name, count: group.servers.length, monthly: group.servers.reduce((sum, s) => sum + (monthlyCNY(s, rates) || 0), 0) })).filter(row => row.monthly > 0).sort((a, b) => b.monthly - a.monthly);
  const max = Math.max(...byProvider.map(row => row.monthly), 1);
  const customRows = new Map((cm.rows || []).map(row => [row.id, row.monthlyTotal]));
  const customServers = S.ws.servers.filter(s => (cm.serverIds || []).includes(s.id));
  return html`
  ${head('费用', '首页统计和自定义组合分开计算，金额按参考汇率折算为人民币。')}
  <div class="bento costs">
    <article class="tile spend">
      <div class="tile-head"><span class="tile-label">${icon('wallet', 16)}首页统计</span>${btn('cost-scope', '选择服务器', { ico: 'settings', kind: 'ghost small' })}</div>
      <div class="hero-number">${yuan(c.monthlyTotal, '/ 月')}</div>
      <dl class="trio"><div><dt>年付</dt><dd>${yuan(c.yearlyTotal)}</dd></div><div><dt>单期合计</dt><dd>${yuan(c.recordedTotal)}</dd></div><div><dt>参与统计</dt><dd>${included.length}<small> / ${S.ws.servers.length} 台</small></dd></div></dl>
      <p class="tile-note">${costScope()}</p>
    </article>
    <article class="tile custom">
      <div class="tile-head"><span class="tile-label">${icon('layers', 16)}自定义组合</span>${btn('custom-scope', '选择服务器', { ico: 'plus', kind: 'ghost small' })}</div>
      <div class="hero-number small">${yuan(cm.monthlyTotal, '/ 月')}</div>
      <p class="tile-note">已选 ${customServers.length} 台${Number(cm.invalidCostCount) ? ` · ${cm.invalidCostCount} 台账单不完整` : ''}。自由组合几台机器，单独看它们每月要花多少。</p>
      ${customServers.length ? html`<div class="rows compact">${customServers.map(s => html`<button type="button" class="row" data-act="detail" data-id="${s.id}"><span class="row-main"><strong>${s.name}</strong><small>${priceText(s) || '未记录价格'}</small></span><span class="row-side keep">${typeof customRows.get(s.id) === 'number' ? html`<b>¥${money(customRows.get(s.id))}</b><small> / 月</small>` : pill('未计入', 'warning')}</span></button>`)}</div>` : ''}
    </article>
    <article class="tile providers-cost">
      <div class="tile-head"><span class="tile-label">${icon('globe', 16)}按服务商 · 折合月付</span><span class="tile-hint">约数</span></div>
      ${byProvider.length ? html`<ul class="bars">${byProvider.map(row => html`<li><span class="bar-label"><strong>${row.name || '未设置服务商'}</strong><small>${row.count} 台</small></span><span class="bar"><i style="width:${Math.max(4, Math.round(row.monthly / max * 100))}%"></i></span><b>¥${money(row.monthly)}</b></li>`)}</ul>` : empty('暂无可统计的账单', '为参与统计的服务器填写价格后显示。', 'wallet')}
    </article>
    <article class="tile rates">
      <div class="tile-head"><span class="tile-label">${icon('info', 16)}参考汇率</span></div>
      <dl class="rate-grid">${Object.entries(rates).map(([code, value]) => html`<div><dt>${code}<small>${CURRENCIES[code] || ''}</small></dt><dd>¥ ${value}</dd></div>`)}</dl>
      <p class="tile-note">${S.ws.settings.rateSource || '应用内参考汇率'}。实际扣款以服务商账单为准。</p>
    </article>
  </div>`;
}

function commandsPage() {
  const list = S.ws.commands.filter(c => [c.title, c.command, c.category, c.note].join(' ').toLowerCase().includes(S.q.trim().toLowerCase()));
  return html`
  ${head('指令', '常用命令随手复制。这里只保存和复制，不会在服务器上执行。', btn('command-new', '添加指令', { ico: 'plus', kind: 'primary' }))}
  <div class="toolbar"><label class="search">${icon('search', 16)}<input id="command-search" class="input" type="search" placeholder="搜索名称、内容或分类" value="${S.q}" autocomplete="off"></label><span class="count">${S.ws.commands.length} 条</span></div>
  <div id="results">${list.length ? html`<div class="snippets">${list.map(c => html`<article class="snippet"><header><div><h3>${c.title}</h3><p>${c.note || c.category || '暂无说明'}</p></div>${iconBtn('command-edit', '编辑指令', 'edit', { id: c.id, kind: 'ghost' })}</header><pre class="code">${c.command}</pre><footer>${c.category ? pill(c.category, 'accent') : html`<span></span>`}${btn('command-copy', '复制', { ico: 'copy', kind: 'soft small', id: c.id })}</footer></article>`)}</div>` : html`<div class="tile">${S.ws.commands.length ? empty('没有匹配的指令', '试试其他关键词。', 'search') : empty('收藏你的第一条指令', '把常用操作和说明存下来，下次一键复制。', 'terminal', btn('command-new', '添加指令', { ico: 'plus', kind: 'primary' }))}</div>`}</div>`;
}

function backupsPage() {
  const data = S.backups;
  const actions = html`${btn('backups-refresh', '刷新', { ico: 'refresh', kind: 'ghost' })}${btn('backup-now', '立即备份', { ico: 'shield', kind: 'primary' })}`;
  if (!data) return html`${head('备份', '每天自动加密备份，恢复前先核对差异。', actions)}<div class="tile loading">正在读取服务器上的加密备份…</div>`;
  if (data.error) return html`${head('备份', '每天自动加密备份，恢复前先核对差异。', actions)}<div class="tile">${empty('暂时无法读取备份', data.error, 'alert', btn('backups-refresh', '重试', { ico: 'refresh', kind: 'soft' }))}</div>`;
  const status = data.status || {}, records = data.backups || [];
  const kinds = { automatic: '自动', daily: '每日', manual: '手动', 'before-restore': '恢复前', 'pre-restore': '恢复前', restore: '恢复前' };
  const cutoff = S.backupRange === 'all' ? -Infinity : Date.now() - Number(S.backupRange) * 86400000;
  const shown = records.filter(b => !(new Date(b.createdAt).valueOf() < cutoff));
  return html`
  ${head('备份', '每天自动加密备份，保留最近 7 天；手动和恢复前备份各保留 30 份。', actions)}
  <div class="bento three">
    <article class="tile mini"><span class="tile-label">${icon('calendar', 16)}备份计划</span><b>${status.enabled === false ? '已暂停' : '每天自动'}</b><small>保留 ${Number(status.retentionDays) || 7} 天</small></article>
    <article class="tile mini"><span class="tile-label">${icon('check', 16)}最近成功</span><b>${status.lastBackupAt ? beijingTime(status.lastBackupAt) : '等待首次备份'}</b><small>北京时间</small></article>
    <article class="tile mini"><span class="tile-label">${icon('refresh', 16)}下次检查</span><b>${status.nextBackupAt ? beijingTime(status.nextBackupAt) : '自动检查中'}</b><small>北京时间</small></article>
  </div>
  ${status.lastError ? html`<div class="callout warning">${icon('alert', 16)}<span>最近一次备份未完成：${status.lastError}。程序会继续重试。</span></div>` : ''}
  <section class="group"><h2>可恢复的版本<span>${records.length}</span><span class="spacer"></span><span class="chips small">${[['all', '全部'], ['30', '30 天'], ['7', '7 天']].map(([key, label]) => html`<button type="button" class="chip ${S.backupRange === key ? 'on' : ''}" data-act="backup-range" data-id="${key}">${label}</button>`)}</span></h2>
  <div class="tile flush">${shown.length ? html`<div class="rows">${shown.map(b => html`<div class="row static"><span class="row-icon">${icon('shield', 18)}</span><span class="row-main"><strong>${beijingTime(b.createdAt)}</strong><small>${kinds[b.kind] || '加密'}备份 · ${Number(b.serverCount) || 0} 台服务器 · ${Number(b.commandCount) || 0} 条指令</small></span>${btn('backup-preview', '查看并恢复', { kind: 'soft small', id: b.filename })}</div>`)}</div>` : empty(records.length ? '这个时间范围内没有备份' : '还没有备份', records.length ? '切换到「全部」查看所有保留版本。' : '首次自动备份完成后会显示在这里，也可以立即备份一份。', 'shield')}</div></section>
  <p class="foot-note">${icon('lock', 13)}备份文件加密保存在服务器上，不会下载到当前设备。</p>`;
}

function settingsPage() {
  const account = S.session.account || {}, t = S.ws.settings.telegram || {}, st = S.ws.telegramStatus || {}, q = S.ws.telegramQueryStatus || {};
  const selected = S.ws.servers.filter(s => s.expiryReminder === true), undated = selected.filter(s => daysLeft(s) === null).length;
  const setting = (ico, title, text, action) => html`<div class="setting"><span class="setting-ico">${icon(ico, 18)}</span><div><h3>${title}</h3><p>${text}</p></div>${action}</div>`;
  const tgState = t.enabled && t.configured ? pill('已开启', 'ok') : t.configured ? pill('已暂停', 'warning') : pill('未配置', 'muted');
  return html`
  ${head('设置', '账户安全、Telegram 提醒与系统信息。')}
  <div class="bento two">
    <section class="tile">
      <div class="tile-head"><span class="tile-label">${icon('shield', 16)}账户与安全</span>${pill(account.username || '管理员', 'accent')}</div>
      ${setting('lock', '登录密码', '独立密码，至少 14 位。修改后其他设备需要重新登录。', btn('password-change', '修改', { kind: 'soft small' }))}
      ${setting('key', '双重验证', account.totpEnabled ? '已开启。登录和敏感操作需要验证器中的动态码。' : '使用验证器生成动态码，进一步保护账户。', btn(account.totpEnabled ? 'totp-disable' : 'totp-start', account.totpEnabled ? '关闭' : '开启', { kind: account.totpEnabled ? 'ghost small' : 'soft small' }))}
      ${setting('shield', '数据备份', '每天自动加密备份，恢复前可以核对差异。', html`<a class="btn soft small" href="#/backups">管理备份</a>`)}
      ${setting('spark', '外观', '浅色或深色界面，只保存在这台设备上。', html`<div class="switch small" role="group" aria-label="外观">${[['auto', '跟随系统'], ['light', '浅色'], ['dark', '深色']].map(([key, label]) => html`<button type="button" class="${(prefs.get('theme', 'auto')) === key ? 'on' : ''}" data-act="theme" data-id="${key}" aria-pressed="${prefs.get('theme', 'auto') === key}">${label}</button>`)}</div>`)}
      ${setting('logout', '退出登录', '在公用设备上用完后，记得退出。', btn('logout', '退出', { kind: 'ghost small' }))}
    </section>
    <section class="tile">
      <div class="tile-head"><span class="tile-label">${icon('send', 16)}Telegram 到期提醒</span>${tgState}</div>
      ${setting('settings', '机器人配置', `Chat ID：${t.chatId || '未设置'} · Bot Token：${t.hasToken ? '已加密保存' : '未保存'}`, btn('tg-settings', '配置', { kind: 'soft small' }))}
      ${setting('server', `提醒的机器 · ${selected.length} / ${S.ws.servers.length}`, `到期前 7 天、前 1 天和当天各提醒一次${undated ? `；其中 ${undated} 台缺少有效续费日期` : ''}。`, btn('tg-servers', '选择', { kind: 'soft small' }))}
      ${setting('bell', '在 Telegram 里查询', '私聊机器人发送「检查」「到期 30」「开销」或「帮助」。提醒消息下方可一键记录续费。', t.configured ? btn('tg-test', '发测试消息', { kind: 'ghost small' }) : '')}
      <dl class="facts">
        <div><dt>最近检查</dt><dd>${beijingTime(st.lastCheckedAt) || '暂无'}</dd></div>
        <div><dt>最近发送</dt><dd>${beijingTime(st.lastSentAt) || '暂无'}</dd></div>
        <div><dt>TG 查询</dt><dd>${q.enabled && q.configured ? (q.lastError ? '连接待恢复' : '已启用') : '等待配置'}</dd></div>
        <div><dt>守护</dt><dd>${st.supervisionEnabled ? '异常自动恢复' : '每 5 分钟检查'}</dd></div>
      </dl>
      ${st.lastError ? html`<div class="callout warning">${icon('alert', 16)}<span>${st.lastError}</span></div>` : ''}
      ${q.lastError ? html`<div class="callout warning">${icon('alert', 16)}<span>TG 查询：${q.lastError}</span></div>` : ''}
      ${st.uncertainCount || st.failedCount ? html`<div class="callout warning">${icon('alert', 16)}<span>${st.uncertainCount ? `有 ${st.uncertainCount} 条提醒的发送结果无法确认，请先查看 TG，重试可能收到重复消息。` : `有 ${st.failedCount} 条提醒未发送成功，请检查 Bot Token 和 Chat ID。`}</span>${btn('tg-retry', '重试', { kind: 'soft small' })}</div>` : ''}
    </section>
  </div>`;
}

// ── Server detail (side panel) ───────────────────────────────────────────────
const DETAIL_TABS = [['connect', '连接'], ['billing', '账单'], ['profile', '资料'], ['notes', '域名与备注']];
function credentialBlock(s, field, title, ico, user, address, url = null, ssh = false) {
  const saved = s.hasSecrets?.[field] === true;
  return html`<section class="cred" data-field="${field}">
    <header><span class="cred-title">${icon(ico, 16)}${title}</span>${ssh ? btn('ssh-copy', '复制 SSH', { ico: 'terminal', kind: 'ghost small', id: s.id }) : url ? html`<a class="btn ghost small" href="${url}" target="_blank" rel="noopener noreferrer">${icon('external', 15)}<span>打开</span></a>` : ''}</header>
    ${address ? html`<p class="cred-address mono">${address}</p>` : ''}
    <dl><div><dt>用户名</dt><dd>${user || '未填写'}</dd></div>
    <div class="secret"><dt>密码</dt><dd><span class="secret-value mono" data-secret-value>${saved ? '••••••••' : '未保存'}</span>${saved ? html`<span class="secret-actions">${iconBtn('secret-show', '显示密码', 'eye', { id: s.id, kind: 'ghost' })}${iconBtn('secret-copy', '复制密码', 'copy', { id: s.id, kind: 'ghost' })}</span>` : ''}</dd></div></dl>
  </section>`;
}
function renewalHistory(s) {
  const records = [...(s.renewalHistory || [])].sort((a, b) => String(b.paidOn).localeCompare(String(a.paidOn)) || String(b.createdAt).localeCompare(String(a.createdAt)));
  if (!records.length) return html`<p class="hint">还没有续费记录。续费后点「记录续费」，到期日会自动顺延。</p>`;
  const totals = new Map(); for (const r of records) totals.set(r.currency, (totals.get(r.currency) || 0) + Number(r.amount || 0));
  return html`<p class="hint">累计已记录 ${[...totals].map(([cur, total]) => `${cur} ${money(total)}`).join(' · ')}</p><ol class="history">${records.map(r => html`<li><div><strong>${r.currency} ${money(r.amount)}</strong><small>${(CYCLES[r.cycle] || CYCLES.monthly).label} × ${Number(r.periods) || 1} · 延至 ${shortDate(parseDate(r.newExpiry))}</small>${r.note ? html`<p>${r.note}</p>` : ''}</div><time>${shortDate(parseDate(r.paidOn))}</time></li>`)}</ol>`;
}
function detailPanel(id, tab = 'connect') {
  const s = server(id); if (!s) { closeLayer('panel', true); return; }
  if (!DETAIL_TABS.some(([key]) => key === tab)) tab = 'connect';
  const date = renewalOf(s), days = daysLeft(s);
  let body = '';
  if (tab === 'connect') body = html`
    ${credentialBlock(s, 'sshPassword', 'SSH', 'terminal', s.username || 'root', `${s.ipAddress || '未填写地址'} · 端口 ${s.sshPort || 22}`, null, true)}
    ${s.serverURL || s.serverURLUsername || s.hasSecrets?.serverURLPassword ? credentialBlock(s, 'serverURLPassword', '服务商控制台', 'globe', s.serverURLUsername, s.serverURL, safeURL(s.serverURL)) : ''}
    ${s.panelURL || s.panelUsername || s.hasSecrets?.panelPassword ? credentialBlock(s, 'panelPassword', '管理面板', 'grid', s.panelUsername, s.panelURL, safeURL(s.panelURL)) : ''}
    <p class="hint">${icon('lock', 13)}密码只在你点开时向服务器读取，60 秒后或切走页面时自动隐藏。</p>`;
  else if (tab === 'billing') body = html`
    <div class="facts-grid">
      <div><dt>单期价格</dt><dd>${priceText(s) || '未记录'}</dd></div><div><dt>下次到期</dt><dd>${date ? `${shortDate(date)} ${weekday(date)}` : dueLabel(null, s)}</dd></div>
      <div><dt>续费方式</dt><dd>${s.autoRenew ? '服务商自动续费' : '手动续费'}</dd></div><div><dt>首页费用统计</dt><dd>${s.excludeFromCosts === true ? '不参与' : '参与'}</dd></div>
      <div><dt>TG 到期提醒</dt><dd>${s.expiryReminder === true ? '已开启' : '未开启'}</dd></div><div><dt>折合月付</dt><dd>${monthlyCNY(s, S.ws.settings.rates) === null ? '—' : `约 ¥${money(monthlyCNY(s, S.ws.settings.rates))}`}</dd></div>
    </div>
    <div class="section-head"><h3>续费记录</h3>${btn('renew', '记录续费', { ico: 'check', kind: 'soft small', id: s.id })}</div>${renewalHistory(s)}`;
  else if (tab === 'profile') body = html`<div class="facts-grid">
      <div><dt>服务商</dt><dd>${s.provider || '—'}</dd></div><div><dt>区域</dt><dd>${s.region || '—'}</dd></div>
      <div class="wide"><dt>IP / 主机地址</dt><dd class="mono">${s.ipAddress || '—'}</dd></div>
      <div><dt>配置 / 套餐</dt><dd>${s.plan || '—'}</dd></div><div><dt>主要用途</dt><dd>${s.purpose || '—'}</dd></div>
      <div><dt>月流量</dt><dd>${s.monthlyTraffic || '—'}</dd></div><div><dt>带宽</dt><dd>${normalizeBandwidth(s.bandwidth) || '—'}</dd></div>
      <div class="wide"><dt>标签</dt><dd>${(s.tags || []).length ? (s.tags || []).map(tag => pill(tag, 'accent')) : '—'}</dd></div>
      <div><dt>创建时间</dt><dd>${beijingTime(s.createdAt) || '—'}</dd></div><div><dt>最近更新</dt><dd>${beijingTime(s.updatedAt) || '—'}</dd></div></div>`;
  else body = html`
    <div class="section-head"><h3>绑定域名 · ${(s.domains || []).length}</h3></div>
    ${(s.domains || []).length ? html`<ul class="plain">${s.domains.map(d => html`<li><strong>${d.domain}</strong><small>${d.recordType} → ${d.target || '—'}${d.sslNote ? ` · ${d.sslNote}` : ''}</small>${d.remark ? html`<p>${d.remark}</p>` : ''}</li>`)}</ul>` : html`<p class="hint">暂无域名记录。</p>`}
    <div class="section-head"><h3>用途记录 · ${(s.usages || []).length}</h3></div>
    ${(s.usages || []).length ? html`<ul class="plain">${s.usages.map(u => html`<li><strong>${u.title}</strong><small>${shortDate(parseDate(u.date))}</small>${u.detail ? html`<p>${u.detail}</p>` : ''}</li>`)}</ul>` : html`<p class="hint">暂无用途记录。</p>`}
    <div class="section-head"><h3>备注</h3></div><p class="note-text">${s.notes || '暂无备注'}</p>`;
  openLayer('panel', html`<div class="drawer" data-server="${s.id}" data-tab="${tab}">
    <header class="drawer-head">
      <div class="drawer-title"><div class="drawer-meta">${statusPill(s.status)}${days !== null ? pill(dueLabel(days, s), dueTone(days)) : ''}</div><h2>${s.name}</h2><p>${[providerName(s) || '未设置服务商', s.region].filter(Boolean).join(' · ')}</p></div>
      ${iconBtn('close-panel', '关闭', 'close', { kind: 'ghost' })}
    </header>
    <div class="drawer-actions">${btn('server-edit', '编辑', { ico: 'edit', kind: 'primary small', id: s.id })}${btn('renew', '记录续费', { ico: 'check', kind: 'soft small', id: s.id })}${btn('ssh-copy', '复制 SSH', { ico: 'terminal', kind: 'soft small', id: s.id })}${btn('provider', '同服务商', { ico: 'layers', kind: 'ghost small', id: providerName(s) })}</div>
    <nav class="tabs" role="tablist">${DETAIL_TABS.map(([key, label]) => html`<button type="button" role="tab" aria-selected="${key === tab}" data-act="detail-tab" data-id="${key}">${label}</button>`)}</nav>
    <div class="drawer-body">${body}</div>
    <footer class="drawer-foot">${btn('server-delete', '删除这台服务器', { ico: 'trash', kind: 'ghost danger small', id: s.id })}</footer>
  </div>`, { label: s.name });
}

// ── Secrets: fetched on demand, shown for 60 seconds at most ────────────────
let secretEpoch = 0; const secretTimers = new Set();
function clearSecrets(root = document) {
  secretEpoch++;
  for (const timer of secretTimers) clearTimeout(timer); secretTimers.clear();
  for (const node of $$('[data-secret-value][data-revealed]', root)) { node.textContent = '••••••••'; node.removeAttribute('data-revealed'); }
  for (const node of $$('[data-act="secret-show"][aria-pressed="true"]', root)) node.setAttribute('aria-pressed', 'false');
}
async function fetchSecret(id, field) {
  const epoch = secretEpoch, result = await api('/servers/' + encodeURIComponent(id) + '/secrets', { method: 'POST', body: {} });
  if (epoch !== secretEpoch || !$('#panel').open || document.hidden) throw new Error('已取消。');
  return typeof result[field] === 'string' ? result[field] : '';
}
async function showSecret(node) {
  const block = node.closest('.cred'), value = $('[data-secret-value]', block);
  if (value.hasAttribute('data-revealed')) { value.textContent = '••••••••'; value.removeAttribute('data-revealed'); node.setAttribute('aria-pressed', 'false'); return; }
  node.disabled = true;
  try {
    const secret = await fetchSecret(node.dataset.id, block.dataset.field);
    value.textContent = secret || '未保存'; value.setAttribute('data-revealed', ''); node.setAttribute('aria-pressed', 'true');
    const timer = setTimeout(() => { if (value.isConnected) { value.textContent = '••••••••'; value.removeAttribute('data-revealed'); node.setAttribute('aria-pressed', 'false'); } secretTimers.delete(timer); }, 60000);
    secretTimers.add(timer);
  } finally { node.disabled = false; }
}
async function copySecret(node) {
  const block = node.closest('.cred');
  node.disabled = true;
  try {
    const pending = fetchSecret(node.dataset.id, block.dataset.field).then(value => { if (!value) throw new Error('这个账号还没有保存密码。'); return value; });
    // Start the clipboard write inside the click so browsers keep the user gesture.
    if (typeof ClipboardItem === 'function' && navigator.clipboard?.write) {
      const blob = pending.then(value => new Blob([value], { type: 'text/plain' })); blob.catch(() => {});
      try { await navigator.clipboard.write([new ClipboardItem({ 'text/plain': blob })]); toast('密码已复制'); return; } catch { /* fall through */ }
    }
    const value = await pending;
    try { await navigator.clipboard.writeText(value); toast('密码已复制'); }
    catch { const target = $('[data-secret-value]', block); target.textContent = value; target.setAttribute('data-revealed', ''); getSelection()?.selectAllChildren(target); toast('浏览器未允许自动复制，已显示并选中密码'); }
  } finally { node.disabled = false; }
}
async function copyText(text, done = '已复制') {
  try { await navigator.clipboard.writeText(text); toast(done); }
  catch { modal('手动复制', html`<p class="hint">浏览器未允许自动复制，请手动复制下面的内容。</p><textarea class="input mono" rows="4" readonly autofocus>${text}</textarea>`, btn('close-modal', '完成', { kind: 'primary' })); $('#modal textarea')?.select(); }
}

// ── Server editor ────────────────────────────────────────────────────────────
const editorState = new WeakMap();
const field = (name, label, value = '', { type = 'text', hint = '', wide = false, attrs = '', required = false } = {}) => html`<label class="field ${wide ? 'wide' : ''}"><span>${label}${required ? html`<i>*</i>` : ''}</span><input class="input" name="${name}" type="${type}" value="${value ?? ''}" placeholder="${hint}"${raw(required ? ' required' : '')}${raw(attrs ? ' ' + attrs : '')}></label>`;
const select = (name, label, value, options, { wide = false } = {}) => html`<label class="field ${wide ? 'wide' : ''}"><span>${label}</span><select class="input" name="${name}">${Object.entries(options).map(([key, text]) => html`<option value="${key}"${raw(key === value ? ' selected' : '')}>${text}</option>`)}</select></label>`;
const area = (name, label, value = '', hint = '', rows = 3) => html`<label class="field wide"><span>${label}</span><textarea class="input" name="${name}" rows="${rows}" placeholder="${hint}" maxlength="20000">${value || ''}</textarea></label>`;
const toggle = (name, label, checked, hint = '') => html`<label class="toggle wide"><input type="checkbox" name="${name}"${raw(checked ? ' checked' : '')}><span class="switch-ui"></span><span><b>${label}</b>${hint ? html`<small>${hint}</small>` : ''}</span></label>`;
const secretField = (name, label, s) => html`<div class="field"><label class="field"><span>${label}</span><input class="input" name="${name}" type="password" placeholder="${s.hasSecrets?.[name] ? '已保存，留空不修改' : '未设置'}" autocomplete="new-password" maxlength="4096"></label>${s.hasSecrets?.[name] ? html`<label class="check"><input type="checkbox" name="clear_${name}">删除已保存的密码</label>` : ''}</div>`;
const domainRow = (d = {}) => html`<div class="repeat" data-kind="domain" data-rid="${d.id || crypto.randomUUID()}" data-created="${d.createdAt || new Date().toISOString()}"><div class="repeat-grid">${field('domain', '域名', d.domain, { hint: 'example.com', required: true })}${select('recordType', '记录类型', d.recordType || 'A', { A: 'A', AAAA: 'AAAA', CNAME: 'CNAME', TXT: 'TXT', MX: 'MX', NS: 'NS', OTHER: '其他' })}${field('target', '解析目标', d.target)}${field('sslNote', 'SSL 说明', d.sslNote)}${field('remark', '备注', d.remark, { wide: true })}</div>${iconBtn('repeat-remove', '删除这条', 'trash', { kind: 'ghost' })}</div>`;
const usageRow = (u = {}) => html`<div class="repeat" data-kind="usage" data-rid="${u.id || crypto.randomUUID()}"><div class="repeat-grid">${field('usageTitle', '名称', u.title, { hint: '例如：个人博客', required: true })}${select('usageKind', '类型', u.kind || 'website', { website: '网站', database: '数据库', proxy: '代理', bot: '机器人', storage: '存储', note: '其他' })}${field('usageDate', '日期', isoDay(parseDate(u.date)) || beijingToday(), { type: 'date' })}${area('usageDetail', '说明', u.detail, '', 2)}</div>${iconBtn('repeat-remove', '删除这条', 'trash', { kind: 'ghost' })}</div>`;
function editorPanel(id = '', defaults = {}) {
  const s = (id && server(id)) || { provider: defaults.provider || '', status: 'online', sshPort: 22, username: 'root', monthlyCostCurrency: 'CNY', monthlyCostCycle: 'monthly' };
  const editing = Boolean(id && s.id);
  const node = openLayer('panel', html`<form class="drawer" data-form="server" data-id="${editing ? s.id : ''}" novalidate>
    <header class="drawer-head"><div class="drawer-title"><h2>${editing ? '编辑服务器' : '添加服务器'}</h2><p>${editing ? s.name : '把连接信息、账单和续费日期放在一起。'}</p></div>${iconBtn('close-panel', '关闭', 'close', { kind: 'ghost' })}</header>
    <div class="drawer-body form">
      <div class="form-error" role="alert"></div>
      <fieldset><legend>基本信息</legend><div class="grid2">
        ${field('name', '名称', s.name, { hint: '给这台机器起个名字', required: true, attrs: 'maxlength="120" autofocus' })}${field('provider', '服务商', s.provider, { hint: '同名服务商会归为一组', attrs: 'maxlength="120"' })}
        ${field('ipAddress', 'IP / 主机地址', s.ipAddress, { hint: 'IPv4、IPv6 或域名', attrs: 'maxlength="253"' })}${select('status', '状态', s.status || 'online', Object.fromEntries(Object.entries(STATUS).map(([key, v]) => [key, v.label])))}
        ${field('region', '区域', s.region, { hint: '例如：东京' })}${field('plan', '配置 / 套餐', s.plan, { hint: '例如：2 核 / 4 GB / 80 GB' })}
        ${field('purpose', '主要用途', s.purpose)}${field('tagsText', '标签', (s.tags || []).join(', '), { hint: '用逗号分隔' })}
        ${field('monthlyTraffic', '月流量', s.monthlyTraffic, { hint: '例如：1 TB' })}${field('bandwidth', '带宽', normalizeBandwidth(s.bandwidth), { hint: '例如 500M 或 1G' })}
        ${toggle('isPinned', '置顶', s.isPinned === true, '在列表和总览中优先显示')}
      </div></fieldset>
      <fieldset><legend>账单与续费</legend><div class="grid2">
        ${field('monthlyCostAmount', '单期价格', s.monthlyCostAmount, { type: 'number', hint: '尚未填写', attrs: 'min="0" step="0.000001"' })}${select('monthlyCostCurrency', '币种', s.monthlyCostCurrency || 'CNY', Object.fromEntries(Object.entries(CURRENCIES).map(([code, name]) => [code, `${code} · ${name}`])))}
        ${select('monthlyCostCycle', '付费周期', s.monthlyCostCycle || 'monthly', Object.fromEntries(Object.entries(CYCLES).map(([key, v]) => [key, v.label])))}${field('renewalDate', '下次续费日期', isoDay(renewalOf(s)), { type: 'date' })}
        ${toggle('includeInCosts', '参与首页费用统计', s.excludeFromCosts !== true)}${toggle('autoRenew', '已开启自动续费', s.autoRenew === true)}
        ${toggle('expiryReminder', 'TG 到期提醒', s.expiryReminder === true, '到期前 7 天、前 1 天和当天各提醒一次')}
      </div></fieldset>
      <fieldset><legend>SSH</legend><div class="grid2">${field('username', '用户名', s.username || 'root')}${field('sshPort', '端口', s.sshPort || 22, { type: 'number', required: true, attrs: 'min="1" max="65535" step="1"' })}${secretField('sshPassword', 'SSH 密码', s)}</div></fieldset>
      <fieldset><legend>服务商控制台</legend><div class="grid2">${field('serverURL', '网址', s.serverURL, { type: 'url', hint: 'https://', wide: true })}${field('serverURLUsername', '用户名', s.serverURLUsername)}${secretField('serverURLPassword', '密码', s)}</div></fieldset>
      <fieldset><legend>管理面板</legend><div class="grid2">${field('panelURL', '网址', s.panelURL, { type: 'url', hint: 'https://', wide: true })}${field('panelUsername', '用户名', s.panelUsername)}${secretField('panelPassword', '密码', s)}</div></fieldset>
      <fieldset><legend>绑定域名</legend><div class="repeats" id="domains">${(s.domains || []).map(domainRow)}</div>${btn('domain-add', '添加域名', { ico: 'plus', kind: 'ghost small' })}</fieldset>
      <fieldset><legend>用途记录</legend><div class="repeats" id="usages">${(s.usages || []).map(usageRow)}</div>${btn('usage-add', '添加用途', { ico: 'plus', kind: 'ghost small' })}</fieldset>
      <fieldset><legend>备注</legend>${area('notes', '补充说明', s.notes, '安装位置、重要提醒等', 4)}</fieldset>
    </div>
    <footer class="drawer-foot">${editing ? btn('server-delete', '删除', { ico: 'trash', kind: 'ghost danger small', id: s.id }) : html`<span></span>`}<span class="spacer"></span>${btn('editor-cancel', '取消', { kind: 'ghost', id: editing ? s.id : '' })}${submitBtn(editing ? '保存修改' : '添加服务器')}</footer>
  </form>`, { label: editing ? '编辑服务器' : '添加服务器' });
  const form = $('form', node);
  editorState.set(form, { original: readServerForm(form), revision: S.ws.revision, retry: null });
}
function readServerForm(form) {
  const f = new FormData(form), get = name => (f.get(name)?.toString() || '');
  const data = {};
  for (const key of ['name', 'provider', 'ipAddress', 'username', 'region', 'plan', 'monthlyTraffic', 'purpose', 'notes', 'serverURL', 'serverURLUsername', 'panelURL', 'panelUsername', 'status', 'monthlyCostAmount', 'monthlyCostCurrency', 'monthlyCostCycle']) data[key] = key === 'notes' ? get(key) : get(key).trim();
  data.bandwidth = normalizeBandwidth(get('bandwidth'));
  data.sshPort = Number(get('sshPort'));
  data.tags = tagsFrom(get('tagsText'));
  for (const key of ['autoRenew', 'expiryReminder', 'isPinned']) data[key] = f.has(key);
  data.excludeFromCosts = !f.has('includeInCosts');
  data.renewalDate = get('renewalDate') ? get('renewalDate') + 'T00:00:00.000Z' : null;
  data.renewalDateText = get('renewalDate');
  for (const key of ['sshPassword', 'serverURLPassword', 'panelPassword']) { if (f.has('clear_' + key)) data[key] = ''; else if (get(key)) data[key] = get(key); }
  data.domains = $$('.repeat[data-kind="domain"]', form).map(row => ({ id: row.dataset.rid, createdAt: row.dataset.created, domain: $('[name="domain"]', row).value.trim(), recordType: $('[name="recordType"]', row).value, target: $('[name="target"]', row).value.trim(), sslNote: $('[name="sslNote"]', row).value.trim(), remark: $('[name="remark"]', row).value.trim() }));
  data.usages = $$('.repeat[data-kind="usage"]', form).map(row => ({ id: row.dataset.rid, title: $('[name="usageTitle"]', row).value.trim(), kind: $('[name="usageKind"]', row).value, date: ($('[name="usageDate"]', row).value || beijingToday()) + 'T00:00:00.000Z', detail: $('[name="usageDetail"]', row).value.trim() }));
  return data;
}
async function saveServer(form) {
  const state = editorState.get(form), id = form.dataset.id;
  const data = readServerForm(form);
  if (!data.name) throw new Error('请填写服务器名称。');
  if (!Number.isInteger(data.sshPort) || data.sshPort < 1 || data.sshPort > 65535) throw new Error('SSH 端口需为 1–65535。');
  const patch = id ? changedFields(data, state.original) : data;
  if (id && !Object.keys(patch).length) { detailPanel(id); toast('没有需要保存的修改'); return; }
  const revision = state.retry ?? state.revision;
  try {
    const result = await api('/servers' + (id ? '/' + encodeURIComponent(id) : ''), { method: id ? 'PUT' : 'POST', body: patch, revision });
    await loadWorkspace(); render();
    const target = id || result.server?.id;
    if (target && server(target)) detailPanel(target); else closeLayer('panel', true);
    toast(id ? '已保存修改' : '服务器已添加');
  } catch (error) {
    if (error.status !== 409) throw error;
    // Someone saved elsewhere: keep the draft, show what happened, let the person decide.
    await loadWorkspace(); render();
    if (id && !server(id)) throw new Error('这台服务器已在其他页面删除。可以关闭后重新添加。');
    state.retry = S.ws.revision;
    throw new Error(`资料已在其他页面更新。你的修改仍保留在表单里（${Object.keys(patch).length} 项）。再次点击保存，将只用这些修改项覆盖最新资料。`);
  }
}
function confirmDelete(kind, id) {
  const record = kind === 'server' ? server(id) : S.ws.commands.find(c => c.id === id);
  if (!record) return;
  modal('确认删除', html`<p class="lede">将删除「${record.name || record.title}」及其所有记录，这个操作无法撤销。</p>`, html`${cancelBtn()}<button type="submit" class="btn danger">${icon('trash', 16)}<span>删除</span></button>`, { form: kind + '-delete', id });
}

// ── Renewal ──────────────────────────────────────────────────────────────────
const renewalState = new WeakMap();
function renewModal(id) {
  const s = server(id); if (!s) return;
  const cycle = s.monthlyCostCycle || 'monthly', base = isoDay(renewalOf(s)) || beijingToday(), next = addMonths(base, CYCLES[cycle]?.months || 1);
  const node = modal('记录续费', html`
    <div class="renew-preview"><div><small>当前到期</small><b>${shortDate(renewalOf(s)) || '未设置'}</b></div>${icon('arrow', 18)}<div><small>续费后到期</small><b data-preview>${shortDate(parseDate(next))}</b></div></div>
    <div class="grid2">
      ${field('amount', '本次实付', s.monthlyCostAmount, { type: 'number', required: true, attrs: 'min="0" step="0.000001"' })}${select('currency', '币种', s.monthlyCostCurrency || 'CNY', Object.fromEntries(Object.keys(CURRENCIES).map(code => [code, code])))}
      ${select('cycle', '周期', cycle, Object.fromEntries(Object.entries(CYCLES).map(([key, v]) => [key, v.label])))}${field('periods', '期数', 1, { type: 'number', required: true, attrs: 'min="1" max="120" step="1"' })}
      ${field('baseDate', '起算日', base, { type: 'date', required: true })}${field('newExpiry', '新的到期日', next, { type: 'date', required: true })}
      ${field('paidOn', '付款日期', beijingToday(), { type: 'date', required: true })}<span></span>
      ${area('note', '备注', '', '订单号、优惠等（可不填）', 2)}
    </div>
    <p class="hint">默认从原到期日顺延，月底自动对齐到目标月份最后一天。这里只做记录，不会替你付款。</p>`,
    html`${cancelBtn()}${submitBtn('保存续费')}`, { sub: s.name, form: 'renew', id: s.id });
  renewalState.set($('form', node), { requestId: crypto.randomUUID(), revision: S.ws.revision });
}
function updateRenewPreview(form) {
  const periods = Number(form.elements.periods.value);
  if (!Number.isInteger(periods) || periods < 1 || periods > 120) return;
  const next = addMonths(form.elements.baseDate.value, (CYCLES[form.elements.cycle.value]?.months || 1) * periods);
  if (next) { form.elements.newExpiry.value = next; $('[data-preview]', form).textContent = shortDate(parseDate(next)); }
}
async function saveRenewal(form) {
  const state = renewalState.get(form), f = new FormData(form), get = name => f.get(name)?.toString() || '';
  const body = { requestId: state.requestId, amount: get('amount').trim(), currency: get('currency'), cycle: get('cycle'), periods: Number(get('periods')), paidOn: get('paidOn'), baseDate: get('baseDate'), newExpiry: get('newExpiry'), note: get('note') };
  try { await api('/servers/' + encodeURIComponent(form.dataset.id) + '/renewals', { method: 'POST', body, revision: state.revision }); }
  catch (error) { if (error.status === 409) { await loadWorkspace(); render(); throw new Error('资料已在其他页面修改，请关闭后重新核对到期日再记录。'); } throw error; }
  await loadWorkspace(); closeLayer('modal', true); render();
  if ($('#panel').open) detailPanel(form.dataset.id, 'billing');
  toast('续费已记录，到期日已顺延');
}

// ── Choosing servers (cost scope, custom group, Telegram) ───────────────────
function pickerModal({ title, sub, form, checked, hint, extra = '' }) {
  const list = [...S.ws.servers].sort(byPinnedThenName);
  modal(title, html`${extra}<div class="picker-tools"><span class="hint" data-count></span><span>${btn('pick-all', '全选', { kind: 'ghost small' })}${btn('pick-none', '全不选', { kind: 'ghost small' })}</span></div>
    <div class="picker">${list.length ? list.map(s => html`<label class="pick"><input type="checkbox" name="ids" value="${s.id}"${raw(checked(s) ? ' checked' : '')}><span><strong>${s.name}</strong><small>${[providerName(s) || '未设置服务商', priceText(s) || dueLabel(daysLeft(s), s)].join(' · ')}</small></span>${form === 'tg-servers' ? duePill(s) : html`<em>${priceText(s) || '未记录价格'}</em>`}</label>`) : html`<p class="hint center">还没有服务器。</p>`}</div>
    <p class="hint">${hint}</p>`, html`${cancelBtn()}${submitBtn('保存选择')}`, { sub, form, wide: true });
  updatePickerCount($('#modal form'));
}
function updatePickerCount(form) {
  const boxes = $$('input[name="ids"]', form), n = boxes.filter(box => box.checked).length;
  const target = $('[data-count]', form); if (target) target.textContent = `已选 ${n} / ${boxes.length} 台`;
}
const pickedIds = form => $$('input[name="ids"]', form).filter(box => box.checked).map(box => box.value);
async function saveScope(form, path, done) {
  try { await api(path, { method: 'PUT', body: { serverIds: pickedIds(form) } }); }
  catch (error) { if (error.status === 409) { await loadWorkspace(); render(); throw new Error('资料已在其他页面更新，已载入最新内容。你的勾选仍保留，确认无误后再次保存即可。'); } throw error; }
  await loadWorkspace(); closeLayer('modal', true); render(); toast(done);
}

// ── Commands ─────────────────────────────────────────────────────────────────
function commandModal(id = '') {
  const c = (id && S.ws.commands.find(x => x.id === id)) || {};
  modal(c.id ? '编辑指令' : '添加指令', html`<div class="grid2">${field('title', '名称', c.title, { hint: '例如：查看磁盘占用', required: true, attrs: 'maxlength="120" autofocus' })}${field('category', '分类', c.category, { hint: '例如：系统维护' })}
    <label class="field wide"><span>指令内容<i>*</i></span><textarea class="input mono" name="command" rows="6" required maxlength="50000" placeholder="保存后不会自动执行">${c.command || ''}</textarea></label>${area('note', '说明', c.note, '适用范围、参数说明等', 3)}</div>`,
    html`${c.id ? btn('command-delete', '删除', { ico: 'trash', kind: 'ghost danger', id: c.id, attrs: 'data-left' }) : ''}${cancelBtn()}${submitBtn('保存指令')}`, { form: 'command', id: c.id || '', wide: true });
  const form = $('#modal form'); editorState.set(form, { original: readCommandForm(form), revision: S.ws.revision, retry: null });
}
function readCommandForm(form) { const f = new FormData(form), get = name => f.get(name)?.toString() || ''; return { title: get('title').trim(), category: get('category').trim(), command: get('command'), note: get('note') }; }
async function saveCommand(form) {
  const state = editorState.get(form), id = form.dataset.id, data = readCommandForm(form);
  if (!data.title || !data.command.trim()) throw new Error('请填写名称和指令内容。');
  const patch = id ? changedFields(data, state.original) : data;
  if (id && !Object.keys(patch).length) { closeLayer('modal', true); return; }
  try { await api('/commands' + (id ? '/' + encodeURIComponent(id) : ''), { method: id ? 'PUT' : 'POST', body: patch, revision: state.retry ?? state.revision }); }
  catch (error) { if (error.status !== 409) throw error; await loadWorkspace(); render(); if (id && !S.ws.commands.some(c => c.id === id)) throw new Error('这条指令已在其他页面删除。'); state.retry = S.ws.revision; throw new Error('资料已在其他页面更新。你的修改仍保留，再次保存将覆盖修改过的项。'); }
  await loadWorkspace(); closeLayer('modal', true); render(); toast('指令已保存');
}

// ── Account security ─────────────────────────────────────────────────────────
const authFields = () => html`${field('password', '管理密码', '', { type: 'password', required: true, attrs: 'autocomplete="current-password" maxlength="128" autofocus', wide: true })}${S.session.account?.totpEnabled ? field('otp', '动态验证码 / 恢复码', '', { required: true, attrs: 'autocomplete="one-time-code" maxlength="64"', wide: true }) : ''}`;
function securityModal(kind) {
  if (kind === 'password-change') return modal('修改登录密码', html`<div class="grid1">${field('currentPassword', '当前密码', '', { type: 'password', required: true, attrs: 'autocomplete="current-password" maxlength="128" autofocus' })}${field('newPassword', '新密码', '', { type: 'password', required: true, hint: '至少 14 位', attrs: 'autocomplete="new-password" minlength="14" maxlength="128"' })}${field('confirmPassword', '再次输入新密码', '', { type: 'password', required: true, attrs: 'autocomplete="new-password" minlength="14" maxlength="128"' })}${S.session.account?.totpEnabled ? field('otp', '动态验证码 / 恢复码', '', { required: true, attrs: 'autocomplete="one-time-code"' }) : ''}</div><p class="hint">修改后所有设备都需要重新登录。</p>`, html`${cancelBtn()}${submitBtn('更新密码')}`, { form: 'password' });
  if (kind === 'totp-start') return modal('开启双重验证', html`<p class="lede">先验证管理密码，再把密钥添加到验证器。</p><div class="grid1">${authFields()}</div>`, html`${cancelBtn()}${submitBtn('继续')}`, { form: 'totp-start' });
  if (kind === 'totp-disable') return modal('关闭双重验证', html`<p class="lede">关闭后，登录只需要管理密码。</p><div class="grid1">${authFields()}</div>`, html`${cancelBtn()}${submitBtn('确认关闭', 'danger')}`, { form: 'totp-disable' });
  if (kind === 'backup-now') return modal('立即备份', html`<p class="lede">生成一份加密备份，保存在服务器上，不会下载到当前设备。</p><div class="grid1">${authFields()}</div>`, html`${cancelBtn()}${submitBtn('生成备份')}`, { form: 'backup' });
}

// ── Telegram ─────────────────────────────────────────────────────────────────
const tgSelection = { key: '', id: '' };
function tgSettingsModal() {
  const t = S.ws.settings.telegram || {};
  modal('Telegram 提醒', html`
    <ol class="steps"><li>在 Telegram 里找 @BotFather 创建机器人，拿到 Bot Token。</li><li>给你的机器人发一句 /start，再填写你的数字 Chat ID。</li><li>保存后发一条测试消息，再选择需要提醒的机器。</li></ol>
    <div class="grid1">${toggle('enabled', '开启到期提醒', t.enabled === true, '北京时间 09:00 起检查，每 5 分钟一次')}
    ${field('chatId', '接收 Chat ID', t.chatId || '', { hint: '例如：123456789', attrs: 'autocomplete="off" maxlength="32"' })}
    ${field('botToken', 'Bot Token', '', { type: 'password', hint: t.hasToken ? '已保存，留空则保留' : '粘贴 BotFather 给的 Token', attrs: 'autocomplete="new-password" maxlength="256" spellcheck="false"' })}
    ${t.hasToken ? html`<label class="check"><input type="checkbox" name="clearToken">删除已保存的 Token（需同时关闭提醒）</label>` : ''}</div>
    <p class="hint">Token 加密保存，不会回显。提醒只包含机器名称、服务商、到期日期和管理台链接，不含任何密码。</p>
    <h3 class="sub-title">${icon('lock', 15)}验证管理身份</h3><div class="grid1">${authFields()}</div>`, html`${cancelBtn()}${submitBtn('保存设置')}`, { form: 'tg-settings', wide: true });
  $('#modal [name="enabled"]')?.focus();
}
async function saveTgSettings(form) {
  const f = new FormData(form), token = (f.get('botToken')?.toString() || '').trim(), clear = f.has('clearToken');
  if (clear && token) throw new Error('「填写新 Token」和「删除 Token」只能选一个。');
  const body = { enabled: f.has('enabled'), chatId: (f.get('chatId')?.toString() || '').trim(), password: f.get('password')?.toString() || '', otp: (f.get('otp')?.toString() || '').trim() };
  if (token) body.botToken = token; if (clear) body.clearToken = true;
  if (body.enabled && (!body.chatId || clear || (!token && !S.ws.settings.telegram?.hasToken))) throw new Error('开启提醒前，请填写 Chat ID 和 Bot Token。');
  try { await api('/settings/telegram', { method: 'PUT', body }); }
  catch (error) { if (error.status === 409) { await loadWorkspace(); render(); throw new Error('资料已在其他页面更新，已载入最新设置。确认无误后再次保存即可。'); } throw error; }
  await loadWorkspace(); closeLayer('modal', true); render(); toast('Telegram 提醒设置已保存');
}
function tgServersModal() {
  const t = S.ws.settings.telegram || {};
  pickerModal({ title: '选择提醒的机器', sub: '保存后会给你的 Telegram 发一条确认消息。', form: 'tg-servers', checked: s => s.expiryReminder === true,
    hint: !t.configured ? '提醒还没配置好，选择会保存，但暂时无法发送确认消息。' : !t.enabled ? '提醒总开关未开启：选择会保存，开启后才会发送到期提醒。' : '没有有效续费日期的机器不会收到提醒。' });
}
const saveTgServers = form => submitTgSelection(pickedIds(form));
async function submitTgSelection(ids) {
  const key = JSON.stringify([...ids].sort());
  // Retrying the same selection reuses its id, so the server never sends a second confirmation.
  if (tgSelection.key !== key) { tgSelection.key = key; tgSelection.id = crypto.randomUUID(); }
  let result;
  try { result = await api('/settings/telegram/servers', { method: 'PUT', body: { serverIds: ids, confirmationId: tgSelection.id } }); }
  catch (error) {
    if (error.status === 409) { await loadWorkspace(); render(); throw new Error('资料已在其他页面更新，已载入最新内容。你的勾选仍保留，确认无误后再次保存即可。'); }
    if (!error.status) throw new Error('结果暂时无法确认。请先查看 Telegram；保持勾选不变再次保存，不会重复发送。');
    throw error;
  }
  tgSelection.key = ''; await loadWorkspace().catch(() => {}); render();
  const status = result.confirmation?.status || 'uncertain';
  const text = { sent: '确认消息已发送到 Telegram。', failed: '选择已保存，但确认消息发送失败，请检查提醒配置。', uncertain: '选择已保存，确认消息的发送结果暂时无法确认，请先查看 Telegram。', skipped: '选择已保存。提醒还没配置好，所以没有发送确认消息。', pending: '选择已保存，确认消息正在发送。' }[status] || '选择已保存。';
  modal('提醒机器已更新', html`<div class="callout ${status === 'sent' ? 'ok' : 'warning'}">${icon(status === 'sent' ? 'check' : 'info', 16)}<span>已选择 ${Number(result.selectedCount) || 0} 台机器。${text}</span></div>`, btn('close-modal', '好的', { kind: 'primary' }));
}
function tgSendModal(kind) {
  const retry = kind === 'tg-retry', t = S.ws.settings.telegram || {};
  modal(retry ? '重试未成功的提醒' : '发送测试消息', html`<p class="lede">${retry ? '请先查看 Telegram，确认这些提醒是否已经收到。结果未确认的提醒重试后可能重复。' : `将向 Chat ID ${t.chatId || '未设置'} 发送一条测试消息，不影响任何提醒记录。`}</p>${retry ? html`<label class="check"><input type="checkbox" name="confirmRetry">我已查看 Telegram，接受可能收到重复提醒</label>` : ''}<div class="grid1">${authFields()}</div>`, html`${cancelBtn()}${submitBtn(retry ? '确认重试' : '发送')}`, { form: kind });
}

// ── Backups ──────────────────────────────────────────────────────────────────
async function loadBackups() {
  S.loadingBackups = true;
  try { S.backups = await api('/backups'); } catch (error) { S.backups = { error: error.message }; }
  finally { S.loadingBackups = false; if (S.page === 'backups' && S.ws) render(); }
}
const restoreState = new WeakMap();
async function previewBackup(filename, node) {
  node.disabled = true;
  try {
    const r = await api('/backups/preview', { method: 'POST', body: { filename } });
    const s = r.summary || {}, labels = { added: '新增', removed: '移除', changed: '更新', unchanged: '不变' }, fieldNames = { renewalHistory: '续费记录', name: '名称', provider: '服务商', ipAddress: '地址', status: '状态', renewalDate: '续费日期', monthlyCostAmount: '价格', notes: '备注', domains: '域名', usages: '用途', tags: '标签' };
    const nodeModal = modal('核对恢复内容', html`
      <div class="restore-stats">${Object.entries(labels).map(([key, label]) => html`<div><b>${Number(s[key]) || 0}</b><small>${label}</small></div>`)}</div>
      <div class="callout">${icon('info', 16)}<span>将恢复服务器、续费记录、指令和费用选择；当前登录账户、Telegram 设置和已发送提醒保持不变。恢复前会先自动备份当前数据。</span></div>
      <p class="hint">指令 ${Number(s.commandsBefore) || 0} → ${Number(s.commandsAfter) || 0} 条${(r.settingsChanged || []).length ? ` · ${(r.settingsChanged || []).join('、')}有变化` : ''}</p>
      ${(r.changes || []).length ? html`<ul class="plain">${r.changes.map(c => html`<li><strong>${c.name || '未命名服务器'}</strong>${pill(labels[c.type] || c.type, c.type === 'removed' ? 'danger' : c.type === 'added' ? 'ok' : 'notice')}${(c.fields || []).length ? html`<small>${c.fields.map(name => fieldNames[name] || name).join('、')}</small>` : ''}</li>`)}</ul>` : html`<p class="hint">服务器资料没有变化。</p>`}
      <label class="check"><input type="checkbox" name="confirmRestore">我已核对差异，确认恢复</label>
      <p class="hint">备份时间 ${beijingTime(r.createdAt)} · 预览在 ${beijingTime(r.expiresAt)} 失效</p>`,
      html`${cancelBtn()}${submitBtn('确认恢复', 'danger')}`, { form: 'restore', wide: true });
    restoreState.set($('form', nodeModal), { token: r.previewToken, filename, revision: r.revision });
  } finally { node.disabled = false; }
}
async function restoreBackup(form) {
  const state = restoreState.get(form);
  if (!new FormData(form).has('confirmRestore')) throw new Error('请先勾选确认。');
  try { const r = await api('/backups/restore', { method: 'POST', body: { previewToken: state.token, filename: state.filename, confirm: true }, revision: state.revision }); toast(r.message || '已恢复'); }
  catch (error) { if (error.status === 409) { await loadWorkspace(); throw new Error('资料已变化，请关闭后重新查看恢复差异。'); } throw error; }
  S.backups = null; await loadWorkspace(); closeLayer('modal', true); render();
}

// ── Form submissions ─────────────────────────────────────────────────────────
const value = (form, name) => new FormData(form).get(name)?.toString() || '';
const SUBMIT = {
  async login(form) { await api('/login', { method: 'POST', body: { username: value(form, 'username').trim(), password: value(form, 'password'), otp: value(form, 'otp').trim() } }); await boot(); },
  async setup(form) {
    if (value(form, 'password') !== value(form, 'confirmPassword')) throw new Error('两次输入的密码不一致。');
    await api('/setup', { method: 'POST', body: { token: setupToken || value(form, 'token').trim(), username: value(form, 'username').trim(), password: value(form, 'password') } });
    setupToken = ''; await boot();
  },
  server: saveServer, command: saveCommand, renew: saveRenewal, restore: restoreBackup, batch: runBatch,
  async 'server-delete'(form) { await api('/servers/' + encodeURIComponent(form.dataset.id), { method: 'DELETE' }); await loadWorkspace(); closeLayers(true); render(); toast('已删除'); },
  async 'command-delete'(form) { await api('/commands/' + encodeURIComponent(form.dataset.id), { method: 'DELETE' }); await loadWorkspace(); closeLayers(true); render(); toast('已删除'); },
  'cost-scope': form => saveScope(form, '/settings/costs/servers', '统计范围已更新'),
  'custom-scope': form => saveScope(form, '/settings/custom-monthly/servers', '自定义组合已更新'),
  'tg-settings': saveTgSettings, 'tg-servers': saveTgServers,
  async 'tg-test'(form) { await api('/settings/telegram/test', { method: 'POST', body: { password: value(form, 'password'), otp: value(form, 'otp').trim() } }); closeLayer('modal', true); toast('测试消息已发送，请查看 Telegram'); },
  async 'tg-retry'(form) {
    if (!new FormData(form).has('confirmRetry')) throw new Error('请先查看 Telegram 并勾选确认。');
    const r = await api('/settings/telegram/retry', { method: 'POST', body: { password: value(form, 'password'), otp: value(form, 'otp').trim(), confirm: true } });
    await loadWorkspace(); closeLayer('modal', true); render(); toast(`${Number(r.retried) || 0} 条提醒已重新排队`);
  },
  async password(form) {
    if (value(form, 'newPassword') !== value(form, 'confirmPassword')) throw new Error('两次输入的新密码不一致。');
    await api('/security/password', { method: 'POST', body: { currentPassword: value(form, 'currentPassword'), newPassword: value(form, 'newPassword'), otp: value(form, 'otp').trim() } });
    closeLayers(true); await boot(); toast('密码已更新，请重新登录');
  },
  async 'totp-start'(form) {
    const r = await api('/security/totp/start', { method: 'POST', body: { password: value(form, 'password') } });
    modal('连接验证器', html`<p class="lede">在验证器 App 中选择「手动输入密钥」，账户名填 ${S.session.account?.username}，类型选「基于时间」。</p><div class="secret-code mono" id="totp-secret">${r.secret}</div>${btn('copy-totp', '复制密钥', { ico: 'copy', kind: 'ghost small' })}<div class="grid1">${field('code', '验证器显示的 6 位数字', '', { required: true, attrs: 'autocomplete="one-time-code" inputmode="numeric" pattern="[0-9]{6}" maxlength="6" autofocus' })}</div>`, html`${cancelBtn()}${submitBtn('验证并开启')}`, { form: 'totp-confirm', sticky: true });
  },
  async 'totp-confirm'(form) {
    const r = await api('/security/totp/confirm', { method: 'POST', body: { code: value(form, 'code').trim() } });
    S.session = await api('/session'); render();
    modal('双重验证已开启', html`<div class="callout warning">${icon('alert', 16)}<span>请保存下面的恢复码。验证器不可用时，每个恢复码可以登录一次。关闭后将无法再次查看。</span></div><div class="codes mono" id="recovery-codes">${(r.recoveryCodes || []).map(code => html`<span>${code}</span>`)}</div>`, html`${btn('copy-recovery', '复制全部', { ico: 'copy', kind: 'ghost' })}${btn('close-modal', '我已保存', { kind: 'primary' })}`, { sticky: true });
  },
  async 'totp-disable'(form) { await api('/security/totp/disable', { method: 'POST', body: { password: value(form, 'password'), code: value(form, 'otp').trim() } }); closeLayer('modal', true); S.session = await api('/session'); render(); toast('双重验证已关闭'); },
  async backup(form) { const r = await api('/backup', { method: 'POST', body: { password: value(form, 'password'), otp: value(form, 'otp').trim() } }); closeLayer('modal', true); S.backups = null; render(); toast(r.message || '加密备份已生成'); }
};
document.addEventListener('submit', async event => {
  const form = event.target.closest('form[data-form]'); if (!form) return;
  event.preventDefault();
  const handler = SUBMIT[form.dataset.form]; if (!handler || form.getAttribute('aria-busy') === 'true') return;
  const error = $('.form-error', form), submit = $('button[type="submit"]', form);
  if (error) error.textContent = '';
  form.setAttribute('aria-busy', 'true'); if (submit) submit.disabled = true;
  try { await handler(form, event.submitter); }
  catch (failure) { if (error?.isConnected) { error.textContent = failure.message || '操作未完成，请稍后重试。'; error.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); } else toast(failure.message || '操作未完成', 'bad'); }
  finally { form.removeAttribute('aria-busy'); if (submit) submit.disabled = false; }
});

// ── Clicks ───────────────────────────────────────────────────────────────────
const ACTIONS = {
  boot, refresh: async () => { await loadWorkspace(); S.backups = null; render(); toast('资料已刷新'); },
  'close-modal': () => closeLayer('modal'), 'close-panel': () => closeLayer('panel'),
  more: moreSheet, 'account-menu': accountMenu, 'go-settings': () => { closeLayers(); go('settings'); },
  async logout() { clearSecrets(); try { await api('/logout', { method: 'POST', body: {} }); } catch { /* already signed out */ } S.session = null; S.ws = null; S.backups = null; closeLayers(true); await boot(); },
  'server-new': (id) => { closeLayer('modal'); editorPanel('', { provider: id || '' }); }, 'server-edit': id => editorPanel(id),
  'server-delete': id => confirmDelete('server', id), detail: id => detailPanel(id), 'detail-tab': (id, node) => detailPanel(node.closest('.drawer').dataset.server, id),
  renew: id => renewModal(id),
  jump: id => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' }),
  'editor-cancel': (id, node) => { if (!confirmDiscard(node.closest('dialog'))) return; if (id && server(id)) detailPanel(id); else closeLayer('panel', true); },
  provider: id => { closeLayers(); S.view = 'grid'; go('servers', { provider: id ?? '' }); }, 'provider-clear': () => go('servers'),
  status: id => { S.status = id || ''; render(); }, view: id => { S.view = id; prefs.set('view', id); render(); },
  'select-mode': () => { if (S.selecting) exitSelecting(); else S.selecting = true; render(); },
  'pick-server': id => { if (S.selected.has(id)) S.selected.delete(id); else S.selected.add(id); render(); },
  'pick-visible': () => { const list = filteredServers(), all = list.length > 0 && list.every(s => S.selected.has(s.id)); for (const s of list) { if (all) S.selected.delete(s.id); else S.selected.add(s.id); } render(); },
  batch: id => batchModal(id),
  theme: id => { prefs.set('theme', id); applyTheme(id); render(); toast(id === 'auto' ? '外观将跟随系统' : id === 'dark' ? '已切换为深色' : '已切换为浅色'); }, 'clear-filters': () => { S.q = ''; S.status = ''; render(); },
  'domain-add': (_, node) => { $('#domains', node.closest('form')).insertAdjacentHTML('beforeend', String(domainRow())); $('#domains .repeat:last-child input', node.closest('form'))?.focus(); },
  'usage-add': (_, node) => { $('#usages', node.closest('form')).insertAdjacentHTML('beforeend', String(usageRow())); $('#usages .repeat:last-child input', node.closest('form'))?.focus(); },
  'repeat-remove': (_, node) => node.closest('.repeat').remove(),
  'secret-show': (_, node) => showSecret(node), 'secret-copy': (_, node) => copySecret(node),
  'ssh-copy': id => copyText(sshCommand(server(id)), 'SSH 命令已复制'),
  'cost-scope': () => pickerModal({ title: '首页统计范围', sub: '勾选的服务器计入月付、年付和单期合计。', form: 'cost-scope', checked: s => s.excludeFromCosts !== true, hint: '取消勾选不会影响服务器资料和到期提醒；新添加的服务器默认参与统计。' }),
  'custom-scope': () => pickerModal({ title: '自定义组合', sub: '单独计算这一组服务器的每月开销。', form: 'custom-scope', checked: s => (S.ws.customMonthly?.serverIds || []).includes(s.id), hint: '这个组合和首页统计互不影响；新添加的服务器需要手动加入。' }),
  'pick-all': (_, node) => { $$('input[name="ids"]', node.closest('form')).forEach(box => { box.checked = true; }); updatePickerCount(node.closest('form')); },
  'pick-none': (_, node) => { $$('input[name="ids"]', node.closest('form')).forEach(box => { box.checked = false; }); updatePickerCount(node.closest('form')); },
  'command-new': () => commandModal(), 'command-edit': id => commandModal(id), 'command-delete': id => confirmDelete('command', id),
  'command-copy': id => { const c = S.ws.commands.find(x => x.id === id); if (c) return copyText(c.command, '指令已复制'); },
  'password-change': () => securityModal('password-change'), 'totp-start': () => securityModal('totp-start'), 'totp-disable': () => securityModal('totp-disable'), 'backup-now': () => securityModal('backup-now'),
  'copy-totp': () => copyText($('#totp-secret').textContent, '密钥已复制'), 'copy-recovery': () => copyText($$('#recovery-codes span').map(n => n.textContent).join('\n'), '恢复码已复制'),
  'tg-settings': tgSettingsModal, 'tg-servers': tgServersModal, 'tg-test': () => tgSendModal('tg-test'), 'tg-retry': () => tgSendModal('tg-retry'),
  'backups-refresh': async () => { S.backups = null; render(); }, 'backup-range': id => { S.backupRange = id; render(); }, 'backup-preview': (id, node) => previewBackup(id, node)
};
document.addEventListener('click', async event => {
  const nav = event.target.closest('[data-go]');
  if (nav) { event.preventDefault(); closeLayer('modal'); go(nav.dataset.go); return; }
  const node = event.target.closest('[data-act]'); if (!node || node.disabled) return;
  const action = ACTIONS[node.dataset.act]; if (!action) return;
  event.preventDefault();
  try { await action(node.dataset.id, node); } catch (error) { toast(error.message || '操作未完成，请重试。', 'bad'); }
});
// Clicking the dimmed backdrop closes a layer (the dialog element itself is the backdrop target).
for (const id of ['#modal', '#panel']) {
  const node = $(id);
  node.addEventListener('click', event => { if (event.target === node && !node.hasAttribute('data-sticky')) closeLayer(id === '#modal' ? 'modal' : 'panel'); });
  node.addEventListener('cancel', event => { event.preventDefault(); if (!node.hasAttribute('data-sticky')) closeLayer(id === '#modal' ? 'modal' : 'panel'); });
  node.addEventListener('close', () => { clearSecrets(node); });
}
document.addEventListener('keydown', event => {
  if ((event.key === 'Enter' || event.key === ' ') && event.target.matches('[role="button"][data-act]')) { event.preventDefault(); event.target.click(); }
  if (event.key === '/' && !event.target.closest('input, textarea, select') && !$('#modal').open && !$('#panel').open) { event.preventDefault(); $('#omnibox')?.focus(); }
});
document.addEventListener('input', event => {
  if (event.target.id === 'omnibox') {
    S.q = event.target.value;
    if (S.page !== 'servers') { S.focusOmni = true; go('servers', { keepQuery: true }); return; }
    $('#results').innerHTML = String(serverResults());
  }
  if (event.target.id === 'command-search') { S.q = event.target.value; const pos = event.target.selectionStart; render(); const box = $('#command-search'); box.focus(); box.setSelectionRange(pos, pos); }
});
document.addEventListener('change', event => {
  const form = event.target.closest('form');
  if (event.target.name === 'ids' && form) updatePickerCount(form);
  if (event.target.id === 'sort-select') { S.sort = event.target.value; prefs.set('sort', S.sort); $('#results').innerHTML = String(serverResults()); }
  if (form?.dataset.form === 'renew' && ['cycle', 'periods', 'baseDate'].includes(event.target.name)) updateRenewPreview(form);
  if (form?.dataset.form === 'renew' && event.target.name === 'newExpiry') $('[data-preview]', form).textContent = shortDate(parseDate(event.target.value));
});
document.addEventListener('visibilitychange', () => { if (document.hidden) clearSecrets(); });
window.addEventListener('hashchange', () => {
  if (!S.session?.authenticated) return;
  const before = S.page; routeFromHash();
  if (S.page !== before) { if (!S.keepQuery) { S.q = ''; S.status = ''; } exitSelecting(); window.scrollTo({ top: 0, behavior: 'instant' }); }
  S.keepQuery = false; render();
});

// ── Keeping several tabs and devices in step ────────────────────────────────
const SYNC_EVERY = 60000, ACTIVE_WINDOW = 600000;
let lastActivity = Date.now(), syncing = false;
for (const type of ['pointerdown', 'keydown', 'wheel', 'touchstart']) window.addEventListener(type, () => { lastActivity = Date.now(); }, { passive: true, capture: true });
async function syncWorkspace() {
  if (syncing || !S.session?.authenticated || !S.ws || document.hidden || Date.now() - lastActivity > ACTIVE_WINDOW) return;
  // Never pull the rug from under a form, a running batch or someone typing a search.
  const busy = () => $('#modal form, #panel form') || S.selecting || ['omnibox', 'command-search'].includes(document.activeElement?.id);
  if (busy()) return;
  syncing = true;
  try {
    const ws = await api('/workspace');
    if (ws.revision === S.ws.revision || busy()) return;
    ws.servers ||= []; ws.commands ||= []; ws.settings ||= {}; ws.costs ||= {}; ws.customMonthly ||= {};
    S.ws = ws; render();
    const drawer = $('#panel .drawer[data-server]');
    if (drawer && !$('[data-secret-value][data-revealed]')) { if (server(drawer.dataset.server)) detailPanel(drawer.dataset.server, drawer.dataset.tab); else closeLayer('panel', true); }
    toast('已同步其他页面的最新修改');
  } catch { /* the next tick tries again */ }
  finally { syncing = false; }
}
setInterval(syncWorkspace, SYNC_EVERY);
document.addEventListener('visibilitychange', () => { if (!document.hidden) syncWorkspace(); });

// ── Start ────────────────────────────────────────────────────────────────────
const setupMatch = /^#setup=([^&]+)/.exec(location.hash);
if (setupMatch) { setupToken = decodeURIComponent(setupMatch[1]); history.replaceState(null, '', location.pathname + location.search); }
boot();
