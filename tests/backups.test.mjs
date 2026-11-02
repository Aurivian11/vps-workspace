import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { recordRenewal } from '../lib/renewals.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';
import { createBackupManager, validateBackupWorkspace } from '../lib/backups.mjs';
import { normalizeServer, normalizeCommand, DEFAULT_RATES } from '../lib/domain.mjs';
import { seal, unseal } from '../lib/vault.mjs';

function fixture(t) {
  fs.mkdirSync('tmp', { recursive: true, mode: 0o700 });
  const directory = fs.mkdtempSync(path.resolve('tmp/backup-test-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const key = randomBytes(32);
  let clock = new Date('2026-10-21T01:00:00.000Z');
  const server = normalizeServer({ name: 'Test machine', sshPassword: 'NEVER-EXPOSE-PASSWORD', panelURL: 'https://private.example/path', notes: 'PRIVATE-NOTE', monthlyCostAmount: '12' });
  const command = normalizeCommand({ title: 'Test command', command: 'PRIVATE-COMMAND' });
  const vault = {
    state: { version: 1, revision: 5, account: { username: 'original', passwordHash: 'hash-old' }, servers: [server], commands: [command], settings: { rates: { ...DEFAULT_RATES }, rateSource: 'Reference', customMonthly: { serverIds: [server.id] }, telegram: { botToken: 'PRIVATE-TOKEN' } }, telegramState: { sent: ['old'] }, futureRuntimeState: { safe: true } },
    snapshot() { return structuredClone(this.state); },
    save(next) { this.state = next; },
  };
  const manager = createBackupManager({ vault, key, directory, now: () => new Date(clock) });
  t.after(() => manager.stop());
  return { manager, vault, directory, key, setTime: date => { clock = new Date(date); }, server, command };
}

test('full snapshot is encrypted and private; snapshot creation does not mutate live state', t => {
  const f = fixture(t), before = f.vault.snapshot(), backup = f.manager.create();
  assert.equal(f.vault.state.revision, 5);
  assert.deepEqual(f.vault.state, before);
  const file = path.join(f.directory, backup.filename), raw = fs.readFileSync(file, 'utf8');
  for (const value of ['NEVER-EXPOSE-PASSWORD', 'PRIVATE-TOKEN', 'PRIVATE-NOTE', 'PRIVATE-COMMAND']) assert.equal(raw.includes(value), false);
  assert.deepEqual(unseal(raw, f.key).workspace, before);
  assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  assert.equal(fs.statSync(f.directory).mode & 0o777, 0o700);
  assert.equal(f.manager.list().backups.length, 1);
});

test('restore preview contains names and changed field labels, never private field values', t => {
  const f = fixture(t), backup = f.manager.create();
  f.vault.state.servers[0].sshPassword = 'DIFFERENT-SECRET';
  f.vault.state.servers[0].panelURL = 'https://other.example/private';
  f.vault.state.servers[0].notes = 'OTHER-PRIVATE-NOTE';
  f.vault.state.servers.push(normalizeServer({ name: 'New machine' }));
  const preview = f.manager.preview(backup.filename), raw = JSON.stringify(preview);
  assert.deepEqual(preview.servers.changed[0].fields, ['面板网址', '备注', 'SSH 密码']);
  assert.equal(preview.servers.removed[0].name, 'New machine');
  for (const value of ['NEVER-EXPOSE-PASSWORD', 'DIFFERENT-SECRET', 'private.example', 'OTHER-PRIVATE-NOTE', 'PRIVATE-TOKEN', 'PRIVATE-COMMAND']) assert.equal(raw.includes(value), false);
  assert.match(preview.digest, /^[a-f0-9]{64}$/);
});

test('restore changes business records while preserving current account, Telegram, unknown runtime state and revision', t => {
  const f = fixture(t), backup = f.manager.create(), original = f.vault.snapshot();
  f.vault.state.account = { username: 'current', passwordHash: 'hash-new' };
  f.vault.state.settings.telegram = { botToken: 'current-token', delivery: ['new'] };
  f.vault.state.settings.futureSettings = { current: true };
  f.vault.state.telegramState = { sent: ['new'] };
  f.vault.state.futureRuntimeState = { safe: 'latest' };
  f.vault.state.servers[0].name = 'Changed name';
  f.vault.state.commands = [];
  f.vault.state.revision = 99;
  const current = f.vault.snapshot(), preview = f.manager.preview(backup.filename);
  const result = f.manager.restore(backup.filename, preview.digest);
  assert.equal(result.revision, 100);
  assert.equal(f.vault.state.servers[0].name, 'Test machine');
  assert.equal(f.vault.state.commands.length, 1);
  for (const field of ['account', 'telegramState', 'futureRuntimeState']) assert.deepEqual(f.vault.state[field], current[field]);
  assert.deepEqual(f.vault.state.settings.telegram, current.settings.telegram);
  assert.deepEqual(f.vault.state.settings.futureSettings, current.settings.futureSettings);
  assert.deepEqual(f.vault.state.settings.customMonthly, original.settings.customMonthly);
  const saved = unseal(fs.readFileSync(path.join(f.directory, result.backup.filename), 'utf8'), f.key);
  assert.equal(saved.kind, 'pre-restore');
  assert.deepEqual(saved.workspace, current);
});

test('modified backup digest aborts before any restore or pre-restore write', t => {
  const f = fixture(t), backup = f.manager.create(), digest = f.manager.preview(backup.filename).digest;
  const file = path.join(f.directory, backup.filename), payload = unseal(fs.readFileSync(file, 'utf8'), f.key);
  payload.workspace.servers[0].name = 'Changed archive';
  fs.writeFileSync(file, seal(payload, f.key));
  assert.throws(() => f.manager.restore(backup.filename, digest), error => error.status === 409);
  assert.equal(f.vault.state.revision, 5);
  assert.equal(f.manager.list().backups.length, 1);
  assert.throws(() => f.manager.restore(backup.filename, ''), error => error.status === 400);
});

test('backup creation failure prevents restoring live data', t => {
  const f = fixture(t), backup = f.manager.create(), digest = f.manager.preview(backup.filename).digest;
  f.vault.state.servers[0].name = 'Current';
  const before = f.vault.snapshot(), originalSnapshot = f.vault.snapshot.bind(f.vault);
  let calls = 0;
  f.vault.snapshot = () => { if (++calls === 2) throw Error('simulated unreadable current state'); return originalSnapshot(); };
  assert.throws(() => f.manager.restore(backup.filename, digest));
  assert.deepEqual(f.vault.state, before);
});

test('daily backups use Beijing calendar date and survive worker restarts without duplicates', t => {
  const f = fixture(t);
  f.setTime('2026-10-20T15:59:00Z');
  assert.equal(f.manager.tick().kind, 'daily');
  assert.equal(f.manager.tick(), null);
  f.setTime('2026-10-20T16:01:00Z');
  assert.equal(f.manager.tick().kind, 'daily');
  const second = createBackupManager({ vault: f.vault, key: f.key, directory: f.directory, now: () => new Date('2026-10-20T16:02:00Z') });
  assert.equal(second.tick(), null);
  assert.equal(second.list().backups.length, 2);
  assert.equal(second.status().nextBackupAt, '2026-10-21T16:00:00.000Z');
  assert.equal(f.vault.state.revision, 5);
});

test('daily retention keeps 7 Beijing calendar days and manual/pre-restore archives are capped independently', t => {
  const f = fixture(t);
  for (let day = 0; day < 32; day++) {
    f.setTime(new Date(Date.parse('2026-09-01T01:00:00Z') + day * 86400000));
    f.manager.tick();
  }
  let backups = f.manager.list().backups;
  assert.equal(backups.length, 7);
  assert.equal(backups.at(-1).createdAt, '2026-09-26T01:00:00.000Z');
  for (let n = 0; n < 32; n++) {
    f.setTime(new Date(Date.parse('2026-10-02T01:00:00Z') + n * 1000));
    f.manager.create('manual'); f.manager.create('pre-restore');
  }
  backups = f.manager.list().backups;
  assert.equal(backups.filter(b => b.kind === 'daily').length, 7);
  assert.equal(backups.filter(b => b.kind === 'manual').length, 30);
  assert.equal(backups.filter(b => b.kind === 'pre-restore').length, 30);
});

test('rejects traversal, symlink files, symlink directories and outside-project destinations', t => {
  const f = fixture(t), backup = f.manager.create();
  for (const filename of ['../workspace.vault', '/root/VPS/runtime/workspace.vault', 'manual-a.vpsvault/anything', 'unrelated.vpsvault']) assert.throws(() => f.manager.preview(filename), error => error.status === 400);
  const link = path.join(f.directory, 'manual-symlink.vpsvault');
  fs.symlinkSync(path.join(f.directory, backup.filename), link);
  assert.throws(() => f.manager.preview(path.basename(link)), error => error.status === 400);
  assert.equal(f.manager.list().backups.length, 1);
  const linkedDirectory = path.join(f.directory, 'linked');
  fs.symlinkSync(f.directory, linkedDirectory);
  const linkedManager = createBackupManager({ vault: f.vault, key: f.key, directory: linkedDirectory });
  assert.throws(() => linkedManager.create(), error => error.status === 400);
  assert.throws(() => createBackupManager({ vault: f.vault, key: f.key, directory: '../outside' }), error => error.status === 500);
});

test('damaged and foreign-key archives are ignored and never removed by retention', t => {
  const f = fixture(t);
  fs.writeFileSync(path.join(f.directory, 'workspace-foreign.vpsvault'), seal(f.vault.snapshot(), randomBytes(32)), { mode: 0o600 });
  fs.writeFileSync(path.join(f.directory, 'daily-damaged.vpsvault'), 'not an encrypted archive', { mode: 0o600 });
  f.manager.tick();
  assert.equal(f.manager.list().backups.length, 1);
  assert.ok(fs.existsSync(path.join(f.directory, 'workspace-foreign.vpsvault')));
  assert.ok(fs.existsSync(path.join(f.directory, 'daily-damaged.vpsvault')));
});

test('legacy workspace archives remain compatible without being purged as manual snapshots', t => {
  const f = fixture(t), filename = 'workspace-20261021-test.vpsvault';
  fs.writeFileSync(path.join(f.directory, filename), seal(f.vault.snapshot(), f.key), { mode: 0o600 });
  const preview = f.manager.preview(filename);
  assert.equal(preview.backup.serverCount, 1);
  assert.equal(preview.servers.unchanged, 1);
  assert.equal(f.manager.list().backups.length, 1);
});

test('schema validation rejects duplicated identifiers and invalid custom selection while removing orphan selections', t => {
  const f = fixture(t), invalid = f.vault.snapshot();
  invalid.servers.push(structuredClone(invalid.servers[0]));
  assert.throws(() => validateBackupWorkspace(invalid), error => error.status === 400);
  const badCustom = f.vault.snapshot();
  badCustom.settings.customMonthly = { serverIds: ['not-a-uuid'] };
  assert.throws(() => validateBackupWorkspace(badCustom), error => error.status === 400);
  const orphan = f.vault.snapshot();
  orphan.settings.customMonthly.serverIds.push(randomUUID(), f.server.id);
  assert.deepEqual(validateBackupWorkspace(orphan).settings.customMonthly.serverIds, [f.server.id]);
});

test('uninitialized workspace skips automatic backups and worker lifecycle is idempotent', t => {
  const f = fixture(t);
  f.vault.state.account = null;
  assert.equal(f.manager.tick(), null);
  f.manager.start(); f.manager.start();
  assert.equal(f.manager.status().enabled, true);
  assert.equal(f.manager.list().backups.length, 0);
  f.manager.stop(); f.manager.stop();
  assert.equal(f.manager.status().enabled, false);
});

test('renewal history is validated and restored without losing paid records', t => {
  const f = fixture(t);
  f.vault.state.servers[0].renewalDate = '2026-10-31T00:00:00.000Z';
  f.vault.state.servers[0] = recordRenewal(f.vault.state.servers[0], { requestId: randomUUID(), amount: '12.50', currency: 'CNY', cycle: 'monthly', periods: 1, paidOn: '2026-10-21', note: 'renewal record' }).server;
  const original = structuredClone(f.vault.state.servers[0].renewalHistory);
  const backup = f.manager.create();
  f.vault.state.servers[0].renewalHistory = [];
  const preview = f.manager.preview(backup.filename);
  assert.ok(preview.servers.changed[0].fields.includes('续费记录'));
  f.manager.restore(backup.filename, preview.digest);
  assert.deepEqual(f.vault.state.servers[0].renewalHistory, original);
  const invalid = f.vault.snapshot();
  invalid.servers[0].renewalHistory[0].amount = '-1';
  assert.throws(() => validateBackupWorkspace(invalid), error => error.status === 400);
});

test('backup operations work from inherited project cwd after dropping privileges', { skip: typeof process.getuid !== 'function' || process.getuid() !== 0 }, t => {
  const uid = 62031, directory = fs.mkdtempSync(path.resolve('runtime/backup-uid-test-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  fs.chownSync(directory, uid, uid);
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', `
    import { createBackupManager } from './lib/backups.mjs';
    import { normalizeServer, DEFAULT_RATES } from './lib/domain.mjs';
    import { randomBytes } from 'node:crypto';
    process.setgid(${uid}); process.setuid(${uid});
    const vault={state:{version:1,revision:0,account:{username:'fixture'},servers:[normalizeServer({name:'Fixture'})],commands:[],settings:{rates:DEFAULT_RATES}},snapshot(){return structuredClone(this.state)},save(next){this.state=next}};
    const manager=createBackupManager({vault,key:randomBytes(32),directory:${JSON.stringify(directory)}});
    const backup=manager.create(); const preview=manager.preview(backup.filename); manager.restore(backup.filename,preview.digest);
    if(manager.list().backups.length!==2) throw Error('unexpected backup count');
    process.stdout.write('ok');
  `], { encoding: 'utf8', timeout: 10000 });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, 'ok');
});

test('new pre-restore snapshot survives retention even when timestamps are identical', t => {
  const f = fixture(t);
  for (let n = 0; n < 31; n++) {
    const backup = f.manager.create('pre-restore');
    assert.ok(fs.existsSync(path.join(f.directory, backup.filename)));
  }
  assert.equal(f.manager.list().backups.length, 30);
});

test('seven-day retention crosses Beijing midnight safely and cleans existing old daily snapshots without duplicates', t => {
  const f = fixture(t);
  f.setTime('2026-10-14T15:59:00Z');
  const expired = f.manager.tick(), oldBytes = fs.readFileSync(path.join(f.directory, expired.filename));
  const manual = f.manager.create('manual'), beforeRestore = f.manager.create('pre-restore');
  f.setTime('2026-10-14T16:01:00Z');
  const boundary = f.manager.tick();
  f.setTime('2026-10-20T15:59:00Z');
  f.manager.tick();
  assert.ok(fs.existsSync(path.join(f.directory, expired.filename)), 'October 14 is still within October 20 retention');
  f.setTime('2026-10-20T16:01:00Z');
  const today = f.manager.tick();
  assert.ok(!fs.existsSync(path.join(f.directory, expired.filename)), 'October 14 expires at Beijing October 21');
  for (const backup of [boundary, today, manual, beforeRestore]) assert.ok(fs.existsSync(path.join(f.directory, backup.filename)));
  const expected = f.manager.list().backups.map(b => b.filename).sort();
  fs.writeFileSync(path.join(f.directory, expired.filename), oldBytes, { mode: 0o600 });
  assert.equal(f.manager.tick(), null, 'existing backup for today is not duplicated');
  assert.deepEqual(f.manager.list().backups.map(b => b.filename).sort(), expected);
  const status = f.manager.status();
  assert.equal(status.retentionDays, 7); assert.equal(status.dailyDays, 7);
  assert.equal(status.manualLimit, 30); assert.equal(status.preRestoreLimit, 30);
});
