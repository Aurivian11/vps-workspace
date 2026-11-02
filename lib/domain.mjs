import {normalizeRenewalHistory} from './renewals.mjs';
import { randomUUID } from 'node:crypto';

export const DEFAULT_RATES = Object.freeze({ CNY: 1, USD: 6.7796, HKD: 0.8646, EUR: 7.8893, JPY: 0.04254, GBP: 9.1075, CAD: 4.9017 });
const CURRENCIES = new Set(Object.keys(DEFAULT_RATES));
const CYCLES = new Set(['monthly', 'quarterly', 'yearly']);
const STATUSES = new Set(['online', 'maintenance', 'idle', 'expired']);
const USAGE_KINDS = new Set(['website', 'database', 'proxy', 'bot', 'storage', 'note']);
const SECRET_FIELDS = ['sshPassword', 'serverURLPassword', 'panelPassword'];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const AMOUNT = /^(?:(?:[0-9]{1,3}(?:,[0-9]{3})+|[0-9]+)(?:\.[0-9]{1,6})?|\.[0-9]{1,6})$/;
const own = (object, key) => Object.hasOwn(object, key);

function invalid(field) {
  const names={sshPassword:'SSH 密码',serverURLPassword:'服务商密码',panelPassword:'面板密码',name:'服务器名称',title:'标题',sshPort:'SSH 端口',monthlyCostAmount:'账单金额',monthlyCostCurrency:'币种',monthlyCostCycle:'计费周期',serverURL:'服务商网址',panelURL:'面板网址',command:'指令',notes:'备注',username:'用户名',ipAddress:'IP 地址',tags:'标签',domains:'域名记录',usages:'用途记录'};
  const error = new Error(`请检查${names[field] || names[field.split('.')[0]] || '提交内容'}的格式或长度。`);
  error.status = 400;
  throw error;
}
function object(value, field = 'record') {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid(field);
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) invalid(field);
  return value;
}
function take(input, existing, field, fallback) {
  if (own(input, field)) return input[field];
  if (existing && own(existing, field)) return existing[field];
  return fallback;
}
function text(value, field, limit, { required = false, trim = true } = {}) {
  if (value === null || value === undefined) value = '';
  if (typeof value !== 'string') invalid(field);
  const result = trim ? value.trim() : value;
  if (result.length > limit || result.includes('\0') || (required && !result)) invalid(field);
  return result;
}
function choice(value, allowed, field) {
  if (typeof value !== 'string' || !allowed.has(value)) invalid(field);
  return value;
}
function flag(value, field) {
  if (typeof value !== 'boolean') invalid(field);
  return value;
}
function identifier(value, field = 'id') {
  if (value === undefined || value === null) return randomUUID();
  if (typeof value !== 'string' || !UUID.test(value)) invalid(field);
  return value.toLowerCase();
}
function timestamp(value, field, fallback = new Date().toISOString()) {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value !== 'string' || value.length > 50 || !/^\d{4}-\d{2}-\d{2}T/.test(value)) invalid(field);
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) invalid(field);
  return parsed.toISOString();
}
function amountText(value) {
  if (value === null) return null;
  if (value === undefined) return '';
  if (typeof value !== 'string' || value.length > 80) invalid('monthlyCostAmount');
  const stripped = value.trim();
  if (!stripped) return '';
  if (!AMOUNT.test(stripped)) invalid('monthlyCostAmount');
  let normalized = stripped.replaceAll(',', '');
  if (normalized.startsWith('.')) normalized = `0${normalized}`;
  normalized = normalized.replace(/^0+(?=\d)/, '');
  return normalized;
}
function urlText(value, field) {
  const result = text(value, field, 2048);
  if (!result) return '';
  if (!/^https?:\/\//i.test(result) || /[\u0000-\u0020]/.test(result)) invalid(field);
  let parsed;
  try { parsed = new URL(result); } catch { invalid(field); }
  if (!['https:', 'http:'].includes(parsed.protocol) || !parsed.hostname || parsed.username || parsed.password) invalid(field);
  return result;
}
function list(value, field, limit, mapper) {
  if (!Array.isArray(value) || value.length > limit) invalid(field);
  return value.map((item) => mapper(item, field));
}
function domain(value) {
  const input = object(value, 'domains');
  const recordType = text(input.recordType ?? 'A', 'domains.recordType', 16).toUpperCase();
  if (!/^[A-Z0-9_-]+$/.test(recordType)) invalid('domains.recordType');
  return {
    id: identifier(input.id, 'domains.id'),
    domain: text(input.domain, 'domains.domain', 253, { required: true }),
    recordType,
    target: text(input.target, 'domains.target', 2048),
    sslNote: text(input.sslNote, 'domains.sslNote', 200),
    remark: text(input.remark, 'domains.remark', 2000, { trim: false }),
    createdAt: timestamp(input.createdAt, 'domains.createdAt'),
  };
}
function usage(value) {
  const input = object(value, 'usages');
  return {
    id: identifier(input.id, 'usages.id'),
    date: timestamp(input.date, 'usages.date'),
    title: text(input.title, 'usages.title', 200, { required: true }),
    kind: choice(input.kind ?? 'note', USAGE_KINDS, 'usages.kind'),
    detail: text(input.detail, 'usages.detail', 10000, { trim: false }),
  };
}

export function normalizeServer(input, existing = null) {
  object(input);
  if (existing !== null) object(existing, 'existing record');
  const get = (field, fallback = '') => take(input, existing, field, fallback);
  const now = new Date().toISOString();
  const port = get('sshPort', '22');
  const portText = typeof port === 'number' && Number.isInteger(port) ? String(port) : port;
  if (typeof portText !== 'string' || !/^\d{1,5}$/.test(portText) || Number(portText) < 1 || Number(portText) > 65535) invalid('sshPort');
  const legacyText = text(get('monthlyCost'), 'monthlyCost', 500);
  const legacy = parseLegacy(legacyText);
  const rawAmount = get('monthlyCostAmount', legacy?.amount ?? '');
  const rawCurrency = get('monthlyCostCurrency', legacy?.currency ?? null);
  const rawCycle = get('monthlyCostCycle', legacy?.cycle ?? null);
  // A partial structured import must not turn an unknown legacy currency or
  // period into the USD/month default. Entirely empty metadata still defaults.
  if (typeof rawAmount === 'string' && rawAmount.trim() && (!rawCurrency || !rawCycle) && legacyText && !legacy) invalid('billing metadata');
  const result = {
    id: identifier(existing?.id ?? input.id),
    name: text(get('name'), 'name', 120, { required: true }),
    provider: text(get('provider'), 'provider', 120),
    ipAddress: text(get('ipAddress'), 'ipAddress', 253),
    sshPort: String(Number(portText)),
    username: text(get('username', 'root'), 'username', 128),
    status: choice(get('status', 'online'), STATUSES, 'status'),
    region: text(get('region'), 'region', 120),
    plan: text(get('plan'), 'plan', 500),
    monthlyCost: legacyText,
    monthlyCostAmount: amountText(get('monthlyCostAmount', legacy?.amount ?? '')),
    monthlyCostCurrency: choice(get('monthlyCostCurrency', legacy?.currency ?? 'USD') ?? legacy?.currency ?? 'USD', CURRENCIES, 'monthlyCostCurrency'),
    monthlyCostCycle: choice(get('monthlyCostCycle', legacy?.cycle ?? 'monthly') ?? legacy?.cycle ?? 'monthly', CYCLES, 'monthlyCostCycle'),
    monthlyCostConvertedText: text(get('monthlyCostConvertedText'), 'monthlyCostConvertedText', 500),
    excludeFromCosts: flag(get('excludeFromCosts', false), 'excludeFromCosts'),
    monthlyTraffic: text(get('monthlyTraffic'), 'monthlyTraffic', 120),
    bandwidth: text(get('bandwidth'), 'bandwidth', 120),
    purpose: text(get('purpose'), 'purpose', 2000),
    tags: list(get('tags', []), 'tags', 30, (value) => text(value, 'tags', 64, { required: true })),
    renewalDate: timestamp(get('renewalDate', null), 'renewalDate', null),
    renewalDateText: text(get('renewalDateText'), 'renewalDateText', 200),
    renewalHistory: normalizeRenewalHistory(get('renewalHistory', [])),
    autoRenew: flag(get('autoRenew', false) ?? false, 'autoRenew'),
    expiryReminder: flag(get('expiryReminder', false), 'expiryReminder'),
    serverURL: urlText(get('serverURL'), 'serverURL'),
    serverURLUsername: text(get('serverURLUsername'), 'serverURLUsername', 128),
    panelURL: urlText(get('panelURL'), 'panelURL'),
    panelUsername: text(get('panelUsername'), 'panelUsername', 128),
    domains: list(get('domains', []), 'domains', 100, domain),
    usages: list(get('usages', []), 'usages', 500, usage),
    notes: text(get('notes'), 'notes', 20000, { trim: false }),
    passwordMigrationCompleted: flag(get('passwordMigrationCompleted', true) ?? true, 'passwordMigrationCompleted'),
    isPinned: flag(get('isPinned', false) ?? false, 'isPinned'),
    createdAt: timestamp(existing?.createdAt ?? input.createdAt, 'createdAt', now),
    updatedAt: now,
  };
  for (const field of SECRET_FIELDS) result[field] = text(get(field), field, 4096, { trim: false });
  return result;
}

export function normalizeCommand(input, existing = null) {
  object(input);
  if (existing !== null) object(existing, 'existing command');
  const get = (field, fallback = '') => take(input, existing, field, fallback);
  const now = new Date().toISOString();
  return {
    id: identifier(existing?.id ?? input.id),
    title: text(get('title'), 'title', 120, { required: true }),
    category: text(get('category'), 'category', 120),
    command: text(get('command'), 'command', 50000, { required: true, trim: false }),
    note: text(get('note'), 'note', 20000, { trim: false }),
    createdAt: timestamp(existing?.createdAt ?? input.createdAt, 'createdAt', now),
    updatedAt: now,
  };
}

export function redactServer(server) {
  object(server);
  const redacted = {};
  for (const [key, value] of Object.entries(server)) {
    if (SECRET_FIELDS.includes(key) || ['__proto__', 'constructor', 'prototype', 'hasSecrets'].includes(key)) continue;
    Object.defineProperty(redacted, key, { value: structuredClone(value), enumerable: true, writable: true, configurable: true });
  }
  redacted.hasSecrets = Object.fromEntries(SECRET_FIELDS.map((field) => [field, typeof server[field] === 'string' && server[field].length > 0]));
  return redacted;
}

const CURRENCY_TOKEN = '(CNY|RMB|USD|HKD|EUR|JPY|GBP|CAD|CN¥|US\\$|HK\\$|CA\\$|JP¥|[¥￥$€£])';
const LEGACY_AMOUNT = '((?:(?:[0-9]{1,3}(?:,[0-9]{3})+|[0-9]+)(?:\\.[0-9]{1,6})?|\\.[0-9]{1,6}))';
const LEGACY = new RegExp(`^\\s*(?:${CURRENCY_TOKEN}\\s*)?${LEGACY_AMOUNT}(?:\\s*${CURRENCY_TOKEN})?(?:\\s*(?:/|每|per\\s+)\\s*(月付?|季付?|季度|年付?|monthly|month|mo|quarterly|quarter|yearly|year|yr|annual|annum))?\\s*$`, 'i');
function currencyToken(value) {
  if (!value) return null;
  const upper = value.toUpperCase();
  return ({ RMB: 'CNY', 'CN¥': 'CNY', '¥': 'CNY', '￥': 'CNY', 'US$': 'USD', '$': 'USD', 'HK$': 'HKD', '€': 'EUR', 'JP¥': 'JPY', '£': 'GBP', 'CA$': 'CAD' })[upper] ?? upper;
}
function parseLegacy(value) {
  if (typeof value !== 'string' || value.length > 500) return null;
  const match = LEGACY.exec(value);
  if (!match) return null;
  const prefix = currencyToken(match[1]);
  const suffix = currencyToken(match[3]);
  if (prefix && suffix && prefix !== suffix) return null;
  const period = (match[4] ?? '').toLowerCase();
  const cycle = ['季', '季付', '季度', 'quarter', 'quarterly'].includes(period) ? 'quarterly'
    : ['年', '年付', 'year', 'yearly', 'yr', 'annual', 'annum'].includes(period) ? 'yearly' : 'monthly';
  return { amount: match[2].replaceAll(',', ''), currency: prefix ?? suffix ?? 'USD', cycle };
}
function decimalParts(value) {
  const match = /^(\d+)(?:\.(\d+))?(?:e([+-]?\d+))?$/i.exec(value);
  if (!match) return null;
  let units = BigInt(match[1] + (match[2] ?? ''));
  let scale = (match[2]?.length ?? 0) - Number(match[3] ?? 0);
  if (scale < 0) { units *= 10n ** BigInt(-scale); scale = 0; }
  return { units, scale };
}
function addDecimal(left, right) {
  const scale = Math.max(left.scale, right.scale);
  return { units: left.units * 10n ** BigInt(scale - left.scale) + right.units * 10n ** BigInt(scale - right.scale), scale };
}
// Convert once at the API boundary, retaining 12 decimal places. Display currency
// can round to cents without rounding each subscription's monthly share first.
function numeric(total, divisor = 1n) {
  const denominator = 10n ** BigInt(total.scale) * divisor;
  const scaled = total.units * 1000000000000n;
  let rounded = scaled / denominator;
  if ((scaled % denominator) * 2n >= denominator) rounded += 1n;
  return Number(`${rounded / 1000000000000n}.${String(rounded % 1000000000000n).padStart(12, '0')}`);
}

export function calculateCosts(servers, rates = DEFAULT_RATES) {
  if (!Array.isArray(servers)) invalid('servers');
  let yearly = { units: 0n, scale: 0 };
  let recorded = { units: 0n, scale: 0 };
  let includedCount = 0;
  let manuallyExcludedCount = 0;
  let foreignCurrencyCount = 0;
  const rateSource = rates && typeof rates === 'object' && !Array.isArray(rates) ? rates : {};
  for (const server of servers) {
    if (!server || typeof server !== 'object' || Array.isArray(server)) continue;
    if (server.excludeFromCosts === true) { manuallyExcludedCount += 1; continue; }
    const legacy = parseLegacy(server.monthlyCost);
    let amount;
    try {
      amount = own(server, 'monthlyCostAmount') ? amountText(server.monthlyCostAmount) : legacy?.amount;
    } catch { continue; }
    if (amount === null || amount === undefined || amount === '') continue;
    if ((!server.monthlyCostCurrency || !server.monthlyCostCycle) && typeof server.monthlyCost === 'string' && server.monthlyCost.trim() && !legacy) continue;
    const currency = server.monthlyCostCurrency ?? legacy?.currency ?? 'USD';
    const cycle = server.monthlyCostCycle ?? legacy?.cycle ?? 'monthly';
    if (!CURRENCIES.has(currency) || !CYCLES.has(cycle)) continue;
    const rateValue = own(rateSource, currency) ? rateSource[currency] : DEFAULT_RATES[currency];
    if (typeof rateValue !== 'number' || !Number.isFinite(rateValue) || rateValue <= 0) continue;
    const quote = decimalParts(amount);
    const rate = decimalParts(String(rateValue));
    if (!quote || !rate) continue;
    const converted = { units: quote.units * rate.units, scale: quote.scale + rate.scale };
    const multiplier = cycle === 'monthly' ? 12n : cycle === 'quarterly' ? 4n : 1n;
    const nextRecorded = addDecimal(recorded, converted);
    const nextYearly = addDecimal(yearly, { units: converted.units * multiplier, scale: converted.scale });
    if (!Number.isFinite(numeric(nextRecorded)) || !Number.isFinite(numeric(nextYearly))) continue;
    recorded = nextRecorded;
    yearly = nextYearly;
    includedCount += 1;
    if (currency !== 'CNY') foreignCurrencyCount += 1;
  }
  return {
    monthlyTotal: numeric(yearly, 12n),
    yearlyTotal: numeric(yearly),
    recordedTotal: numeric(recorded),
    includedCount,
    excludedCount: servers.length - includedCount,
    selectedCount: servers.length - manuallyExcludedCount,
    manuallyExcludedCount,
    invalidCostCount: servers.length - manuallyExcludedCount - includedCount,
    foreignCurrencyCount,
  };
}

// This selection is independent of the overview's per-server cost flags.
export function calculateCustomMonthly(servers, serverIds = [], rates = DEFAULT_RATES) {
  if (!Array.isArray(servers)) invalid('servers');
  const selected = new Set(Array.isArray(serverIds) ? serverIds.filter(id => typeof id === 'string') : []);
  const records = servers.filter(server => server && typeof server === 'object' && !Array.isArray(server) && selected.has(server.id));
  const costRecords = records.map(server => ({...server, excludeFromCosts: false}));
  const costs = calculateCosts(costRecords, rates);
  return {
    serverIds: records.map(server => server.id),
    monthlyTotal: costs.monthlyTotal,
    selectedCount: records.length,
    includedCount: costs.includedCount,
    invalidCostCount: costs.excludedCount,
    rows: costRecords.map(server => {
      const cost = calculateCosts([server], rates);
      return {id: server.id, monthlyTotal: cost.includedCount ? cost.monthlyTotal : null};
    }),
  };
}
