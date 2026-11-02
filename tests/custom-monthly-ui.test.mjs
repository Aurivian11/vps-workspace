import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync(new URL('../public/app.js',import.meta.url),'utf8').replace(/\ninit\(\);\s*$/,'');
const clone=value=>JSON.parse(JSON.stringify(value));
const servers=[{id:'a',name:'Tokyo',provider:'A',monthlyCostAmount:10,monthlyCostCurrency:'USD',expiryReminder:true},{id:'b',name:'London',provider:'B',monthlyCostAmount:12,excludeFromCosts:true,expiryReminder:false},{id:'c',name:'Sydney',provider:'C',monthlyCostAmount:null,expiryReminder:true}];
function fixture(records=servers,ids=[]){
 const backend={revision:1,servers:clone(records),commands:[],settings:{telegram:{enabled:true}},costs:{monthlyTotal:99,invalidCostCount:1,excludedCount:2},customMonthly:{serverIds:clone(ids),monthlyTotal:12,selectedCount:ids.length,includedCount:ids.length,invalidCostCount:0,rows:ids.map(id=>({id,monthlyTotal:12}))}};
 const requests=[],listeners={},dialogListeners={},app={innerHTML:''},toast={classList:{add(){},remove(){}}};
 let gate=null,selectionError=null,workspaceError=false;
 const controls={disabled:false},count={textContent:''},feedback={hidden:true,innerHTML:'',scrollIntoView(){}},error={textContent:'',isConnected:true,scrollIntoView(){}};
 const form={dataset:{form:'custom-monthly-servers',revision:'1',id:''},values:{},boxes:[],button:{type:'submit',disabled:false},cancel:{type:'button',disabled:false},reload:{type:'button',disabled:false},controls,count,feedback,error,
  setAttribute(){},matches:s=>s==='form[data-form]',
  querySelector(sel){return sel==='.cost-selection-controls'?controls:sel==='[data-cost-selection-count]'?count:sel==='.cost-selection-feedback'?feedback:sel==='button[type="submit"]'?this.button:sel==='.form-error'?error:null;},
  querySelectorAll(sel){return sel==='input[name="customMonthlyServerIds"]'?this.boxes:sel.includes('dialog-close')?[this.button,this.cancel,this.reload]:[];}};
 const dialog={innerHTML:'',dataset:{},open:false,addEventListener(name,fn){dialogListeners[name]=fn;},close(){this.open=false;},showModal(){this.open=true;if(this.dataset.kind==='custom-monthly-servers'){form.boxes=[...this.innerHTML.matchAll(/<input type="checkbox" name="customMonthlyServerIds" value="([^"]*)"([^>]*)>/g)].map(m=>({value:m[1],checked:m[2].includes('checked')}));}},querySelector(sel){return sel==='form'?form:sel==='.dialog-head>div'?{insertAdjacentHTML(){}}:null;}};
 class TestFormData{constructor(f){this.values=f.values;}get(k){return this.values[k]??null;}has(k){return Object.hasOwn(this.values,k);}}
 const context=vm.createContext({console,URL,URLSearchParams,structuredClone,FormData:TestFormData,Number,
  setTimeout(){return 1;},clearTimeout(){},location:{hash:'',pathname:'/',search:''},history:{replaceState(){}},crypto:{randomUUID:()=> 'synthetic-id'},
  document:{querySelector(sel){return sel==='#app'?app:sel==='#dialog'?dialog:toast;},addEventListener(name,fn){const previous=listeners[name];listeners[name]=previous?event=>{previous(event);return fn(event);}:fn;}},
  fetch:async(path,opts)=>{
   if(path==='/api/workspace'){if(workspaceError)throw new Error('Refresh unavailable');return {ok:true,status:200,json:async()=>clone(backend)};}
   const revision=Number(opts.headers['If-Match']),body=JSON.parse(opts.body);requests.push({path,method:opts.method,headers:opts.headers,revision,body});
   if(path==='/api/settings/custom-monthly/servers'){
    if(gate)await gate;if(selectionError)throw selectionError;
    if(revision!==backend.revision)return {ok:false,status:409,json:async()=>({error:'Conflict'})};
    backend.customMonthly.serverIds=clone(body.serverIds);backend.customMonthly.selectedCount=body.serverIds.length;
    backend.revision++;return {ok:true,status:200,json:async()=>({revision:backend.revision,selectedCount:body.serverIds.length,changedCount:1})};
   }
   if(path.startsWith('/api/servers')){if(opts.method==='POST')backend.servers.push({...body,id:'created'});else Object.assign(backend.servers.find(s=>path.endsWith('/'+s.id)),body);backend.revision++;return {ok:true,status:200,json:async()=>({revision:backend.revision})};}
   return {ok:true,status:200,json:async()=>({ok:true})};
  }});
 vm.runInContext(source,context);context.workspace=clone(backend);context.form=form;
 const run=code=>vm.runInContext(code,context);
 run("S.session={authenticated:true,account:{username:'Test'},csrfToken:'test-csrf'};S.workspace=workspace;S.revision=1;S.page='custom-monthly';customMonthlySelectionDialog();");
 return {run,context,backend,form,dialog,requests,listeners,dialogListeners,app,setGate:value=>{gate=value;},setSelectionError:value=>{selectionError=value;},setWorkspaceError:value=>{workspaceError=value;}};
}

test('default selection is empty and page has a dedicated nav and choose entry',()=>{
 const f=fixture();assert.ok(f.form.boxes.every(b=>!b.checked));const html=f.run('customMonthlyPage()');assert.match(html,/自定义月付/);assert.match(html,/先选择一组服务器/);assert.match(html,/data-action="custom-monthly-servers"/);assert.ok(!html.includes('name="customMonthlyServerIds"'));assert.ok(!html.includes('所有服务器'));assert.ok(!html.includes('data-action="cost-servers"'));assert.ok(f.run("navItems.some(n=>n[0]==='custom-monthly')"));assert.equal(f.requests.length,0);
 const empty=fixture([]);assert.match(empty.dialog.innerHTML,/暂无服务器/);assert.match(empty.dialog.innerHTML,/type="submit" disabled/);
});
test('custom selection uses its own IDs regardless of home exclusions',()=>{
 const f=fixture(servers,['b']);assert.deepEqual(f.form.boxes.map(b=>b.checked),[false,true,false]);assert.match(f.dialog.innerHTML,/USD 10.00/);assert.match(f.dialog.innerHTML,/新添加的服务器需要在这里勾选加入/);const original=clone(f.backend.servers);f.run('selectCustomMonthlyServers(form,true)');assert.ok(f.form.boxes.every(b=>b.checked));assert.deepEqual(f.backend.servers,original);f.run('S.workspace.servers[1].excludeFromCosts=false;customMonthlySelectionDialog()');assert.deepEqual(f.form.boxes.map(b=>b.checked),[false,true,false]);
});
test('page uses backend monthly amounts, keeps zero distinct from missing bills and escapes records',()=>{
 const f=fixture([{id:'a',name:'<img src=x>',provider:'<script>bad()</script>',monthlyCostAmount:'100',sshPassword:'SECRET'},{id:'b',name:'Free',monthlyCostAmount:'0'},{id:'c',name:'Unknown',monthlyCostAmount:null}],['a','b','c']);
 f.run("S.workspace.customMonthly={serverIds:['a','b','c'],monthlyTotal:7.5,selectedCount:3,includedCount:2,invalidCostCount:1,rows:[{id:'a',monthlyTotal:7.5},{id:'b',monthlyTotal:0},{id:'c',monthlyTotal:null}]}");
 const html=f.run('customMonthlyPage()');assert.match(html,/¥ 7.50/);assert.match(html,/¥ 0.00/);assert.match(html,/未计入/);assert.match(html,/信息不完整/);assert.match(html,/&lt;img/);assert.ok(!html.includes('<img'));assert.ok(!html.includes('<script>'));assert.ok(!html.includes('SECRET'));assert.match(html,/data-action="detail" data-id="a"/);
});
test('all, none, checkbox changes and cancel do not persist or alter homepage',()=>{
 const f=fixture(servers,['b']);f.run('selectCustomMonthlyServers(form,true)');assert.match(f.form.count.textContent,/已选 3/);f.run('selectCustomMonthlyServers(form,false)');assert.ok(f.form.boxes.every(b=>!b.checked));f.form.boxes[0].checked=true;f.listeners.change({target:{matches:s=>s.includes('customMonthlyServerIds'),closest:()=>f.form}});assert.match(f.form.count.textContent,/已选 1/);f.run('closeDialog()');assert.equal(f.dialog.open,false);assert.equal(f.requests.length,0);assert.deepEqual(f.backend.customMonthly.serverIds,['b']);assert.deepEqual(f.backend.servers,servers);assert.equal(f.backend.costs.monthlyTotal,99);
});
test('save uses dedicated endpoint, opening revision and CSRF while preserving home choices',async()=>{
 const f=fixture(servers,['b']);f.form.boxes[0].checked=true;f.run('S.revision=88');await f.run('handleSubmit(form)');assert.equal(f.requests.length,1);assert.equal(f.requests[0].path,'/api/settings/custom-monthly/servers');assert.equal(f.requests[0].method,'PUT');assert.equal(f.requests[0].revision,1);assert.equal(f.requests[0].headers['X-CSRF-Token'],'test-csrf');assert.deepEqual(f.requests[0].body,{serverIds:['a','b']});assert.deepEqual(f.backend.customMonthly.serverIds,['a','b']);assert.deepEqual(f.backend.servers,servers);assert.equal(f.run('S.workspace.costs.monthlyTotal'),99);assert.equal(f.dialog.open,false);
});
test('saving none is a valid independent empty selection',async()=>{const f=fixture(servers,['b']);f.run('selectCustomMonthlyServers(form,false)');await f.run('saveCustomMonthlySelection(form)');assert.deepEqual(f.requests[0].body,{serverIds:[]});assert.deepEqual(f.backend.customMonthly.serverIds,[]);assert.deepEqual(f.backend.servers,servers);});
test('409 preserves exact draft until explicit reload of current independent selection',async()=>{
 const f=fixture(servers,['b']);f.form.boxes[0].checked=true;f.backend.revision=2;f.backend.customMonthly.serverIds=['c'];assert.equal(await f.run('saveCustomMonthlySelection(form)'),false);assert.deepEqual(f.form.boxes.map(b=>b.checked),[true,true,false]);assert.equal(f.form.controls.disabled,true);assert.equal(f.form.button.disabled,true);assert.match(f.form.feedback.innerHTML,/重新加载会替换/);assert.equal(f.run('customMonthlySelectionState(form).revision'),1);await assert.rejects(f.run('saveCustomMonthlySelection(form)'),/先重新加载/);assert.equal(f.requests.length,1);await f.run('reloadCustomMonthlySelection(form)');assert.deepEqual(f.form.boxes.map(b=>b.checked),[false,false,true]);assert.equal(f.run('customMonthlySelectionState(form).revision'),2);assert.equal(f.requests.length,1);await f.run('saveCustomMonthlySelection(form)');assert.equal(f.requests[1].revision,2);assert.deepEqual(f.backend.servers,servers);
});
test('pending save blocks close, Escape, duplicate submit and selection changes',async()=>{
 const f=fixture(servers,['b']);let release;f.setGate(new Promise(r=>release=r));const pending=f.run('saveCustomMonthlySelection(form)');assert.equal(f.form.controls.disabled,true);assert.equal(f.form.cancel.disabled,true);assert.equal(f.run('closeDialog()'),false);let prevented=false;f.dialogListeners.cancel({preventDefault(){prevented=true;}});assert.ok(prevented);assert.equal(f.dialog.open,true);f.run('selectCustomMonthlyServers(form,true)');assert.deepEqual(f.form.boxes.map(b=>b.checked),[false,true,false]);assert.equal(await f.run('saveCustomMonthlySelection(form)'),false);assert.equal(f.requests.length,1);release();assert.equal(await pending,true);
});
test('unknown network outcome requires reloading actual selection before another save',async()=>{
 const f=fixture(servers,['b']);f.setSelectionError(new Error('Network unavailable'));assert.equal(await f.run('saveCustomMonthlySelection(form)'),false);assert.deepEqual(f.form.boxes.map(b=>b.checked),[false,true,false]);assert.match(f.form.feedback.innerHTML,/暂时无法确认保存结果/);assert.equal(f.form.button.disabled,true);await assert.rejects(f.run('saveCustomMonthlySelection(form)'),/先重新加载/);f.setSelectionError(null);await f.run('reloadCustomMonthlySelection(form)');assert.equal(f.run('customMonthlySelectionState(form).conflicted'),false);assert.equal(await f.run('saveCustomMonthlySelection(form)'),true);
});
test('confirmed server error keeps selection editable and retryable',async()=>{const f=fixture(servers,['b']),error=new Error('Temporary failure');error.status=503;f.setSelectionError(error);await assert.rejects(f.run('saveCustomMonthlySelection(form)'),/Temporary/);assert.equal(f.form.controls.disabled,false);assert.equal(f.form.button.disabled,false);f.setSelectionError(null);assert.equal(await f.run('saveCustomMonthlySelection(form)'),true);});
test('successful save and failed refresh offer reload-only recovery without duplicate write',async()=>{
 const f=fixture(servers,['b']);f.setWorkspaceError(true);assert.equal(await f.run('saveCustomMonthlySelection(form)'),true);assert.match(f.form.feedback.innerHTML,/选择已保存/);assert.equal(f.form.button.disabled,true);assert.equal(f.form.cancel.disabled,false);await assert.rejects(f.run('saveCustomMonthlySelection(form)'),/选择已经保存/);assert.equal(f.requests.length,1);f.setWorkspaceError(false);await f.run('reloadCustomMonthlySelection(form)');assert.equal(f.requests.length,1);assert.equal(f.dialog.open,false);assert.equal(f.run('S.revision'),2);
});
test('failed conflict reload retains draft and revision for another attempt',async()=>{const f=fixture(servers,['b']);f.backend.revision=2;await f.run('saveCustomMonthlySelection(form)');f.setWorkspaceError(true);await assert.rejects(f.run('reloadCustomMonthlySelection(form)'),/Refresh unavailable/);assert.equal(f.run('customMonthlySelectionState(form).revision'),1);assert.deepEqual(f.form.boxes.map(b=>b.checked),[false,true,false]);f.setWorkspaceError(false);await f.run('reloadCustomMonthlySelection(form)');assert.equal(f.run('customMonthlySelectionState(form).revision'),2);});
for(const [label,change] of [['new session',"S.session={authenticated:true,csrfToken:'new'}"],['another page',"S.page='settings'"],['closed dialog','dialog.close()']]){
 test('late completion cannot replace data or redraw after '+label,async()=>{
  const f=fixture(servers,['b']);let release;f.setGate(new Promise(r=>release=r));const oldWorkspace=f.run('JSON.stringify(S.workspace)'),pending=f.run('saveCustomMonthlySelection(form)');f.run(change);release();assert.equal(await pending,false);assert.equal(f.run('JSON.stringify(S.workspace)'),oldWorkspace);assert.equal(f.app.innerHTML,'');
 });
}
test('late workspace refresh is scoped to the original session and dialog',async()=>{
 const f=fixture(servers,['b']);let resolve;f.context.pendingRead=new Promise(r=>resolve=r);f.run("api=async()=>await pendingRead");const before=f.run('JSON.stringify(S.workspace)'),pending=f.run('loadCustomMonthlyWorkspace(form,customMonthlySelectionState(form))');f.run("S.session={authenticated:true,csrfToken:'replacement'}");resolve({revision:999,servers:[{id:'other-session'}]});assert.equal(await pending,false);assert.equal(f.run('JSON.stringify(S.workspace)'),before);
});
test('home financial scope remains explicitly named inside server editor and detail',()=>{const f=fixture(servers,['b']);f.run('editServer("b")');assert.match(f.dialog.innerHTML,/参与首页费用统计/);f.run('detailServer("b","billing")');assert.match(f.dialog.innerHTML,/首页费用统计/);assert.match(f.dialog.innerHTML,/不参与统计/);});
