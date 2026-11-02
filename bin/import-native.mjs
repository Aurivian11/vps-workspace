import fs from 'node:fs';
import assert from 'node:assert/strict';
import {isDeepStrictEqual} from 'node:util';
const checkEqual=(a,b,message='Validation mismatch')=>assert.ok(isDeepStrictEqual(a,b),message);
import {dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash,createDecipheriv,randomBytes} from 'node:crypto';
import {normalizeServer,normalizeCommand,calculateCosts,redactServer} from '../lib/domain.mjs';
import {seal,unseal} from '../lib/vault.mjs';
process.chdir(dirname(dirname(fileURLToPath(import.meta.url))));
process.umask(0o077);
if(process.getuid()!==0)throw Error('Administrator required');
const config=JSON.parse(fs.readFileSync('.private/config.json'));
const key=Buffer.from(config.key,'base64');
const target=config.vaultFile||'runtime/workspace.vault';
const prepared='.private/import-prepared.vpsvault';
const digest=b=>createHash('sha256').update(b).digest('hex');
const secrets=['sshPassword','serverURLPassword','panelPassword'];
function atomic(path,value,owner){
 const tmp=path+'.'+randomBytes(8).toString('hex')+'.pending';let fd;
 try{fd=fs.openSync(tmp,'wx',0o600);fs.writeFileSync(fd,seal(value,key));if(owner)fs.fchownSync(fd,owner.uid,owner.gid);fs.fsyncSync(fd);fs.closeSync(fd);fd=undefined;fs.renameSync(tmp,path);const d=fs.openSync(dirname(path),'r');fs.fsyncSync(d);fs.closeSync(d);}finally{if(fd!==undefined)fs.closeSync(fd);if(fs.existsSync(tmp))fs.unlinkSync(tmp);}
}
function load(){return unseal(fs.readFileSync(target,'utf8'),key);}
function counts(v){return {servers:v.servers.length,commands:v.commands.length,domains:v.servers.reduce((n,s)=>n+s.domains.length,0),usages:v.servers.reduce((n,s)=>n+s.usages.length,0),passwords:Object.fromEntries(secrets.map(k=>[k,v.servers.filter(s=>!!s[k]).length]))};}
function unique(records){assert.equal(new Set(records.map(s=>s.id.toLowerCase())).size,records.length,'Duplicate source identifiers');}
function preserved(source,result,path=''){
 for(const [k,v] of Object.entries(source)){
  assert.ok(Object.hasOwn(result,k),`Unmapped field ${path}${k}`);
  const r=result[k];
  if(v===null&&['renewalDate','autoRenew','isPinned','passwordMigrationCompleted','monthlyCostAmount'].includes(k))continue;
  if(k==='id'){assert.equal(v.toLowerCase(),r);continue;}
  if(['createdAt','updatedAt','date','renewalDate'].includes(k)&&v){assert.equal(new Date(v).getTime(),new Date(r).getTime());continue;}
  if(Array.isArray(v)){assert.equal(v.length,r.length);v.forEach((x,i)=>typeof x==='object'?preserved(x,r[i],`${path}${k}.`):assert.equal(x,r[i]));continue;}
  checkEqual(r,v,`Field changed: ${path}${k}`);
 }
}
function normalized(records,normalizer){return records.map((s,i)=>{let n;try{n=normalizer(s);n.updatedAt=new Date(s.updatedAt).toISOString();preserved(s,n);}catch(error){throw Error(`Source record ${i+1}: ${error.message}`);}return n;});}
function compare(current,incoming){
 for(const type of ['servers','commands']){
  unique(current[type]);
  for(const record of incoming[type]){
   const old=current[type].find(x=>x.id.toLowerCase()===record.id);
   if(old)checkEqual(old,record,`Existing ${type} record differs; refusing overwrite`);
   else if(type==='servers'&&record.ipAddress)assert.ok(!current.servers.some(x=>x.ipAddress===record.ipAddress&&x.sshPort===record.sshPort),'Existing server address conflict; refusing duplicate');
  }
 }
}
function verify(v,p){
 for(const type of ['servers','commands'])for(const expected of p[type])checkEqual(v[type].find(s=>s.id===expected.id),expected,`Saved ${type} mismatch`);
 for(const s of v.servers){const safe=redactServer(s);for(const k of secrets)assert.ok(!Object.hasOwn(safe,k),'Secret redaction failed');}
}
const mode=process.argv[2];
if(mode==='--prepare'){
 let chunks=[],size=0;for await(const c of process.stdin){size+=c.length;if(size>10485760)throw Error('Import too large');chunks.push(c);}
 const bundle=JSON.parse(Buffer.concat(chunks).toString('utf8'));
 assert.equal(bundle.version,1);assert.equal(typeof bundle.legacyPassword,'string');
 const files=bundle.files;assert.ok(files&&typeof files==='object');
 for(const [name,f] of Object.entries(files)){assert.ok(['servers.json','common_commands.json','password_salt.bin','expiry_widget.json','cache_maintenance.json'].includes(name));assert.equal(digest(Buffer.from(f.data,'base64')),f.sha256,'Source checksum failed');}
 const raw=name=>Buffer.from(files[name].data,'base64');
 const salt=raw('password_salt.bin');assert.equal(salt.length,16);
 let legacyKey=Buffer.concat([Buffer.from(bundle.legacyPassword),salt]);
 for(let i=0;i<120000;i++)legacyKey=createHash('sha256').update(legacyKey).digest();
 const servers=JSON.parse(raw('servers.json'));const commands=JSON.parse(raw('common_commands.json'));
 assert.ok(Array.isArray(servers)&&Array.isArray(commands));unique(servers);unique(commands);
 let decrypted=0;
 for(const s of servers)for(const k of secrets){const value=s[k];if(typeof value!=='string'||!value.startsWith('vpsm-field-aesgcm-v1:'))continue;const b=Buffer.from(value.slice('vpsm-field-aesgcm-v1:'.length),'base64');assert.ok(b.length>=28);const d=createDecipheriv('aes-256-gcm',legacyKey,b.subarray(0,12));d.setAuthTag(b.subarray(-16));s[k]=Buffer.concat([d.update(b.subarray(12,-16)),d.final()]).toString('utf8');decrypted++;}
 legacyKey.fill(0);delete bundle.legacyPassword;
 const incoming={servers:normalized(servers,normalizeServer),commands:normalized(commands,normalizeCommand)};
 const current=load();compare(current,incoming);
 checkEqual(calculateCosts(servers,current.settings.rates),calculateCosts(incoming.servers,current.settings.rates),'Cost calculation changed');
 const payload={version:1,preparedAt:new Date().toISOString(),sourceFiles:files,...incoming,baseVaultHash:digest(fs.readFileSync(target)),decrypted};
 atomic(prepared,payload);
 console.log(JSON.stringify({prepared:true,...counts(incoming),decryptedPasswords:decrypted,sourceFiles:Object.keys(files),costs:calculateCosts(incoming.servers,current.settings.rates),existingAccountPreserved:!!current.account}));
}else if(mode==='--apply'){
 if(fs.existsSync('.private/server.pid')){try{process.kill(Number(fs.readFileSync('.private/server.pid','utf8')),0);throw Error('Stop service first');}catch(e){if(e.code!=='ESRCH')throw e;}}
 const p=unseal(fs.readFileSync(prepared,'utf8'),key);assert.equal(digest(fs.readFileSync(target)),p.baseVaultHash,'Workspace changed since preparation');
 const current=load();compare(current,p);
 const stamp=new Date().toISOString().replace(/[:.]/g,'-'),owner={uid:config.serviceUID,gid:config.serviceGID};
 const backup=`runtime/backups/before-native-import-${stamp}.vpsvault`;
 atomic(backup,current,owner);
 const next=structuredClone(current);
 for(const type of ['servers','commands'])for(const s of p[type])if(!next[type].some(x=>x.id===s.id))next[type].push(s);
 next.revision++;
 verify(next,p);checkEqual(next.account,current.account);checkEqual(next.settings,current.settings);
 atomic(target,next,owner);
 const saved=load();verify(saved,p);checkEqual(saved,next);
 const archive=`.private/native-source-${stamp}.vpsvault`;
 atomic(archive,{version:1,importedAt:new Date().toISOString(),sourceFiles:p.sourceFiles});
 const report={importedAt:new Date().toISOString(),verified:true,...counts(saved),importedServers:p.servers.length,importedCommands:p.commands.length,decryptedPasswords:p.decrypted,costs:calculateCosts(saved.servers,saved.settings.rates),backup,sourceArchive:archive,revision:saved.revision,accountUnchanged:true,settingsUnchanged:true};
 fs.writeFileSync('reports/native-import.json',JSON.stringify(report,null,2)+'\n',{mode:0o600});
 fs.unlinkSync(prepared);console.log(JSON.stringify(report));
}else throw Error('Choose --prepare or --apply');
