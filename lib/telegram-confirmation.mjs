import {parseRenewalDate} from './renewal-date.mjs';
import { createHash, randomUUID } from 'node:crypto';
import { normalizeTelegram, sendTelegram, TelegramDeliveryError } from './telegram.mjs';

const RETENTION_MS = 7 * 86400000;
const MAX_HISTORY = 1000;
const hash = value => createHash('sha256').update(value).digest('hex');
const destination = config => hash(`${config.botToken.split(':')[0]}\n${config.chatId}`);
const failure = (status, message) => { const error = new Error(message); error.status = status; throw error; };
const resultMessages = {
  pending: '选择已保存，Telegram 确认消息正在发送。',
  sent: '选择已保存，Telegram 确认消息已发送。',
  failed: '选择已保存，但 Telegram 拒绝发送确认消息。请检查机器人设置并先开始对话。',
  uncertain: '选择已保存，确认消息的发送结果待确认。请先查看 Telegram，系统不会重复发送。',
  skipped: '选择已保存，未发送确认消息。请先完成 Telegram 设置。',
};
function publicResult(record) {
  const status = ['sent', 'failed', 'uncertain', 'skipped'].includes(record?.status) ? record.status : 'pending';
  return { status, message: record?.reason === 'destination-changed' ? '选择已保存，但 Telegram 接收设置已更改，本次确认消息未发送。' : resultMessages[status] };
}
function requestIdentity(confirmationId, serverIds) {
  if (typeof confirmationId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_-]{15,127}$/.test(confirmationId)) failure(400, '确认编号格式不正确，请重新打开选择窗口。');
  if (!Array.isArray(serverIds) || serverIds.length > 10000 || serverIds.some(id => typeof id !== 'string' || id.length < 1 || id.length > 128)) failure(400, '机器选择格式不正确。');
  return { confirmationId, selectionHash: hash(JSON.stringify([...new Set(serverIds)].sort())) };
}
function existingRecord(state, identity) {
  const record = state.telegramSelectionConfirmations?.[identity.confirmationId];
  if (!record) return null;
  if (record.selectionHash !== identity.selectionHash) failure(409, '此确认编号已用于其他选择，请重新确认。');
  return record;
}
function configured(state) {
  try { return normalizeTelegram({ ...state.settings?.telegram, enabled: true }); }
  catch { return null; }
}
const expiry=value=>parseRenewalDate(value)?.date||null;
function cleanName(value) { return typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, 100) || '未命名机器' : '未命名机器'; }
function messageFor(state, serverIds, origin) {
  const selected = new Set(serverIds);
  const servers = state.servers.filter(server => selected.has(server.id));
  const missing = servers.filter(server => !expiry(server.renewalDate || server.renewalDateText)).length;
  const header = ['VPS 提醒选择已保存', `已选择 ${servers.length} 台机器`, `到期提醒：${state.settings?.telegram?.enabled === true ? '已开启' : '已关闭（开启后才会发送到期提醒）'}`, '提醒规则：到期前 7 天，北京时间 09:00 起检查。'];
  const footer = [missing ? `${missing} 台未填写有效到期日期，暂不会触发到期提醒。` : null, `管理：${origin}`].filter(Boolean).join('\n');
  let text = header.join('\n'), shown = 0;
  for (const server of servers) {
    const line = `\n${cleanName(server.name)} — ${expiry(server.renewalDate || server.renewalDateText) || '未填写有效日期'}`;
    if (text.length + line.length + footer.length + 100 > 4000) break;
    text += line; shown++;
  }
  if (shown < servers.length) text += `\n其余 ${servers.length - shown} 台请在管理页面查看。`;
  return `${text}\n${footer}`;
}
function pruneHistory(state, timestamp) {
  for (const [id, record] of Object.entries(state.telegramSelectionConfirmations || {})) {
    if (!['queued', 'sending'].includes(record.status) && timestamp - Date.parse(record.finishedAt || record.createdAt) > RETENTION_MS) delete state.telegramSelectionConfirmations[id];
  }
}

export function createSelectionConfirmer({ vault, origin, now = () => new Date(), send = sendTelegram }) {
  const link = new URL(origin);
  if (!(link.protocol === 'https:' || (link.protocol === 'http:' && ['127.0.0.1', '[::1]', 'localhost'].includes(link.hostname))) || link.username || link.password) throw Error('Telegram confirmations require a public HTTPS origin');
  const appURL = link.origin;
  const inFlight = new Map();
  let stopped = false, started = false, startup = null;
  const instant = () => new Date(now()).toISOString();
  function lookup(confirmationId, serverIds) {
    const record = existingRecord(vault.snapshot(), requestIdentity(confirmationId, serverIds));
    return record ? publicResult(record) : null;
  }
  function prepare(state, { confirmationId, serverIds }) {
    const identity = requestIdentity(confirmationId, serverIds), existing = existingRecord(state, identity);
    if (existing) return publicResult(existing);
    const records = state.telegramSelectionConfirmations ||= {};
    const createdAt = instant();
    pruneHistory(state, Date.parse(createdAt));
    if (Object.keys(records).length >= MAX_HISTORY) failure(400, '近期确认记录过多，请稍后再试。');
    const config = configured(state);
    records[confirmationId] = { selectionHash: identity.selectionHash, status: config ? 'queued' : 'skipped', createdAt, destination: config ? destination(config) : null, text: messageFor(state, serverIds, appURL), ...(config ? {} : { finishedAt: createdAt }) };
    return publicResult(records[confirmationId]);
  }
  function settle(id, claim, update) {
    const latest = vault.snapshot(), record = latest.telegramSelectionConfirmations?.[id];
    if (!record || record.claim !== claim) return record ? publicResult(record) : { status: 'skipped', message: '确认任务已移除，本次不再发送。' };
    Object.assign(record, update, { finishedAt: instant() });
    vault.save(latest);
    return publicResult(record);
  }
  async function execute(id) {
    try {
      if (stopped) return publicResult(vault.snapshot().telegramSelectionConfirmations?.[id]);
      const next = vault.snapshot(), record = next.telegramSelectionConfirmations?.[id];
      if (!record) return { status: 'skipped', message: '未找到确认任务，本次不再发送。' };
      if (record.status === 'sending') return settle(id, record.claim, { status: 'uncertain' });
      if (record.status !== 'queued') return publicResult(record);
      const config = configured(next);
      if (!config || destination(config) !== record.destination) {
        Object.assign(record, { status: 'skipped', reason: config ? 'destination-changed' : 'unconfigured', finishedAt: instant() });
        vault.save(next); return publicResult(record);
      }
      const claim = randomUUID();
      Object.assign(record, { status: 'sending', claim, startedAt: instant() });
      // A durable claim precedes the network call. Interrupted delivery is never
      // automatically retried: Telegram may already have accepted the message.
      vault.save(next);
      const latest = vault.snapshot(), current = latest.telegramSelectionConfirmations?.[id], currentConfig = configured(latest);
      if (!current || current.claim !== claim) return { status: 'skipped', message: '确认任务已改变，本次不再发送。' };
      if (!currentConfig || destination(currentConfig) !== current.destination) return settle(id, claim, { status: 'skipped', reason: currentConfig ? 'destination-changed' : 'unconfigured' });
      let outcome;
      try {
        const response = await send(currentConfig, current.text);
        outcome = Number.isSafeInteger(response?.messageId) ? { status: 'sent', messageId: response.messageId } : { status: 'uncertain' };
      } catch (error) {
        // Arbitrary error text may contain a secret endpoint URL.
        outcome = { status: error instanceof TelegramDeliveryError && error.deliveryState === 'failed' ? 'failed' : 'uncertain' };
      }
      return settle(id, claim, outcome);
    } catch {
      return { status: 'uncertain', message: '选择已保存，确认消息状态暂时无法保存。请先查看 Telegram，系统不会重复发送。' };
    }
  }
  function deliver(id) {
    if (inFlight.has(id)) return inFlight.get(id);
    const task = Promise.resolve().then(() => execute(id)).finally(() => { inFlight.delete(id); });
    inFlight.set(id, task);
    return task;
  }
  function start() {
    if (started) return startup || Promise.resolve();
    started = true; stopped = false;
    startup = (async () => {
      try {
        const next = vault.snapshot(); let changed = false;
        for (const [id, record] of Object.entries(next.telegramSelectionConfirmations || {})) {
          if (record.status === 'sending' && !inFlight.has(id)) { Object.assign(record, { status: 'uncertain', finishedAt: instant() }); changed = true; }
        }
        if (changed) vault.save(next);
        for (const [id, record] of Object.entries(vault.snapshot().telegramSelectionConfirmations || {})) {
          if (stopped) break;
          if (record.status === 'queued') await deliver(id);
        }
      } catch { /* A later explicit retry can inspect the durable record. */ }
    })();
    return startup;
  }
  async function stop() { stopped = true; started = false; await Promise.allSettled([...inFlight.values(), startup].filter(Boolean)); }
  return { prepare, lookup, deliver, start, stop };
}
