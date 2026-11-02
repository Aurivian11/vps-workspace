import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {normalizeServer,redactServer} from '../lib/domain.mjs';
const source=fs.readFileSync(new URL('../public/app.js',import.meta.url),'utf8').replace(/\ninit\(\);\s*$/,'');
const clone=x=>JSON.parse(JSON.stringify(x));
const decode=s=>String(s||'').replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&amp;/g,'&');
const seed=[{name:'Alpha One',provider:'ciallo',ipAddress:'192.0.2.1',status:'online',monthlyCostAmount:'10',monthlyCostCurrency:'CNY',monthlyCostCycle:'monthly',excludeFromCosts:true,expiryReminder:true,sshPassword:'FAKE-ORIGINAL-SECRET',renewalDate:'2030-01-01T00:00:00.000Z'},{name:'Alpha Two',provider:'ciallo',ipAddress:'192.0.2.2',status:'idle',monthlyCostAmount:'20',monthlyCostCurrency:'CNY',monthlyCostCycle:'monthly'},{name:'Beta',provider:'ciallo plus',ipAddress:'192.0.2.3',status:'online'},{name:'Unassigned',provider:''}];
function fixture(records=seed){
 const backend={revision:1,servers:records.map(s=>normalizeServer(s)),commands:[],settings:{telegram:{enabled:false}},costs:{monthlyTotal:20,yearlyTotal:240,recordedTotal:20},customMonthly:{serverIds:[],monthlyTotal:0,selectedCount:0,rows:[]}};
 backend.customMonthly.serverIds=[backend.servers[0]?.id].filter(Boolean);
 const requests=[],listeners={},app={innerHTML:''},results={innerHTML:''},toast={classList:{add(){},remove(){}}};
 const form={dataset:{form:'server',id:''},values:{},button:{textContent:'Save'},querySelector(sel){return sel==='button[type="submit"]'?this.button:null;},querySelectorAll(){return [];}};
 const dialog={dataset:{},innerHTML:'',open:false,addEventListener(){},close(){this.open=false;},querySelector(sel){return sel==='form'?form:null;},showModal(){
  this.open=true;form.dataset.form=this.dataset.kind;form.dataset.id=decode(this.innerHTML.match(/class="dialog-shell"[^>]*data-id="([^"]*)"/)?.[1]);form.values={};
  for(const m of this.innerHTML.matchAll(/<input\b([^>]*)>/g)){const a=m[1],name=a.match(/\bname="([^"]*)"/)?.[1];if(!name||(/type="checkbox"/.test(a)&&!(/\bchecked\b/.test(a))))continue;form.values[name]=decode(a.match(/\bvalue="([^"]*)"/)?.[1]||'');}
  for(const m of this.innerHTML.matchAll(/<select\b[^>]*name="([^"]*)"[^>]*>([\s\S]*?)<\/select>/g)){const options=[...m[2].matchAll(/<option\b([^>]*)>/g)],chosen=options.find(o=>/\bselected\b/.test(o[1]))||options[0];form.values[m[1]]=decode(chosen?.[1].match(/value="([^"]*)"/)?.[1]);}
  for(const m of this.innerHTML.matchAll(/<textarea\b[^>]*name="([^"]*)"[^>]*>([\s\S]*?)<\/textarea>/g))form.values[m[1]]=decode(m[2]);
 }};
 class TestFormData{constructor(f){this.values=f.values;}get(k){return this.values[k]??null;}has(k){return Object.hasOwn(this.values,k);}}
 const context=vm.createContext({window:{scrollTo(){}},console,URL,URLSearchParams,structuredClone,FormData:TestFormData,setTimeout(){return 1;},clearTimeout(){},location:{hash:'',pathname:'/',search:''},history:{replaceState(){}},crypto:{randomUUID:()=> 'synthetic-id'},document:{querySelector(sel){return sel==='#app'?app:sel==='#dialog'?dialog:sel==='#results'?results:toast;},addEventListener(name,fn){listeners[name]=fn;}},fetch:async(path,opts)=>{
  if(path==='/api/workspace')return {ok:true,status:200,json:async()=>({...clone(backend),servers:backend.servers.map(redactServer)})};
  const body=JSON.parse(opts.body),revision=Number(opts.headers['If-Match']);requests.push({path,method:opts.method,body,revision,headers:opts.headers});
  if(path.startsWith('/api/servers')){if(revision!==backend.revision)return {ok:false,status:409,json:async()=>({error:'Conflict'})};if(opts.method==='POST')backend.servers.push(normalizeServer(body));else{const i=backend.servers.findIndex(s=>path.endsWith('/'+s.id));backend.servers[i]=normalizeServer(body,backend.servers[i]);}backend.revision++;}
  return {ok:true,status:200,json:async()=>({revision:backend.revision})};
 }});
 vm.runInContext(source,context);context.workspace={...clone(backend),servers:backend.servers.map(redactServer)};context.form=form;
 const run=code=>vm.runInContext(code,context);run("S.session={authenticated:true,account:{username:'Test'},csrfToken:'test-csrf'};S.workspace=workspace;S.revision=1;S.page='providers';S.provider=null;");
 return {run,context,backend,form,dialog,requests,listeners,app,results};
}
const json=(f,code)=>JSON.parse(f.run('JSON.stringify('+code+')'));

test('same provider records group together without merging substring names or unassigned records',()=>{
 const f=fixture(),groups=json(f,'providerGroups()');assert.equal(groups.length,3);const a=groups.find(g=>g.name==='ciallo');assert.equal(a.servers.length,2);assert.deepEqual(a.servers.map(s=>s.name),['Alpha One','Alpha Two']);assert.equal(groups.find(g=>g.name==='ciallo plus').servers.length,1);assert.equal(groups.find(g=>g.name==='').servers.length,1);assert.equal(f.requests.length,0);
});
test('provider page and server page expose discoverable group navigation',()=>{const f=fixture();assert.ok(f.run("navItems.some(n=>n[0]==='providers')"));assert.match(f.run('providersPage()'),/data-action="provider-open"/);assert.match(f.run('serversPage()'),/按服务商查看/);assert.match(f.run('serverResults()'),/data-action="provider-open"[^>]*data-id="ciallo"/);});
test('opening a group resets filters, closes any detail and shows only matching machines',async()=>{
 const f=fixture();f.run("S.query='old filter';S.status='idle';dialog.open=true");await f.run("handleAction('provider-open','ciallo',{})");assert.equal(f.run('S.page'),'providers');assert.equal(f.run('S.provider'),'ciallo');assert.equal(f.run('S.query'),'');assert.equal(f.run('S.status'),'');assert.equal(f.dialog.open,false);assert.deepEqual(json(f,'filteredServers().map(s=>s.name)'),['Alpha One','Alpha Two']);assert.match(f.app.innerHTML,/添加该商家机器/);assert.ok(!f.run('serverResults()').includes('Beta'));assert.equal(f.requests.length,0);
});
test('provider filters compose within group for table and cards',async()=>{
 const f=fixture();await f.run("handleAction('provider-open','ciallo',{})");f.run("S.query='192.0.2.2';S.status='idle'");assert.deepEqual(json(f,'filteredServers().map(s=>s.name)'),['Alpha Two']);assert.ok(!f.run('serverResults()').includes('Alpha One'));f.run("S.view='cards'");assert.match(f.run('serverResults()'),/server-card/);assert.ok(!f.run('serverResults()').includes('Beta'));f.run("S.query='Beta';S.status=''");assert.equal(f.run('filteredServers().length'),0);
});
test('new machine from provider prefills only provider and preserves distinct record data',async()=>{
 const f=fixture(seed.slice(0,1)),original=clone(f.backend.servers),custom=clone(f.backend.customMonthly),costs=clone(f.backend.costs);await f.run("handleAction('provider-open','ciallo',{})");await f.run("handleAction('provider-server-new',undefined,{})");
 assert.equal(f.form.dataset.id,'');assert.equal(f.form.values.provider,'ciallo');assert.equal(f.form.values.name,'');assert.equal(f.form.values.ipAddress,'');assert.equal(f.form.values.sshPassword,'');assert.equal(f.form.values.renewalDate,'');assert.ok(!f.dialog.innerHTML.includes('FAKE-ORIGINAL-SECRET'));assert.equal(f.run('editorStates.get(form).record'),null);
 Object.assign(f.form.values,{name:'Second independent machine',ipAddress:'192.0.2.99',sshPassword:'FAKE-SECOND-SECRET',monthlyCostAmount:'8',renewalDate:'2031-05-06'});assert.equal(await f.run('saveEditor(form)'),true);assert.equal(f.requests.length,1);assert.equal(f.requests[0].method,'POST');assert.equal(f.requests[0].path,'/api/servers');assert.equal(f.requests[0].headers['X-CSRF-Token'],'test-csrf');assert.equal(f.requests[0].revision,1);assert.equal(f.backend.servers.length,2);assert.deepEqual(f.backend.servers[0],original[0]);assert.notEqual(f.backend.servers[1].id,original[0].id);assert.equal(f.backend.servers[1].provider,'ciallo');assert.equal(f.backend.servers[1].sshPassword,'FAKE-SECOND-SECRET');assert.equal(f.backend.servers[1].monthlyCostAmount,'8');assert.equal(f.backend.servers[1].expiryReminder,false);assert.deepEqual(f.backend.customMonthly,custom);assert.deepEqual(f.backend.costs,costs);assert.equal(f.run('S.provider'),'ciallo');assert.equal(f.run('filteredServers().length'),2);
});
test('existing machine provider can be changed without moving sibling or losing passwords',async()=>{
 const f=fixture(),before=clone(f.backend.servers);f.context.id=before[1].id;await f.run("handleAction('provider-open','ciallo',{})");f.run('editServer(id)');f.form.values.provider='Another merchant';assert.equal(await f.run('saveEditor(form)'),true);assert.deepEqual(f.requests[0].body,{provider:'Another merchant'});assert.deepEqual(f.backend.servers[0],before[0]);assert.equal(f.backend.servers[1].provider,'Another merchant');assert.equal(f.backend.servers[1].id,before[1].id);assert.equal(f.run('filteredServers().length'),1);assert.equal(json(f,'providerGroups()').find(g=>g.name==='Another merchant').servers.length,1);
});
test('unassigned provider is a real group distinct from provider index',async()=>{const f=fixture();await f.run("handleAction('provider-open','',{})");assert.equal(f.run('S.provider'),'');assert.deepEqual(json(f,'filteredServers().map(s=>s.name)'),['Unassigned']);await f.run("handleAction('provider-server-new',undefined,{})");assert.equal(f.form.values.provider,'');await f.run("handleAction('provider-back',undefined,{})");assert.equal(f.run('S.provider'),null);assert.match(f.app.innerHTML,/ciallo/);});
test('provider navigation and refresh do not mutate financial or reminder choices',async()=>{
 const f=fixture(),before=clone(f.backend);await f.run("handleAction('provider-open','ciallo',{})");await f.run("handleAction('refresh',undefined,{})");assert.equal(f.run('S.provider'),'ciallo');assert.deepEqual(json(f,'filteredServers().map(s=>s.name)'),['Alpha One','Alpha Two']);await f.run("handleAction('provider-back',undefined,{})");assert.deepEqual(f.backend,before);assert.equal(f.requests.length,0);
});
test('provider names are HTML-escaped in group titles, action IDs and editor defaults',async()=>{
 const provider='A"><img src=x onerror=alert(1)> & \'quote\'',f=fixture([{name:'<script>bad()</script>',provider,sshPassword:'FAKE-SECRET'}]);f.context.provider=provider;const html=f.run('providersPage()');assert.ok(html.includes('&lt;img'));assert.ok(!html.includes('<img'));assert.ok(!html.includes('<script>'));assert.ok(!html.includes('FAKE-SECRET'));await f.run("handleAction('provider-open',provider,{})");assert.equal(f.run('S.provider'),provider);assert.equal(f.run('filteredServers().length'),1);assert.ok(!f.app.innerHTML.includes('<img'));await f.run("handleAction('provider-server-new',undefined,{})");assert.equal(f.form.values.provider,provider);assert.ok(!f.dialog.innerHTML.includes('<img'));
});
test('group index search finds machine IP and name but selected group search remains isolated',()=>{
 const f=fixture();f.run("S.query='192.0.2.2'");let html=f.run('providerResults()');assert.match(html,/data-id="ciallo"/);assert.ok(!html.includes('data-id="ciallo plus"'));f.run("S.query='Beta'");html=f.run('providerResults()');assert.match(html,/data-id="ciallo plus"/);assert.ok(!html.includes('data-id="ciallo"'));f.run("S.query='no such machine'");assert.ok(!f.run('providerResults()').includes('class="provider-card"'));
});
test('search input dispatches provider index results and scoped machine results',()=>{
 const f=fixture();f.listeners.input({target:{id:'search',value:'Beta'}});assert.match(f.results.innerHTML,/data-id="ciallo plus"/);f.run("S.provider='ciallo'");f.listeners.input({target:{id:'search',value:'Alpha One'}});assert.match(f.results.innerHTML,/Alpha One/);assert.ok(!f.results.innerHTML.includes('Alpha Two'));assert.ok(!f.results.innerHTML.includes('Beta'));
});
test('trimmed provider grouping keeps exact casing and does not merge near names',()=>{
 const f=fixture([{name:'One',provider:' ciallo '},{name:'Two',provider:'ciallo'},{name:'Three',provider:'Ciallo'},{name:'Four',provider:'ciallo plus'}]);assert.equal(f.run("providerKey({provider:' ciallo '})"),'ciallo');const groups=json(f,'providerGroups()');assert.equal(groups.find(g=>g.name==='ciallo').servers.length,2);assert.equal(groups.length,3);
});
test('missing or deleted provider group remains safe with add entry instead of showing all machines',async()=>{const f=fixture();await f.run("handleAction('provider-open','Deleted merchant',{})");assert.equal(f.run('filteredServers().length'),0);assert.ok(!f.run('serverResults()').includes('Alpha One'));assert.match(f.run('providersPage()'),/添加该商家机器/);});
