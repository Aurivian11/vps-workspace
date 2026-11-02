import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { randomBytes } from 'node:crypto';
import { token, digest, equal, validatePassword, hashPassword, verifyPassword, base32, totp, verifyTotp, newTotpSecret, RateLimiter } from '../lib/security.mjs';
import { seal, unseal, Vault } from '../lib/vault.mjs';
const PASSWORD = 'test-only independent passphrase 738';
const RFC_SECRET = base32(Buffer.from('12345678901234567890'));
function mutateEnvelope(text, field) {
  const value = JSON.parse(text), data = Buffer.from(value[field], 'base64');
  data[0] ^= 1; value[field] = data.toString('base64'); return JSON.stringify(value);
}
test('password policy rejects missing, short, oversized and non-string input', () => {
  for (const value of [undefined, null, 123, [], {}, '', 'a'.repeat(13), 'a'.repeat(129)]) assert.throws(() => validatePassword(value), { status: 400 });
  assert.equal(validatePassword('a'.repeat(14)), 'a'.repeat(14));
  assert.equal(validatePassword('a'.repeat(128)), 'a'.repeat(128));
});
test('scrypt verifies only correct password and salts every hash independently', async () => {
  const a = await hashPassword(PASSWORD), b = await hashPassword(PASSWORD);
  assert.equal(a.algorithm, 'scrypt-v1');
  assert.equal(Buffer.from(a.salt, 'base64url').length, 24);
  assert.equal(Buffer.from(a.hash, 'base64url').length, 64);
  assert.notEqual(a.salt, b.salt); assert.notEqual(a.hash, b.hash);
  assert.equal(await verifyPassword(PASSWORD, a), true);
  assert.equal(await verifyPassword(PASSWORD + 'x', a), false);
  assert.equal(await verifyPassword(PASSWORD, { ...a, algorithm: 'unknown' }), false);
  assert.equal(await verifyPassword(PASSWORD, { ...a, hash: b.hash }), false);
  assert.equal(await verifyPassword(PASSWORD, null), false);
  assert.equal(await verifyPassword('a'.repeat(129), a), false);
  assert.equal(await verifyPassword({ password: PASSWORD }, a), false);
  assert.equal(JSON.stringify(a).includes(PASSWORD), false);
});
test('tokens are independent URL-safe entropy and comparisons reject mismatches', () => {
  const a = token(), b = token(); assert.notEqual(a, b); assert.match(a, /^[A-Za-z0-9_-]+$/);
  assert.equal(Buffer.from(a, 'base64url').length, 32);
  assert.equal(Buffer.from(token(18), 'base64url').length, 18);
  assert.equal(digest(a).length, 64);
  assert.equal(equal(a, a), true); assert.equal(equal(a, b), false); assert.equal(equal(a, a + 'x'), false);
});
test('AES-256-GCM round-trips full records while hiding plaintext', () => {
  const key = randomBytes(32), value = { version: 1, servers: [{ name: '测试服务器', sshPassword: 'TEST-SECRET-DO-NOT-LEAK', notes: 'private note' }], commands: [], nested: [null, false, 123] };
  const text = seal(value, key), envelope = JSON.parse(text);
  assert.equal(envelope.version, 1);
  assert.equal(Buffer.from(envelope.iv, 'base64').length, 12);
  assert.equal(Buffer.from(envelope.tag, 'base64').length, 16);
  assert.deepEqual(unseal(text, key), value);
  assert.equal(text.includes('TEST-SECRET-DO-NOT-LEAK'), false); assert.equal(text.includes('private note'), false);
});
test('AES-GCM rejects wrong key and mutations of nonce, tag or ciphertext', () => {
  const key = randomBytes(32), text = seal({ secret: 'sensitive test payload' }, key);
  assert.throws(() => unseal(text, randomBytes(32)));
  for (const field of ['iv', 'tag', 'ciphertext']) assert.throws(() => unseal(mutateEnvelope(text, field), key));
  assert.throws(() => unseal('{broken-json', key));
  assert.throws(() => unseal(JSON.stringify({ ...JSON.parse(text), version: 2 }), key));
});
test('AES-GCM generates fresh nonce and ciphertext on every save', () => {
  const key = randomBytes(32), nonces = new Set(), ciphertexts = new Set();
  for (let i = 0; i < 64; i++) { const envelope = JSON.parse(seal({ same: 'same payload' }, key)); nonces.add(envelope.iv); ciphertexts.add(envelope.ciphertext); }
  assert.equal(nonces.size, 64); assert.equal(ciphertexts.size, 64);
});
test('vault persists with private permissions and isolated snapshots', () => {
  const dir = fs.mkdtempSync('tmp/security-tests-');
  try {
    const file = `${dir}/workspace.vault`, key = randomBytes(32), initial = { version: 1, revision: 0, servers: [], commands: [], account: null };
    const vault = new Vault(file, key, initial);
    assert.equal(fs.statSync(file).mode & 0o777, 0o600);
    const next = vault.snapshot(); next.servers.push({ name: 'ISOLATED-TEST-RECORD', sshPassword: 'SYNTHETIC-SECRET' }); next.revision++;
    assert.equal(vault.state.servers.length, 0); vault.save(next);
    assert.equal(fs.statSync(file).mode & 0o777, 0o600);
    assert.deepEqual(new Vault(file, key, {}).snapshot(), next);
    assert.equal(fs.readFileSync(file, 'utf8').includes('SYNTHETIC-SECRET'), false);
    assert.throws(() => new Vault(file, randomBytes(32), initial));
    assert.deepEqual(fs.readdirSync(dir), ['workspace.vault']);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
test('vault rejects decrypted content with incompatible schema', () => {
  const dir = fs.mkdtempSync('tmp/security-tests-');
  try {
    const file = `${dir}/workspace.vault`, key = randomBytes(32);
    for (const invalid of [{ version: 2, servers: [], commands: [] }, { version: 1, servers: {}, commands: [] }, { version: 1, servers: [] }]) {
      fs.writeFileSync(file, seal(invalid, key), { mode: 0o600 });
      assert.throws(() => new Vault(file, key, {}), /Invalid vault schema/);
    }
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
test('Base32 and TOTP match RFC 4648 and RFC 6238 SHA-1 vectors (six digits)', () => {
  assert.equal(base32(Buffer.from('foo')), 'MZXW6'); assert.equal(RFC_SECRET, 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ');
  for (const [seconds, expected] of [[59, '287082'], [1111111109, '081804'], [1111111111, '050471'], [1234567890, '005924'], [2000000000, '279037'], [20000000000, '353130']]) {
    assert.equal(totp(RFC_SECRET, Math.floor(seconds / 30)), expected);
    assert.equal(verifyTotp(RFC_SECRET, expected, -1, seconds * 1000), Math.floor(seconds / 30));
  }
});
test('TOTP accepts adjacent clock window only and rejects malformed codes', () => {
  const counter = 40000000, now = counter * 30000;
  for (const accepted of [counter - 1, counter, counter + 1]) assert.equal(verifyTotp(RFC_SECRET, totp(RFC_SECRET, accepted), -1, now), accepted);
  for (const rejected of [counter - 2, counter + 2]) assert.equal(verifyTotp(RFC_SECRET, totp(RFC_SECRET, rejected), -1, now), null);
  for (const invalid of ['', '12345', '1234567', '12 345', 'abcdef', null, undefined, {}, []]) assert.equal(verifyTotp(RFC_SECRET, invalid, -1, now), null);
});
test('TOTP counters prevent replay and older accepted windows', () => {
  const counter = 40000000, now = counter * 30000;
  assert.equal(verifyTotp(RFC_SECRET, totp(RFC_SECRET, counter), counter, now), null);
  assert.equal(verifyTotp(RFC_SECRET, totp(RFC_SECRET, counter - 1), counter, now), null);
  assert.equal(verifyTotp(RFC_SECRET, totp(RFC_SECRET, counter + 1), counter, now), counter + 1);
  assert.equal(verifyTotp(RFC_SECRET, totp(RFC_SECRET, counter), counter + 1, now), null);
});
test('new TOTP secrets are independent 160-bit Base32 values', () => {
  const a = newTotpSecret(), b = newTotpSecret(); assert.match(a, /^[A-Z2-7]{32}$/); assert.notEqual(a, b);
});
test('rate limits isolate keys and reset only after expiry', (t) => {
  let now = 100000; t.mock.method(Date, 'now', () => now); const limiter = new RateLimiter();
  assert.equal(limiter.consume('login:one', 2, 1000), true); assert.equal(limiter.consume('login:one', 2, 1000), true); assert.equal(limiter.consume('login:one', 2, 1000), false);
  assert.equal(limiter.consume('login:two', 2, 1000), true); assert.equal(limiter.consume('reauth:one', 2, 1000), true);
  now += 999; assert.equal(limiter.consume('login:one', 2, 1000), false);
  now++; assert.equal(limiter.consume('login:one', 2, 1000), true); assert.equal(limiter.entries.size, 1);
});
test('rate limiter has default eight-attempt bound for fifteen minutes', (t) => {
  let now = 100000; t.mock.method(Date, 'now', () => now); const limiter = new RateLimiter();
  for (let i = 0; i < 8; i++) assert.equal(limiter.consume('default'), true);
  assert.equal(limiter.consume('default'), false); now += 899999; assert.equal(limiter.consume('default'), false);
  now++; assert.equal(limiter.consume('default'), true);
});
test('AES-GCM rejects truncated authentication tags, wrong nonce lengths and nonstring envelope fields', () => {
  const key = randomBytes(32), envelope = JSON.parse(seal({ test: 'authenticated' }, key));
  for (const length of [0, 4, 8, 12, 15]) assert.throws(() => unseal(JSON.stringify({ ...envelope, tag: Buffer.from(envelope.tag, 'base64').subarray(0, length).toString('base64') }), key));
  for (const length of [0, 8, 11, 13, 16]) assert.throws(() => unseal(JSON.stringify({ ...envelope, iv: Buffer.alloc(length).toString('base64') }), key));
  for (const field of ['iv', 'tag', 'ciphertext']) assert.throws(() => unseal(JSON.stringify({ ...envelope, [field]: [] }), key));
});
