import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeTelegram, publicTelegram, sendTelegram, TelegramDeliveryError, createReminderWorker } from '../lib/telegram.mjs';
const TOKEN = '123456789:' + 'a'.repeat(35);
const config = { enabled: true, botToken: TOKEN, chatId: '123456' };
const server = (id, date, extra = {}) => ({ id, name: `机器 ${id}`, provider: '测试厂商', renewalDate: date + 'T00:00:00.000Z', expiryReminder: true, sshPassword: 'SHOULD_NOT_LEAK', notes: 'PRIVATE_NOTE', ipAddress: 'PRIVATE_IP', ...extra });
function fixture(servers, options = {}) {
  let state = { revision: 41, servers, settings: { telegram: { ...config } }, commands: [{ id: 'preserved' }] };
  let clock = new Date('2026-10-14T01:00:00Z');
  const messages = [];
  const vault = { snapshot: () => structuredClone(state), save: (next) => { state = structuredClone(next); } };
  const send = options.send || (async (cfg, text) => { messages.push({ cfg, text }); return { messageId: messages.length }; });
  const worker = createReminderWorker({ vault, origin: 'https://example.com', now: () => clock, send });
  return { vault, worker, messages, state: () => state, mutate: (fn) => { const s = vault.snapshot(); fn(s); vault.save(s); }, time: (value) => { clock = new Date(value); }, newWorker: () => createReminderWorker({ vault, origin: 'https://example.com', now: () => clock, send }) };
}
const receipt = (f) => Object.values(f.state().telegramDeliveries || {})[0];
function deferred() { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; }

test('settings validate strictly, preserve token on blank edit, and never expose it', () => {
  assert.deepEqual(normalizeTelegram({}, config), config);
  assert.equal(normalizeTelegram({ botToken: ' ' }, config).botToken, TOKEN);
  assert.equal(normalizeTelegram({ enabled: false, clearToken: true }, config).botToken, '');
  for (const value of [{ enabled: 'true' }, { botToken: 'https://evil' }, { chatId: '@username' }, { botToken: null }, { clearToken: 'true' }, { enabled: true }]) assert.throws(() => normalizeTelegram(value));
  assert.equal(publicTelegram(config).hasToken, true);
  assert.equal(JSON.stringify(publicTelegram(config)).includes(TOKEN), false);
  assert.equal(publicTelegram(config).hour, 9);
});
test('only selected servers 0..7 calendar days out are sent, with exact safe fields', async () => {
  const f = fixture([server('seven', '2026-10-21'), server('eight', '2026-10-22'), server('today', '2026-10-14'), server('old', '2026-10-13'), server('off', '2026-10-20', { expiryReminder: false }), server('legacy', '2026-10-21', { expiryReminder: undefined }), server('invalid', '2026-02-30')]);
  await f.worker.tick();
  assert.equal(f.messages.length, 2);
  assert.match(f.messages[0].text, /剩余 7 天/);
  assert.match(f.messages[1].text, /今天到期/);
  assert.match(f.messages[0].text, /https:\/\/example.com/);
  for (const secret of ['SHOULD_NOT_LEAK', 'PRIVATE_NOTE', 'PRIVATE_IP', TOKEN]) assert.equal(JSON.stringify(f.messages.map(m => m.text)).includes(secret), false);
  assert.equal(f.state().revision, 41);
});
test('Beijing 09:00 gate and stored date prefix are independent of UTC date/time', async () => {
  const f = fixture([server('a', '2026-10-21')]);
  f.time('2026-10-14T00:59:59Z'); await f.worker.tick(); assert.equal(f.messages.length, 0);
  f.time('2026-10-14T01:00:00Z'); await f.worker.tick(); assert.equal(f.messages.length, 1);
  const g = fixture([server('b', '2026-10-21', { renewalDate: '2026-10-21T23:30:00Z' })]);
  await g.worker.tick(); assert.match(g.messages[0].text, /2026-10-21/);
});
test('disabled or incomplete global config produces no network calls', async () => {
  const f = fixture([server('a', '2026-10-21')]);
  for (const settings of [{ ...config, enabled: false }, { ...config, botToken: '' }, undefined]) {
    f.mutate(s => { s.settings.telegram = settings; }); await f.worker.tick();
  }
  assert.equal(f.messages.length, 0);
});
test('one delivery survives worker restarts, token rotation, and opt-out/in; changed renewal or destination permits next delivery', async () => {
  const f = fixture([server('a', '2026-10-21')]);
  await f.worker.tick(); await f.worker.tick(); await f.newWorker().tick();
  f.mutate(s => { s.servers[0].expiryReminder = false; }); await f.worker.tick();
  f.mutate(s => { s.servers[0].expiryReminder = true; s.settings.telegram.botToken = '123456789:' + 'b'.repeat(35); }); await f.worker.tick();
  assert.equal(f.messages.length, 1);
  f.mutate(s => { s.servers[0].renewalDate = '2026-10-20T00:00:00Z'; }); await f.worker.tick(); assert.equal(f.messages.length, 2);
  f.mutate(s => { s.settings.telegram.chatId = '-987654'; }); await f.worker.tick(); assert.equal(f.messages.length, 3);
});
test('awaited send preserves concurrent edits and rechecks next server/settings', async () => {
  const gate = deferred(); let calls = 0;
  const f = fixture([server('a', '2026-10-21'), server('b', '2026-10-21')], { send: async () => { calls++; await gate.promise; return { messageId: 77 }; } });
  const tick = f.worker.tick();
  assert.equal(receipt(f).state, 'pending');
  assert.equal(f.worker.tick(), tick);
  f.mutate(s => { s.revision = 42; s.servers[0].notes = 'CONCURRENT_EDIT'; s.servers[1].expiryReminder = false; s.commands.push({ id: 'new' }); });
  gate.resolve(); await tick;
  assert.equal(calls, 1); assert.equal(f.state().revision, 42); assert.equal(f.state().servers[0].notes, 'CONCURRENT_EDIT'); assert.equal(f.state().commands.length, 2); assert.equal(receipt(f).state, 'sent');
});
test('global disable during send prevents any subsequent server send', async () => {
  const gate = deferred(); let calls = 0;
  const f = fixture([server('a', '2026-10-21'), server('b', '2026-10-21')], { send: async () => { calls++; await gate.promise; return { messageId: 1 }; } });
  const tick = f.worker.tick(); f.mutate(s => { s.settings.telegram.enabled = false; }); gate.resolve(); await tick;
  assert.equal(calls, 1); assert.equal(f.state().settings.telegram.enabled, false);
});
test('orphan pending is marked uncertain and never retried without confirmation', async () => {
  const gate = deferred();
  const f = fixture([server('a', '2026-10-21')], { send: () => gate.promise });
  const inflight = f.worker.tick();
  const orphan = structuredClone(f.state());
  gate.resolve({ messageId: 1 }); await inflight;
  f.vault.save(orphan);
  const nextWorker = f.newWorker(); await nextWorker.tick();
  assert.equal(receipt(f).state, 'uncertain'); assert.equal(nextWorker.status().uncertainCount, 1);
  assert.throws(() => nextWorker.retryUncertain(), /确认/);
  assert.deepEqual(nextWorker.retryUncertain({ confirmed: true }), { resetCount: 1 });
  await nextWorker.tick(); assert.equal(receipt(f).state, 'sent');
});
test('ambiguous failure has no automatic retry, known retryable rejection uses bounded backoff', async () => {
  let calls = 0;
  const f = fixture([server('a', '2026-10-21')], { send: async () => { calls++; throw Error('request to ' + TOKEN); } });
  await f.worker.tick(); await f.worker.tick(); assert.equal(calls, 1); assert.equal(receipt(f).state, 'uncertain'); assert.equal(JSON.stringify(f.state()).includes('request to'), false);
  let retries = 0;
  const g = fixture([server('b', '2026-10-21')], { send: async () => { retries++; throw new TelegramDeliveryError('稍后重试。', { deliveryState: 'failed', retryable: true, retryAfterMs: 600000 }); } });
  await g.worker.tick(); await g.worker.tick(); assert.equal(retries, 1);
  g.time('2026-10-14T01:09:59Z'); await g.worker.tick(); assert.equal(retries, 1);
  for (const minute of [10, 20, 40, 80, 160]) { g.time(new Date(Date.parse('2026-10-14T01:00:00Z') + minute * 60000)); await g.worker.tick(); }
  assert.equal(retries, 5); assert.equal(receipt(g).retryable, false);
});
test('permanent rejection can be manually retried after user starts bot; changed credentials retry automatically', async () => {
  let fail = true, calls = 0;
  const f = fixture([server('a', '2026-10-21')], { send: async () => { calls++; if (fail) throw new TelegramDeliveryError('请先开始对话。', { deliveryState: 'failed' }); return { messageId: 1 }; } });
  await f.worker.tick(); await f.worker.tick(); assert.equal(calls, 1);
  fail = false; assert.deepEqual(f.worker.retryUncertain({ confirmed: true }), { resetCount: 1 }); await f.worker.tick(); assert.equal(calls, 2); assert.equal(receipt(f).state, 'sent');
  const g = fixture([server('b', '2026-10-21')], { send: async () => { throw new TelegramDeliveryError('invalid token', { deliveryState: 'failed' }); } });
  await g.worker.tick(); g.mutate(s => { s.settings.telegram.botToken = '123456789:' + 'b'.repeat(35); }); await g.worker.tick(); assert.equal(receipt(g).attempts, 1);
});
test('obsolete uncertain receipts do not pollute status or reset across new dates/destinations/opt-out', async () => {
  const f = fixture([server('a', '2026-10-21')], { send: async () => { throw Error('network'); } });
  await f.worker.tick(); assert.equal(f.worker.status().uncertainCount, 1);
  f.mutate(s => { s.servers[0].renewalDate = '2026-12-01T00:00:00Z'; });
  assert.equal(f.worker.status().uncertainCount, 0); assert.equal(f.worker.retryUncertain({ confirmed: true }).resetCount, 0);
});
test('stop waits for current send and prevents further batch work', async () => {
  const gate = deferred(); let calls = 0;
  const f = fixture([server('a', '2026-10-21'), server('b', '2026-10-21')], { send: async () => { calls++; await gate.promise; return { messageId: 1 }; } });
  const tick = f.worker.tick(); let stopped = false; const stop = f.worker.stop().then(() => { stopped = true; });
  await Promise.resolve(); assert.equal(stopped, false); gate.resolve(); await stop; await tick;
  assert.equal(calls, 1); await f.worker.tick(); assert.equal(calls, 1);
});
test('transport uses fixed HTTPS, no redirect or formatting, no previews, and numeric recipient', async () => {
  let seen;
  const out = await sendTelegram(config, '安全提醒', { fetchImpl: async (url, options) => { seen = { url, options }; return { ok: true, status: 200, json: async () => ({ ok: true, result: { message_id: 123 } }) }; } });
  assert.deepEqual(out, { messageId: 123 });
  assert.equal(new URL(seen.url).hostname, 'api.telegram.org'); assert.equal(new URL(seen.url).protocol, 'https:'); assert.equal(seen.options.redirect, 'error');
  const body = JSON.parse(seen.options.body); assert.equal(body.chat_id, config.chatId); assert.deepEqual(body.link_preview_options, { is_disabled: true }); assert.equal(body.parse_mode, undefined);
  await assert.rejects(sendTelegram({ ...config, botToken: 'bad' }, 'message'), e => e.deliveryState === 'failed');
});
test('transport distinguishes Telegram rejection, 429 delay, and ambiguous network/body errors without leaking details', async () => {
  for (const code of [400, 403, 429, 502]) {
    await assert.rejects(sendTelegram(config, 'message', { fetchImpl: async () => ({ ok: false, status: code, json: async () => ({ ok: false, error_code: code, description: TOKEN, parameters: { retry_after: 3600 } }) }) }), e => e.deliveryState === 'failed' && e.retryable === (code >= 500 || code === 429) && !e.message.includes(TOKEN) && (code !== 429 || e.retryAfterMs === 3600000));
  }
  await assert.rejects(sendTelegram(config, 'message', { fetchImpl: async () => { throw Error(TOKEN); } }), e => e.deliveryState === 'uncertain' && !e.message.includes(TOKEN));
  await assert.rejects(sendTelegram(config, 'message', { fetchImpl: async () => ({ ok: false, status: 502, json: async () => { throw Error(TOKEN); } }) }), e => e.deliveryState === 'uncertain' && !e.message.includes(TOKEN));
});
test('transport timeout aborts without exposing token', async () => {
  const keepAlive = setTimeout(() => {}, 1000);
  try {
    await assert.rejects(sendTelegram(config, 'message', { timeoutMs: 10, fetchImpl: async (_, options) => new Promise((_, reject) => options.signal.addEventListener('abort', () => reject(Error(TOKEN)), { once: true })) }), e => e.deliveryState === 'uncertain' && !e.message.includes(TOKEN));
  } finally { clearTimeout(keepAlive); }
});
test('save failure before network prevents sending; failure after network retains uncertain claim', async () => {
  const f = fixture([server('a', '2026-10-21')]);
  const save = f.vault.save;
  f.vault.save = () => { throw Error('disk full'); };
  await f.worker.tick(); assert.equal(f.messages.length, 0); assert.match(f.worker.status().lastError, /失败/);
  let saves = 0;
  f.vault.save = s => { saves++; if (saves === 2) throw Error('disk full'); save(s); };
  await f.worker.tick(); assert.equal(f.messages.length, 1); assert.equal(receipt(f).state, 'pending');
  f.vault.save = save; await f.worker.tick(); assert.equal(f.messages.length, 1); assert.equal(receipt(f).state, 'uncertain');
});
test('fresh pre-send state is revalidated and reminder uses current metadata', async () => {
  const f = fixture([server('a', '2026-10-21')]); const save = f.vault.save; let first = true;
  f.vault.save = next => { if (first) { first = false; next.servers[0].expiryReminder = false; next.revision++; } save(next); };
  await f.worker.tick(); assert.equal(f.messages.length, 0); assert.equal(f.state().revision, 42);
});
test('loopback development origins work, remote plaintext origins are rejected', () => {
  const f = fixture([]);
  for (const origin of ['http://127.0.0.1:12345', 'http://[::1]:12345', 'http://localhost:12345']) assert.doesNotThrow(() => createReminderWorker({ vault: f.vault, origin }));
  for (const origin of ['http://example.com', 'https://user:pass@example.com']) assert.throws(() => createReminderWorker({ vault: f.vault, origin }));
});
test('manual recovery permits configured disabled settings and pre-09:00 reset without sending early', async () => {
  let fail = true;
  const f = fixture([server('a', '2026-10-21')], { send: async () => { if (fail) throw new TelegramDeliveryError('开始对话。', { deliveryState: 'failed' }); return { messageId: 1 }; } });
  await f.worker.tick(); f.mutate(s => { s.settings.telegram.enabled = false; }); f.time('2026-10-15T00:00:00Z');
  assert.deepEqual(f.worker.retryUncertain({ confirmed: true }), { resetCount: 1 }); fail = false; await f.worker.tick(); assert.equal(receipt(f).state, 'failed');
  f.mutate(s => { s.settings.telegram.enabled = true; }); await f.worker.tick(); assert.equal(receipt(f).state, 'failed');
  f.time('2026-10-15T01:00:00Z'); await f.worker.tick(); assert.equal(receipt(f).state, 'sent');
});

test('table replies opt into HTML without changing ordinary reminder message format', async () => {
  const bodies=[];
  const fetchImpl=async (_url,options)=>{bodies.push(JSON.parse(options.body));return {ok:true,status:200,json:async()=>({ok:true,result:{message_id:bodies.length}})};};
  await sendTelegram(config,'<pre>机器 &amp; 到期</pre>',{fetchImpl,parseMode:'HTML'});
  assert.equal(bodies[0].parse_mode,'HTML');assert.equal(bodies[0].text,'<pre>机器 &amp; 到期</pre>');
  await sendTelegram(config,'ordinary reminder',{fetchImpl});assert.ok(!Object.hasOwn(bodies[1],'parse_mode'));
  await assert.rejects(sendTelegram(config,'message',{fetchImpl,parseMode:'Markdown'}),/格式/);assert.equal(bodies.length,2);
});

test('three reminder points per renewal date: 7 days, 1 day and the due day, each once', async () => {
  const f = fixture([server('a', '2026-10-21')]);
  f.time('2026-10-14T01:00:00Z'); await f.worker.tick(); await f.worker.tick();
  for (const day of ['15', '16', '17', '18', '19']) { f.time(`2026-10-${day}T03:00:00Z`); await f.worker.tick(); }
  assert.equal(f.messages.length, 1); assert.match(f.messages[0].text, /剩余 7 天/);
  f.time('2026-10-20T00:59:00Z'); await f.worker.tick(); assert.equal(f.messages.length, 1);
  f.time('2026-10-20T01:00:00Z'); await f.worker.tick(); await f.newWorker().tick();
  assert.equal(f.messages.length, 2); assert.match(f.messages[1].text, /明天到期/);
  f.time('2026-10-21T01:00:00Z'); await f.worker.tick(); await f.worker.tick();
  assert.equal(f.messages.length, 3); assert.match(f.messages[2].text, /今天到期/);
  f.time('2026-10-22T01:00:00Z'); await f.worker.tick(); assert.equal(f.messages.length, 3);
  assert.deepEqual(Object.values(f.state().telegramDeliveries).map(r => r.stage).sort(), ['day', 'early', 'eve']);
});
test('late enablement only sends the current reminder point, never a backlog', async () => {
  const f = fixture([server('a', '2026-10-15')]);
  await f.worker.tick();
  assert.equal(f.messages.length, 1); assert.match(f.messages[0].text, /明天到期/);
  f.time('2026-10-15T01:00:00Z'); await f.worker.tick();
  assert.equal(f.messages.length, 2); assert.match(f.messages[1].text, /今天到期/);
});
test('receipts written before reminder points existed still suppress the 7-day reminder', async () => {
  const { createHash } = await import('node:crypto');
  const sha = (v) => createHash('sha256').update(v).digest('hex');
  const f = fixture([server('a', '2026-10-21')]);
  const dest = sha(`${TOKEN.split(':')[0]}\n${config.chatId}`);
  f.mutate(s => { s.telegramDeliveries = { [sha(`a\n2026-10-21\n${dest}`)]: { state: 'sent', serverId: 'a', renewalDate: '2026-10-21', destination: dest } }; });
  await f.worker.tick(); assert.equal(f.messages.length, 0);
  f.time('2026-10-20T01:00:00Z'); await f.worker.tick(); assert.equal(f.messages.length, 1); assert.match(f.messages[0].text, /明天到期/);
});

test('a failure from an earlier reminder point stops counting once a later point is current', async () => {
  let fail = true;
  const f = fixture([server('a', '2026-10-21')], { send: async () => { if (fail) throw new TelegramDeliveryError('rejected', { deliveryState: 'failed' }); return { messageId: 1 }; } });
  await f.worker.tick();
  assert.equal(f.worker.status().failedCount, 1);
  fail = false;
  f.time('2026-10-20T01:00:00Z');
  assert.equal(f.worker.status().failedCount, 0);
  assert.equal(f.worker.retryUncertain({ confirmed: true }).resetCount, 0);
  await f.worker.tick();
  assert.equal(f.worker.status().sentCount, 1);
  assert.equal(f.worker.status().lastError, '');
});
