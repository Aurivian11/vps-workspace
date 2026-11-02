import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import {spawn} from 'node:child_process';
import {randomBytes,randomUUID} from 'node:crypto';
import {seal,unseal} from '../lib/vault.mjs';
import {digest} from '../lib/security.mjs';
import {DEFAULT_RATES,normalizeServer,calculateCosts} from '../lib/domain.mjs';
const quote=(amount,currency='CNY',cycle='monthly')=>({monthlyCostAmount:amount,monthlyCostCurrency:currency,monthlyCostCycle:cycle});
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));

test('cost inclusion defaults to included, is strictly boolean, and survives partial edits',()=>{
  const current=normalizeServer({name:'Synthetic cost host'});
  assert.equal(current.excludeFromCosts,false);
  const excluded=normalizeServer({excludeFromCosts:true},current);
  assert.equal(excluded.excludeFromCosts,true);
  assert.equal(normalizeServer({notes:'Unrelated edit'},excluded).excludeFromCosts,true);
  assert.equal(normalizeServer({excludeFromCosts:false},excluded).excludeFromCosts,false);
  const legacy={...current};delete legacy.excludeFromCosts;
  assert.equal(normalizeServer({notes:'Legacy edit'},legacy).excludeFromCosts,false);
  for(const value of ['true','false',1,0,null,{},[],undefined])assert.throws(()=>normalizeServer({excludeFromCosts:value},current),{status:400});
});

test('manual exclusions remove all three totals and distinguish missing prices from deselection',()=>{
  const records=[quote('120'),{...quote('90','USD','quarterly'),excludeFromCosts:true},quote('120','EUR','yearly'),quote(''),{...quote(''),excludeFromCosts:true}];
  const original=structuredClone(records);
  assert.deepEqual(calculateCosts(records,{CNY:1,USD:7,EUR:8}),{monthlyTotal:200,yearlyTotal:2400,recordedTotal:1080,includedCount:2,excludedCount:3,selectedCount:3,manuallyExcludedCount:2,invalidCostCount:1,foreignCurrencyCount:1});
  assert.deepEqual(records,original);
});

test('legacy billing remains included unless exclusion is explicitly true',()=>{
  const records=[{monthlyCost:'CNY 120 / 年'},{monthlyCost:'USD 12 / quarter',excludeFromCosts:true},{monthlyCost:'CNY 3 / 月',excludeFromCosts:'true'}];
  const result=calculateCosts(records,{CNY:1,USD:7});
  assert.equal(result.monthlyTotal,13);assert.equal(result.yearlyTotal,156);assert.equal(result.recordedTotal,123);
  assert.equal(result.selectedCount,2);assert.equal(result.includedCount,2);assert.equal(result.manuallyExcludedCount,1);assert.equal(result.invalidCostCount,0);
});

test('selected fractional costs retain base-ten precision without per-machine rounding',()=>{
  const records=Array.from({length:12},()=>quote('0.01','CNY','yearly'));
  records.push({...quote('999999999999999999','USD'),excludeFromCosts:true});
  let result=calculateCosts(records,{CNY:1,USD:7});
  assert.equal(result.monthlyTotal,0.01);assert.equal(result.yearlyTotal,0.12);assert.equal(result.recordedTotal,0.12);
  assert.equal(result.selectedCount,12);assert.equal(result.manuallyExcludedCount,1);
  result=calculateCosts([quote('0.1'),quote('0.2'),{...quote('0.3'),excludeFromCosts:true}],{CNY:1});
  assert.equal(result.monthlyTotal,0.3);assert.equal(result.yearlyTotal,3.6);assert.equal(result.recordedTotal,0.3);
});

test('empty selection and zero-price machines have unambiguous totals and counts',()=>{
  const result=calculateCosts([{...quote('100'),excludeFromCosts:true},{...quote(''),excludeFromCosts:true}]);
  assert.deepEqual(result,{monthlyTotal:0,yearlyTotal:0,recordedTotal:0,includedCount:0,excludedCount:2,selectedCount:0,manuallyExcludedCount:2,invalidCostCount:0,foreignCurrencyCount:0});
  const free=calculateCosts([quote('0')]);assert.equal(free.includedCount,1);assert.equal(free.invalidCostCount,0);assert.equal(free.monthlyTotal,0);
});

test('cost selection API uses isolated encrypted storage and preserves unrelated data',async t=>{
  const dir=`runtime/cost-selection-${randomUUID()}`,port=19896,origin=`http://127.0.0.1:${port}`;
  fs.mkdirSync(dir,{mode:0o700});fs.chownSync(dir,62031,62031);
  const key=randomBytes(32),setup=randomUUID(),configFile=`${dir}/config.json`,vaultFile=`${dir}/workspace.vault`,mockLog=`${dir}/telegram-calls`,preload=`${dir}/mock-fetch.mjs`;
  const password='Synthetic-cost-selection-password!2026',botToken='123456789:ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijk';
  const legacy=normalizeServer({name:'Synthetic legacy yearly host',monthlyCost:'CNY 120 / 年',expiryReminder:true,renewalDate:'2099-12-31T00:00:00.000Z',sshPassword:'SYNTHETIC-SSH-SECRET',serverURLPassword:'SYNTHETIC-PROVIDER-SECRET'});
  delete legacy.excludeFromCosts;delete legacy.monthlyCostAmount;delete legacy.monthlyCostCurrency;delete legacy.monthlyCostCycle;
  const monthly=normalizeServer({name:'Synthetic fractional host',...quote('0.1'),panelPassword:'SYNTHETIC-PANEL-SECRET',expiryReminder:false});
  const invalid=normalizeServer({name:'Synthetic host without quote',expiryReminder:true,renewalDateText:'2099-12-31',notes:'Preserve notes'});
  const initial={version:1,revision:0,account:null,servers:[legacy,monthly,invalid],commands:[{id:randomUUID(),title:'Synthetic command',command:'echo synthetic'}],settings:{rates:DEFAULT_RATES,rateSource:'Synthetic fixture',telegram:{enabled:true,botToken,chatId:'-1001234567890'}}};
  fs.writeFileSync(vaultFile,seal(initial,key),{mode:0o600});fs.chownSync(vaultFile,62031,62031);
  fs.writeFileSync(configFile,JSON.stringify({mode:'private',host:'127.0.0.1',port,origin,key:key.toString('base64'),setupHash:digest(setup),serviceUID:62031,serviceGID:62031,vaultFile}),{mode:0o600});
  fs.writeFileSync(preload,`import fs from 'node:fs';const original=globalThis.fetch;globalThis.fetch=async(url,options)=>{if(String(url).startsWith('https://api.telegram.org/bot')){fs.appendFileSync(${JSON.stringify(mockLog)},'called\\n',{mode:0o600});return new Response(JSON.stringify({ok:true,result:{message_id:1}}),{status:200});}return original(url,options);};`,{mode:0o600});
  let child,output='',cookie='',csrf='',revision=0;const sockets=new Set();
  async function stop(){if(!child||child.exitCode!==null)return;const processToStop=child;processToStop.kill('SIGTERM');await new Promise(resolve=>{const timer=setTimeout(()=>{processToStop.kill('SIGKILL');},6500);timer.unref();processToStop.once('exit',()=>{clearTimeout(timer);resolve();});});}
  t.after(async()=>{for(const socket of sockets)socket.destroy();await stop();fs.rmSync(dir,{recursive:true,force:true});});
  async function start(){
    child=spawn(process.execPath,['--import',`./${preload}`,'server.mjs'],{cwd:process.cwd(),env:{...process.env,VPS_CONFIG:configFile},stdio:['ignore','pipe','pipe']});
    child.stdout.on('data',x=>output+=x);child.stderr.on('data',x=>output+=x);
    let ready=false;for(let i=0;i<70;i++){if(child.exitCode!==null)break;try{if((await fetch(origin+'/api/health')).ok){ready=true;break;}}catch{}await delay(100);}assert.ok(ready,output);
  }
  const state=()=>unseal(fs.readFileSync(vaultFile,'utf8'),key),encrypted=()=>fs.readFileSync(vaultFile,'utf8');
  const endpoint='/api/settings/costs/servers';
  function headers(extra={}){return{Origin:origin,'Content-Type':'application/json',Cookie:cookie,'X-CSRF-Token':csrf,'If-Match':String(revision),...extra};}
  async function request(path,method='GET',data,extra={}){
    const response=await fetch(origin+path,{method,headers:headers(extra),body:data===undefined?undefined:JSON.stringify(data)}),value=await response.json();
    if(response.headers.has('set-cookie'))cookie=response.headers.get('set-cookie').split(';')[0];
    if(response.ok&&value.csrfToken)csrf=value.csrfToken;if(response.ok&&Number.isInteger(value.revision))revision=value.revision;
    return{status:response.status,value};
  }
  function slowSelection(serverIds){
    const payload=JSON.stringify({serverIds});let request;
    const result=new Promise((resolve,reject)=>{request=http.request(origin+endpoint,{method:'PUT',headers:headers({'Content-Length':Buffer.byteLength(payload)})},response=>{let text='';response.on('data',x=>text+=x);response.on('end',()=>resolve({status:response.statusCode,value:JSON.parse(text)}));});request.on('error',reject);request.on('socket',socket=>{sockets.add(socket);socket.once('close',()=>sockets.delete(socket));});request.write(payload.slice(0,1));});
    return{result,finish:()=>request.end(payload.slice(1))};
  }
  await start();
  await t.test('authentication is required before reading or changing selections',async()=>{
    assert.equal((await request(endpoint,'PUT',{serverIds:[]})).status,401);
    assert.equal((await request('/api/setup','POST',{token:setup,username:'cost_test_admin',password})).status,201);
    const workspace=await request('/api/workspace');assert.equal(workspace.status,200);
    assert.equal(workspace.value.costs.selectedCount,3);assert.equal(workspace.value.costs.invalidCostCount,1);assert.equal(workspace.value.costs.monthlyTotal,10.1);
  });
  await t.test('CSRF, origin and revision errors leave encrypted storage untouched',async()=>{
    const before=encrypted();
    for(const extra of [{'X-CSRF-Token':'invalid'},{Origin:'https://untrusted.example'},{Origin:''},{'Sec-Fetch-Site':'cross-site'}])assert.equal((await request(endpoint,'PUT',{serverIds:[]},extra)).status,403);
    for(const value of ['-1','','not-a-revision'])assert.equal((await request(endpoint,'PUT',{serverIds:[]},{'If-Match':value})).status,409);
    assert.equal(encrypted(),before);
  });
  await t.test('invalid, duplicate, oversized and unknown IDs fail atomically',async()=>{
    const before=encrypted();
    for(const serverIds of [null,{},'all',[null],[1],['bad-id'],[legacy.id,legacy.id],[randomUUID()],[legacy.id,randomUUID()],Array(1001).fill(legacy.id)]){
      assert.equal((await request(endpoint,'PUT',{serverIds})).status,400);assert.equal(encrypted(),before);
    }
    assert.equal((await request(endpoint,'PUT',{})).status,400);assert.equal(encrypted(),before);
  });
  await t.test('legacy all-selected save is a true no-op without re-encryption or timestamp edits',async()=>{
    const before=encrypted(),oldRevision=revision,stat=fs.statSync(vaultFile);
    const result=await request(endpoint,'PUT',{serverIds:[legacy.id,monthly.id,invalid.id]});
    assert.equal(result.status,200);assert.deepEqual(result.value,{revision:oldRevision,selectedCount:3,changedCount:0});
    assert.equal(encrypted(),before);assert.equal(fs.statSync(vaultFile).ino,stat.ino);assert.equal(fs.statSync(vaultFile).mtimeMs,stat.mtimeMs);
    assert.equal(Object.hasOwn(state().servers[0],'excludeFromCosts'),false);
  });
  await t.test('subset changes only exclusion and changed timestamps, ignores unrelated input',async()=>{
    const before=state(),oldRevision=revision;await delay(5);
    const result=await request(endpoint,'PUT',{serverIds:[legacy.id],expiryReminder:false,settings:{telegram:{enabled:false}},sshPassword:'DO-NOT-STORE',name:'DO-NOT-RENAME'});
    assert.equal(result.status,200);assert.deepEqual(result.value,{revision:oldRevision+1,selectedCount:1,changedCount:2});
    const after=state(),unchangedFields=server=>Object.fromEntries(Object.entries(server).filter(([field])=>!['excludeFromCosts','updatedAt'].includes(field)));
    for(const server of after.servers){const old=before.servers.find(x=>x.id===server.id);assert.deepEqual(unchangedFields(server),unchangedFields(old));if(server.id===legacy.id)assert.equal(server.updatedAt,old.updatedAt);else assert.notEqual(server.updatedAt,old.updatedAt);}
    for(const field of ['account','settings','commands'])assert.deepEqual(after[field],before[field]);
    const workspace=(await request('/api/workspace')).value;
    assert.equal(workspace.costs.monthlyTotal,10);assert.equal(workspace.costs.yearlyTotal,120);assert.equal(workspace.costs.recordedTotal,120);assert.equal(workspace.costs.manuallyExcludedCount,2);assert.equal(workspace.costs.invalidCostCount,0);
    assert.equal(fs.existsSync(mockLog),false);
  });
  await t.test('repeated selection keeps ciphertext, revision and all timestamps stable',async()=>{
    const before=encrypted(),oldRevision=revision;
    const result=await request(endpoint,'PUT',{serverIds:[legacy.id]});
    assert.equal(result.status,200);assert.deepEqual(result.value,{revision:oldRevision,selectedCount:1,changedCount:0});assert.equal(encrypted(),before);
  });
  await t.test('none and all selections are supported, including invalid-price records',async()=>{
    let result=await request(endpoint,'PUT',{serverIds:[]});assert.equal(result.status,200);assert.equal(result.value.changedCount,1);assert.equal(result.value.selectedCount,0);
    let costs=(await request('/api/workspace')).value.costs;assert.equal(costs.monthlyTotal,0);assert.equal(costs.yearlyTotal,0);assert.equal(costs.recordedTotal,0);assert.equal(costs.invalidCostCount,0);assert.equal(costs.manuallyExcludedCount,3);
    result=await request(endpoint,'PUT',{serverIds:[invalid.id,monthly.id,legacy.id]});assert.equal(result.status,200);assert.equal(result.value.changedCount,3);assert.equal(result.value.selectedCount,3);
    costs=(await request('/api/workspace')).value.costs;assert.equal(costs.monthlyTotal,10.1);assert.equal(costs.selectedCount,3);assert.equal(costs.invalidCostCount,1);
  });
  await t.test('editing an excluded host preserves its choice; new hosts still default to included',async()=>{
    assert.equal((await request(endpoint,'PUT',{serverIds:[]})).status,200);
    const result=await request('/api/servers/'+monthly.id,'PUT',{notes:'Updated synthetic note'});assert.equal(result.status,200);assert.equal(result.value.server.excludeFromCosts,true);
    assert.equal(result.value.server.expiryReminder,false);assert.equal(result.value.server.hasSecrets.panelPassword,true);
    assert.equal((await request('/api/servers/'+monthly.id,'PUT',{excludeFromCosts:'true'})).status,400);
    const created=await request('/api/servers','POST',{name:'Synthetic new cost host',...quote('0.2')});assert.equal(created.status,201);assert.equal(created.value.server.excludeFromCosts,false);
    const costs=(await request('/api/workspace')).value.costs;assert.equal(costs.selectedCount,1);assert.equal(costs.monthlyTotal,0.2);assert.equal(costs.yearlyTotal,2.4);
  });
  await t.test('stale selection cannot overwrite newer edits and deleted IDs are rejected',async()=>{
    const oldRevision=revision,added=await request('/api/servers','POST',{name:'Synthetic temporary host'});assert.equal(added.status,201);
    assert.equal((await request(endpoint,'PUT',{serverIds:[]},{'If-Match':String(oldRevision)})).status,409);
    assert.equal((await request('/api/servers/'+added.value.server.id,'DELETE')).status,200);
    const before=encrypted();assert.equal((await request(endpoint,'PUT',{serverIds:[added.value.server.id]})).status,400);assert.equal(encrypted(),before);
  });
  await t.test('session revocation while awaiting a body prevents the selection commit',async()=>{
    const before=encrypted(),pending=slowSelection([legacy.id]);await delay(75);
    assert.equal((await request('/api/logout','POST',{})).status,200);pending.finish();assert.equal((await pending.result).status,401);assert.equal(encrypted(),before);
    assert.equal((await request('/api/login','POST',{username:'cost_test_admin',password})).status,200);
  });
  await t.test('selection persists across a process restart in the same encrypted fixture',async()=>{
    const before=state(),raw=encrypted();
    for(const secret of [botToken,'SYNTHETIC-SSH-SECRET','SYNTHETIC-PROVIDER-SECRET','SYNTHETIC-PANEL-SECRET','Synthetic fractional host'])assert.ok(!raw.includes(secret));
    await stop();await start();cookie='';csrf='';
    assert.equal((await request(endpoint,'PUT',{serverIds:[]})).status,401);
    assert.equal((await request('/api/login','POST',{username:'cost_test_admin',password})).status,200);
    const workspace=(await request('/api/workspace')).value;assert.equal(workspace.revision,before.revision);assert.equal(workspace.costs.selectedCount,1);assert.equal(workspace.costs.monthlyTotal,0.2);
    assert.deepEqual(state(),before);assert.equal(encrypted(),raw);assert.equal(fs.existsSync(mockLog),false);
    for(const secret of [botToken,'SYNTHETIC-SSH-SECRET','SYNTHETIC-PANEL-SECRET'])assert.ok(!output.includes(secret));
  });
});
