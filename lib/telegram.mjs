import {parseRenewalDate} from './renewal-date.mjs';
import { createHash, randomUUID } from 'node:crypto';
const DAY = 86400000;
const TOKEN = /^[1-9]\d{4,19}:[A-Za-z0-9_-]{25,100}$/;
const CHAT = /^-?[1-9]\d{0,19}$/;
const MAX_ATTEMPTS = 5;
const TIME_ZONE = 'Asia/Shanghai';
const formatter = new Intl.DateTimeFormat('en-CA', { timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23' });
const digest = (value) => createHash('sha256').update(value).digest('hex');
const destination = (config) => digest(`${config.botToken.split(':')[0]}\n${config.chatId}`);
const configuration = (config) => digest(`${config.botToken}\n${config.chatId}`);
const own = (value, field) => Object.hasOwn(value, field);
const invalid = (message) => { const error = new Error(message); error.status = 400; throw error; };

export function normalizeTelegram(input, existing = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) invalid('请检查 Telegram 设置。');
  if (own(input, 'enabled') && typeof input.enabled !== 'boolean') invalid('提醒开关格式不正确。');
  if (own(input, 'clearToken') && typeof input.clearToken !== 'boolean') invalid('令牌清除选项格式不正确。');
  if (own(input, 'botToken') && typeof input.botToken !== 'string') invalid('Bot Token 格式不正确。');
  if (own(input, 'chatId') && typeof input.chatId !== 'string') invalid('Chat ID 格式不正确。');
  const enabled = input.enabled ?? existing.enabled ?? false;
  const botToken = input.clearToken ? '' : (input.botToken?.trim() || existing.botToken || '');
  const chatId = own(input, 'chatId') ? input.chatId.trim() : (existing.chatId || '');
  if (botToken && !TOKEN.test(botToken)) invalid('Bot Token 格式不正确。');
  if (chatId && !CHAT.test(chatId)) invalid('请输入 Telegram 数字 Chat ID。');
  if (enabled && (!botToken || !chatId)) invalid('开启提醒前请填写 Bot Token 和 Chat ID。');
  return { enabled, botToken, chatId };
}
export function publicTelegram(settings = {}, deliveryInfo = {}) {
  return { enabled: settings.enabled === true, hasToken: Boolean(settings.botToken), chatId: settings.chatId || '', configured: Boolean(TOKEN.test(settings.botToken || '') && CHAT.test(settings.chatId || '')), daysBefore: 7, timeZone: TIME_ZONE, hour: 9, ...deliveryInfo };
}
export class TelegramDeliveryError extends Error {
  constructor(message, { deliveryState = 'uncertain', retryable = false, retryAfterMs = 0 } = {}) {
    super(message); this.name = 'TelegramDeliveryError'; this.deliveryState = deliveryState; this.retryable = retryable; this.retryAfterMs = retryAfterMs;
  }
}
export async function sendTelegram(config, text, { fetchImpl = globalThis.fetch, timeoutMs = 15000, parseMode } = {}) {
  let safe;
  try { safe = normalizeTelegram({ ...config, enabled: true }); }
  catch { throw new TelegramDeliveryError('Telegram 设置不完整或格式不正确。', { deliveryState: 'failed' }); }
  if (typeof text !== 'string' || !text || text.length > 4096) throw new TelegramDeliveryError('提醒消息格式不正确。', { deliveryState: 'failed' });
  if (parseMode !== undefined && parseMode !== 'HTML') throw new TelegramDeliveryError('提醒消息格式不正确。', { deliveryState: 'failed' });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  timer.unref?.();
  try {
    const response = await fetchImpl(`https://api.telegram.org/bot${safe.botToken}/sendMessage`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, redirect: 'error', signal: controller.signal,
      body: JSON.stringify({ chat_id: safe.chatId, text, ...(parseMode ? { parse_mode: parseMode } : {}), link_preview_options: { is_disabled: true } }),
    });
    let body;
    try { body = await response.json(); }
    catch {
      if (response.status === 429) throw new TelegramDeliveryError('Telegram 暂时限流，将稍后重试。', { deliveryState: 'failed', retryable: true, retryAfterMs: 60000 });
      throw new TelegramDeliveryError('Telegram 返回异常，发送结果待确认。');
    }
    if (body?.ok === true && response.ok && Number.isSafeInteger(body.result?.message_id)) return { messageId: body.result.message_id };
    // Only a structured Telegram rejection proves sendMessage did not succeed.
    if (body?.ok === false && Number.isInteger(body.error_code)) {
      const rateLimited = body.error_code === 429;
      const retryable = rateLimited || body.error_code >= 500;
      const seconds = Number(body.parameters?.retry_after);
      const retryAfterMs = rateLimited && Number.isFinite(seconds) && seconds > 0 ? Math.min(seconds * 1000, DAY) : 0;
      throw new TelegramDeliveryError(rateLimited ? 'Telegram 暂时限流，将稍后重试。' : retryable ? 'Telegram 暂时不可用，将稍后重试。' : 'Telegram 拒绝发送，请检查 Bot Token、Chat ID，并先与机器人开始对话。', { deliveryState: 'failed', retryable, retryAfterMs });
    }
    throw new TelegramDeliveryError('Telegram 返回异常，发送结果待确认。');
  } catch (error) {
    if (error instanceof TelegramDeliveryError) throw error;
    // Fetch errors can contain the secret endpoint URL, so never expose them.
    throw new TelegramDeliveryError('网络中断或超时，发送结果待确认；请先检查 Telegram 收件记录。');
  } finally { clearTimeout(timer); }
}
function calendar(now) {
  const parts = Object.fromEntries(formatter.formatToParts(now).filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]));
  return { day: Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day)), hour: Number(parts.hour) };
}
const renewal=parseRenewalDate;
function eligible(server, now, ignoreHour = false) {
  if (server.expiryReminder !== true) return null;
  const expiry = renewal(server.renewalDate || server.renewalDateText);
  if (!expiry) return null;
  const today = calendar(now);
  const daysLeft = Math.round((expiry.day - today.day) / DAY);
  if ((!ignoreHour && today.hour < 9) || daysLeft < 0 || daysLeft > 7) return null;
  return { daysLeft, date: expiry.date };
}
function settingsOf(state) {
  const config = state.settings?.telegram;
  if (!config?.enabled || !TOKEN.test(config.botToken || '') || !CHAT.test(config.chatId || '')) return null;
  return config;
}
function keyFor(server, due, config) { return digest(`${server.id}\n${due.date}\n${destination(config)}`); }
function cleanName(value, fallback) { return typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, 120) || fallback : fallback; }
function reminder(server, due, origin) {
  return ['VPS 到期提醒', `机器：${cleanName(server.name, '未命名机器')}`, server.provider ? `服务商：${cleanName(server.provider, '未填写')}` : null, `到期日期：${due.date}`, due.daysLeft === 0 ? '今天到期，请及时处理。' : `剩余 ${due.daysLeft} 天，请及时处理。`, `管理：${origin}`].filter(Boolean).join('\n');
}
const safeFailure = (error) => error instanceof TelegramDeliveryError ? { state: error.deliveryState, error: error.message, retryable: error.retryable, retryAfterMs: error.retryAfterMs } : { state: 'uncertain', error: '发送结果待确认；请先检查 Telegram 收件记录。', retryable: false, retryAfterMs: 0 };

export function createReminderWorker({ vault, origin, now = () => new Date(), send = sendTelegram, intervalMs = 300000 }) {
  const link = new URL(origin);
  if (!(link.protocol === 'https:' || (link.protocol === 'http:' && ['127.0.0.1', '[::1]', 'localhost'].includes(link.hostname))) || link.username || link.password) throw Error('Telegram reminders require a public HTTPS origin');
  const appURL = link.origin;
  let running = null, timer = null, lastCheckedAt = null, runtimeError = '', initialized = false, stopped = false;
  const currentTime = () => new Date(now());
  function updateReceipt(key, claim, update) {
    const next = vault.snapshot();
    if (next.telegramDeliveries?.[key]?.claim !== claim) return;
    next.telegramDeliveries[key] = { ...next.telegramDeliveries[key], ...update };
    vault.save(next);
  }
  function recoverPending() {
    const next = vault.snapshot();
    let changed = false;
    for (const receipt of Object.values(next.telegramDeliveries || {})) {
      if (receipt.state === 'pending') { receipt.state = 'uncertain'; receipt.error = '服务中断时发送尚未确认；请先检查 Telegram 收件记录。'; receipt.retryable = false; changed = true; }
    }
    if (changed) vault.save(next);
    initialized = true;
  }
  async function execute() {
    runtimeError = '';
    try {
      if (!initialized) recoverPending();
      lastCheckedAt = currentTime().toISOString();
      const ids = vault.snapshot().servers.map((server) => server.id);
      for (const id of ids) {
        if (stopped) break;
        // Refresh each attempt; never save a snapshot kept across a network await.
        const next = vault.snapshot(), config = settingsOf(next), instant = currentTime();
        if (!config) break;
        const server = next.servers.find((record) => record.id === id);
        if (!server) continue;
        const due = eligible(server, instant);
        if (!due) continue;
        const key = keyFor(server, due, config), configHash = configuration(config);
        const prior = next.telegramDeliveries?.[key];
        if (prior && ['sent', 'pending', 'uncertain'].includes(prior.state)) continue;
        const unchangedConfig = prior?.configHash === configHash;
        const attempts = unchangedConfig ? (prior?.attempts || 0) : 0;
        if (prior && unchangedConfig && (!prior.retryable || attempts >= MAX_ATTEMPTS || Date.parse(prior.nextAttemptAt || '') > instant.getTime())) continue;
        const claim = randomUUID();
        next.telegramDeliveries ||= {};
        next.telegramDeliveries[key] = { state: 'pending', claim, serverId: id, renewalDate: due.date, destination: destination(config), configHash, attempts: attempts + 1, startedAt: instant.toISOString(), error: '', retryable: false };
        // Commit a durable claim before calling Telegram to avoid crash duplicates.
        vault.save(next);
        const latest = vault.snapshot(), latestConfig = settingsOf(latest), latestServer = latest.servers.find((record) => record.id === id);
        const latestDue = latestServer && eligible(latestServer, currentTime());
        if (!latestConfig || configuration(latestConfig) !== configHash || !latestDue || keyFor(latestServer, latestDue, latestConfig) !== key) {
          updateReceipt(key, claim, { state: 'failed', retryable: true, attempts: 0, nextAttemptAt: currentTime().toISOString(), error: '' });
          continue;
        }
        let outcome;
        try { const result = await send(latestConfig, reminder(latestServer, latestDue, appURL)); outcome = { state: 'sent', sentAt: currentTime().toISOString(), messageId: Number.isSafeInteger(result?.messageId) ? result.messageId : null, error: '', retryable: false }; }
        catch (error) {
          const failure = safeFailure(error);
          const backoff = Math.max(300000 * 2 ** attempts, failure.retryAfterMs || 0);
          outcome = { state: failure.state, error: failure.error, retryable: failure.retryable && attempts + 1 < MAX_ATTEMPTS, nextAttemptAt: new Date(currentTime().getTime() + backoff).toISOString() };
        }
        updateReceipt(key, claim, outcome);
        lastCheckedAt = currentTime().toISOString();
      }
    } catch {
      // Persistence failure after send leaves pending, recovered as uncertain.
      initialized = false;
      runtimeError = '提醒检查失败，请检查服务状态；未确认的发送不会自动重复。';
    }
    return status();
  }
  function tick() { if (stopped) return Promise.resolve(status()); if (running) return running; running = execute().finally(() => { running = null; }); return running; }
  function start() { stopped = false; if (!timer) { void tick(); timer = setInterval(() => { void tick(); }, Math.max(1000, intervalMs)); timer.unref?.(); } }
  function stop() { stopped = true; if (timer) clearInterval(timer); timer = null; return running || Promise.resolve(); }
  function status() {
    const state = vault.snapshot(), config = state.settings?.telegram;
    const dest = config?.botToken && config?.chatId ? destination(config) : null;
    const receipts = Object.values(state.telegramDeliveries || {}).filter((entry) => entry.destination === dest && state.servers.some((server) => server.id === entry.serverId && server.expiryReminder === true && renewal(server.renewalDate || server.renewalDateText)?.date === entry.renewalDate));
    const count = (kind) => receipts.filter((entry) => entry.state === kind).length;
    const lastSentAt = receipts.map((entry) => entry.sentAt).filter(Boolean).sort().at(-1) || null;
    const latestError = receipts.filter((entry) => ['failed', 'uncertain'].includes(entry.state) && entry.error).sort((a, b) => (b.startedAt || '').localeCompare(a.startedAt || ''))[0]?.error || '';
    return { lastCheckedAt, running: Boolean(running), sentCount: count('sent'), failedCount: count('failed'), pendingCount: count('pending'), uncertainCount: count('uncertain'), lastSentAt, lastError: runtimeError || latestError };
  }
  function retryUncertain({ confirmed = false } = {}) {
    if (confirmed !== true) invalid('请先检查 Telegram 收件记录并确认可能重复发送。');
    const next = vault.snapshot(), config = next.settings?.telegram;
    if (!config || !TOKEN.test(config.botToken || '') || !CHAT.test(config.chatId || '')) invalid('请先完成 Telegram 设置。');
    const dest = destination(config);
    let resetCount = 0;
    for (const receipt of Object.values(next.telegramDeliveries || {})) {
      if (['uncertain', 'failed'].includes(receipt.state) && receipt.destination === dest && next.servers.some((server) => server.id === receipt.serverId && eligible(server, currentTime(), true)?.date === receipt.renewalDate)) { receipt.state = 'failed'; receipt.retryable = true; receipt.attempts = 0; receipt.nextAttemptAt = currentTime().toISOString(); receipt.error = ''; resetCount++; }
    }
    if (resetCount) vault.save(next);
    return { resetCount };
  }
  return { tick, start, stop, status, retryUncertain };
}
