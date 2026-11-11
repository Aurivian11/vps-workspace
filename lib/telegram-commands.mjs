import { createHash } from 'node:crypto';
import { parseRenewalDate } from './renewal-date.mjs';
import { recordRenewal, suggestRenewalDate } from './renewals.mjs';
import { calculateCosts, DEFAULT_RATES } from './domain.mjs';
import { renewalKeyboard } from './telegram.mjs';
import { DAY, DIVIDER, html, clean, beijingClock, weekday, remainingText, footer, money, priceLabel, cycleName, paginate } from './telegram-format.mjs';

export const COMMAND_HINT = "💡 可发送：检查 · 到期 30 · 开销 · 帮助";
const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';

// Exact private-chat commands only; anything else stays silent.
export function parseCommand(text) {
  if (typeof text !== 'string') return null;
  const value = text.trim();
  if (['检查', '/check'].includes(value)) return { kind: 'check' };
  if (['开销', '费用', '/cost'].includes(value)) return { kind: 'cost' };
  if (['帮助', '/help', '/start'].includes(value)) return { kind: 'help' };
  const due = /^(?:\/due|到期)(?:[ \t]+(\d{1,3}))?$/.exec(value);
  if (due) { const days = due[1] ? Number(due[1]) : 30; return days >= 1 && days <= 365 ? { kind: 'due', days } : null; }
  return null;
}

export function formatHelp({ now = new Date() } = {}) {
  const clock = beijingClock(now);
  return [`🤖 <b>VPS 管家 · 指令</b>\n${DIVIDER}\n<b>检查</b> 或 /check\n└ 已选提醒机器的到期清单\n\n<b>到期 30</b> 或 /due 30\n└ 未来 30 天内到期的全部机器（天数 1–365）\n\n<b>开销</b> 或 /cost\n└ 月付、年付与各服务商开销\n\n<b>帮助</b> 或 /help\n└ 显示本说明\n\n到期提醒下方有「✅ 已续费」按钮，确认后自动记录续费 1 期并更新到期日。\n\n${footer(clock)}`];
}

export function formatDueList(state, { now = new Date(), days = 30 } = {}) {
  const clock = beijingClock(now);
  const servers = Array.isArray(state?.servers) ? state.servers : [];
  const dated = [], missing = [];
  for (const server of servers) {
    const due = parseRenewalDate(server.renewalDate || server.renewalDateText);
    if (!due) { missing.push(server); continue; }
    const left = Math.round((due.day - clock.day) / DAY);
    if (left <= days) dated.push({ server, due, left });
  }
  dated.sort((a, b) => a.left - b.left || clean(a.server.name).localeCompare(clean(b.server.name), 'zh-CN'));
  const overdue = dated.filter(row => row.left < 0).length;
  const heading = `📅 <b>未来 ${days} 天到期</b>\n共 <b>${dated.length}</b> 台${overdue ? ` · 含已过期 <b>${overdue}</b> 台` : ''}`;
  const note = missing.length ? `\n<i>另有 ${missing.length} 台未填写有效续费日期</i>` : '';
  if (!dated.length) return [`${heading}\n${DIVIDER}\n未来 ${days} 天没有需要续费的机器。${note}\n\n${footer(clock, COMMAND_HINT)}`];
  const sections = { overdue: '🔴 已过期', soon: '🟠 7 天内', later: `🔵 8–${days} 天` };
  const totals = {};
  const entries = dated.map(({ server, due, left }) => {
    const section = left < 0 ? 'overdue' : left <= 7 ? 'soon' : 'later';
    totals[section] = (totals[section] || 0) + 1;
    const details = [clean(server.provider) && `🏢 ${html(clean(server.provider))}`, priceLabel(server) && `💵 ${html(priceLabel(server))}`, server.autoRenew === true && '🔁 自动续费'].filter(Boolean).join(' · ');
    const first = `📅 ${due.date} ${weekday(due.day)} · <b>${remainingText(left)}</b>`;
    return { section, body: `<b>${html(clean(server.name) || '未命名机器')}</b>\n${details ? `├ ${first}\n└ ${details}` : `└ ${first}`}` };
  });
  const render = (part, total, records, last) => {
    const groups = new Map();
    for (const record of records) { if (!groups.has(record.section)) groups.set(record.section, []); groups.get(record.section).push(record.body); }
    const body = [...groups].map(([key, items]) => `<b>${sections[key]} · ${totals[key]} 台</b>\n\n${items.join('\n\n')}`).join('\n\n');
    return `${heading}${total > 1 ? `\n<i>第 ${part}/${total} 页</i>` : ''}\n${DIVIDER}\n\n${body}${last ? note : ''}\n\n${footer(clock, last ? COMMAND_HINT : '')}`;
  };
  return paginate(entries, render, 8);
}

export function formatCostSummary(state, { now = new Date() } = {}) {
  const clock = beijingClock(now);
  const servers = Array.isArray(state?.servers) ? state.servers : [];
  const rates = state?.settings?.rates || DEFAULT_RATES;
  const costs = calculateCosts(servers, rates);
  const groups = new Map();
  for (const server of servers) {
    if (server?.excludeFromCosts === true) continue;
    const name = clean(server.provider) || '未设置服务商';
    if (!groups.has(name)) groups.set(name, []);
    groups.get(name).push(server);
  }
  const providers = [...groups].map(([name, list]) => ({ name, cost: calculateCosts(list, rates) })).filter(row => row.cost.includedCount > 0).sort((a, b) => b.cost.monthlyTotal - a.cost.monthlyTotal || a.name.localeCompare(b.name, 'zh-CN'));
  const shown = providers.slice(0, 12), rest = providers.slice(12);
  const lines = shown.map(row => `${html(row.name)}\n└ <b>¥ ${money(row.cost.monthlyTotal)}</b> / 月 · ${row.cost.includedCount} 台`);
  if (rest.length) lines.push(`其他 ${rest.length} 家\n└ <b>¥ ${money(rest.reduce((sum, row) => sum + row.cost.monthlyTotal, 0))}</b> / 月`);
  const scope = `参与统计 ${costs.selectedCount} / ${servers.length} 台${costs.invalidCostCount ? ` · ${costs.invalidCostCount} 台账单不完整` : ''}`;
  return [`💰 <b>费用概览</b>\n${DIVIDER}\n月付开销　<b>¥ ${money(costs.monthlyTotal)}</b>\n年付开销　<b>¥ ${money(costs.yearlyTotal)}</b>\n单期合计　<b>¥ ${money(costs.recordedTotal)}</b>\n<i>${scope}</i>${lines.length ? `\n\n<b>🏢 按服务商 · 折合月付</b>\n\n${lines.join('\n\n')}` : '\n\n还没有可统计的账单。'}\n\n${footer(clock, '按参考汇率折算人民币，仅供预算参考')}`];
}

// "✅ 已续费" buttons carry the server and the expiry date the reminder was about.
const CALLBACK = new RegExp(`^(rn|rc|rx):(${UUID}):(\\d{8})$`, 'i');
export function parseRenewalCallback(data) {
  if (typeof data !== 'string' || data.length > 64) return null;
  const match = CALLBACK.exec(data);
  if (!match) return null;
  const date = `${match[3].slice(0, 4)}-${match[3].slice(4, 6)}-${match[3].slice(6)}`;
  if (parseRenewalDate(date)?.date !== date) return null;
  return { action: { rn: 'start', rc: 'confirm', rx: 'cancel' }[match[1].toLowerCase()], serverId: match[2].toLowerCase(), date };
}
export function confirmKeyboard(serverId, date, newExpiry) {
  const tail = `${serverId}:${date.replaceAll('-', '')}`;
  return { inline_keyboard: [[{ text: `✅ 确认，延至 ${newExpiry}`, callback_data: `rc:${tail}` }], [{ text: '取消', callback_data: `rx:${tail}` }]] };
}
// One reminder date maps to one request id, so repeated taps can never record twice.
export function telegramRenewalRequestId(serverId, date) {
  const h = createHash('sha256').update(`telegram-renewal\n${serverId}\n${date}`).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-${'89ab'[parseInt(h[16], 16) % 4]}${h.slice(17, 20)}-${h.slice(20, 32)}`;
}
export function planTelegramRenewal(state, serverId, date) {
  const server = (state?.servers || []).find(record => record.id === serverId);
  if (!server) return { error: '这台机器已被删除。', stale: true };
  const requestId = telegramRenewalRequestId(serverId, date);
  const done = (server.renewalHistory || []).find(record => record.requestId === requestId);
  if (done) return { server, requestId, duplicate: done };
  const current = parseRenewalDate(server.renewalDate || server.renewalDateText);
  if (current?.date !== date) return { error: `到期日已变为 ${current?.date || '未设置'}，这条提醒已失效。`, stale: true };
  const amount = String(server.monthlyCostAmount ?? '').trim();
  if (!amount) return { error: '这台机器还没有填写价格，请到管理台记录续费。' };
  const cycle = ['monthly', 'quarterly', 'yearly'].includes(server.monthlyCostCycle) ? server.monthlyCostCycle : 'monthly';
  const currency = server.monthlyCostCurrency || 'CNY';
  try { return { server, requestId, amount, currency, cycle, newExpiry: suggestRenewalDate(server, cycle, 1, date) }; }
  catch (error) { return { error: error.message || '无法计算新的到期日，请到管理台记录续费。' }; }
}
export function renewalPlanText(plan, date) {
  return `将记录 ${plan.currency} ${plan.amount}（${cycleName(plan.cycle)} 1 期）\n到期日 ${date} → ${plan.newExpiry}`;
}
// Mutates `state` only when a new record is written; the caller persists it.
export function applyTelegramRenewal(state, serverId, date, { now = new Date() } = {}) {
  const plan = planTelegramRenewal(state, serverId, date);
  if (plan.error || plan.duplicate) return plan;
  const index = state.servers.findIndex(record => record.id === serverId);
  let result;
  try {
    result = recordRenewal(state.servers[index], { requestId: plan.requestId, amount: plan.amount, currency: plan.currency, cycle: plan.cycle, periods: 1, paidOn: beijingClock(now).date, baseDate: date, newExpiry: plan.newExpiry, note: '通过 Telegram 一键记录' }, { now: () => new Date(now) });
  } catch (error) { return { error: error.message || '续费记录未保存，请到管理台记录。' }; }
  if (result.duplicate) return { ...plan, duplicate: result.record };
  state.servers[index] = result.server;
  state.revision = (Number(state.revision) || 0) + 1;
  return { ...plan, record: result.record, changed: true };
}
export { renewalKeyboard };
