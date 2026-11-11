import test from 'node:test';
import assert from 'node:assert/strict';
import { createTelegramQueryWorker } from '../lib/telegram-query.mjs';
const TOKEN = '123456789:ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghi';
const CHAT = '1234567890';
const baseTime = Date.parse('2026-10-29T02:00:00Z');
const response = (result, code = 200, extra = {}) => ({ ok: code === 200, status: code, json: async () => code === 200 ? { ok: true, result } : { ok: false, error_code: code, ...extra } });
const defer = () => { let resolve, reject; const promise = new Promise((a,b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
function fixture(options = {}) {
  let instant = baseTime, queue = [], hook = null, sendHook = null, failSave = false;
  const calls = [], sent = [], saves = [];
  let state = { version: 1, revision: 12, account: { username: 'fixture' }, servers: [{ id: '11111111-1111-4111-8111-111111111111', name: 'Synthetic server', expiryReminder: true, renewalDate: '2026-11-05', sshPassword: 'SECRET-PASSWORD' }], commands: [], settings: { telegram: { enabled: true, botToken: TOKEN, chatId: CHAT }, customMonthly: { serverIds: ['kept'] } }, unrelated: { keep: true } };
  const vault = { snapshot: () => structuredClone(state), save(next) { if (failSave) throw Error('secret failing persistence'); state = structuredClone(next); saves.push(structuredClone(next)); } };
  const fetchImpl = async (url, init) => {
    const method = url.slice(url.lastIndexOf('/')+1), payload = JSON.parse(init.body), call = { method, payload, signal: init.signal };
    calls.push(call);
    if (hook) { const custom = await hook(call); if (custom !== undefined) return custom; }
    return response(method === 'getWebhookInfo' ? { url: '' } : queue.shift() || []);
  };
  const send = async (config, html, extra) => { sent.push({ config, html, extra }); if (sendHook) return sendHook(config,html,extra); return { messageId: sent.length }; };
  const args = { vault, now: () => new Date(instant), fetchImpl, send, pollTimeoutSeconds: 0, ...options };
  const worker = createTelegramQueryWorker(args);
  return { worker, vault, args, calls, sent, saves, get state() { return state; }, change(fn) { fn(state); }, setTime(value) { instant = typeof value === 'number' ? value : Date.parse(value); }, advance(ms) { instant += ms; }, queue(...batches) { queue.push(...batches); }, hook(fn) { hook = fn; }, sendHook(fn) { sendHook = fn; }, failSave(value) { failSave = value; }, update(id = 1, patch = {}) { return { update_id: id, message: { message_id: id, date: Math.floor(instant/1000), chat: { id: Number(CHAT), type: 'private' }, from: { id: Number(CHAT), is_bot: false }, text: '检查', ...patch } }; } };
}

test('authorized private check sends HTML, commits cursor first and preserves current business state', async () => {
  const f = fixture(), original = structuredClone(f.state); f.queue([f.update(10)]);
  f.hook(call => { if (call.method === 'getUpdates') f.change(state => { state.revision = 13; state.unrelated.latest = 'preserved'; }); });
  f.sendHook(() => { assert.equal(f.state.telegramQueryState.offset, 11); return { messageId: 7 }; });
  await f.worker.tick();
  assert.equal(f.sent.length, 1); assert.equal(f.sent[0].extra.parseMode, 'HTML'); assert.ok(!/<\/?(?:pre|code|table|blockquote)\b/i.test(f.sent[0].html)); assert.match(f.sent[0].html, /<b>🟠 7 天内到期 · 1 台<\/b>\n\n<b>Synthetic server<\/b>\n├ 📅 2026-11-05 周四 · <b>7 天后到期<\/b>\n└ <i>等待发送<\/i>/); assert.ok(!f.sent[0].html.includes('SECRET-PASSWORD'));
  assert.equal(f.state.revision, 13); assert.deepEqual(f.state.servers, original.servers); assert.deepEqual(f.state.settings, original.settings); assert.deepEqual(f.state.unrelated, { keep: true, latest: 'preserved' });
  assert.deepEqual(f.calls.map(c => c.method), ['getWebhookInfo','getUpdates']); assert.deepEqual(f.calls[1].payload.allowed_updates, ['message', 'callback_query']); assert.equal(f.calls[1].payload.offset, 0); assert.equal(f.calls[1].payload.limit, 100);
  const status = f.worker.status(); assert.equal(status.lastSuccessfulPollAt, new Date(baseTime).toISOString()); assert.ok(status.lastReplyAt); assert.equal(status.loopHealthy,true); assert.ok(!JSON.stringify(status).includes(TOKEN)); assert.ok(!JSON.stringify(status).includes(CHAT));
});

test('unrelated, forwarded, edited, bot, mismatched-sender and group updates are silently consumed', async () => {
  const f = fixture(); let id=1;
  const messages = [
    { text:'查看' }, { text:'检查 extra' }, { text:'/check@another_bot' },
    { chat:{id:777,type:'private'},from:{id:777,is_bot:false} },
    { from:{id:777,is_bot:false} }, { from:{id:Number(CHAT),is_bot:true} },
    { chat:{id:Number(CHAT),type:'group'} }, { forward_origin:{type:'user'} },
    { forward_from:{id:777} }, { forward_from_chat:{id:777} }, { forward_sender_name:'other' },
    { forward_date:1 }, { edit_date:1 }, { sender_chat:{id:777} }, { via_bot:{id:777} },
    { date:Math.floor(baseTime/1000)-31 }, { date:Math.floor(baseTime/1000)+61 }
  ].map(patch=>f.update(id++,patch));
  messages.push({ update_id:id++, edited_message:f.update().message });
  messages.push({ update_id:id++, channel_post:f.update().message });
  f.queue(messages); await f.worker.tick();
  assert.equal(f.sent.length,0); assert.equal(f.state.telegramQueryState.offset,id); assert.equal(f.worker.status().lastError,'');
});

test('trimmed Chinese and slash command are accepted while rapid repeats are rate limited', async () => {
  const f=fixture();f.queue([f.update(1,{text:'  检查\n'}),f.update(2,{text:'/check'})]);await f.worker.tick();assert.equal(f.sent.length,1);assert.equal(f.state.telegramQueryState.offset,3);
  f.advance(5000);f.queue([f.update(3,{text:'/check'})]);await f.worker.tick();assert.equal(f.sent.length,2);assert.equal(f.state.telegramQueryState.offset,4);
});

test('sorting, duplicate update IDs and restarts never replay a consumed command', async () => {
  const f=fixture();f.queue([f.update(7),f.update(5),f.update(5)]);await f.worker.tick();assert.equal(f.state.telegramQueryState.offset,8);assert.equal(f.sent.length,1);
  f.advance(6000);f.queue([f.update(7)]);const second=createTelegramQueryWorker(f.args);await second.tick();assert.equal(f.sent.length,1);assert.equal(f.calls.at(-1).payload.offset,8);
});

test('paused reminder sending still permits lookup; disabled worker, missing account and group config do not poll', async () => {
  const f=fixture();f.change(s=>{s.settings.telegram.enabled=false;});f.queue([f.update()]);await f.worker.tick();assert.equal(f.sent.length,1);
  for (const kind of ['disabled','no-account','group','token']) {
    const g=fixture({enabled:kind!=='disabled'});
    if(kind==='no-account')g.change(s=>{s.account=null;});if(kind==='group')g.change(s=>{s.settings.telegram.chatId='-12345';});if(kind==='token')g.change(s=>{s.settings.telegram.botToken='';});
    await g.worker.tick();assert.equal(g.calls.length,0);assert.equal(g.saves.length,0);assert.equal(g.worker.status().loopHealthy,true);
  }
});

test('Webhook is never replaced, and polling starts only after it is removed externally', async () => {
  const f=fixture();let webhook=true;
  f.hook(call=>call.method==='getWebhookInfo'?response({url:webhook?'https://existing.invalid/webhook':''}):undefined);
  await f.worker.tick();assert.equal(f.calls.length,1);assert.match(f.worker.status().lastError,/Webhook/);assert.equal(f.worker.status().lastSuccessfulPollAt,null);
  f.advance(59000);await f.worker.tick();assert.equal(f.calls.length,1);
  webhook=false;f.advance(1000);await f.worker.tick();assert.deepEqual(f.calls.map(c=>c.method),['getWebhookInfo','getWebhookInfo','getUpdates']);assert.equal(f.worker.status().lastError,'');
});

for (const code of [409,429,500]) test('Telegram '+code+' uses safe errors and bounded retry backoff',async()=>{
  const f=fixture();let failed=true;
  f.hook(call=>call.method==='getUpdates'&&failed?response(null,code,{parameters:{retry_after:120}}):undefined);
  await f.worker.tick();assert.equal(f.calls.length,2);assert.equal(f.worker.status().lastSuccessfulPollAt,null);assert.ok(f.worker.status().lastError);assert.ok(!JSON.stringify(f.worker.status()).includes(TOKEN));
  const delay=code===409?60000:code===429?120000:30000;
  f.advance(delay-1);await f.worker.tick();assert.equal(f.calls.length,2);assert.equal(f.worker.status().loopHealthy,true);
  f.advance(1);failed=false;await f.worker.tick();assert.equal(f.calls.length,code===409?4:3);assert.equal(f.worker.status().lastError,'');assert.ok(f.worker.status().lastSuccessfulPollAt);
});

test('network errors never reveal the token-bearing URL and retry after 30 seconds',async()=>{
  const f=fixture();f.hook(()=>{throw Error('https://api.telegram.org/bot'+TOKEN+'/getUpdates');});await f.worker.tick();assert.equal(f.sent.length,0);assert.ok(!JSON.stringify(f.worker.status()).includes(TOKEN));assert.ok(!f.worker.status().lastError.includes('https:'));
  f.hook(null);f.advance(30000);await f.worker.tick();assert.ok(f.worker.status().lastSuccessfulPollAt);
});

test('configuration changes during long polling discard stale updates and initialize an independent cursor',async()=>{
  const f=fixture();let change=true;
  f.hook(call=>{if(call.method==='getUpdates'&&change){change=false;f.change(s=>{s.settings.telegram.botToken='987654321:ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghi';s.unrelated.changed=true;});return response([f.update(90)]);}});
  await f.worker.tick();assert.equal(f.sent.length,0);assert.equal(f.state.telegramQueryState.offset,0);assert.equal(f.worker.status().lastSuccessfulPollAt,null);
  f.queue([f.update(1)]);await f.worker.tick();assert.equal(f.sent.length,1);assert.equal(f.state.telegramQueryState.offset,2);assert.equal(f.state.unrelated.changed,true);
});

test('changing chat during webhook inspection prevents polling old destination',async()=>{
  const f=fixture();f.hook(call=>{if(call.method==='getWebhookInfo')f.change(s=>{s.settings.telegram.chatId='999999999';});});await f.worker.tick();assert.equal(f.calls.length,1);assert.equal(f.sent.length,0);
});

test('storage failure cannot send before durable consumption',async()=>{
  const f=fixture();f.queue([f.update(5)]);f.hook(call=>{if(call.method==='getUpdates')f.failSave(true);});await f.worker.tick();assert.equal(f.sent.length,0);assert.equal(f.state.telegramQueryState.offset,0);assert.ok(f.worker.status().lastError);
  f.failSave(false);f.hook(null);f.advance(30000);f.queue([f.update(5)]);await f.worker.tick();assert.equal(f.sent.length,1);assert.equal(f.state.telegramQueryState.offset,6);
});

test('failed or uncertain reply remains consumed and is never retried automatically',async()=>{
  const f=fixture();f.queue([f.update(5)]);f.sendHook(()=>{throw Error('unknown send result: '+TOKEN);});await f.worker.tick();assert.equal(f.sent.length,1);assert.equal(f.state.telegramQueryState.offset,6);assert.match(f.worker.status().lastError,/重新发送/);assert.ok(!f.worker.status().lastError.includes(TOKEN));
  f.advance(6000);f.queue([f.update(5)]);const second=createTelegramQueryWorker(f.args);await second.tick();assert.equal(f.sent.length,1);
  f.sendHook(null);f.queue([f.update(6)]);await second.tick();assert.equal(f.sent.length,2);
});

test('tick and start do not overlap; stop aborts a pending long poll without an error',async()=>{
  const f=fixture({intervalMs:10}),entered=defer();
  f.hook(call=>{if(call.method==='getUpdates'){entered.resolve();return new Promise((resolve,reject)=>call.signal.addEventListener('abort',()=>reject(Error('aborted')),{once:true}));}});
  const first=f.worker.start(),second=f.worker.start(),third=f.worker.tick();assert.equal(first,second);assert.equal(first,third);await entered.promise;assert.equal(f.worker.status().polling,true);
  await f.worker.stop();await first;assert.equal(f.worker.status().polling,false);assert.equal(f.worker.status().enabled,false);assert.equal(f.worker.status().lastError,'');assert.equal(f.calls.length,2);
  await f.worker.tick();assert.equal(f.calls.length,2);
});

function manyServers(f) { f.change(s=>{s.servers=Array.from({length:200},(_,i)=>({...s.servers[0],id:String(i).padStart(8,'0')+'-0000-4000-8000-000000000000',name:'合成机器 '+i+' '+('Long-name-'.repeat(8))}));}); }

test('multi-part answers are HTML, spaced apart, and update heartbeat while sending',async()=>{
  const f=fixture(),times=[];manyServers(f);f.queue([f.update()]);
  f.sendHook(()=>{times.push(Date.now());assert.equal(f.worker.status().loopHealthy,true);f.advance(60000);if(times.length===3)void f.worker.stop();return {messageId:times.length};});
  await f.worker.tick();assert.equal(f.sent.length,3);assert.ok(times[1]-times[0]>=950);assert.ok(times[2]-times[1]>=950);assert.ok(f.sent.every(x=>x.extra.parseMode==='HTML'&&x.html.length<3500));
});

test('stop during the first part prevents all remaining parts',async()=>{
  const f=fixture();manyServers(f);f.queue([f.update()]);f.sendHook(()=>{void f.worker.stop();return {messageId:1};});await f.worker.tick();assert.equal(f.sent.length,1);
});

test('configuration or account changes between answer parts prevent further sends',async()=>{
  for(const mode of ['token','account']){
    const f=fixture();manyServers(f);f.queue([f.update()]);f.sendHook(()=>{f.change(s=>{if(mode==='token')s.settings.telegram.botToken='987654321:ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghi';else s.account=null;});return {messageId:1};});
    await f.worker.tick();assert.equal(f.sent.length,1);assert.equal(f.state.telegramQueryState.lastReplyAt,null);
  }
});

test('malformed getUpdates payload cannot advance cursor or leak diagnostics',async()=>{
  for(const payload of [{unexpected:true},[{update_id:-1}], [{update_id:Number.MAX_SAFE_INTEGER}], Array.from({length:101},(_,i)=>({update_id:i}))]){
    const f=fixture();f.hook(call=>call.method==='getUpdates'?response(payload):undefined);await f.worker.tick();assert.equal(f.state.telegramQueryState.offset,0);assert.equal(f.sent.length,0);assert.ok(f.worker.status().lastError);assert.equal(f.worker.status().lastSuccessfulPollAt,null);
  }
});
