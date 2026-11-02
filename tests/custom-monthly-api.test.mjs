import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import {spawn} from 'node:child_process';
import {randomBytes,randomUUID} from 'node:crypto';
import {seal,unseal} from '../lib/vault.mjs';
import {digest} from '../lib/security.mjs';
import {DEFAULT_RATES,normalizeServer,calculateCosts,calculateCustomMonthly} from '../lib/domain.mjs';
const quote=(amount,currency='CNY',cycle='monthly')=>({monthlyCostAmount:amount,monthlyCostCurrency:currency,monthlyCostCycle:cycle});
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));

test('custom monthly defaults to an empty selection and does not alter old records',()=>{
 const servers=[{id:'a',...quote('10')},{id:'b',...quote('20'),excludeFromCosts:true}],before=structuredClone(servers);
 const empty={serverIds:[],monthlyTotal:0,selectedCount:0,includedCount:0,invalidCostCount:0,rows:[]};
 assert.deepEqual(calculateCustomMonthly(servers),empty);assert.deepEqual(calculateCustomMonthly(servers,['unknown']),empty);
 assert.deepEqual(calculateCustomMonthly(servers,null),empty);assert.deepEqual(servers,before);
});
test('custom monthly ignores overview exclusions and deduplicates valid selections in server order',()=>{
 const servers=[{id:'a',...quote('120','CNY','yearly')},{id:'b',...quote('90','USD','quarterly'),excludeFromCosts:true},{id:'c',...quote('15')}],rates={CNY:1,USD:7};
 const before=structuredClone(servers),ratesBefore=structuredClone(rates);
 assert.deepEqual(calculateCustomMonthly(servers,['c','b','a','a','unknown'],rates),{serverIds:['a','b','c'],monthlyTotal:235,selectedCount:3,includedCount:3,invalidCostCount:0,rows:[{id:'a',monthlyTotal:10},{id:'b',monthlyTotal:210},{id:'c',monthlyTotal:15}]});
 assert.equal(calculateCosts(servers,rates).monthlyTotal,25);assert.deepEqual(servers,before);assert.deepEqual(rates,ratesBefore);
});
test('legacy quotes and free hosts are valid while missing bills remain distinct from zero',()=>{
 const servers=[{id:'legacy',monthlyCost:'CNY 120 / 年',excludeFromCosts:true},{id:'free',...quote('0')},{id:'missing',...quote('')},{id:'invalid',monthlyCost:'AUD 5 / month'}];
 assert.deepEqual(calculateCustomMonthly(servers,servers.map(s=>s.id),{CNY:1}),{serverIds:servers.map(s=>s.id),monthlyTotal:10,selectedCount:4,includedCount:2,invalidCostCount:2,rows:[{id:'legacy',monthlyTotal:10},{id:'free',monthlyTotal:0},{id:'missing',monthlyTotal:null},{id:'invalid',monthlyTotal:null}]});
});
test('total aggregates exact billing values rather than rounded row totals',()=>{
 const servers=Array.from({length:12},(_,i)=>({id:String(i),...quote('0.01','CNY','yearly'),excludeFromCosts:true}));
 const result=calculateCustomMonthly(servers,servers.map(s=>s.id),{CNY:1});
 assert.equal(result.monthlyTotal,0.01);assert.ok(result.rows.every(row=>row.monthlyTotal===0.000833333333));
 assert.notEqual(result.rows.reduce((sum,row)=>sum+row.monthlyTotal,0),result.monthlyTotal);
 assert.equal(calculateCustomMonthly([{id:'a',...quote('0.1')},{id:'b',...quote('0.2')}],['a','b'],{CNY:1}).monthlyTotal,0.3);
});

test('custom monthly API is independent, authenticated, atomic and persistent',async t=>{
 const dir=`runtime/custom-monthly-${randomUUID()}`,port=19896,origin=`http://127.0.0.1:${port}`;
 fs.mkdirSync(dir,{mode:0o700});fs.chownSync(dir,62031,62031);
 const key=randomBytes(32),setup=randomUUID(),configFile=`${dir}/config.json`,vaultFile=`${dir}/workspace.vault`,mockLog=`${dir}/telegram-calls`,preload=`${dir}/mock-fetch.mjs`;
 const password='Synthetic-custom-monthly-password!2026',botToken='123456789:ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijk';
 const legacy=normalizeServer({name:'Synthetic old annual host',monthlyCost:'CNY 120 / 年',expiryReminder:true,renewalDate:'2099-12-31T00:00:00.000Z',sshPassword:'SYNTHETIC-SSH-ONLY'});
 delete legacy.excludeFromCosts;delete legacy.monthlyCostAmount;delete legacy.monthlyCostCurrency;delete legacy.monthlyCostCycle;
 const monthly=normalizeServer({name:'Synthetic excluded monthly host',...quote('20','USD'),excludeFromCosts:true,panelPassword:'SYNTHETIC-PANEL-ONLY'});
 const quarterly=normalizeServer({name:'Synthetic quarterly host',...quote('9','USD','quarterly')});
 const missing=normalizeServer({name:'Synthetic missing bill',expiryReminder:true,renewalDateText:'2099-12-31'});
 const free=normalizeServer({name:'Synthetic free host',...quote('0')});
 const initial={version:1,revision:0,account:null,servers:[legacy,monthly,quarterly,missing,free],commands:[{id:randomUUID(),title:'Test command',command:'echo synthetic'}],settings:{rates:{...DEFAULT_RATES,CNY:1,USD:7},rateSource:'Synthetic fixture',telegram:{enabled:true,botToken,chatId:'-1001234567890'}}};
 fs.writeFileSync(vaultFile,seal(initial,key),{mode:0o600});fs.chownSync(vaultFile,62031,62031);
 fs.writeFileSync(configFile,JSON.stringify({mode:'private',host:'127.0.0.1',port,origin,key:key.toString('base64'),setupHash:digest(setup),serviceUID:62031,serviceGID:62031,vaultFile}),{mode:0o600});
 fs.writeFileSync(preload,`import fs from 'node:fs';const original=globalThis.fetch;globalThis.fetch=async(url,options)=>{if(String(url).startsWith('https://api.telegram.org/bot')){fs.appendFileSync(${JSON.stringify(mockLog)},'called\\n',{mode:0o600});return new Response(JSON.stringify({ok:true,result:{message_id:1}}),{status:200});}return original(url,options);};`,{mode:0o600});
 let child,output='',cookie='',csrf='',revision=0;const sockets=new Set();
 async function stop(){if(!child||child.exitCode!==null)return;const p=child;p.kill('SIGTERM');await new Promise(resolve=>{const timer=setTimeout(()=>p.kill('SIGKILL'),6500);timer.unref();p.once('exit',()=>{clearTimeout(timer);resolve();});});}
 t.after(async()=>{for(const socket of sockets)socket.destroy();await stop();fs.rmSync(dir,{recursive:true,force:true});});
 async function start(){
  child=spawn(process.execPath,['--import',`./${preload}`,'server.mjs'],{cwd:process.cwd(),env:{...process.env,VPS_CONFIG:configFile},stdio:['ignore','pipe','pipe']});
  child.stdout.on('data',x=>output+=x);child.stderr.on('data',x=>output+=x);
  let ready=false;for(let i=0;i<70;i++){if(child.exitCode!==null)break;try{if((await fetch(origin+'/api/health')).ok){ready=true;break;}}catch{}await delay(100);}assert.ok(ready,output);
 }
 const state=()=>unseal(fs.readFileSync(vaultFile,'utf8'),key),encrypted=()=>fs.readFileSync(vaultFile,'utf8'),endpoint='/api/settings/custom-monthly/servers';
 function headers(extra={}){return {Origin:origin,'Content-Type':'application/json',Cookie:cookie,'X-CSRF-Token':csrf,'If-Match':String(revision),...extra};}
 async function request(path,method='GET',data,extra={}){
  const r=await fetch(origin+path,{method,headers:headers(extra),body:data===undefined?undefined:JSON.stringify(data)}),value=await r.json();
  if(r.headers.has('set-cookie'))cookie=r.headers.get('set-cookie').split(';')[0];if(r.ok&&value.csrfToken)csrf=value.csrfToken;if(r.ok&&Number.isInteger(value.revision))revision=value.revision;return {status:r.status,value};
 }
 function slowSelection(serverIds){
  const payload=JSON.stringify({serverIds});let req;
  const result=new Promise((resolve,reject)=>{req=http.request(origin+endpoint,{method:'PUT',headers:headers({'Content-Length':Buffer.byteLength(payload)})},r=>{let text='';r.on('data',x=>text+=x);r.on('end',()=>resolve({status:r.statusCode,value:JSON.parse(text)}));});req.on('error',reject);req.on('socket',s=>{sockets.add(s);s.once('close',()=>sockets.delete(s));});req.write(payload.slice(0,1));});
  return {result,finish:()=>req.end(payload.slice(1))};
 }
 await start();
 await t.test('old workspaces default to empty custom selection without changing home costs or storage',async()=>{
  assert.equal((await request(endpoint,'PUT',{serverIds:[]})).status,401);
  assert.equal((await request('/api/setup','POST',{token:setup,username:'monthly_test_admin',password})).status,201);
  const raw=encrypted(),w=(await request('/api/workspace')).value;
  assert.equal(w.costs.monthlyTotal,31);assert.equal(w.customMonthly.monthlyTotal,0);assert.equal(w.customMonthly.selectedCount,0);assert.deepEqual(w.customMonthly.serverIds,[]);assert.equal(encrypted(),raw);assert.equal(state().settings.customMonthly,undefined);
  const stat=fs.statSync(vaultFile),saved=await request(endpoint,'PUT',{serverIds:[]});assert.equal(saved.status,200);assert.equal(saved.value.changed,false);assert.equal(encrypted(),raw);assert.equal(fs.statSync(vaultFile).mtimeMs,stat.mtimeMs);assert.equal(state().settings.customMonthly,undefined);
 });
 await t.test('auth, origin, CSRF and stale revision errors never commit',async()=>{
  const before=encrypted();
  for(const extra of [{'X-CSRF-Token':'invalid'},{Origin:'https://untrusted.example'},{Origin:''},{'Sec-Fetch-Site':'cross-site'}])assert.equal((await request(endpoint,'PUT',{serverIds:[]},extra)).status,403);
  for(const value of ['-1','','invalid'])assert.equal((await request(endpoint,'PUT',{serverIds:[]},{'If-Match':value})).status,409);
  assert.equal(encrypted(),before);
 });
 await t.test('invalid and unknown IDs are rejected atomically',async()=>{
  const before=encrypted();
  for(const serverIds of [null,{},'all',[null],[1],['bad-id'],[legacy.id,legacy.id],[randomUUID()],[legacy.id,randomUUID()],Array(1001).fill(legacy.id)]){assert.equal((await request(endpoint,'PUT',{serverIds})).status,400);assert.equal(encrypted(),before);}
  assert.equal((await request(endpoint,'PUT',{})).status,400);assert.equal(encrypted(),before);
 });
 await t.test('custom selection counts home-excluded hosts and modifies only its dedicated settings',async()=>{
  const before=state(),home=(await request('/api/workspace')).value.costs,oldRevision=revision;
  const r=await request(endpoint,'PUT',{serverIds:[monthly.id,legacy.id],excludeFromCosts:false,expiryReminder:false,settings:{rates:{USD:99}},sshPassword:'DO-NOT-STORE'});
  assert.equal(r.status,200);assert.equal(r.value.changed,true);assert.equal(r.value.revision,oldRevision+1);assert.equal(r.value.selectedCount,2);assert.equal(r.value.customMonthly.monthlyTotal,150);
  const after=state();assert.deepEqual(after.servers,before.servers);assert.deepEqual(after.commands,before.commands);assert.deepEqual(after.account,before.account);assert.deepEqual(after.settings,{...before.settings,customMonthly:{serverIds:[legacy.id,monthly.id]}});
  const w=(await request('/api/workspace')).value;assert.deepEqual(w.costs,home);assert.equal(w.customMonthly.monthlyTotal,150);assert.equal(w.servers.find(s=>s.id===monthly.id).excludeFromCosts,true);assert.equal(fs.existsSync(mockLog),false);
 });
 await t.test('same selection in another order is a true no-op',async()=>{
  const before=encrypted(),oldRevision=revision,stat=fs.statSync(vaultFile),result=await request(endpoint,'PUT',{serverIds:[monthly.id,legacy.id]});
  assert.equal(result.status,200);assert.equal(result.value.changed,false);assert.equal(result.value.revision,oldRevision);assert.equal(encrypted(),before);assert.equal(fs.statSync(vaultFile).ino,stat.ino);assert.equal(fs.statSync(vaultFile).mtimeMs,stat.mtimeMs);
 });
 await t.test('changing the overview selection cannot affect custom monthly selection or total',async()=>{
  const before=state().settings.customMonthly,expected=(await request('/api/workspace')).value.customMonthly;
  assert.equal((await request('/api/settings/costs/servers','PUT',{serverIds:[]})).status,200);
  let w=(await request('/api/workspace')).value;assert.equal(w.costs.monthlyTotal,0);assert.deepEqual(w.customMonthly,expected);assert.deepEqual(state().settings.customMonthly,before);
  assert.equal((await request('/api/settings/costs/servers','PUT',{serverIds:initial.servers.map(s=>s.id)})).status,200);
  w=(await request('/api/workspace')).value;assert.equal(w.costs.monthlyTotal,171);assert.deepEqual(w.customMonthly,expected);
 });
 await t.test('none and all custom selections preserve the overview and distinguish invalid bills',async()=>{
  const home=(await request('/api/workspace')).value.costs;
  let r=await request(endpoint,'PUT',{serverIds:[]});assert.equal(r.status,200);assert.equal(r.value.customMonthly.monthlyTotal,0);assert.equal(r.value.customMonthly.selectedCount,0);
  r=await request(endpoint,'PUT',{serverIds:initial.servers.map(s=>s.id)});assert.equal(r.status,200);assert.equal(r.value.customMonthly.monthlyTotal,171);assert.equal(r.value.customMonthly.selectedCount,5);assert.equal(r.value.customMonthly.includedCount,4);assert.equal(r.value.customMonthly.invalidCostCount,1);
  assert.equal(r.value.customMonthly.rows.find(x=>x.id===free.id).monthlyTotal,0);assert.equal(r.value.customMonthly.rows.find(x=>x.id===missing.id).monthlyTotal,null);assert.deepEqual((await request('/api/workspace')).value.costs,home);
 });
 await t.test('price edits recalculate the chosen group and new hosts do not join automatically',async()=>{
  assert.equal((await request(endpoint,'PUT',{serverIds:[legacy.id,monthly.id]})).status,200);
  const chosen=state().settings.customMonthly.serverIds;
  let r=await request('/api/servers/'+monthly.id,'PUT',{monthlyCostAmount:'30'});assert.equal(r.status,200);
  let w=(await request('/api/workspace')).value;assert.equal(w.customMonthly.monthlyTotal,220);assert.deepEqual(w.customMonthly.serverIds,chosen);
  r=await request('/api/servers','POST',{name:'Synthetic new unselected host',...quote('999')});assert.equal(r.status,201);
  w=(await request('/api/workspace')).value;assert.deepEqual(w.customMonthly.serverIds,chosen);assert.equal(w.customMonthly.monthlyTotal,220);assert.equal(w.servers.find(s=>s.id===r.value.server.id).excludeFromCosts,false);
 });
 await t.test('delete removes chosen IDs from settings and stale selections cannot overwrite newer state',async()=>{
  const previousRevision=revision;
  assert.equal((await request('/api/servers/'+legacy.id,'DELETE')).status,200);
  const saved=state();assert.deepEqual(saved.settings.customMonthly.serverIds,[monthly.id]);
  let w=(await request('/api/workspace')).value;assert.equal(w.customMonthly.monthlyTotal,210);assert.deepEqual(w.customMonthly.serverIds,[monthly.id]);
  const before=encrypted();assert.equal((await request(endpoint,'PUT',{serverIds:[legacy.id]},{'If-Match':String(previousRevision)})).status,409);assert.equal(encrypted(),before);
  assert.equal((await request(endpoint,'PUT',{serverIds:[legacy.id]})).status,400);assert.equal(encrypted(),before);
 });
 await t.test('logout while the request body is incomplete prevents commit',async()=>{
  const before=encrypted(),pending=slowSelection([]);await delay(75);assert.equal((await request('/api/logout','POST',{})).status,200);pending.finish();assert.equal((await pending.result).status,401);assert.equal(encrypted(),before);
  assert.equal((await request('/api/login','POST',{username:'monthly_test_admin',password})).status,200);
 });
 await t.test('selection survives restart with no Telegram calls or secret disclosure',async()=>{
  const before=state(),raw=encrypted(),expected=(await request('/api/workspace')).value.customMonthly;
  for(const secret of [botToken,'SYNTHETIC-SSH-ONLY','SYNTHETIC-PANEL-ONLY','Synthetic excluded monthly host'])assert.ok(!raw.includes(secret));
  await stop();await start();cookie='';csrf='';
  assert.equal((await request(endpoint,'PUT',{serverIds:[]})).status,401);
  assert.equal((await request('/api/login','POST',{username:'monthly_test_admin',password})).status,200);
  const w=(await request('/api/workspace')).value;assert.deepEqual(w.customMonthly,expected);assert.equal(w.revision,before.revision);assert.deepEqual(state(),before);assert.equal(encrypted(),raw);assert.equal(fs.existsSync(mockLog),false);
  for(const secret of [botToken,'SYNTHETIC-SSH-ONLY','SYNTHETIC-PANEL-ONLY'])assert.ok(!JSON.stringify(w).includes(secret));
  assert.equal(w.servers.find(s=>s.id===monthly.id).hasSecrets.panelPassword,true);assert.ok(!output.includes(botToken));
 });
});
