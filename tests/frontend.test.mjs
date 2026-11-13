import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as C from '../public/core.js';
import { parseRenewalDate } from '../lib/renewal-date.mjs';

const app = fs.readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');

test('html escapes every interpolation unless it is already markup', () => {
  const name = '<img src=x onerror=alert(1)>"\'&';
  const out = String(C.html`<b title="${name}">${name}</b>${C.html`<i>${name}</i>`}${[name, C.raw('<br>')]}${null}${false}${undefined}${0}`);
  assert.equal(out, '<b title="&lt;img src=x onerror=alert(1)&gt;&quot;&#39;&amp;">&lt;img src=x onerror=alert(1)&gt;&quot;&#39;&amp;</b><i>&lt;img src=x onerror=alert(1)&gt;&quot;&#39;&amp;</i>&lt;img src=x onerror=alert(1)&gt;&quot;&#39;&amp;<br>0');
  assert.ok(!out.includes('<img'));
});

test('page dates follow exactly the server reminder rule', () => {
  const samples = ['2026-11-13', '2026/11/3', '2026-1-5', '2026-11-13T00:00:00.000Z', ' 2026-11-13 ', '12/05/2026', '2026-02-29', '2028-02-29', '2026-13-01', '2026-11-31', '2026.11.13', '2026-11-13 10:00', '', 'soon', '20261113', '2026-11-13Tbad'];
  for (const value of samples) {
    const server = parseRenewalDate(value), page = C.parseDate(value);
    assert.equal(page ? C.isoDay(page) : null, server ? server.date : null, value);
  }
  assert.equal(C.isoDay(C.parseDate(new Date(2026, 10, 13, 23, 59))), '2026-11-13');
  assert.equal(C.parseDate(new Date('bad')), null);
  assert.equal(C.unreadableDate('12/05/2026'), true); assert.equal(C.unreadableDate(''), false); assert.equal(C.unreadableDate('2026-12-05'), false);
});

test('due labels and tones are calendar-day based', () => {
  const today = new Date(2026, 10, 13, 23, 30);
  const due = date => C.daysLeft({ renewalDate: date }, today);
  assert.deepEqual(['2026-11-11', '2026-11-13', '2026-11-14', '2026-11-20', '2026-11-21', '2026-12-13', '2026-12-14'].map(due), [-2, 0, 1, 7, 8, 30, 31]);
  assert.deepEqual([-2, 0, 1, 7, 8, 30, 31, null].map(C.dueTone), ['danger', 'warning', 'warning', 'warning', 'notice', 'notice', 'calm', 'muted']);
  assert.equal(C.dueLabel(-2), '已过期 2 天'); assert.equal(C.dueLabel(0), '今天到期'); assert.equal(C.dueLabel(1), '明天到期'); assert.equal(C.dueLabel(9), '9 天后到期');
  assert.equal(C.dueLabel(null, { renewalDateText: '12/05/2026' }), '日期无法识别'); assert.equal(C.dueLabel(null, {}), '未设置续费日');
  const buckets = C.renewalBuckets(['2026-11-11', '2026-11-13', '2026-11-25', '2027-01-01', ''].map((renewalDate, i) => ({ id: String(i), name: String(i), renewalDate })), today);
  assert.deepEqual(Object.fromEntries(Object.entries(buckets).map(([key, rows]) => [key, rows.map(row => row.server.id)])), { overdue: ['0'], week: ['1'], month: ['2'], later: ['3'], undated: ['4'] });
  assert.equal(C.nextRenewal([{ renewalDate: '2026-11-11' }, { renewalDate: '2026-11-20', name: 'b' }, { renewalDate: '2026-11-15', name: 'a' }], today).server.name, 'a');
});

test('renewal months clamp to the end of the target month', () => {
  assert.equal(C.addMonths('2026-01-31', 1), '2026-02-28'); assert.equal(C.addMonths('2028-01-31', 1), '2028-02-29');
  assert.equal(C.addMonths('2026-11-30', 3), '2027-02-28'); assert.equal(C.addMonths('2026-12-15', 12), '2027-12-15');
  assert.equal(C.addMonths('bad', 1), ''); assert.equal(C.addMonths('2026-01-01', 1.5), '');
});

test('prices, monthly conversion and SSH commands', () => {
  const s = { monthlyCostAmount: '60', monthlyCostCurrency: 'HKD', monthlyCostCycle: 'quarterly' };
  assert.equal(C.priceText(s), 'HKD 60.00 / 季'); assert.equal(C.priceText({ monthlyCostAmount: '' }), '');
  assert.equal(C.monthlyCNY(s, { HKD: 0.9 }), 18); assert.equal(C.monthlyCNY({ monthlyCostAmount: '10' }, {}), 10); assert.equal(C.monthlyCNY({ monthlyCostAmount: '10', monthlyCostCurrency: 'USD' }, {}), null);
  assert.equal(C.sshCommand({ ipAddress: '1.2.3.4', sshPort: '2222', username: "o'neil" }), "ssh -p 2222 -- 'o'\"'\"'neil@1.2.3.4'");
  assert.equal(C.sshCommand({ ipAddress: 'host; rm -rf /' }), "ssh -p 22 -- 'root@host; rm -rf /'");
  assert.throws(() => C.sshCommand({ ipAddress: '1.2.3.4', sshPort: '70000' })); assert.throws(() => C.sshCommand({}));
  assert.equal(C.normalizeBandwidth('500 mbps'), '500M'); assert.equal(C.normalizeBandwidth('1g'), '1G'); assert.equal(C.normalizeBandwidth('100'), '100M'); assert.equal(C.normalizeBandwidth('不限'), '不限');
  assert.equal(C.safeURL('javascript:alert(1)'), null); assert.equal(C.safeURL('https://a.example/x'), 'https://a.example/x');
});

test('edits send only the fields that changed', () => {
  const original = { name: 'a', tags: ['x'], domains: [{ id: '1', domain: 'a.com' }], notes: '' };
  assert.deepEqual(C.changedFields({ ...original }, original), {});
  assert.deepEqual(C.changedFields({ ...original, tags: ['x', 'y'], notes: 'n' }, original), { tags: ['x', 'y'], notes: 'n' });
  assert.deepEqual(C.changedFields({ ...original, sshPassword: 'new' }, original), { sshPassword: 'new' });
  assert.deepEqual(C.tagsFrom(' 生产，博客 , ,web'), ['生产', '博客', 'web']);
  const servers = [{ name: 'b', provider: 'X' }, { name: 'a', provider: 'X', isPinned: true }, { name: 'c', provider: '' }];
  assert.deepEqual(C.providerGroups(servers).map(g => [g.name, g.servers.length]), [['X', 2], ['', 1]]);
  assert.deepEqual([...servers].sort(C.byPinnedThenName).map(s => s.name), ['a', 'b', 'c']);
  assert.equal(C.matchesQuery({ name: 'Tokyo', tags: ['生产'] }, '生产'), true); assert.equal(C.matchesQuery({ name: 'Tokyo' }, 'osaka'), false);
});

test('every button and form in the interface has a handler', () => {
  const actions = new Set([...app.matchAll(/(?:btn|iconBtn)\('([a-z-]+)'/g), ...app.matchAll(/data-act="([a-z-]+)"/g)].map(m => m[1]));
  const block = app.slice(app.indexOf('const ACTIONS = {'), app.indexOf("document.addEventListener('click'"));
  const handled = new Set([...block.matchAll(/(?:^|[\s,{])'?([a-z][a-z-]*)'?\s*[:(]/gm)].map(m => m[1]));
  for (const action of actions) assert.ok(handled.has(action), `missing click handler: ${action}`);
  const forms = new Set([...app.matchAll(/form: '([a-z-]+)'/g), ...app.matchAll(/data-form="([a-z-]+)"/g)].map(m => m[1]));
  for (const kind of ['login', 'setup', 'server', 'tg-test', 'tg-retry', 'command-delete', 'server-delete']) forms.add(kind);
  const submit = app.slice(app.indexOf('const SUBMIT = {'), app.indexOf("document.addEventListener('submit'"));
  for (const form of forms) assert.ok(new RegExp(`(?:^|[\\s,{])'?${form}'?\\s*[:(]`, 'm').test(submit), `missing submit handler: ${form}`);
});

test('markup is only ever written through the escaping template', () => {
  for (const [, rhs] of app.matchAll(/\.innerHTML\s*=\s*([^;]+);/g)) assert.match(rhs.trim(), /^(?:String\((?:html`|serverResults\(\)|content)|'')/, rhs);
  for (const [, arg] of app.matchAll(/insertAdjacentHTML\('beforeend',\s*([^)]+\))/g)) assert.match(arg, /^String\((?:domainRow|usageRow)\(/);
  assert.ok(!/\beval\(|new Function|document\.write/.test(app));
  assert.ok(!/\.outerHTML\s*=/.test(app));
  // Secrets come only from the dedicated endpoint and are cleared on close and when hidden.
  assert.match(app, /'\/servers\/' \+ encodeURIComponent\(id\) \+ '\/secrets'/);
  assert.match(app, /visibilitychange', \(\) => \{ if \(document\.hidden\) clearSecrets\(\); \}/);
  assert.match(app, /addEventListener\('close', \(\) => \{ clearSecrets\(node\); \}\)/);
  assert.match(app, /setTimeout\([^]*?60000\)/);
});

test('tone classes never carry layout of their own, so they cannot collide with other components', () => {
  const css = fs.readFileSync(new URL('../public/styles.css', import.meta.url), 'utf8');
  for (const tone of ['ok', 'warning', 'danger', 'notice', 'calm', 'muted', 'accent']) {
    assert.doesNotMatch(css, new RegExp(`(?:^|[},])\\.${tone}(?=[\\s{,:.>])`, 'm'), `.${tone} must only be styled together with its component`);
  }
  // Container classes are unique: the overview tile and the server grid no longer share a name.
  assert.doesNotMatch(app, /class="tile machines"|class="notice/);
});

test('in-page links never change the route, and drafts and one-time secrets are protected', () => {
  // The router owns location.hash, so no anchor may point at an in-page fragment.
  assert.doesNotMatch(app, /href="#(?!\/)[^"]*"/);
  assert.match(app, /data-act="jump"/);
  // Closing a layer with unsaved edits asks first; forced closes (after saving) do not.
  assert.match(app, /if \(!force && !confirmDiscard\(node\)\) return false;/);
  assert.match(app, /'editor-cancel': \(id, node\) => \{ if \(!confirmDiscard/);
  // Recovery codes and the authenticator secret can only be dismissed with their buttons.
  assert.match(app, /btn\('close-modal', '我已保存'[^]*?\{ sticky: true \}\)/);
  assert.match(app, /form: 'totp-confirm', sticky: true/);
  assert.match(app, /if \(event\.target === node && !node\.hasAttribute\('data-sticky'\)\)/);
  // Leaving a page through history starts the next page without a stale search.
  assert.match(app, /if \(S\.page !== before\) \{ if \(!S\.keepQuery\) \{ S\.q = ''; S\.status = ''; \}/);
});

test('sorting keeps missing dates and prices last, and batch toggles compute the whole new set', () => {
  const today = new Date(2026, 10, 13);
  const list = [
    { name: 'b', renewalDate: '2026-12-01', monthlyCostAmount: '5' },
    { name: 'a', isPinned: true },
    { name: 'c', renewalDate: '2026-11-20', monthlyCostAmount: '9', monthlyCostCurrency: 'USD' },
    { name: 'd', renewalDate: '2026-11-10', monthlyCostAmount: '12', monthlyCostCycle: 'yearly' }
  ];
  const order = mode => C.sortServers(list, mode, { rates: { CNY: 1, USD: 7 }, today }).map(s => s.name).join('');
  assert.equal(order('smart'), 'abcd'); assert.equal(order('name'), 'abcd');
  assert.equal(order('due'), 'dcba'); assert.equal(order('price'), 'cbda');
  assert.equal(order('unknown'), 'abcd'); assert.deepEqual(list.map(s => s.name), ['b', 'a', 'c', 'd']);
  assert.deepEqual(C.toggledSet(['1', '2'], ['2', '3'], true), ['1', '2', '3']);
  assert.deepEqual(C.toggledSet(['1', '2'], ['2', '3'], false), ['1']);
});

test('dark theme follows the system unless overridden, and leaves no hard-coded white surfaces', () => {
  const css = fs.readFileSync(new URL('../public/styles.css', import.meta.url), 'utf8');
  assert.match(css, /@media \(prefers-color-scheme:dark\)\{\n:root:not\(\[data-theme="light"\]\)\{/);
  assert.match(css, /\n:root\[data-theme="dark"\]\{/);
  const count = prefix => (css.match(new RegExp(prefix.replace(/[[\]()"]/g, '\\$&'), 'g')) || []).length;
  assert.equal(count(':root:not([data-theme="light"]) '), count(':root[data-theme="dark"] '), 'both dark entry points style the same parts');
  const base = css.slice(0, css.indexOf('/* ── Dark theme'));
  assert.ok(base.length > 1000);
  assert.doesNotMatch(base, /rgba\(255,255,255,/); assert.doesNotMatch(base, /background:#fff\b/);
  // Theme preference is per device and survives storage being unavailable.
  assert.match(app, /get\(key, fallback = null\) \{ try \{ return localStorage\.getItem/);
  assert.match(app, /set\(key, value\) \{ try \{ localStorage\.setItem/);
});

test('background sync respects idle sessions, open forms and running batches', () => {
  assert.match(app, /Date\.now\(\) - lastActivity > ACTIVE_WINDOW\) return;/);
  assert.match(app, /const SYNC_EVERY = 60000, ACTIVE_WINDOW = 600000;/);
  assert.match(app, /\$\('#modal form, #panel form'\) \|\| S\.selecting \|\| \['omnibox', 'command-search'\]\.includes/);
  assert.match(app, /if \(ws\.revision === S\.ws\.revision \|\| busy\(\)\) return;/);
  // Batch edits go one server at a time, each with its own revision check.
  assert.match(app, /const r = await api\('\/servers\/' \+ encodeURIComponent\(id\), \{ method: 'PUT', body: \{ status: op \} \}\); S\.ws\.revision = r\.revision;/);
});

test('batch choices must be explicit and deleting an already removed server counts as done', () => {
  assert.match(app, /if \(\(kind === 'tg' \|\| kind === 'cost'\) && !\['on', 'off'\]\.includes\(op\)\) throw/);
  assert.match(app, /if \(!server\(id\) && goneIsDone\) \{ done\+\+; continue; \}/);
  assert.match(app, /method: 'DELETE' \}\); S\.ws\.revision = r\.revision; \}, \{ goneIsDone: true \}\);/);
});
