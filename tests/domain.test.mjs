import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeServer, normalizeCommand, redactServer, calculateCosts, DEFAULT_RATES } from '../lib/domain.mjs';

const rates = { CNY: 1, USD: 7, EUR: 8, HKD: 0.9, JPY: 0.05, GBP: 9, CAD: 5 };
const quote = (amount, currency = 'CNY', cycle = 'monthly') => ({ monthlyCostAmount: amount, monthlyCostCurrency: currency, monthlyCostCycle: cycle });
const bad = (operation) => assert.throws(operation, (error) => error.status === 400 && typeof error.message === 'string');

test('mixed monthly, quarterly, yearly and currencies use the agreed basis', () => {
  const servers = [quote('120'), quote('90', 'USD', 'quarterly'), quote('120', 'EUR', 'yearly')];
  const original = structuredClone(servers);
  const originalRates = structuredClone(rates);
  assert.deepEqual(calculateCosts(servers, rates), { monthlyTotal: 410, yearlyTotal: 4920, recordedTotal: 1710, includedCount: 3, excludedCount: 0, selectedCount: 3, manuallyExcludedCount: 0, invalidCostCount: 0, foreignCurrencyCount: 2 });
  assert.deepEqual(servers, original);
  assert.deepEqual(rates, originalRates);
});

test('base-ten arithmetic does not accumulate floating point errors or round each asset', () => {
  assert.equal(calculateCosts([quote('0.1'), quote('0.2')], rates).monthlyTotal, 0.3);
  const costs = calculateCosts(Array.from({ length: 12 }, () => quote('0.01', 'CNY', 'yearly')), rates);
  assert.equal(costs.monthlyTotal, 0.01);
  assert.equal(costs.yearlyTotal, 0.12);
  assert.equal(calculateCosts([quote('1', 'CNY', 'yearly')], rates).monthlyTotal, 0.083333333333);
  assert.equal(calculateCosts([quote('0.000001', 'USD')], rates).monthlyTotal, 0.000007);
});

test('empty, missing, invalid quotes are excluded while explicit zero is valid', () => {
  const invalid = ['', null, undefined, '-1', '-0', 'NaN', 'Infinity', '1e3', '10 20', '12 / 3月', '1,2', '1.0000001', true, 1];
  const costs = calculateCosts([...invalid.map((amount) => quote(amount)), quote('0')], rates);
  assert.equal(costs.includedCount, 1);
  assert.equal(costs.excludedCount, invalid.length);
  assert.equal(costs.monthlyTotal, 0);
  assert.deepEqual(calculateCosts([], rates), { monthlyTotal: 0, yearlyTotal: 0, recordedTotal: 0, includedCount: 0, excludedCount: 0, selectedCount: 0, manuallyExcludedCount: 0, invalidCostCount: 0, foreignCurrencyCount: 0 });
});

test('legacy quotes only parse an unambiguous complete record', () => {
  const legacy = [{ monthlyCost: 'CNY 120 / 年' }, { monthlyCost: '$6' }, { monthlyCost: 'EUR 12 / quarter' }];
  const costs = calculateCosts(legacy, rates);
  assert.equal(costs.monthlyTotal, 84);
  assert.equal(costs.yearlyTotal, 1008);
  assert.equal(costs.recordedTotal, 258);
  for (const monthlyCost of ['AUD 10 / month', 'USD 10 / week', 'CNY 12 / 3月', 'CNY 10 20 / 月', 'USD 10 CNY / 月']) {
    assert.equal(calculateCosts([{ monthlyCost }], rates).excludedCount, 1);
  }
  assert.equal(calculateCosts([{ ...quote(''), monthlyCost: 'CNY 120 / 月' }], rates).includedCount, 0);
  assert.equal(calculateCosts([{ ...quote('10', null), monthlyCost: 'AUD 10 / month' }], rates).includedCount, 0);
  assert.equal(calculateCosts([{ ...quote('10', 'USD', null), monthlyCost: 'USD 10 / week' }], rates).includedCount, 0);
  assert.equal(calculateCosts([{ ...quote('20', 'CNY', 'yearly'), monthlyCost: 'AUD 999 / week' }], rates).yearlyTotal, 20);
});

test('rate validation and fallback do not change defaults', () => {
  for (const rate of [0, -1, Infinity, -Infinity, NaN, '7']) {
    assert.equal(calculateCosts([quote('1', 'USD')], { USD: rate }).excludedCount, 1);
  }
  assert.equal(calculateCosts([quote('1', 'USD')], {}).monthlyTotal, DEFAULT_RATES.USD);
  assert.equal(calculateCosts([quote('1', 'USD')], { USD: 1e-7 }).monthlyTotal, 0.0000001);
  assert.equal(calculateCosts([quote('1', 'AUD')], rates).includedCount, 0);
  assert.equal(calculateCosts([quote('1', 'USD', 'weekly')], rates).includedCount, 0);
  assert.equal(calculateCosts([quote('100', 'USD')], { USD: Number.MAX_VALUE }).includedCount, 0);
});

test('new server defaults and structured amounts are normalized without mutating input', () => {
  const input = { name: '  Synthetic server  ', monthlyCostAmount: '001,234.500000', monthlyCostCurrency: 'CNY', sshPort: 2222, unknown: 'discard' };
  const original = structuredClone(input);
  const server = normalizeServer(input);
  assert.equal(server.name, 'Synthetic server');
  assert.equal(server.monthlyCostAmount, '1234.500000');
  assert.equal(server.sshPort, '2222');
  assert.equal(server.status, 'online');
  assert.equal(server.monthlyCostCycle, 'monthly');
  assert.equal(server.sshPassword, '');
  assert.match(server.id, /^[0-9a-f-]{36}$/);
  assert.equal(new Date(server.createdAt).toISOString(), server.createdAt);
  assert.equal(server.renewalDate, null);
  assert.ok(!Object.hasOwn(server, 'unknown'));
  assert.deepEqual(input, original);
  assert.equal(normalizeServer({ name: 'Free', monthlyCostAmount: '0' }).monthlyCostAmount, '0');
  assert.equal(normalizeServer({ name: 'None', monthlyCostAmount: null }).monthlyCostAmount, null);
});

test('patch inherits secrets and explicit empty clears only that secret', () => {
  const existing = normalizeServer({ name: 'Synthetic', sshPassword: 'synthetic ssh', serverURLPassword: 'synthetic web', panelPassword: 'synthetic panel', notes: 'retained note' });
  const snapshot = structuredClone(existing);
  const patched = normalizeServer({ name: 'Renamed', panelPassword: '', id: 'ignored replacement' }, existing);
  assert.equal(patched.id, existing.id);
  assert.equal(patched.createdAt, existing.createdAt);
  assert.equal(patched.sshPassword, existing.sshPassword);
  assert.equal(patched.serverURLPassword, existing.serverURLPassword);
  assert.equal(patched.panelPassword, '');
  assert.equal(patched.notes, existing.notes);
  assert.deepEqual(existing, snapshot);
  const redacted = redactServer(patched);
  for (const key of ['sshPassword', 'serverURLPassword', 'panelPassword']) assert.ok(!Object.hasOwn(redacted, key));
  assert.deepEqual(redacted.hasSecrets, { sshPassword: true, serverURLPassword: true, panelPassword: false });
  assert.ok(!JSON.stringify(redacted).includes('synthetic ssh'));
  redacted.tags.push('external');
  assert.equal(patched.tags.length, 0);
});

test('validation enforces names, lengths, enums, ports and does not echo secrets', () => {
  for (const input of [null, [], '', {}, { name: '' }, { name: 'a'.repeat(121) }, { name: 'x', notes: 'a'.repeat(20001) }, { name: 'x', ipAddress: 'a'.repeat(254) }]) bad(() => normalizeServer(input));
  for (const sshPort of ['0', '65536', '22.2', 'abc', -1, 1.5, null]) bad(() => normalizeServer({ name: 'x', sshPort }));
  for (const monthlyCostAmount of ['-1', 'Infinity', 'NaN', 'USD 1', '1e3', '1,00', '1.0000001']) bad(() => normalizeServer({ name: 'x', monthlyCostAmount }));
  bad(() => normalizeServer({ name: 'x', status: 'unknown' }));
  bad(() => normalizeServer({ name: 'x', monthlyCostCurrency: 'AUD' }));
  bad(() => normalizeServer({ name: 'x', monthlyCostCycle: 'weekly' }));
  bad(() => normalizeServer({ name: 'x', autoRenew: 'true' }));
  const secret = 'synthetic-sensitive-content'.repeat(200);
  assert.throws(() => normalizeServer({ name: 'x', sshPassword: secret }), (error) => error.status === 400 && !error.message.includes(secret) && error.message.includes('SSH 密码'));
});

test('URL protocols are restricted to HTTP and HTTPS and embedded credentials are rejected', () => {
  for (const field of ['serverURL', 'panelURL']) {
    for (const value of ['javascript:alert(1)', 'data:text/html,hello', 'file:///tmp/test', 'ftp://example.test', 'https://user:synthetic@example.test', 'http:example.test', 'https://exa\nmple.test', 'not a URL']) {
      bad(() => normalizeServer({ name: 'x', [field]: value }));
    }
    assert.equal(normalizeServer({ name: 'x', [field]: 'https://example.test:8443/path?q=1' })[field], 'https://example.test:8443/path?q=1');
    assert.equal(normalizeServer({ name: 'x', [field]: '' })[field], '');
  }
});

test('nested domains, usages and tags are validated and allow only expected fields', () => {
  const server = normalizeServer({ name: 'x', tags: ['test'], domains: [{ domain: 'example.test', target: '192.0.2.1', unknown: 'discard' }], usages: [{ title: 'Synthetic usage', kind: 'website', detail: 'No remote activity' }] });
  assert.equal(server.domains[0].recordType, 'A');
  assert.ok(!Object.hasOwn(server.domains[0], 'unknown'));
  assert.equal(server.usages[0].kind, 'website');
  bad(() => normalizeServer({ name: 'x', tags: Array(31).fill('tag') }));
  bad(() => normalizeServer({ name: 'x', tags: [{}] }));
  bad(() => normalizeServer({ name: 'x', domains: Array(101).fill({ domain: 'example.test' }) }));
  bad(() => normalizeServer({ name: 'x', domains: [{ domain: {} }] }));
  bad(() => normalizeServer({ name: 'x', usages: [{ title: 'x', kind: 'invalid' }] }));
});

test('legacy imports preserve raw quote and infer only valid missing metadata', () => {
  const server = normalizeServer({ name: 'Imported', monthlyCost: 'CNY 120 / 年' });
  assert.equal(server.monthlyCost, 'CNY 120 / 年');
  assert.equal(server.monthlyCostAmount, '120');
  assert.equal(server.monthlyCostCurrency, 'CNY');
  assert.equal(server.monthlyCostCycle, 'yearly');
  assert.equal(calculateCosts([server], rates).monthlyTotal, 10);
  const noCost = normalizeServer({ name: 'Imported', monthlyCost: 'CNY 120 / 年', monthlyCostAmount: null });
  assert.equal(calculateCosts([noCost], rates).includedCount, 0);
});

test('command validation, inheritance, limits and timestamps', () => {
  const command = normalizeCommand({ title: '  Inspect  ', command: 'printf test\n', category: 'system', unknown: true });
  assert.equal(command.title, 'Inspect');
  assert.equal(command.command, 'printf test\n');
  assert.ok(!Object.hasOwn(command, 'unknown'));
  const updated = normalizeCommand({ note: 'updated' }, command);
  assert.equal(updated.id, command.id);
  assert.equal(updated.createdAt, command.createdAt);
  assert.equal(updated.command, command.command);
  bad(() => normalizeCommand({ title: 'x', command: 'x'.repeat(50001) }));
  bad(() => normalizeCommand({ title: '', command: 'x' }));
  bad(() => normalizeCommand({ title: 'x', command: '' }));
});

test('prototype keys cannot pollute outputs or globals', () => {
  const input = JSON.parse('{"name":"safe","__proto__":{"polluted":true},"constructor":{"prototype":{"polluted":true}},"prototype":{"polluted":true}}');
  const normalized = normalizeServer(input);
  assert.equal({}.polluted, undefined);
  for (const field of ['__proto__', 'constructor', 'prototype']) assert.ok(!Object.hasOwn(normalized, field));
  assert.equal(Object.getPrototypeOf(normalized), Object.prototype);
  const redacted = redactServer(input);
  assert.ok(!Object.hasOwn(redacted, '__proto__'));
  assert.equal({}.polluted, undefined);
  bad(() => normalizeServer(Object.create({ name: 'inherited' })));
});


test('partial structured imports cannot silently default unknown legacy billing metadata', () => {
  bad(() => normalizeServer({ name: 'x', monthlyCostAmount: '10', monthlyCostCurrency: null, monthlyCostCycle: 'monthly', monthlyCost: 'AUD 10 / month' }));
  bad(() => normalizeServer({ name: 'x', monthlyCostAmount: '10', monthlyCostCurrency: 'USD', monthlyCostCycle: null, monthlyCost: 'USD 10 / week' }));
  const complete = normalizeServer({ name: 'x', ...quote('20', 'CNY', 'yearly'), monthlyCost: 'AUD 99 / week' });
  assert.equal(calculateCosts([complete], rates).yearlyTotal, 20);
  assert.equal(normalizeServer({ name: 'x', monthlyCostAmount: '10' }).monthlyCostCurrency, 'USD');
});
