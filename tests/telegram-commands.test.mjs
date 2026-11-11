import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCommand, formatDueList, formatCostSummary, formatHelp, parseRenewalCallback, planTelegramRenewal, applyTelegramRenewal, telegramRenewalRequestId } from '../lib/telegram-commands.mjs';
import { formatReminderTable } from '../lib/telegram-table.mjs';
import { createTelegramQueryWorker } from '../lib/telegram-query.mjs';
import { createReminderWorker, sendTelegram, reminderKey } from '../lib/telegram.mjs';

const TOKEN = '123456789:ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghi';
const CHAT = '1234567890';
const now = new Date('2026-11-11T06:00:00Z'); // Beijing 2026-11-11 14:00
const ID = n => `${String(n).padStart(8, '0')}-0000-4000-8000-000000000000`;
const machine = (n, name, date, extra = {}) => ({ id: ID(n), name, provider: 'Vultr', renewalDate: date ? `${date}T00:00:00.000Z` : null, renewalDateText: date || '', expiryReminder: true, monthlyCostAmount: '12', monthlyCostCurrency: 'USD', monthlyCostCycle: 'monthly', renewalHistory: [], sshPassword: 'PRIVATE-SSH', ipAddress: 'PRIVATE-IP', notes: 'PRIVATE-NOTES', ...extra });
const fixtureState = servers => ({ version: 1, revision: 5, account: { username: 'fixture' }, servers, commands: [], settings: { telegram: { enabled: true, botToken: TOKEN, chatId: CHAT }, rates: { CNY: 1, USD: 7, HKD: 0.9, EUR: 8, JPY: 0.05, GBP: 9, CAD: 5 } } });
function wellFormed(message) {
  assert.ok(message.length < 3500); assert.ok(!/<(?!\/?(?:b|i)>)/.test(message));
  const stack = []; for (const [, closing, tag] of message.matchAll(/<(\/?)(b|i)>/g)) { if (closing) assert.equal(stack.pop(), tag); else stack.push(tag); } assert.equal(stack.length, 0);
  assert.match(message, /🕘 <i>北京时间：\d{4}-\d{2}-\d{2} \d{2}:\d{2}<\/i>$/);
  for (const secret of ['PRIVATE-SSH', 'PRIVATE-IP', 'PRIVATE-NOTES', TOKEN, CHAT]) assert.ok(!message.includes(secret));
}

test('commands are exact, trimmed and bounded', () => {
  assert.deepEqual(parseCommand(' 检查\n'), { kind: 'check' }); assert.deepEqual(parseCommand('/check'), { kind: 'check' });
  assert.deepEqual(parseCommand('/cost'), { kind: 'cost' }); assert.deepEqual(parseCommand('开销'), { kind: 'cost' }); assert.deepEqual(parseCommand('费用'), { kind: 'cost' });
  assert.deepEqual(parseCommand('/due'), { kind: 'due', days: 30 }); assert.deepEqual(parseCommand('/due 7'), { kind: 'due', days: 7 }); assert.deepEqual(parseCommand('到期 365'), { kind: 'due', days: 365 });
  assert.deepEqual(parseCommand('/help'), { kind: 'help' }); assert.deepEqual(parseCommand('/start'), { kind: 'help' });
  for (const text of ['/due 0', '/due 366', '/due abc', '到期30x', '/check@another_bot', '检查 extra', '查看', '', null, 42]) assert.equal(parseCommand(text), null);
});

test('due list groups every dated machine within the window and notes missing dates', () => {
  const state = fixtureState([machine(1, 'Past', '2026-11-09'), machine(2, 'Today', '2026-11-11', { autoRenew: true, expiryReminder: false }), machine(3, 'Later', '2026-11-30', { provider: '' }), machine(4, 'Far', '2027-03-01'), machine(5, 'Undated', '', { renewalDateText: '12/05/2026' })]);
  const [message] = formatDueList(state, { now, days: 30 }); wellFormed(message);
  assert.match(message, /^📅 <b>未来 30 天到期<\/b>\n共 <b>3<\/b> 台 · 含已过期 <b>1<\/b> 台/);
  assert.ok(message.indexOf('🔴 已过期 · 1 台') < message.indexOf('🟠 7 天内 · 1 台')); assert.ok(message.indexOf('🟠 7 天内 · 1 台') < message.indexOf('🔵 8–30 天 · 1 台'));
  assert.match(message, /<b>Today<\/b>\n├ 📅 2026-11-11 周三 · <b>今天到期<\/b>\n└ 🏢 Vultr · 💵 USD 12\.00 \/ 月 · 🔁 自动续费/);
  assert.match(message, /<b>Later<\/b>\n├ 📅 2026-11-30 周一 · <b>19 天后到期<\/b>\n└ 💵 USD 12\.00 \/ 月/);
  assert.ok(!message.includes('Far')); assert.match(message, /另有 1 台未填写有效续费日期/);
  const [empty] = formatDueList(fixtureState([machine(4, 'Far', '2027-03-01')]), { now, days: 1 }); wellFormed(empty); assert.match(empty, /未来 1 天没有需要续费的机器/);
  const many = formatDueList(fixtureState(Array.from({ length: 40 }, (_, i) => machine(i + 1, `M${i}`, '2026-11-20'))), { now, days: 30 });
  assert.equal(many.length, 5); many.forEach(wellFormed); assert.match(many[0], /第 1\/5 页/); assert.ok(many.at(-1).includes('💡 可发送')); assert.ok(!many[0].includes('💡 可发送'));
});

test('cost summary converts with saved rates, honours exclusions and ranks providers', () => {
  const state = fixtureState([machine(1, 'A', '2026-12-01'), machine(2, 'B', '2026-12-01', { provider: 'Hetzner', monthlyCostAmount: '120', monthlyCostCurrency: 'EUR', monthlyCostCycle: 'yearly' }), machine(3, 'C', '2026-12-01', { excludeFromCosts: true }), machine(4, 'D', '2026-12-01', { monthlyCostAmount: '' })]);
  const [message] = formatCostSummary(state, { now }); wellFormed(message);
  assert.match(message, /月付开销　<b>¥ 164\.00<\/b>/); assert.match(message, /年付开销　<b>¥ 1,968\.00<\/b>/); assert.match(message, /单期合计　<b>¥ 1,044\.00<\/b>/);
  assert.match(message, /参与统计 3 \/ 4 台 · 1 台账单不完整/);
  assert.ok(message.indexOf('Vultr') < message.indexOf('Hetzner')); assert.match(message, /Vultr\n└ <b>¥ 84\.00<\/b> \/ 月 · 1 台/); assert.match(message, /Hetzner\n└ <b>¥ 80\.00<\/b> \/ 月 · 1 台/);
  const [help] = formatHelp({ now }); wellFormed(help); assert.match(help, /\/due 30/); assert.match(help, /✅ 已续费/);
});

test('checklist status follows the current reminder point, not only the seven-day one', () => {
  const state = fixtureState([machine(1, 'Eve', '2026-11-12'), machine(2, 'Day', '2026-11-11'), machine(3, 'Early', '2026-11-15')]);
  const cfg = state.settings.telegram; state.telegramDeliveries = {};
  state.telegramDeliveries[reminderKey(ID(1), '2026-11-12', 'early', cfg)] = { state: 'sent' };
  state.telegramDeliveries[reminderKey(ID(2), '2026-11-11', 'day', cfg)] = { state: 'sent' };
  state.telegramDeliveries[reminderKey(ID(3), '2026-11-15', 'early', cfg)] = { state: 'failed' };
  const [message] = formatReminderTable(state, { now });
  assert.match(message, /<b>Eve<\/b>\n├ 📅 2026-11-12 周四 · <b>明天到期<\/b>\n└ 🏢 Vultr · <i>等待发送<\/i>/);
  assert.match(message, /<b>Day<\/b>\n├ 📅 2026-11-11 周三 · <b>今天到期<\/b>\n└ 🏢 Vultr · <i>✓ 已发送<\/i>/);
  assert.match(message, /<b>Early<\/b>\n├[^\n]*\n└ 🏢 Vultr · <i>⚠ 发送失败<\/i>/);
});

test('renewal callbacks are validated and one reminder date records at most one renewal', () => {
  assert.deepEqual(parseRenewalCallback(`rn:${ID(1)}:20261114`), { action: 'start', serverId: ID(1), date: '2026-11-14' });
  for (const data of [`rn:${ID(1)}:20260230`, `zz:${ID(1)}:20261114`, `rn:not-a-uuid:20261114`, `rn:${ID(1)}:2026111`, `rc:${ID(1)}:20261114x`, null]) assert.equal(parseRenewalCallback(data), null);
  const state = fixtureState([machine(1, 'Tokyo', '2026-11-14', { monthlyCostCycle: 'quarterly' }), machine(2, 'NoPrice', '2026-11-14', { monthlyCostAmount: '' })]);
  assert.match(planTelegramRenewal(state, ID(2), '2026-11-14').error, /未填写价格|还没有填写价格/);
  assert.equal(planTelegramRenewal(state, ID(1), '2026-11-13').stale, true); assert.equal(planTelegramRenewal(state, ID(9), '2026-11-14').stale, true);
  const before = structuredClone(state); assert.equal(planTelegramRenewal(state, ID(1), '2026-11-14').newExpiry, '2027-02-14'); assert.deepEqual(state, before);
  const result = applyTelegramRenewal(state, ID(1), '2026-11-14', { now });
  assert.equal(result.changed, true); assert.equal(state.revision, 6); assert.equal(state.servers[0].renewalDate, '2027-02-14T00:00:00.000Z');
  const [record] = state.servers[0].renewalHistory;
  assert.deepEqual({ amount: record.amount, currency: record.currency, cycle: record.cycle, periods: record.periods, paidOn: record.paidOn, baseDate: record.baseDate, previousExpiry: record.previousExpiry, newExpiry: record.newExpiry, requestId: record.requestId }, { amount: '12', currency: 'USD', cycle: 'quarterly', periods: 1, paidOn: '2026-11-11', baseDate: '2026-11-14', previousExpiry: '2026-11-14', newExpiry: '2027-02-14', requestId: telegramRenewalRequestId(ID(1), '2026-11-14') });
  const again = applyTelegramRenewal(state, ID(1), '2026-11-14', { now });
  assert.ok(again.duplicate); assert.ok(!again.changed); assert.equal(state.revision, 6); assert.equal(state.servers[0].renewalHistory.length, 1);
});

test('reminders carry the renewal button and sendTelegram forwards only a valid keyboard', async () => {
  let state = fixtureState([machine(1, 'Tokyo', '2026-11-14')]); const sent = [];
  const vault = { snapshot: () => structuredClone(state), save: next => { state = structuredClone(next); } };
  const worker = createReminderWorker({ vault, origin: 'https://example.com', now: () => now, send: async (cfg, text, extra) => { sent.push({ text, extra }); return { messageId: 1 }; } });
  await worker.tick(); assert.equal(sent.length, 1);
  assert.deepEqual(sent[0].extra.replyMarkup, { inline_keyboard: [[{ text: '✅ 已续费', callback_data: `rn:${ID(1)}:20261114` }]] });
  assert.match(sent[0].text, /^⏰ VPS 到期提醒\n\n🖥 Tokyo\n🏢 Vultr\n📅 2026-11-14（周六）\n🟡 剩余 3 天，请及时处理。/); assert.ok(!sent[0].text.includes('PRIVATE'));
  const bodies = []; const fetchImpl = async (url, init) => { bodies.push(JSON.parse(init.body)); return { ok: true, status: 200, json: async () => ({ ok: true, result: { message_id: 9 } }) }; };
  await sendTelegram({ botToken: TOKEN, chatId: CHAT }, 'hi', { fetchImpl, replyMarkup: sent[0].extra.replyMarkup });
  assert.deepEqual(bodies[0].reply_markup, sent[0].extra.replyMarkup);
  await sendTelegram({ botToken: TOKEN, chatId: CHAT }, 'hi', { fetchImpl }); assert.equal(Object.hasOwn(bodies[1], 'reply_markup'), false);
  await assert.rejects(sendTelegram({ botToken: TOKEN, chatId: CHAT }, 'hi', { fetchImpl, replyMarkup: { keyboard: [] } })); assert.equal(bodies.length, 2);
});

function queryFixture(servers) {
  let state = fixtureState(servers), instant = now.getTime(), queue = [];
  const calls = [], sent = [];
  const vault = { snapshot: () => structuredClone(state), save(next) { state = structuredClone(next); } };
  const ok = result => ({ ok: true, status: 200, json: async () => ({ ok: true, result }) });
  const fetchImpl = async (url, init) => { const method = url.slice(url.lastIndexOf('/') + 1), payload = JSON.parse(init.body); calls.push({ method, payload }); if (method === 'getWebhookInfo') return ok({ url: '' }); if (method === 'getUpdates') return ok(queue.shift() || []); return ok(true); };
  const send = async (config, html, extra) => { sent.push({ html, extra }); return { messageId: sent.length }; };
  const worker = createTelegramQueryWorker({ vault, now: () => new Date(instant), fetchImpl, send, pollTimeoutSeconds: 0 });
  let next = 1;
  const tap = (data, patch = {}) => ({ update_id: next++, callback_query: { id: 'cb' + next, from: { id: Number(CHAT), is_bot: false }, data, message: { message_id: 77, chat: { id: Number(CHAT), type: 'private' }, text: '⏰ VPS 到期提醒' }, ...patch } });
  const say = text => ({ update_id: next++, message: { message_id: next, date: Math.floor(instant / 1000), chat: { id: Number(CHAT), type: 'private' }, from: { id: Number(CHAT), is_bot: false }, text } });
  return { worker, calls, sent, tap, say, queue: (...b) => queue.push(...b), advance: ms => { instant += ms; }, get state() { return state; } };
}

test('due, cost and help commands reply in HTML through the same private channel', async () => {
  const f = queryFixture([machine(1, 'Tokyo', '2026-11-14')]);
  f.queue([f.say('/due 7')]); await f.worker.tick(); f.advance(6000);
  f.queue([f.say('开销')]); await f.worker.tick(); f.advance(6000);
  f.queue([f.say('帮助')]); await f.worker.tick();
  assert.equal(f.sent.length, 3); f.sent.forEach(item => assert.equal(item.extra.parseMode, 'HTML'));
  assert.match(f.sent[0].html, /未来 7 天到期/); assert.match(f.sent[1].html, /费用概览/); assert.match(f.sent[2].html, /VPS 管家 · 指令/);
});

test('renewal button asks for confirmation, records once, and ignores foreign taps', async () => {
  const f = queryFixture([machine(1, 'Tokyo', '2026-11-14')]), data = `rn:${ID(1)}:20261114`;
  f.queue([f.tap(data, { from: { id: 999, is_bot: false } }), f.tap(data, { message: { message_id: 1, chat: { id: 999, type: 'private' } } }), f.tap(data, { from: { id: Number(CHAT), is_bot: true } })]);
  await f.worker.tick(); assert.deepEqual(f.calls.map(c => c.method), ['getWebhookInfo', 'getUpdates']); assert.equal(f.state.revision, 5);
  f.queue([f.tap(data)]); await f.worker.tick();
  const markup = f.calls.find(c => c.method === 'editMessageReplyMarkup');
  assert.equal(markup.payload.message_id, 77); assert.equal(markup.payload.reply_markup.inline_keyboard[0][0].text, '✅ 确认，延至 2026-12-14'); assert.equal(markup.payload.reply_markup.inline_keyboard[1][0].callback_data, `rx:${ID(1)}:20261114`);
  assert.match(f.calls.find(c => c.method === 'answerCallbackQuery').payload.text, /将记录 USD 12（月付 1 期）\n到期日 2026-11-14 → 2026-12-14/); assert.equal(f.state.revision, 5);
  f.calls.length = 0; f.queue([f.tap(`rx:${ID(1)}:20261114`)]); await f.worker.tick();
  assert.equal(f.calls.find(c => c.method === 'editMessageReplyMarkup').payload.reply_markup.inline_keyboard[0][0].callback_data, data); assert.equal(f.state.revision, 5);
  f.calls.length = 0; f.queue([f.tap(`rc:${ID(1)}:20261114`), f.tap(`rc:${ID(1)}:20261114`)]); await f.worker.tick();
  assert.equal(f.state.revision, 6); assert.equal(f.state.servers[0].renewalDate, '2026-12-14T00:00:00.000Z'); assert.equal(f.state.servers[0].renewalHistory.length, 1); assert.equal(f.state.servers[0].renewalHistory[0].note, '通过 Telegram 一键记录');
  const edit = f.calls.find(c => c.method === 'editMessageText'); assert.match(edit.payload.text, /^⏰ VPS 到期提醒\n\n✅ 已记录续费：USD 12（月付 1 期）\n📅 新到期日：2026-12-14（周一）$/); assert.equal(Object.hasOwn(edit.payload, 'reply_markup'), false);
  const answers = f.calls.filter(c => c.method === 'answerCallbackQuery').map(c => c.payload.text); assert.deepEqual(answers, ['已记录，到期日延至 2026-12-14', '这次续费已经记录过了。']);
  f.calls.length = 0; f.queue([f.tap(data)]); await f.worker.tick(); assert.equal(f.calls.find(c => c.method === 'answerCallbackQuery').payload.text, '这次续费已经记录过了。'); assert.equal(f.state.revision, 6);
  assert.equal(f.state.telegramQueryState.offset, 9); assert.equal(f.sent.length, 0);
});

test('a stale reminder button never moves a date that was already changed elsewhere', async () => {
  const f = queryFixture([machine(1, 'Tokyo', '2026-12-20')]);
  f.queue([f.tap(`rc:${ID(1)}:20261114`)]); await f.worker.tick();
  const answer = f.calls.find(c => c.method === 'answerCallbackQuery').payload; assert.match(answer.text, /到期日已变为 2026-12-20/); assert.equal(answer.show_alert, true);
  assert.deepEqual(f.calls.find(c => c.method === 'editMessageReplyMarkup').payload.reply_markup, { inline_keyboard: [] }); assert.equal(f.state.revision, 5); assert.equal(f.state.servers[0].renewalHistory.length, 0);
});
