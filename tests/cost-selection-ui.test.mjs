import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync(new URL('../public/app.js',import.meta.url),'utf8').replace(/\ninit\(\);\s*$/,'');
const clone=value=>JSON.parse(JSON.stringify(value));
const servers=[{id:'a',name:'Tokyo',provider:'A',monthlyCostAmount:10,monthlyCostCurrency:'USD',expiryReminder:true},{id:'b',name:'London',provider:'B',monthlyCostAmount:12,excludeFromCosts:true,expiryReminder:false},{id:'c',name:'Sydney',provider:'C',monthlyCostAmount:null,expiryReminder:true}];
function fixture(records=servers){
 const backend={revision:1,servers:clone(records),commands:[],settings:{telegram:{enabled:true}},costs:{invalidCostCount:1,excludedCount:2}};
 const requests=[],listeners={},dialogListeners={},app={innerHTML:''},toast={classList:{add(){},remove(){}}};
 let gate=null,selectionError=null,workspaceError=false;
 const controls={disabled:false},count={textContent:''},feedback={hidden:true,innerHTML:'',scrollIntoView(){}},error={textContent:'',isConnected:true,scrollIntoView(){}};
 const form={dataset:{form:'cost-servers',revision:'1',id:''},values:{},boxes:[],button:{type:'submit',disabled:false},cancel:{type:'button',disabled:false},reload:{type:'button',disabled:false},controls,count,feedback,error,
  setAttribute(){},matches:s=>s==='form[data-form]',
  querySelector(sel){return sel==='.cost-selection-controls'?controls:sel==='[data-cost-selection-count]'?count:sel==='.cost-selection-feedback'?feedback:sel==='button[type="submit"]'?this.button:sel==='.form-error'?error:null;},
  querySelectorAll(sel){return sel==='input[name="costServerIds"]'?this.boxes:sel.includes('dialog-close')?[this.button,this.cancel,this.reload]:[];}};
 const dialog={innerHTML:'',dataset:{},open:false,addEventListener(name,fn){dialogListeners[name]=fn;},close(){this.open=false;},showModal(){this.open=true;if(this.dataset.kind==='cost-servers'){form.boxes=[...this.innerHTML.matchAll(/<input type="checkbox" name="costServerIds" value="([^"]*)"([^>]*)>/g)].map(m=>({value:m[1],checked:m[2].includes('checked')}));}},querySelector(sel){return sel==='form'?form:null;}};
 class TestFormData{constructor(f){this.values=f.values;}get(k){return this.values[k]??null;}has(k){return Object.hasOwn(this.values,k);}}
 const context=vm.createContext({console,URL,URLSearchParams,structuredClone,FormData:TestFormData,Number,
  setTimeout(){return 1;},clearTimeout(){},location:{hash:'',pathname:'/',search:''},history:{replaceState(){}},crypto:{randomUUID:()=> 'synthetic-id'},
  document:{querySelector(sel){return sel==='#app'?app:sel==='#dialog'?dialog:toast;},addEventListener(name,fn){const previous=listeners[name];listeners[name]=previous?event=>{previous(event);return fn(event);}:fn;}},
  fetch:async(path,opts)=>{
   if(path==='/api/workspace'){if(workspaceError)throw new Error('Refresh unavailable');return {ok:true,status:200,json:async()=>clone(backend)};}
   const revision=Number(opts.headers['If-Match']),body=JSON.parse(opts.body);requests.push({path,method:opts.method,headers:opts.headers,revision,body});
   if(path==='/api/settings/costs/servers'){
    if(gate)await gate;if(selectionError)throw selectionError;
    if(revision!==backend.revision)return {ok:false,status:409,json:async()=>({error:'Conflict'})};
    for(const server of backend.servers)server.excludeFromCosts=!body.serverIds.includes(server.id);
    backend.revision++;return {ok:true,status:200,json:async()=>({revision:backend.revision,selectedCount:body.serverIds.length,changedCount:1})};
   }
   if(path.startsWith('/api/servers')){if(opts.method==='POST')backend.servers.push({...body,id:'created'});else Object.assign(backend.servers.find(s=>path.endsWith('/'+s.id)),body);backend.revision++;return {ok:true,status:200,json:async()=>({revision:backend.revision})};}
   return {ok:true,status:200,json:async()=>({ok:true})};
  }});
 vm.runInContext(source,context);context.workspace=clone(backend);context.form=form;
 const run=code=>vm.runInContext(code,context);
 run("S.session={authenticated:true,account:{username:'Test'},csrfToken:'test-csrf'};S.workspace=workspace;S.revision=1;costSelectionDialog();");
 return {run,context,backend,form,dialog,requests,listeners,dialogListeners,app,setGate:value=>{gate=value;},setSelectionError:value=>{selectionError=value;},setWorkspaceError:value=>{workspaceError=value;}};
}

test('overview and settings expose compact controls and distinguish invalid bills from excluded servers',()=>{
 const f=fixture(),html=f.run('finance()');assert.match(html,/data-action="cost-servers"/);assert.match(html,/已选 2 \/ 3 台/);assert.match(html,/手动排除 1 台/);assert.match(html,/其中 1 台账单信息不完整/);assert.ok(!html.includes('name="costServerIds"'));assert.ok(!html.includes('所有服务器'));assert.match(f.run('settingsPage()'),/参与统计的服务器/);
 f.run('S.workspace.costs.invalidCostCount=0');assert.ok(!f.run('finance()').includes('账单信息不完整'));
});

test('legacy and new machines default to included while explicitly excluded machines are unchecked',()=>{
 const f=fixture();assert.deepEqual(f.form.boxes.map(b=>b.checked),[true,false,true]);assert.match(f.dialog.innerHTML,/USD 10.00/);assert.match(f.dialog.innerHTML,/未记录价格/);assert.match(f.dialog.innerHTML,/到期提醒保持不变/);assert.equal(f.requests.length,0);
 const empty=fixture([]);assert.match(empty.dialog.innerHTML,/暂无服务器/);assert.match(empty.dialog.innerHTML,/type="submit" disabled/);
});

test('all, none, individual changes and cancel do not persist',()=>{
 const f=fixture();f.run('selectCostServers(form,true)');assert.ok(f.form.boxes.every(b=>b.checked));assert.match(f.form.count.textContent,/已选 3/);f.run('selectCostServers(form,false)');assert.ok(f.form.boxes.every(b=>!b.checked));assert.match(f.form.count.textContent,/已选 0/);
 f.form.boxes[1].checked=true;f.listeners.change({target:{matches:s=>s.includes('costServerIds'),closest:()=>f.form}});assert.match(f.form.count.textContent,/已选 1/);f.run('closeDialog()');assert.equal(f.dialog.open,false);assert.equal(f.requests.length,0);assert.deepEqual(f.backend.servers,servers);
});

test('save sends only selected IDs with the opening revision and CSRF then refreshes costs',async()=>{
 const f=fixture();f.form.boxes[0].checked=false;f.form.boxes[1].checked=true;f.run('S.revision=99');await f.run('handleSubmit(form)');
 assert.equal(f.requests.length,1);assert.equal(f.requests[0].path,'/api/settings/costs/servers');assert.equal(f.requests[0].method,'PUT');assert.equal(f.requests[0].revision,1);assert.equal(f.requests[0].headers['X-CSRF-Token'],'test-csrf');assert.deepEqual(f.requests[0].body,{serverIds:['b','c']});assert.deepEqual(f.backend.servers.map(s=>s.excludeFromCosts),[true,false,false]);assert.deepEqual(f.backend.servers.map(s=>s.expiryReminder),[true,false,true]);assert.equal(f.run('S.revision'),2);assert.equal(f.dialog.open,false);
});

test('saving no selected machines sends an empty array',async()=>{const f=fixture();f.run('selectCostServers(form,false)');await f.run('saveCostSelection(form)');assert.deepEqual(f.requests[0].body,{serverIds:[]});assert.ok(f.backend.servers.every(s=>s.excludeFromCosts));});

test('409 keeps the exact draft and cannot overwrite until explicit reload of new choices',async()=>{
 const f=fixture();f.form.boxes[1].checked=true;f.backend.revision=2;f.backend.servers=[{id:'latest',name:'New record',excludeFromCosts:false}];
 assert.equal(await f.run('saveCostSelection(form)'),false);assert.deepEqual(f.form.boxes.map(b=>b.checked),[true,true,true]);assert.equal(f.form.controls.disabled,true);assert.equal(f.form.button.disabled,true);assert.equal(f.form.feedback.hidden,false);assert.match(f.form.feedback.innerHTML,/重新加载会替换/);assert.equal(f.run('costSelectionState(form).revision'),1);await assert.rejects(f.run('saveCostSelection(form)'),/先重新加载/);assert.equal(f.requests.length,1);
 f.run('selectCostServers(form,false)');assert.ok(f.form.boxes.every(b=>b.checked));await f.run('reloadCostSelection(form)');assert.equal(f.run('costSelectionState(form).revision'),2);assert.deepEqual(f.form.boxes,[{value:'latest',checked:true}]);assert.equal(f.requests.length,1);await f.run('saveCostSelection(form)');assert.equal(f.requests[1].revision,2);
});

test('a pending request prevents close, Escape, selection changes and duplicate submit',async()=>{
 const f=fixture();let release;f.setGate(new Promise(resolve=>release=resolve));const pending=f.run('saveCostSelection(form)');assert.equal(f.form.controls.disabled,true);assert.equal(f.form.cancel.disabled,true);assert.equal(f.form.button.disabled,true);assert.equal(f.run('closeDialog()'),false);let prevented=false;f.dialogListeners.cancel({preventDefault(){prevented=true;}});assert.ok(prevented);assert.equal(f.dialog.open,true);f.run('selectCostServers(form,false)');assert.deepEqual(f.form.boxes.map(b=>b.checked),[true,false,true]);assert.equal(await f.run('saveCostSelection(form)'),false);assert.equal(f.requests.length,1);release();assert.equal(await pending,true);assert.equal(f.run('costSelectionState(form).busy'),false);
});

test('unknown network outcome preserves draft and requires reloading actual saved state',async()=>{
 const f=fixture();f.setSelectionError(new Error('Network unavailable'));assert.equal(await f.run('saveCostSelection(form)'),false);assert.deepEqual(f.form.boxes.map(b=>b.checked),[true,false,true]);assert.match(f.form.feedback.innerHTML,/暂时无法确认保存结果/);assert.equal(f.form.controls.disabled,true);await assert.rejects(f.run('saveCostSelection(form)'),/先重新加载/);assert.equal(f.requests.length,1);f.setSelectionError(null);await f.run('reloadCostSelection(form)');assert.equal(f.run('costSelectionState(form).conflicted'),false);assert.equal(await f.run('saveCostSelection(form)'),true);
});

test('confirmed server error unlocks editable selection for a retry',async()=>{
 const f=fixture(),error=new Error('Temporary server failure');error.status=503;f.setSelectionError(error);await assert.rejects(f.run('saveCostSelection(form)'),/Temporary/);assert.equal(f.form.controls.disabled,false);assert.equal(f.form.button.disabled,false);assert.deepEqual(f.form.boxes.map(b=>b.checked),[true,false,true]);f.setSelectionError(null);assert.equal(await f.run('saveCostSelection(form)'),true);
});

test('successful save followed by failed refresh never resubmits and offers a refresh-only recovery',async()=>{
 const f=fixture();f.setWorkspaceError(true);assert.equal(await f.run('saveCostSelection(form)'),true);assert.match(f.form.feedback.innerHTML,/选择已保存/);assert.match(f.form.feedback.innerHTML,/重新加载统计结果/);assert.equal(f.form.button.disabled,true);assert.equal(f.form.cancel.disabled,false);await assert.rejects(f.run('saveCostSelection(form)'),/选择已经保存/);assert.equal(f.requests.length,1);f.setWorkspaceError(false);await f.run('reloadCostSelection(form)');assert.equal(f.requests.length,1);assert.equal(f.dialog.open,false);assert.equal(f.run('S.revision'),2);
});

test('failed conflict reload keeps draft and captured revision recoverable',async()=>{
 const f=fixture();f.backend.revision=2;await f.run('saveCostSelection(form)');f.setWorkspaceError(true);await assert.rejects(f.run('reloadCostSelection(form)'),/Refresh unavailable/);assert.equal(f.run('costSelectionState(form).revision'),1);assert.equal(f.form.cancel.disabled,false);assert.deepEqual(f.form.boxes.map(b=>b.checked),[true,false,true]);f.setWorkspaceError(false);await f.run('reloadCostSelection(form)');assert.equal(f.run('costSelectionState(form).revision'),2);
});

test('new and existing editor flags serialize participation and retain excluded state in unrelated edits',async()=>{
 const f=fixture();f.form.dataset={form:'server',id:'b'};f.form.values={costParticipationPresent:'1',name:'London'};assert.equal(f.run('readEditor(form).excludeFromCosts'),true);f.run('rememberEditor(form,"b")');f.form.values.name='London renamed';await f.run('saveEditor(form)');assert.ok(!Object.hasOwn(f.requests[0].body,'excludeFromCosts'));assert.equal(f.backend.servers[1].excludeFromCosts,true);
 f.form.values.includeInCosts='on';assert.equal(f.run('readEditor(form).excludeFromCosts'),false);assert.equal(f.run('editLabels.excludeFromCosts'),'费用统计');assert.deepEqual(clone(f.run('conflictingFields({excludeFromCosts:false},{excludeFromCosts:true},{excludeFromCosts:false})')),['excludeFromCosts']);
 const n=fixture();n.form.dataset={form:'server',id:''};n.form.values={costParticipationPresent:'1',includeInCosts:'on',name:'New machine'};n.run('rememberEditor(form,"")');assert.equal(n.run('readEditor(form).excludeFromCosts'),false);await n.run('saveEditor(form)');assert.equal(n.requests[0].body.excludeFromCosts,false);
 n.run('editServer()');assert.match(n.dialog.innerHTML,/name="includeInCosts" checked/);n.run('editServer("b")');assert.ok(!/name="includeInCosts" checked/.test(n.dialog.innerHTML));
});

test('untrusted machine content is escaped and credentials are not rendered',()=>{
 const f=fixture([{id:'x',name:'<img src=x>',provider:'<script>bad()</script>',monthlyCostAmount:10,sshPassword:'SYNTHETIC-secret'}]);assert.ok(!f.dialog.innerHTML.includes('<img'));assert.ok(!f.dialog.innerHTML.includes('<script>bad'));assert.match(f.dialog.innerHTML,/&lt;img/);assert.ok(!f.dialog.innerHTML.includes('SYNTHETIC-secret'));
});

test('late selection completion cannot replace a different active dialog or session',async()=>{
 const f=fixture();let release;f.setGate(new Promise(resolve=>release=resolve));const pending=f.run('saveCostSelection(form)');f.run('S.session={authenticated:true,csrfToken:"replacement"}');release();assert.equal(await pending,false);assert.equal(f.app.innerHTML,'');assert.equal(f.dialog.open,false);
});

test('cost participation conflict previews use human-readable labels for inverse and legacy flags',()=>{const f=fixture();assert.equal(f.run("editValueText('excludeFromCosts',true)"),'不参与统计');assert.equal(f.run("editValueText('excludeFromCosts',false)"),'参与统计');assert.equal(f.run("editValueText('excludeFromCosts',undefined)"),'参与统计');assert.equal(f.run("editValueText('name','Tokyo')"),'Tokyo');});
