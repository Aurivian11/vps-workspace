// Pure helpers for the interface. No DOM access, so tests can import this file directly.

// ── Safe HTML ────────────────────────────────────────────────────────────────
// Every interpolation is escaped unless it is already a Safe fragment built by `html`.
export class Safe { constructor(text) { this.text = String(text); } toString() { return this.text; } }
export const raw = text => new Safe(text);
export const escapeHTML = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
function fragment(value) {
  if (value === null || value === undefined || value === false) return '';
  if (value instanceof Safe) return value.text;
  if (Array.isArray(value)) return value.map(fragment).join('');
  return escapeHTML(value);
}
export function html(strings, ...values) {
  let out = strings[0];
  for (let i = 0; i < values.length; i++) out += fragment(values[i]) + strings[i + 1];
  return new Safe(out);
}

// ── Calendar dates ───────────────────────────────────────────────────────────
// Same rule as the server's reminder parser: YYYY-MM-DD or YYYY/M/D, optional time suffix.
export function parseDate(value) {
  if (!value) return null;
  if (Object.prototype.toString.call(value) === '[object Date]') return Number.isNaN(value.valueOf()) ? null : new Date(value.getFullYear(), value.getMonth(), value.getDate());
  if (typeof value !== 'string') return null;
  const match = /^(\d{4})([-/])(\d{1,2})\2(\d{1,2})(?:T\d.*)?$/.exec(value.trim());
  if (!match) return null;
  const year = Number(match[1]), month = Number(match[3]) - 1, day = Number(match[4]), date = new Date(year, month, day);
  return date.getFullYear() === year && date.getMonth() === month && date.getDate() === day ? date : null;
}
export const unreadableDate = value => typeof value === 'string' && value.trim() !== '' && !parseDate(value);
export const isoDay = date => date ? [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-') : '';
export const renewalOf = server => parseDate(server?.renewalDate || server?.renewalDateText);
export function daysUntil(date, today = new Date()) {
  if (!date) return null;
  return Math.round((Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) - Date.UTC(today.getFullYear(), today.getMonth(), today.getDate())) / 86400000);
}
export const daysLeft = (server, today = new Date()) => daysUntil(renewalOf(server), today);
export function dueLabel(days, server) {
  if (days === null || days === undefined) return unreadableDate(server?.renewalDate || server?.renewalDateText) ? '日期无法识别' : '未设置续费日';
  if (days < 0) return `已过期 ${-days} 天`;
  if (days === 0) return '今天到期';
  if (days === 1) return '明天到期';
  return `${days} 天后到期`;
}
export const dueTone = days => days === null || days === undefined ? 'muted' : days < 0 ? 'danger' : days <= 7 ? 'warning' : days <= 30 ? 'notice' : 'calm';
const WEEK = '日一二三四五六';
export const weekday = date => date ? '周' + WEEK[date.getDay()] : '';
export const shortDate = date => date ? `${date.getFullYear()}/${String(date.getMonth() + 1).padStart(2, '0')}/${String(date.getDate()).padStart(2, '0')}` : '';
export function addMonths(iso, months) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '');
  if (!match || !Number.isInteger(months)) return '';
  const [year, month, day] = match.slice(1).map(Number), base = new Date(Date.UTC(year, month - 1 + months, 1));
  const last = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth() + 1, 0)).getUTCDate();
  base.setUTCDate(Math.min(day, last));
  return base.toISOString().slice(0, 10);
}
export const beijingToday = (now = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
export function beijingTime(value) {
  const date = new Date(value);
  return value && !Number.isNaN(date.valueOf()) ? date.toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : '';
}
export function greeting(date = new Date()) {
  const hour = date.getHours();
  return hour < 5 ? '夜深了' : hour < 11 ? '早上好' : hour < 13 ? '中午好' : hour < 18 ? '下午好' : '晚上好';
}

// ── Money and billing ────────────────────────────────────────────────────────
export const CYCLES = { monthly: { label: '月付', unit: '月', months: 1 }, quarterly: { label: '季付', unit: '季', months: 3 }, yearly: { label: '年付', unit: '年', months: 12 } };
export const CURRENCIES = { CNY: '人民币', USD: '美元', HKD: '港币', EUR: '欧元', JPY: '日元', GBP: '英镑', CAD: '加元' };
export const money = (value, digits = 2) => Number(value || 0).toLocaleString('zh-CN', { minimumFractionDigits: digits, maximumFractionDigits: digits });
export const hasPrice = server => String(server?.monthlyCostAmount ?? '').trim() !== '' && Number.isFinite(Number(server.monthlyCostAmount));
export function priceText(server) {
  if (!hasPrice(server)) return '';
  return `${server.monthlyCostCurrency || 'CNY'} ${money(server.monthlyCostAmount)} / ${(CYCLES[server.monthlyCostCycle] || CYCLES.monthly).unit}`;
}
// Approximate monthly CNY using the saved reference rates (display only; the server owns the totals).
export function monthlyCNY(server, rates = {}) {
  if (!hasPrice(server)) return null;
  const rate = Number(rates[server.monthlyCostCurrency || 'CNY'] ?? (server.monthlyCostCurrency === 'CNY' || !server.monthlyCostCurrency ? 1 : NaN));
  if (!Number.isFinite(rate) || rate <= 0) return null;
  return Number(server.monthlyCostAmount) * rate / (CYCLES[server.monthlyCostCycle] || CYCLES.monthly).months;
}

// ── Servers ──────────────────────────────────────────────────────────────────
export const STATUS = { online: { label: '运行中', tone: 'ok' }, maintenance: { label: '维护中', tone: 'warning' }, idle: { label: '闲置', tone: 'muted' }, expired: { label: '已到期', tone: 'danger' } };
export const statusOf = value => STATUS[value] || { label: '未记录', tone: 'muted' };
export function statusCounts(servers = []) {
  const counts = { online: 0, maintenance: 0, idle: 0, expired: 0 };
  for (const server of servers) if (Object.hasOwn(counts, server.status)) counts[server.status]++;
  return counts;
}
export const providerName = server => String(server?.provider || '').trim();
export function providerGroups(servers = []) {
  const groups = new Map();
  for (const server of servers) { const name = providerName(server); if (!groups.has(name)) groups.set(name, []); groups.get(name).push(server); }
  return [...groups].map(([name, list]) => ({ name, servers: list })).sort((a, b) => b.servers.length - a.servers.length || a.name.localeCompare(b.name, 'zh-CN'));
}
export function matchesQuery(server, query) {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return true;
  return [server.name, server.ipAddress, server.provider, server.region, server.plan, ...(server.tags || [])].join(' ').toLowerCase().includes(q);
}
export const byPinnedThenName = (a, b) => Number(Boolean(b.isPinned)) - Number(Boolean(a.isPinned)) || String(a.name).localeCompare(String(b.name), 'zh-CN');
export function renewalBuckets(servers = [], today = new Date()) {
  const buckets = { overdue: [], week: [], month: [], later: [], undated: [] };
  for (const server of servers) {
    const days = daysLeft(server, today);
    const key = days === null ? 'undated' : days < 0 ? 'overdue' : days <= 7 ? 'week' : days <= 30 ? 'month' : 'later';
    buckets[key].push({ server, days });
  }
  for (const key of Object.keys(buckets)) buckets[key].sort((a, b) => (a.days ?? Infinity) - (b.days ?? Infinity) || String(a.server.name).localeCompare(String(b.server.name), 'zh-CN'));
  return buckets;
}
export function nextRenewal(servers = [], today = new Date()) {
  return servers.map(server => ({ server, days: daysLeft(server, today) })).filter(row => row.days !== null && row.days >= 0).sort((a, b) => a.days - b.days)[0] || null;
}
export function normalizeBandwidth(rawValue) {
  const value = String(rawValue ?? '').trim();
  const match = /^(\d+(?:\.\d+)?|\.\d+)\s*(?:([mMgG])(?:bps|b\/s|bit\/s)?)?$/.exec(value);
  return match ? `${match[1]}${(match[2] || 'M').toUpperCase()}` : value;
}
export function safeURL(rawValue) {
  try { const url = new URL(rawValue); return ['http:', 'https:'].includes(url.protocol) ? url.href : null; } catch { return null; }
}
export const shellQuote = text => "'" + String(text).replace(/'/g, `'"'"'`) + "'";
export function sshCommand(server) {
  if (!server?.ipAddress) throw new Error('请先填写 IP 或主机地址。');
  const port = Number(server.sshPort || 22);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('SSH 端口无效。');
  return `ssh -p ${port} -- ${shellQuote((server.username || 'root') + '@' + server.ipAddress)}`;
}

// ── Editing ──────────────────────────────────────────────────────────────────
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
// Only fields the person actually changed are sent, so concurrent edits elsewhere survive.
export function changedFields(draft, original) {
  return Object.fromEntries(Object.entries(draft).filter(([key, value]) => !same(value, original[key])));
}
export const tagsFrom = text => String(text || '').split(/[,，]/).map(tag => tag.trim()).filter(Boolean);

// ── Sorting ──────────────────────────────────────────────────────────────────
export const SORTS = { smart: '置顶优先', due: '到期时间', price: '月付金额', name: '名称' };
const byName = (a, b) => String(a.name).localeCompare(String(b.name), 'zh-CN');
// Missing dates or prices always sink to the end, whatever the direction.
export function sortServers(list, mode = 'smart', { rates = {}, today = new Date() } = {}) {
  const copy = [...list];
  if (mode === 'due') return copy.sort((a, b) => (daysLeft(a, today) ?? Infinity) - (daysLeft(b, today) ?? Infinity) || byName(a, b));
  if (mode === 'price') return copy.sort((a, b) => (monthlyCNY(b, rates) ?? -1) - (monthlyCNY(a, rates) ?? -1) || byName(a, b));
  if (mode === 'name') return copy.sort(byName);
  return copy.sort(byPinnedThenName);
}

// ── Batch edits ──────────────────────────────────────────────────────────────
// The selection endpoints take the whole new set, so batch toggles are computed here.
export function toggledSet(current, selected, on) {
  const result = new Set(current);
  for (const id of selected) { if (on) result.add(id); else result.delete(id); }
  return [...result];
}
