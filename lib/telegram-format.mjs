// Shared helpers for Telegram replies: HTML-safe text, Beijing calendar days and paging.
export const DAY = 86400000;
export const MAX_MESSAGE = 3499;
export const DIVIDER = '┈┈┈┈┈┈┈┈┈┈┈┈';
export const html = value => String(value).replace(/[&<>]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));
export const clean = value => String(value ?? '').normalize('NFC').replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, ' ').replace(/\s+/gu, ' ').trim();
export function beijingClock(now) {
  const instant = new Date(now);
  if (!Number.isFinite(instant.getTime())) throw new TypeError('Invalid reminder query time');
  const iso = new Date(instant.getTime() + 8 * 3600000).toISOString();
  return { day: Date.parse(iso.slice(0, 10) + 'T00:00:00Z'), date: iso.slice(0, 10), time: iso.slice(11, 16) };
}
export const weekday = day => '周' + '日一二三四五六'[new Date(day).getUTCDay()];
export const remainingText = days => days === 0 ? '今天到期' : days === 1 ? '明天到期' : days < 0 ? `已过期 ${-days} 天` : `${days} 天后到期`;
export const footer = (clock, hint = '') => `${hint ? `<i>${hint}</i>\n` : ''}🕘 <i>北京时间：${clock.date} ${clock.time}</i>`;
export const money = value => Number(value || 0).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const CYCLE = { monthly: '月', quarterly: '季', yearly: '年' };
export const cycleName = cycle => ({ monthly: '月付', quarterly: '季付', yearly: '年付' })[cycle] || '月付';
export function priceLabel(server) {
  const amount = String(server?.monthlyCostAmount ?? '').trim();
  if (!amount || !Number.isFinite(Number(amount))) return '';
  return `${clean(server.monthlyCostCurrency || 'CNY')} ${money(amount)} / ${CYCLE[server.monthlyCostCycle] || '月'}`;
}
// Whole entries per page: at most `perPage`, and each rendered page stays under the message limit.
export function paginate(entries, render, perPage = 5) {
  const pages = []; let current = [];
  for (const entry of entries) {
    if (current.length && (current.length >= perPage || render(entries.length, entries.length, [...current, entry], false).length > MAX_MESSAGE)) { pages.push(current); current = []; }
    current.push(entry);
  }
  if (current.length) pages.push(current);
  return pages.map((records, index) => render(index + 1, pages.length, records, index === pages.length - 1));
}
