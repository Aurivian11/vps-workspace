import test from 'node:test';
import assert from 'node:assert/strict';
import { createSelectionConfirmer } from '../lib/telegram-confirmation.mjs';
import { TelegramDeliveryError } from '../lib/telegram.mjs';
const TOKEN = '123456789:' + 'a'.repeat(35);
const config = { enabled: true, botToken: TOKEN, chatId: '123456' };
const ID = '11111111-1111-4111-8111-111111111111';
const ID2 = '22222222-2222-4222-8222-222222222222';
const server = (id, extra = {}) => ({ id, name: `机器 ${id}`, renewalDate: '2026-10-21T00:00:00Z', expiryReminder: true, sshPassword: 'SECRET_PASSWORD', notes: 'SECRET_NOTE', ipAddress: 'PRIVATE_IP', ...extra });
function deferred() { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; }
function fixture(options = {}) {
  let state = { revision: 7, servers: options.servers || [server('a'), server('b')], settings: { telegram: { ...config, ...options.config } }, commands: [{ id: 'preserved' }] };
  let clock = new Date('2026-10-14T02:00:00Z');
  const messages = [];
  const vault = { snapshot: () => structuredClone(state), save: next => { state = structuredClone(next); } };
  const send = options.send || (async (cfg, text) => { messages.push({ cfg, text }); return { messageId: messages.length }; });
  const make = () => createSelectionConfirmer({ vault, origin: 'https://example.com', now: () => clock, send });
  const worker = make();
  const mutate = fn => { const next = vault.snapshot(); fn(next); vault.save(next); };
  function queue(id = ID, ids = ['a'], helper = worker) { const next = vault.snapshot(); const result = helper.prepare(next, { confirmationId: id, serverIds: ids }); vault.save(next); return result; }
  return { worker, vault, messages, queue, mutate, state: () => state, make, time: value => { clock = new Date(value); } };
}
const record = (f, id = ID) => f.state().telegramSelectionConfirmations?.[id];

test('prepare is transaction-local; one confirmation per id canonicalized selection', async () => {
  const f = fixture(), next = f.vault.snapshot();
  assert.equal(f.worker.lookup(ID, ['a', 'b']), null);
  assert.equal(f.worker.prepare(next, { confirmationId: ID, serverIds: ['b', 'a', 'a'] }).status, 'pending');
  assert.equal(record(f), undefined); assert.equal(f.messages.length, 0);
  next.servers[0].expiryReminder = false; next.revision++;
  f.vault.save(next);
  assert.equal(f.worker.lookup(ID, ['a', 'b']).status, 'pending');
  assert.equal((await f.worker.deliver(ID)).status, 'sent');
  assert.equal((await f.worker.deliver(ID)).status, 'sent');
  assert.equal(f.queue(ID, ['b', 'a']).status, 'sent');
  assert.equal(f.messages.length, 1); assert.equal(f.state().revision, 8); assert.equal(f.state().servers[0].expiryReminder, false);
  assert.throws(() => f.worker.lookup(ID, ['a']), error => error.status === 409);
  assert.throws(() => f.queue(ID, ['a']), error => error.status === 409);
  assert.deepEqual(Object.keys(f.worker.lookup(ID, ['a', 'b'])).sort(), ['message', 'status']);
});

test('two overlapping retries coalesce; completion preserves unrelated latest edits', async () => {
  const gate = deferred(); let calls = 0;
  const f = fixture({ send: async () => { calls++; return gate.promise; } }); f.queue();
  const first = f.worker.deliver(ID), second = f.worker.deliver(ID);
  assert.equal(first, second); await Promise.resolve(); assert.equal(record(f).status, 'sending');
  f.mutate(s => { s.revision = 19; s.commands.push({ id: 'new' }); s.servers[0].notes = 'CONCURRENT'; });
  gate.resolve({ messageId: 77 }); await first;
  assert.equal(calls, 1); assert.equal(record(f).status, 'sent'); assert.equal(f.state().revision, 19); assert.equal(f.state().servers[0].notes, 'CONCURRENT'); assert.equal(f.state().commands.length, 2);
});

test('startup flushes queued once and recovers interrupted sends without duplicating', async () => {
  const f = fixture(); f.queue(); await f.make().start(); await f.make().start();
  assert.equal(f.messages.length, 1); assert.equal(record(f).status, 'sent');
  f.queue(ID2, ['b']); f.mutate(s => { s.telegramSelectionConfirmations[ID2].status = 'sending'; s.telegramSelectionConfirmations[ID2].claim = 'old'; });
  const restarted = f.make(); await restarted.start();
  assert.equal(record(f, ID2).status, 'uncertain'); assert.equal((await restarted.deliver(ID2)).status, 'uncertain'); assert.equal(f.messages.length, 1);
});

test('disabled global setting still confirms; missing config or changed destination skips', async () => {
  const f = fixture({ config: { enabled: false } }); f.queue(); await f.worker.deliver(ID);
  assert.match(f.messages[0].text, /已关闭/); assert.equal(f.state().settings.telegram.enabled, false);
  const missing = fixture({ config: { botToken: '' } }); assert.equal(missing.queue().status, 'skipped'); assert.equal((await missing.worker.deliver(ID)).status, 'skipped'); assert.equal(missing.messages.length, 0);
  const changed = fixture(); changed.queue(); changed.mutate(s => { s.settings.telegram.chatId = '654321'; });
  assert.equal((await changed.worker.deliver(ID)).status, 'skipped'); assert.equal(changed.messages.length, 0); assert.match(changed.worker.lookup(ID, ['a']).message, /更改/);
  const rotated = fixture(); rotated.queue(); rotated.mutate(s => { s.settings.telegram.botToken = '123456789:' + 'b'.repeat(35); });
  assert.equal((await rotated.worker.deliver(ID)).status, 'sent'); assert.equal(rotated.messages[0].cfg.botToken, '123456789:' + 'b'.repeat(35));
});

test('messages are bounded and contain only intended server fields', async () => {
  const servers = Array.from({ length: 100 }, (_, index) => server(String(index), { name: '名称\n\r\t' + '长'.repeat(120), renewalDate: index === 1 ? '2026-02-30' : '2026-10-21' }));
  const f = fixture({ servers }); f.queue(ID, servers.map(s => s.id)); await f.worker.deliver(ID);
  const text = f.messages[0].text;
  assert.ok(text.length <= 4000); assert.match(text, /已选择 100 台/); assert.match(text, /其余 \d+ 台/); assert.match(text, /1 台未填写有效到期日期/);
  assert.equal(text.includes('\r'), false); assert.equal(text.includes('\t'), false);
  for (const secret of ['SECRET_PASSWORD', 'SECRET_NOTE', 'PRIVATE_IP', TOKEN]) assert.equal(text.includes(secret), false);
  assert.match(text, /管理：https:\/\/example.com/);
  const empty = fixture(); empty.queue(ID, []); await empty.worker.deliver(ID); assert.match(empty.messages[0].text, /已选择 0 台/);
});

test('known rejections and ambiguous failures do not retry or leak error details', async () => {
  for (const error of [new TelegramDeliveryError(TOKEN, { deliveryState: 'failed', retryable: true }), new TelegramDeliveryError(TOKEN), Error(TOKEN)]) {
    let calls = 0;
    const f = fixture({ send: async () => { calls++; throw error; } }); f.queue();
    const output = await f.worker.deliver(ID); await f.worker.deliver(ID); await f.make().start();
    assert.equal(output.status, error.deliveryState === 'failed' ? 'failed' : 'uncertain');
    assert.equal(calls, 1); assert.equal(JSON.stringify(output).includes(TOKEN), false);
    assert.equal(JSON.stringify(record(f)).includes(TOKEN), false);
  }
  const malformed = fixture({ send: async () => ({}) }); malformed.queue(); assert.equal((await malformed.worker.deliver(ID)).status, 'uncertain');
});

test('post-network settlement is claim-guarded against replaced/imported state', async () => {
  const gate = deferred(); const f = fixture({ send: () => gate.promise }); f.queue();
  const task = f.worker.deliver(ID); await Promise.resolve();
  f.mutate(s => { s.telegramSelectionConfirmations[ID].claim = 'replacement'; s.telegramSelectionConfirmations[ID].status = 'skipped'; s.revision = 42; });
  gate.resolve({ messageId: 88 }); await task;
  assert.equal(record(f).status, 'skipped'); assert.equal(record(f).messageId, undefined); assert.equal(f.state().revision, 42);
});

test('persisted claim is revalidated against latest destination before network', async () => {
  const f = fixture(); f.queue(); const save = f.vault.save;
  f.vault.save = next => { if (next.telegramSelectionConfirmations[ID].status === 'sending') next.settings.telegram.chatId = '654321'; save(next); };
  assert.equal((await f.worker.deliver(ID)).status, 'skipped'); assert.equal(f.messages.length, 0);
});

test('disk failure before sending prevents network; after sending becomes uncertain', async () => {
  const f = fixture(); f.queue(); const save = f.vault.save;
  f.vault.save = () => { throw Error(TOKEN); };
  assert.equal((await f.worker.deliver(ID)).status, 'uncertain'); assert.equal(f.messages.length, 0);
  let saves = 0;
  f.vault.save = next => { if (++saves === 2) throw Error(TOKEN); save(next); };
  assert.equal((await f.worker.deliver(ID)).status, 'uncertain'); assert.equal(f.messages.length, 1); assert.equal(record(f).status, 'sending');
  f.vault.save = save;
  assert.equal((await f.worker.deliver(ID)).status, 'uncertain'); assert.equal(f.messages.length, 1); assert.equal(record(f).status, 'uncertain');
});

test('shutdown awaits active send and leaves other queued messages for restart', async () => {
  const gate = deferred(); let calls = 0;
  const f = fixture({ send: () => { calls++; return gate.promise; } }); f.queue(); f.queue(ID2, ['b']);
  const startup = f.worker.start(); await Promise.resolve();
  let done = false; const shutdown = f.worker.stop().then(() => { done = true; });
  await Promise.resolve(); assert.equal(done, false);
  gate.resolve({ messageId: 1 }); await shutdown; await startup;
  assert.equal(calls, 1); assert.equal(record(f).status, 'sent'); assert.equal(record(f, ID2).status, 'queued');
  assert.equal((await f.worker.deliver(ID2)).status, 'pending'); assert.equal(calls, 1);
});

test('history retains all recent idempotency records, caps admission, prunes old terminal records only', () => {
  const f = fixture({ config: { botToken: '' } }); const next = f.vault.snapshot();
  for (let i = 0; i < 1000; i++) f.worker.prepare(next, { confirmationId: `request-${String(i).padStart(20, '0')}`, serverIds: ['a'] });
  f.vault.save(next);
  assert.equal(Object.keys(f.state().telegramSelectionConfirmations).length, 1000);
  assert.throws(() => f.queue(), e => e.status === 400);
  f.time('2026-10-22T02:00:00Z'); f.queue();
  assert.equal(Object.keys(f.state().telegramSelectionConfirmations).length, 1);
  const g = fixture(); g.queue(); g.time('2026-11-22T02:00:00Z'); g.queue(ID2, ['b']);
  assert.equal(Object.keys(g.state().telegramSelectionConfirmations).length, 2);
});

test('invalid ids, payloads and unsafe origins reject cleanly', () => {
  const f = fixture();
  for (const id of ['__proto__', '', null, 'a'.repeat(129)]) assert.throws(() => f.worker.lookup(id, []), e => e.status === 400);
  for (const ids of [null, {}, [null], [''], ['a'.repeat(129)]]) assert.throws(() => f.worker.lookup(ID, ids), e => e.status === 400);
  for (const origin of ['http://example.com', 'https://user:pass@example.com']) assert.throws(() => createSelectionConfirmer({ vault: f.vault, origin }));
  assert.doesNotThrow(() => createSelectionConfirmer({ vault: f.vault, origin: 'http://127.0.0.1:19999' }));
});
