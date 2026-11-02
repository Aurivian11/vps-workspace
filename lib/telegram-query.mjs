import { createHash } from 'node:crypto';
import { normalizeTelegram, sendTelegram } from './telegram.mjs';
import { formatReminderTable } from './telegram-table.mjs';

const hash = value => createHash('sha256').update(value).digest('hex');
const PRIVATE_CHAT = /^[1-9]\d{0,19}$/;
const COOLDOWN = 5000;
function configuration(state) {
  if (!state?.account) return null;
  try {
    const config = normalizeTelegram({ ...state.settings?.telegram, enabled: false });
    if (!config.botToken || !PRIVATE_CHAT.test(config.chatId)) return null;
    return { config, fingerprint: hash(config.botToken + '\n' + config.chatId) };
  } catch { return null; }
}
function validCursor(cursor, fingerprint) {
  return cursor?.configurationHash === fingerprint && Number.isSafeInteger(cursor.offset) && cursor.offset >= 0 && Number.isFinite(Date.parse(cursor.activatedAt));
}
function permitted(update, config, activatedAt, instant) {
  const message = update.message;
  if (!message || message.chat?.type !== 'private' || String(message.chat.id) !== config.chatId || String(message.from?.id) !== config.chatId || message.from?.is_bot !== false) return false;
  if (message.sender_chat || message.via_bot || message.edit_date || message.is_automatic_forward || Object.keys(message).some(key => key.startsWith('forward_'))) return false;
  if (typeof message.text !== 'string' || !['检查', '/check'].includes(message.text.trim())) return false;
  if (!Number.isSafeInteger(message.date) || message.date * 1000 < Date.parse(activatedAt) - 30000 || message.date * 1000 > instant.getTime() + 60000) return false;
  return true;
}
class QueryError extends Error {
  constructor(code = 0, retryAfter = 0) { super('Telegram query request failed'); this.code = code; this.retryAfter = retryAfter; }
}
export function createTelegramQueryWorker({ vault, enabled = true, fetchImpl = globalThis.fetch, send = sendTelegram, now = () => new Date(), intervalMs = 2000, pollTimeoutSeconds = 25 }) {
  const interval = Math.max(10, Number(intervalMs) || 2000), pollSeconds = Math.max(0, Math.min(50, Math.floor(Number(pollTimeoutSeconds) || 0)));
  let timer = null, running = null, controller = null, started = false, stopped = false, polling = false;
  let lastPollAt = null, lastSuccessfulPollAt = null, startedAt = new Date(now()).getTime(), pollError = '', replyError = '', retryAt = 0, seenHash = null, webhookChecked = null;
  const clock = () => new Date(now());
  function current(context) {
    if (stopped || !enabled) return null;
    const state = vault.snapshot(), cfg = configuration(state);
    if (!cfg || cfg.fingerprint !== context.fingerprint || !validCursor(state.telegramQueryState, cfg.fingerprint) || state.telegramQueryState.activatedAt !== context.activatedAt) return null;
    return { state, ...cfg };
  }
  function saveCursor(context, values) {
    const latest = current(context);
    if (!latest) return null;
    const prior = latest.state.telegramQueryState;
    latest.state.telegramQueryState = { ...prior, ...values, offset: Math.max(prior.offset, values.offset ?? prior.offset) };
    vault.save(latest.state);
    return latest.state.telegramQueryState;
  }
  async function request(config, method, payload, timeoutMs) {
    const abort = new AbortController(); controller = abort;
    const timeout = setTimeout(() => abort.abort(), timeoutMs); timeout.unref?.();
    try {
      const response = await fetchImpl(`https://api.telegram.org/bot${config.botToken}/${method}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, redirect: 'error', signal: abort.signal, body: JSON.stringify(payload) });
      let body;
      try { body = await response.json(); } catch { throw new QueryError(response.status); }
      if (!response.ok || body?.ok !== true) throw new QueryError(Number(body?.error_code) || response.status, Math.max(0, Math.min(3600, Number(body?.parameters?.retry_after) || 0)) * 1000);
      return body.result;
    } catch (error) {
      if (error instanceof QueryError) throw error;
      throw new QueryError();
    } finally { clearTimeout(timeout); if (controller === abort) controller = null; }
  }
  function waitForNextPart() {
    return new Promise(resolve => {
      const abort = new AbortController(); controller = abort;
      const finish = () => { clearTimeout(timer); abort.signal.removeEventListener('abort', finish); if (controller === abort) controller = null; resolve(); };
      const timer = setTimeout(finish, 1000);
      abort.signal.addEventListener('abort', finish, { once: true });
      if (stopped) abort.abort();
    });
  }
  async function execute() {
    lastPollAt = clock().toISOString();
    try {
      const snapshot = vault.snapshot(), cfg = configuration(snapshot);
      if (!cfg || !enabled || stopped) { seenHash = null; webhookChecked = null; lastSuccessfulPollAt = null; retryAt = 0; pollError = ''; return; }
      if (seenHash !== cfg.fingerprint) { seenHash = cfg.fingerprint; webhookChecked = null; lastSuccessfulPollAt = null; retryAt = 0; pollError = ''; replyError = ''; }
      if (clock().getTime() < retryAt) return;
      if (!validCursor(snapshot.telegramQueryState, cfg.fingerprint)) {
        snapshot.telegramQueryState = { configurationHash: cfg.fingerprint, offset: 0, activatedAt: clock().toISOString(), lastCommandAt: null, lastReplyAt: null };
        vault.save(snapshot);
      }
      const context = { fingerprint: cfg.fingerprint, activatedAt: snapshot.telegramQueryState.activatedAt };
      if (webhookChecked !== cfg.fingerprint) {
        const info = await request(cfg.config, 'getWebhookInfo', {}, 15000);
        if (!current(context)) return;
        if (!info || typeof info.url !== 'string') throw new QueryError();
        if (info.url) { pollError = '机器人已设置 Webhook，查询轮询未启用；现有 Webhook 未改动。'; retryAt = clock().getTime() + 60000; return; }
        webhookChecked = cfg.fingerprint;
      }
      const latest = current(context); if (!latest) return;
      polling = true;
      const updates = await request(latest.config, 'getUpdates', { offset: latest.state.telegramQueryState.offset, timeout: pollSeconds, limit: 100, allowed_updates: ['message'] }, (pollSeconds + 10) * 1000);
      polling = false;
      if (!current(context)) return;
      if (!Array.isArray(updates) || updates.length > 100 || updates.some(update => !Number.isSafeInteger(update?.update_id) || update.update_id < 0 || update.update_id >= Number.MAX_SAFE_INTEGER)) throw new QueryError();
      pollError = ''; retryAt = 0; lastSuccessfulPollAt = clock().toISOString();
      let offset = latest.state.telegramQueryState.offset;
      for (const update of [...updates].sort((a, b) => a.update_id - b.update_id)) {
        const active = current(context); if (!active) return;
        if (update.update_id < Math.max(offset, active.state.telegramQueryState.offset)) continue;
        offset = update.update_id + 1;
        const instant = clock(), lastCommand = Date.parse(active.state.telegramQueryState.lastCommandAt || '');
        if (!permitted(update, active.config, context.activatedAt, instant) || (Number.isFinite(lastCommand) && instant.getTime() - lastCommand < COOLDOWN)) continue;
        // Commit consumption before sending: uncertain outcomes cannot duplicate on restart.
        if (!saveCursor(context, { offset, lastCommandAt: instant.toISOString() })) return;
        try {
          const source = current(context); if (!source) return;
          const messages = formatReminderTable(source.state, { now: instant });
          for (let index = 0; index < messages.length; index++) {
            lastPollAt = clock().toISOString();
            if (index) await waitForNextPart();
            const message = messages[index];
            const target = current(context); if (!target) return;
            await send(target.config, message, { parseMode: 'HTML' });
            lastPollAt = clock().toISOString();
          }
          if (!saveCursor(context, { lastReplyAt: clock().toISOString() })) return;
          replyError = '';
        } catch { if (!stopped && current(context)) replyError = '查询回复未完成或结果待确认，请重新发送“检查”。'; }
      }
      const final = current(context);
      if (final && offset > final.state.telegramQueryState.offset) saveCursor(context, { offset });
    } catch (error) {
      if (stopped) return;
      if (error instanceof QueryError && error.code === 409) { webhookChecked = null; pollError = 'TG 查询被其他接收程序占用，正在重试。'; retryAt = clock().getTime() + 60000; }
      else if (error instanceof QueryError && error.code === 429) { pollError = 'TG 查询接口限流，稍后重试。'; retryAt = clock().getTime() + Math.max(30000, error.retryAfter); }
      else { pollError = 'TG 查询检查暂未完成，正在重试。'; retryAt = clock().getTime() + 30000; }
    } finally { polling = false; lastPollAt = clock().toISOString(); }
  }
  function status() {
    let snapshot, cfg;
    try { snapshot = vault.snapshot(); cfg = configuration(snapshot); }
    catch { return { enabled: enabled && !stopped, configured: false, polling, lastPollAt, lastSuccessfulPollAt: null, lastReplyAt: null, lastError: 'TG 查询配置暂时无法读取。', loopHealthy: false }; }
    const cursor = cfg && validCursor(snapshot.telegramQueryState, cfg.fingerprint) ? snapshot.telegramQueryState : null;
    return { enabled: enabled && !stopped, configured: Boolean(cfg), polling, lastPollAt, lastSuccessfulPollAt: cfg?.fingerprint === seenHash ? lastSuccessfulPollAt : null, lastReplyAt: cursor?.lastReplyAt || null, lastError: replyError || pollError, loopHealthy: !enabled || stopped || !cfg || clock().getTime() - (lastPollAt ? Date.parse(lastPollAt) : startedAt) < 90000 };
  }
  function schedule() {
    if (!started || stopped || timer || !enabled) return;
    timer = setTimeout(() => { timer = null; void tick(); }, interval); timer.unref?.();
  }
  function tick() {
    if (stopped || !enabled) return Promise.resolve(status());
    if (running) return running;
    if (timer) { clearTimeout(timer); timer = null; }
    running = Promise.resolve().then(execute).catch(() => {
      pollError = 'TG 查询检查暂未完成，正在重试。'; retryAt = clock().getTime() + 30000;
    }).then(status).finally(() => { running = null; schedule(); });
    return running;
  }
  function start() {
    if (started) return running || Promise.resolve(status());
    started = true; stopped = false; startedAt = clock().getTime();
    return tick();
  }
  function stop() {
    started = false; stopped = true;
    if (timer) clearTimeout(timer); timer = null;
    controller?.abort();
    return running || Promise.resolve(status());
  }
  return { start, stop, tick, status };
}
