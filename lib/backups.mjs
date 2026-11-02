import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import { seal, unseal } from './vault.mjs';
import { normalizeServer, normalizeCommand, DEFAULT_RATES } from './domain.mjs';

const KINDS = new Set(['daily', 'manual', 'pre-restore']);
const FILE = /^(?:daily|manual|pre-restore|workspace)-[a-zA-Z0-9_-]+\.vpsvault$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_BYTES = 32 * 1024 * 1024;
const DAY = 86400000;
const DAILY_RETENTION_DAYS = 7;
const own = (value, key) => Object.hasOwn(value, key);
const plain = value => !!value && typeof value === 'object' && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
function fail(status, message) { return Object.assign(new Error(message), { status }); }
function timestamp(value) {
  if (typeof value !== 'string' || value.length > 50 || !/^\d{4}-\d{2}-\d{2}T/.test(value) || !Number.isFinite(Date.parse(value))) throw fail(400, '备份时间格式无效。');
  return new Date(value).toISOString();
}
function shanghaiDay(value) { return new Date(new Date(value).getTime() + 8 * 3600000).toISOString().slice(0, 10); }
function validId(value) { return typeof value === 'string' && UUID.test(value); }
function validateRecords(records, normalize) {
  if (!Array.isArray(records) || records.length > 1000) throw fail(400, '备份中的记录数量或格式无效。');
  const ids = new Set();
  return records.map(record => {
    if (!plain(record) || !validId(record.id) || ids.has(record.id.toLowerCase())) throw fail(400, '备份包含无效或重复的记录编号。');
    ids.add(record.id.toLowerCase());
    let result;
    try { result = normalize(record); } catch { throw fail(400, '备份中的资料格式无效，未进行恢复。'); }
    if (own(record, 'renewalHistory') && !own(result, 'renewalHistory')) throw fail(400, '当前版本不能安全恢复这份续费记录。');
    result.createdAt = timestamp(record.createdAt);
    result.updatedAt = timestamp(record.updatedAt);
    return result;
  });
}
export function validateBackupWorkspace(value) {
  if (!plain(value) || value.version !== 1 || !plain(value.settings)) throw fail(400, '备份内容格式无效。');
  const servers = validateRecords(value.servers, normalizeServer);
  const commands = validateRecords(value.commands, normalizeCommand);
  const rates = { ...DEFAULT_RATES };
  if (own(value.settings, 'rates')) {
    if (!plain(value.settings.rates)) throw fail(400, '备份中的汇率格式无效。');
    for (const [currency, rate] of Object.entries(value.settings.rates)) {
      if (!own(DEFAULT_RATES, currency) || typeof rate !== 'number' || !Number.isFinite(rate) || rate <= 0 || rate > 1e12) throw fail(400, '备份中的汇率格式无效。');
      rates[currency] = rate;
    }
  }
  const rateSource = value.settings.rateSource ?? '';
  if (typeof rateSource !== 'string' || rateSource.length > 500 || rateSource.includes('\0')) throw fail(400, '备份中的汇率说明格式无效。');
  const custom = value.settings.customMonthly ?? { serverIds: [] };
  if (!plain(custom) || !Array.isArray(custom.serverIds) || custom.serverIds.length > 1000 || custom.serverIds.some(id => !validId(id))) throw fail(400, '备份中的自定义月付选择格式无效。');
  const ids = new Set(servers.map(server => server.id));
  const selected = new Set(custom.serverIds.map(id => id.toLowerCase()));
  return { servers, commands, settings: { rates, rateSource, customMonthly: { serverIds: [...selected].filter(id => ids.has(id)) } } };
}

const LABELS = {
  name: '服务器名称', provider: '服务商', ipAddress: 'IP 地址', sshPort: 'SSH 端口', username: 'SSH 账号', sshPassword: 'SSH 密码',
  status: '状态', region: '地区', plan: '套餐', monthlyCost: '账单', monthlyCostAmount: '账单金额', monthlyCostCurrency: '账单币种', monthlyCostCycle: '计费周期', monthlyCostConvertedText: '账单说明',
  excludeFromCosts: '首页统计选择', monthlyTraffic: '套餐流量', bandwidth: '带宽', purpose: '用途', tags: '标签', renewalDate: '到期日期', renewalDateText: '到期说明', autoRenew: '自动续费', expiryReminder: '到期提醒选择',
  serverURL: '服务商网址', serverURLUsername: '服务商账号', serverURLPassword: '服务商密码', panelURL: '面板网址', panelUsername: '面板账号', panelPassword: '面板密码', domains: '域名记录', usages: '用途记录', notes: '备注', isPinned: '置顶设置', passwordMigrationCompleted: '密码记录状态', renewalHistory: '续费记录',
};
function recordChanges(before, after) {
  const old = new Map(before.map(record => [record.id, record]));
  const next = new Map(after.map(record => [record.id, record]));
  const added = [], removed = [], changed = [];
  for (const record of after) {
    const previous = old.get(record.id);
    if (!previous) { added.push({ id: record.id, name: record.name }); continue; }
    const fields = [...new Set([...Object.keys(previous), ...Object.keys(record)])]
      .filter(key => !['createdAt', 'updatedAt'].includes(key) && !equal(previous[key], record[key]))
      .map(key => LABELS[key] || '其他资料');
    if (fields.length) changed.push({ id: record.id, name: record.name, fields: [...new Set(fields)] });
  }
  for (const record of before) if (!next.has(record.id)) removed.push({ id: record.id, name: record.name });
  return { added, removed, changed, unchanged: after.length - added.length - changed.length };
}

export function createBackupManager({ vault, key, directory = 'runtime/backups', now = () => new Date() }) {
  const root = path.resolve(process.cwd()), absoluteDirectory = path.resolve(directory);
  const relative = path.relative(root, absoluteDirectory);
  // The service inherits this cwd before dropping privileges; /root is not traversable afterward.
  const dir = relative;
  if (!relative || relative.startsWith(`..${path.sep}`) || relative === '..' || path.isAbsolute(relative)) throw fail(500, '备份目录必须位于项目目录内。');
  let timer = null, midnightTimer = null, enabled = true, lastBackupAt = null, lastError = null;
  function ensureDirectory() {
    let cursor = '.';
    for (const component of relative.split(path.sep)) {
      cursor = path.join(cursor, component);
      let stat;
      try { stat = fs.lstatSync(cursor); } catch (error) {
        if (error.code !== 'ENOENT') throw error;
        fs.mkdirSync(cursor, { mode: 0o700 });
        stat = fs.lstatSync(cursor);
      }
      if (!stat.isDirectory() || stat.isSymbolicLink()) throw fail(400, '备份目录不安全。');
    }
    fs.chmodSync(dir, 0o700);
  }
  function checkedFilename(filename) {
    if (typeof filename !== 'string' || filename.length > 160 || !FILE.test(filename)) throw fail(400, '备份文件名无效。');
    return path.join(dir, filename);
  }
  function read(filename) {
    const file = checkedFilename(filename);
    ensureDirectory();
    let fd;
    try {
      fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
      const stat = fs.fstatSync(fd);
      if (!stat.isFile() || stat.size < 30 || stat.size > MAX_BYTES) throw fail(400, '备份文件格式或大小无效。');
      const content = fs.readFileSync(fd, 'utf8');
      const payload = unseal(content, key);
      let workspace = payload, kind = 'manual', createdAt = stat.mtime.toISOString();
      if (plain(payload) && payload.format === 'vps-backup') {
        if (payload.version !== 1 || !KINDS.has(payload.kind)) throw fail(400, '备份版本或类型无效。');
        workspace = payload.workspace;
        kind = payload.kind;
        createdAt = timestamp(payload.createdAt);
      }
      const validated = validateBackupWorkspace(workspace);
      return { metadata: { filename, createdAt, kind, serverCount: validated.servers.length, commandCount: validated.commands.length }, workspace, validated, digest: createHash('sha256').update(content).digest('hex') };
    } catch (error) {
      if (error.status) throw error;
      if (error.code === 'ENOENT') throw fail(404, '这份备份已不存在，请刷新列表。');
      throw fail(400, '备份无法读取或校验未通过，未进行恢复。');
    } finally { if (fd !== undefined) fs.closeSync(fd); }
  }
  function entries() {
    ensureDirectory();
    const result = [];
    for (const filename of fs.readdirSync(dir)) {
      if (!FILE.test(filename)) continue;
      try { result.push(read(filename).metadata); } catch { /* Preserve foreign-key or damaged archives. */ }
    }
    return result.sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.filename.localeCompare(a.filename));
  }
  function prune(keepFilename = null) {
    const backups = entries(), cutoff = shanghaiDay(new Date(now().getTime() - (DAILY_RETENTION_DAYS - 1) * DAY));
    for (const kind of KINDS) {
      const candidates = backups.filter(backup => backup.kind === kind && !backup.filename.startsWith('workspace-'));
      if (keepFilename) candidates.sort((a, b) => Number(b.filename === keepFilename) - Number(a.filename === keepFilename));
      const removed = kind === 'daily' ? candidates.filter(backup => backup.filename !== keepFilename && shanghaiDay(backup.createdAt) < cutoff) : candidates.slice(30);
      for (const backup of removed) {
        const file = checkedFilename(backup.filename), stat = fs.lstatSync(file);
        if (stat.isFile() && !stat.isSymbolicLink()) fs.unlinkSync(file);
      }
    }
  }
  function status() {
    const date = now(), tomorrow = new Date(`${shanghaiDay(new Date(date.getTime() + DAY))}T00:00:00+08:00`);
    return { enabled, retentionDays: DAILY_RETENTION_DAYS, dailyDays: DAILY_RETENTION_DAYS, manualLimit: 30, preRestoreLimit: 30, lastBackupAt, nextBackupAt: tomorrow.toISOString(), lastError };
  }
  function list() {
    const backups = entries();
    lastBackupAt = backups[0]?.createdAt ?? null;
    return { backups, status: status() };
  }
  function create(kind = 'manual') {
    if (!KINDS.has(kind)) throw fail(400, '备份类型无效。');
    ensureDirectory();
    const workspace = vault.snapshot();
    validateBackupWorkspace(workspace);
    const createdAt = now().toISOString();
    const filename = `${kind}-${createdAt.replaceAll(/[-:.]/g, '')}-${randomBytes(6).toString('hex')}.vpsvault`;
    const file = checkedFilename(filename), temp = `${file}.pending`;
    let fd;
    try {
      const content = seal({ format: 'vps-backup', version: 1, createdAt, kind, workspace }, key);
      if (Buffer.byteLength(content) > MAX_BYTES) throw fail(400, '备份数据超过允许大小。');
      fd = fs.openSync(temp, 'wx', 0o600);
      fs.writeFileSync(fd, content); fs.fsyncSync(fd); fs.closeSync(fd); fd = undefined;
      fs.renameSync(temp, file);
      const directoryFd = fs.openSync(dir, 'r');
      try { fs.fsyncSync(directoryFd); } finally { fs.closeSync(directoryFd); }
      lastBackupAt = createdAt; lastError = null;
      try { prune(filename); } catch { lastError = '备份已完成，但旧备份清理暂未完成。'; }
      return { filename, createdAt, kind, serverCount: workspace.servers.length, commandCount: workspace.commands.length };
    } catch (error) {
      lastError = '备份未完成，请检查服务运行状态及磁盘空间。';
      if (error.status) throw error;
      throw fail(500, lastError);
    } finally {
      if (fd !== undefined) fs.closeSync(fd);
      try { fs.unlinkSync(temp); } catch (error) { if (error.code !== 'ENOENT') lastError = '备份临时文件清理暂未完成。'; }
    }
  }
  function preview(filename) {
    const selected = read(filename), current = vault.snapshot(), target = selected.validated;
    const normalizedCurrent = validateBackupWorkspace(current);
    const commandsOld = new Map(normalizedCurrent.commands.map(record => [record.id, record]));
    const commandsNext = new Map(target.commands.map(record => [record.id, record]));
    return {
      backup: selected.metadata, digest: selected.digest,
      servers: recordChanges(normalizedCurrent.servers, target.servers),
      commands: {
        before: current.commands.length, after: target.commands.length,
        added: target.commands.filter(record => !commandsOld.has(record.id)).length,
        removed: current.commands.filter(record => !commandsNext.has(record.id)).length,
        changed: target.commands.filter(record => commandsOld.has(record.id) && !equal(commandsOld.get(record.id), record)).length,
      },
      settingsChanged: Object.keys(target.settings).filter(field => !equal(normalizedCurrent.settings[field], target.settings[field])).map(field => ({ rates: '参考汇率', rateSource: '汇率说明', customMonthly: '自定义月付选择' })[field]),
      preserved: ['登录账号', 'Telegram 配置及通知记录'],
    };
  }
  function restore(filename, expectedDigest) {
    if (typeof expectedDigest !== 'string' || !/^[a-f0-9]{64}$/.test(expectedDigest)) throw fail(400, '请先预览这份备份再确认恢复。');
    const selected = read(filename);
    if (selected.digest !== expectedDigest) throw fail(409, '备份已经变化，请重新预览后再恢复。');
    const current = vault.snapshot();
    const backup = create('pre-restore');
    const next = { ...current, servers: selected.validated.servers, commands: selected.validated.commands, settings: { ...current.settings, ...selected.validated.settings }, revision: (Number.isSafeInteger(current.revision) && current.revision >= 0 ? current.revision : 0) + 1 };
    try { vault.save(next); } catch { throw fail(500, '恢复未完成，恢复前备份已保存。'); }
    return { restoredAt: now().toISOString(), revision: next.revision, backup, serverCount: next.servers.length, commandCount: next.commands.length };
  }
  function tick() {
    try {
      if (!vault.state.account) return null;
      const backups = entries();
      lastBackupAt = backups[0]?.createdAt ?? null;
      if (backups.some(backup => backup.kind === 'daily' && shanghaiDay(backup.createdAt) === shanghaiDay(now()))) { prune(); lastError = null; return null; }
      return create('daily');
    } catch { lastError = '自动备份暂未完成，将在下一次检查时重试。'; return null; }
  }
  function scheduleMidnight() {
    const next = new Date(`${shanghaiDay(new Date(now().getTime() + DAY))}T00:00:00+08:00`);
    midnightTimer = setTimeout(() => { tick(); scheduleMidnight(); }, Math.max(1000, next.getTime() - now().getTime()));
    midnightTimer.unref?.();
  }
  function start() { enabled = true; if (timer) return; tick(); timer = setInterval(tick, 3600000); timer.unref?.(); scheduleMidnight(); }
  function stop() { if (timer) clearInterval(timer); if (midnightTimer) clearTimeout(midnightTimer); timer = null; midnightTimer = null; enabled = false; }
  return { list, create, preview, restore, tick, start, stop, status };
}
