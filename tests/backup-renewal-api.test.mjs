import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {spawn} from 'node:child_process';
import {randomBytes,randomUUID} from 'node:crypto';
import {seal,unseal} from '../lib/vault.mjs';
import {digest} from '../lib/security.mjs';
import {normalizeServer,DEFAULT_RATES} from '../lib/domain.mjs';
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
test('backup previews/restores and renewal records are authenticated, atomic and isolated',async t=>{
 const dir=`runtime/backup-renewal-${randomUUID()}`,port=19906,origin=`http://127.0.0.1:${port}`;
 fs.mkdirSync(dir,{mode:0o700});fs.chownSync(dir,62031,62031);
 const key=randomBytes(32),setup=randomUUID(),configFile=`${dir}/config.json`,vaultFile=`${dir}/workspace.vault`,password='Synthetic-backup-renewal-only-2026!';
 const host=normalizeServer({name:'Synthetic annual host',monthlyCostAmount:'120',monthlyCostCurrency:'CNY',monthlyCostCycle:'yearly',renewalDate:'2028-02-29T00:00:00.000Z',sshPassword:'FAKE-SSH-RENEWAL-ONLY',excludeFromCosts:true,expiryReminder:false});
 const initial={version:1,revision:0,account:null,servers:[host],commands:[],settings:{rates:DEFAULT_RATES,rateSource:'Synthetic',telegram:{enabled:false},customMonthly:{serverIds:[host.id]}},telegramDeliveries:{kept:{state:'sent',serverId:host.id}},unknownRuntime:{keep:true}};
 fs.writeFileSync(vaultFile,seal(initial,key),{mode:0o600});fs.chownSync(vaultFile,62031,62031);
 fs.writeFileSync(configFile,JSON.stringify({mode:'private',host:'127.0.0.1',port,origin,key:key.toString('base64'),setupHash:digest(setup),serviceUID:62031,serviceGID:62031,vaultFile}),{mode:0o600});
 let child,output='',cookie='',csrf='',revision=0;
 async function stop(){if(!child||child.exitCode!==null)return;const p=child;p.kill('SIGTERM');await new Promise(resolve=>{const timer=setTimeout(()=>p.kill('SIGKILL'),6000);timer.unref();p.once('exit',()=>{clearTimeout(timer);resolve();});});}
 t.after(async()=>{await stop();fs.rmSync(dir,{recursive:true,force:true});});
 async function start(){child=spawn(process.execPath,['server.mjs'],{cwd:process.cwd(),env:{...process.env,VPS_CONFIG:configFile},stdio:['ignore','pipe','pipe']});child.stdout.on('data',x=>output+=x);child.stderr.on('data',x=>output+=x);for(let i=0;i<80;i++){try{if((await fetch(origin+'/api/health')).ok)return;}catch{}if(child.exitCode!==null)break;await delay(100);}assert.fail(output);}
 async function req(path,method='GET',body,extra={}){const response=await fetch(origin+path,{method,headers:{Origin:origin,'Content-Type':'application/json',Cookie:cookie,'X-CSRF-Token':csrf,'If-Match':String(revision),...extra},body:body===undefined?undefined:JSON.stringify(body)});const value=await response.json();if(response.headers.has('set-cookie'))cookie=response.headers.get('set-cookie').split(';')[0];if(response.ok&&value.csrfToken)csrf=value.csrfToken;if(response.ok&&Number.isInteger(value.revision))revision=value.revision;return {status:response.status,value};}
 const state=()=>unseal(fs.readFileSync(vaultFile,'utf8'),key);
 await start();
 for(const [path,method,body]of [['/api/backups','GET'],['/api/backups/preview','POST',{filename:'bad'}],[`/api/servers/${host.id}/renewals`,'POST',{}]])assert.equal((await req(path,method,body)).status,401);
 assert.equal((await req('/api/setup','POST',{token:setup,username:'backup_test',password})).status,201);
 const renewal={requestId:randomUUID(),amount:'123.45',currency:'CNY',cycle:'yearly',periods:1,paidOn:'2028-02-28',note:'Synthetic annual renewal'};
 const endpoint=`/api/servers/${host.id}/renewals`;
 await t.test('renewal writes once, updates expiry, and preserves prices, secrets and selections',async()=>{
  const before=state();
  assert.equal((await req(endpoint,'POST',renewal,{'X-CSRF-Token':'bad'})).status,403);
  assert.equal((await req(endpoint,'POST',renewal,{Origin:'https://evil.invalid'})).status,403);
  assert.equal((await req(endpoint,'POST',renewal,{'If-Match':'-1'})).status,409);
  assert.deepEqual(state(),before);
  const result=await req(endpoint,'POST',renewal);assert.equal(result.status,201);assert.equal(result.value.record.newExpiry,'2029-02-28');assert.equal(result.value.duplicate,false);
  const after=state(),record=after.servers[0];assert.equal(record.renewalHistory.length,1);assert.equal(record.monthlyCostAmount,'120');assert.equal(record.sshPassword,host.sshPassword);assert.equal(record.excludeFromCosts,true);assert.equal(record.expiryReminder,false);assert.deepEqual(after.settings,before.settings);
  const raw=fs.readFileSync(vaultFile,'utf8');assert.ok(!raw.includes(renewal.note));assert.ok(!raw.includes(host.sshPassword));
  const oldRevision=revision;assert.equal((await req(endpoint,'POST',renewal,{'If-Match':'0'})).value.duplicate,true);assert.equal(revision,oldRevision);assert.equal(state().servers[0].renewalHistory.length,1);
  assert.equal((await req(endpoint,'POST',{...renewal,amount:'124'})).status,409);
  assert.equal((await req(`/api/servers/${host.id}`,'PUT',{name:'Edited host',renewalHistory:[]})).status,200);assert.equal(state().servers[0].renewalHistory.length,1);
 });
 let savedFilename,preview;
 await t.test('manual encrypted backups are listed without secret content',async()=>{
  assert.equal((await req('/api/backup','POST',{password})).status,201);
  const listed=await req('/api/backups');assert.equal(listed.status,200);assert.equal(listed.value.status.enabled,true);assert.equal(listed.value.status.retentionDays,7);assert.equal(listed.value.status.dailyDays,7);assert.equal(listed.value.status.manualLimit,30);assert.equal(listed.value.status.preRestoreLimit,30);
  const manual=listed.value.backups.find(x=>x.kind==='manual');assert.ok(manual);savedFilename=manual.filename;assert.equal(manual.serverCount,1);
  assert.ok(!JSON.stringify(listed.value).includes(host.sshPassword));
  const bytes=fs.readFileSync(`${dir}/backups/${savedFilename}`,'utf8');assert.ok(!bytes.includes('Edited host'));assert.ok(!bytes.includes(password));assert.equal(fs.statSync(`${dir}/backups/${savedFilename}`).mode&0o777,0o600);
  for(const filename of ['../../workspace.vault','/etc/passwd','bad.vpsvault'])assert.ok([400,404].includes((await req('/api/backups/preview','POST',{filename})).status));
 });
 await t.test('preview reports semantic changes without revealing secret values',async()=>{
  assert.equal((await req(`/api/servers/${host.id}`,'PUT',{name:'After backup',sshPassword:'FAKE-CHANGED-SECRET',notes:'PRIVATE-NOTE-SYNTHETIC'})).status,200);
  assert.equal((await req('/api/servers','POST',{name:'Later addition'})).status,201);
  const result=await req('/api/backups/preview','POST',{filename:savedFilename});assert.equal(result.status,200);preview=result.value;
  assert.equal(preview.summary.changed,1);assert.equal(preview.summary.removed,1);assert.equal(preview.summary.added,0);
  for(const secret of [host.sshPassword,'FAKE-CHANGED-SECRET','PRIVATE-NOTE-SYNTHETIC',password])assert.ok(!JSON.stringify(preview).includes(secret));
  assert.equal((await req('/api/backups/restore','POST',{filename:savedFilename,previewToken:preview.previewToken})).status,400);
  assert.equal((await req('/api/backups/restore','POST',{filename:savedFilename,previewToken:preview.previewToken,confirm:true},{'X-CSRF-Token':'bad'})).status,403);
 });
 await t.test('stale previews refuse to overwrite new edits',async()=>{
  assert.equal((await req(`/api/servers/${host.id}`,'PUT',{region:'New region'})).status,200);
  assert.equal((await req('/api/backups/restore','POST',{filename:savedFilename,previewToken:preview.previewToken,confirm:true})).status,409);
  preview=(await req('/api/backups/preview','POST',{filename:savedFilename})).value;
 });
 await t.test('confirmed restore creates safety backup, preserves current security and runtime state',async()=>{
  const before=state(),oldRevision=revision;
  const result=await req('/api/backups/restore','POST',{filename:savedFilename,previewToken:preview.previewToken,confirm:true});assert.equal(result.status,200);assert.equal(result.value.revision,oldRevision+1);assert.ok(result.value.backupFilename);
  const after=state();assert.equal(after.servers.length,1);assert.equal(after.servers[0].name,'Edited host');assert.equal(after.servers[0].sshPassword,host.sshPassword);assert.equal(after.servers[0].renewalHistory.length,1);
  assert.deepEqual(after.account,before.account);assert.deepEqual(after.settings.telegram,before.settings.telegram);assert.deepEqual(after.telegramDeliveries,before.telegramDeliveries);assert.deepEqual(after.unknownRuntime,before.unknownRuntime);
  assert.equal((await req('/api/backups/restore','POST',{filename:savedFilename,previewToken:preview.previewToken,confirm:true})).status,409);
  const workspace=(await req('/api/workspace')).value;assert.equal(workspace.servers[0].sshPassword,undefined);assert.ok(!JSON.stringify(workspace).includes(host.sshPassword));
  const safety=unseal(fs.readFileSync(`${dir}/backups/${result.value.backupFilename}`,'utf8'),key);assert.equal(safety.workspace.servers.length,2);
 });
 await t.test('restart schedules a daily encrypted snapshot and preserves recorded history',async()=>{
  const before=state();await stop();await start();cookie='';csrf='';assert.equal((await req('/api/login','POST',{username:'backup_test',password})).status,200);
  const listed=(await req('/api/backups')).value;assert.ok(listed.backups.some(x=>x.kind==='daily'));assert.ok(listed.status.lastBackupAt);assert.ok(listed.status.nextBackupAt);assert.deepEqual(state(),before);
  assert.equal((await req(endpoint,'POST',renewal)).value.duplicate,true);assert.equal(state().servers[0].renewalHistory.length,1);
 });
 for(const secret of [password,host.sshPassword,'FAKE-CHANGED-SECRET'])assert.ok(!output.includes(secret));
});
