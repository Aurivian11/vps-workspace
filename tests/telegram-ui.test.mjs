import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync(new URL('../public/app.js',import.meta.url),'utf8').replace(/\ninit\(\);\s*$/,'');
const clone=v=>JSON.parse(JSON.stringify(v));
function fixture(){
 let backend={revision:1,servers:[],commands:[],settings:{telegram:{enabled:false,configured:true,hasToken:true,chatId:'123'}},costs:{}};
 let requestGate=null,selectionError=null,workspaceError=false,confirmation={status:"sent",message:"确认消息已发送"},uuidCount=0;
 const requests=[],listeners={},dialogListeners={},app={innerHTML:''},toast={classList:{add(){},remove(){}}};
 function panel(){return {innerHTML:'',scrollIntoView(){},remove(){if(this.parent?.panel===this)this.parent.panel=null;}};}
 function form(kind='telegram-settings',values={}){return {dataset:{form:kind,id:''},values,panel:null,button:{textContent:'Save'},querySelector(sel){if(sel==='.telegram-conflict'||sel==='.edit-conflict')return this.panel;if(sel==='button[type="submit"]')return this.button;if(sel==='.dialog-body')return {prepend:p=>{this.panel=p;p.parent=this;}};return null;},querySelectorAll(){return [];}};}
 const current=form('telegram-settings',{chatId:'123',botToken:'',password:'synthetic-password',otp:''});
 const dialog={innerHTML:'',dataset:{},open:false,addEventListener(name,fn){dialogListeners[name]=fn;},close(){this.open=false;},showModal(){this.open=true;},querySelector(sel){return sel==='form'?current:null;}};
 class TestFormData{constructor(f){this.values=f.values;}get(k){return this.values[k]??null;}has(k){return Object.hasOwn(this.values,k);}}
 const context=vm.createContext({console,URL,URLSearchParams,structuredClone,FormData:TestFormData,Number,
  setTimeout(){return 1;},clearTimeout(){},location:{hash:'',pathname:'/',search:''},history:{replaceState(){}},
  document:{querySelector(sel){return sel==='#app'?app:sel==='#dialog'?dialog:toast;},createElement:panel,addEventListener(name,fn){const previous=listeners[name];listeners[name]=previous?event=>{previous(event);return fn(event);}:fn;}},
  crypto:{randomUUID(){return '00000000-0000-0000-0000-'+String(++uuidCount).padStart(12,'0');}},
  fetch:async(path,opts)=>{
   if(path==='/api/workspace'&&workspaceError)throw new Error('Network unavailable');
   if(path==='/api/workspace')return {ok:true,status:200,json:async()=>clone(backend)};
   const revision=Number(opts.headers['If-Match']),body=JSON.parse(opts.body);requests.push({path,revision,body});
   if(path==='/api/settings/telegram/servers'&&opts.method==='PUT'){
    if(requestGate)await requestGate;
    if(selectionError)throw selectionError;
    if(revision!==backend.revision)return {ok:false,status:409,json:async()=>({error:'Conflict'})};
    if(body.serverIds.some(id=>!backend.servers.some(s=>s.id===id)))return {ok:false,status:400,json:async()=>({error:'机器列表已变化，请重新加载'})};
    for(const server of backend.servers)server.expiryReminder=body.serverIds.includes(server.id);
    backend.revision++;
    return {ok:true,status:200,json:async()=>({revision:backend.revision,selectedCount:body.serverIds.length,confirmation:clone(confirmation)})};
   }
   if(path==='/api/settings/telegram'&&opts.method==='PUT'){
    if(revision!==backend.revision)return {ok:false,status:409,json:async()=>({error:'Conflict'})};
    Object.assign(backend.settings.telegram,{enabled:body.enabled,chatId:body.chatId});backend.revision++;
   }
   return {ok:true,status:200,json:async()=>({ok:true,retried:2})};
  }});
 vm.runInContext(source,context);context.workspace=clone(backend);context.form=current;
 vm.runInContext("S.session={authenticated:true,account:{username:'Test'},csrfToken:'test'};S.workspace=workspace;S.revision=1;telegramEditorStates.set(form,{revision:1,review:null});",context);
 return {context,form:current,dialog,requests,app,listeners,dialogListeners,setSelectionError:value=>{selectionError=value;},setWorkspaceError:value=>{workspaceError=value;},setConfirmation:value=>{confirmation=value;},setRequestGate:value=>{requestGate=value;},run:code=>vm.runInContext(code,context),backend:()=>backend,change:patch=>{Object.assign(backend.settings.telegram,patch);backend.revision++;},newForm:form};
}
test('reminder selection defaults off, serializes both on and off, and participates in editor conflicts',()=>{
 const f=fixture();f.form.dataset.form='server';
 assert.equal(f.run('readEditor(form).expiryReminder'),false);
 f.form.values.expiryReminder='on';assert.equal(f.run('readEditor(form).expiryReminder'),true);
 assert.equal(f.run('editLabels.expiryReminder'),'TG 到期提醒');
 assert.deepEqual(clone(f.run('conflictingFields({expiryReminder:true},{expiryReminder:false},{expiryReminder:true})')),['expiryReminder']);
 delete f.form.values.expiryReminder;assert.equal(f.run('readEditor(form).expiryReminder'),false);
 assert.match(f.run('reminderBadge({})'),/TG 不提醒/);
 assert.match(f.run('reminderBadge({expiryReminder:true})'),/待开启/);
 f.run('S.workspace.settings.telegram.enabled=true');
 assert.match(f.run('reminderBadge({expiryReminder:true})'),/TG 提醒已选/);
});
test('blank Bot Token is omitted and preserves the saved token; deletion is explicit',()=>{
 const f=fixture();f.form.values.enabled='on';
 const data=clone(f.run('telegramSettingsPayload(form)'));
 assert.equal(data.enabled,true);assert.equal(data.chatId,'123');assert.ok(!Object.hasOwn(data,'botToken'));assert.ok(!Object.hasOwn(data,'clearToken'));
 delete f.form.values.enabled;f.form.values.clearToken='on';
 assert.equal(f.run('telegramSettingsPayload(form).clearToken'),true);
 f.form.values.botToken=' synthetic-token ';
 assert.throws(()=>f.run('telegramSettingsPayload(form)'),/选择一种/);
 delete f.form.values.clearToken;assert.equal(f.run('telegramSettingsPayload(form).botToken'),'synthetic-token');
});
test('enabling incomplete settings is blocked without sending a request',()=>{
 const f=fixture();f.form.values.enabled='on';f.run('S.workspace.settings.telegram.hasToken=false');
 assert.throws(()=>f.run('telegramSettingsPayload(form)'),/Chat ID 和 Bot Token/);
 f.form.values.botToken='synthetic-token';f.form.values.chatId='';
 assert.throws(()=>f.run('telegramSettingsPayload(form)'),/Chat ID 和 Bot Token/);assert.equal(f.requests.length,0);
});
test('settings conflicts retain a token draft, require explicit review, and handle repeated changes',async()=>{
 const f=fixture();f.form.values.chatId='456';f.form.values.botToken='SYNTHETIC-secret-draft';f.change({chatId:'789'});
 assert.equal(await f.run('saveTelegramSettings(form)'),false);
 assert.equal(f.form.values.botToken,'SYNTHETIC-secret-draft');assert.equal(f.form.values.chatId,'456');
 assert.ok(!f.form.panel.innerHTML.includes('SYNTHETIC-secret-draft'));assert.match(f.form.panel.innerHTML,/789/);
 await assert.rejects(f.run('saveTelegramSettings(form)'),/先核对/);assert.equal(f.requests.length,1);
 f.run('reviewTelegramSettings(form)');f.change({chatId:'999'});
 assert.equal(await f.run('saveTelegramSettings(form)'),false);assert.deepEqual(f.requests.map(r=>r.revision),[1,2]);
 await assert.rejects(f.run('saveTelegramSettings(form)'),/先核对/);
 f.run('reviewTelegramSettings(form)');assert.equal(await f.run('saveTelegramSettings(form)'),true);
 assert.equal(f.backend().settings.telegram.chatId,'456');assert.deepEqual(f.requests.map(r=>r.revision),[1,2,3]);
});
test('settings UI escapes server content and never renders a stored token or account password',()=>{
 const f=fixture();f.run(`S.workspace.settings.telegram.chatId='<img src=x onerror=alert(1)>';S.workspace.settings.telegram.botToken='SYNTHETIC-stored-token';S.workspace.telegramStatus={lastError:'<script>alert(1)</script>',uncertainCount:2};`);
 const card=f.run('telegramSettingsCard()');assert.ok(!card.includes('<img'));assert.ok(!card.includes('<script>'));assert.ok(card.includes('&lt;img'));assert.ok(card.includes('&lt;script&gt;'));
 assert.ok(!card.includes('SYNTHETIC-stored-token'));assert.match(card,/上次发送结果无法确认/);
 f.run('telegramSettingsDialog()');assert.ok(!f.dialog.innerHTML.includes('SYNTHETIC-stored-token'));assert.ok(!f.dialog.innerHTML.includes('synthetic-password'));
 assert.match(f.dialog.innerHTML,/name="botToken" type="password" value=""/);assert.match(f.dialog.innerHTML,/发送 \/start/);
 f.change({chatId:'<img src=x>'});f.run('S.workspace.settings.telegram.chatId="<img src=x>";showTelegramConflict(form,telegramEditorStates.get(form))');
 assert.ok(!f.form.panel.innerHTML.includes('<img'));assert.ok(f.form.panel.innerHTML.includes('&lt;img'));
 f.run('closeDialog()');assert.equal(f.dialog.innerHTML,'');
});
test('test messages send only after explicit action and use saved configuration with reauthentication',async()=>{
 const f=fixture();f.run("telegramSendDialog('telegram-test')");assert.equal(f.requests.length,0);assert.match(f.dialog.innerHTML,/立即向你的 TG 发送一条测试消息/);
 f.form.dataset.form='telegram-test';f.form.values.botToken='UNSAVED-token';f.form.values.chatId='UNSAVED-chat';
 await f.run('handleSubmit(form)');assert.equal(f.requests.length,1);
 assert.equal(f.requests[0].path,'/api/settings/telegram/test');assert.deepEqual(f.requests[0].body,{password:'synthetic-password',otp:''});
});
test('uncertain-message retry requires deliberate duplicate-risk confirmation',async()=>{
 const f=fixture();f.run("telegramSendDialog('telegram-retry')");assert.match(f.dialog.innerHTML,/name="confirmRetry" required/);assert.equal(f.requests.length,0);
 f.form.dataset.form='telegram-retry';await assert.rejects(f.run('handleSubmit(form)'),/先检查 TG/);assert.equal(f.requests.length,0);
 f.form.values.confirmRetry='on';await f.run('handleSubmit(form)');assert.equal(f.requests[0].path,'/api/settings/telegram/retry');assert.deepEqual(f.requests[0].body,{password:'synthetic-password',otp:'',confirm:true});
});
test('reminder scheduling details and machine configuration stay visible',()=>{
 const f=fixture();f.run('S.workspace.servers=[{expiryReminder:true,renewalDate:null},{expiryReminder:false}];');
 const html=f.run('telegramSettingsCard()');assert.match(html,/提前 7 天/);assert.match(html,/09:00/);assert.match(html,/每 5 分钟/);assert.match(html,/已选择 1 台/);assert.match(html,/1 台未填写有效续费日期/);
 assert.match(html,/0–7 天/);assert.match(html,/已过期的机器不再补发/);
});
test('known failures expose manual retry even when there are no uncertain deliveries',()=>{
 const f=fixture();f.run('S.workspace.telegramStatus={failedCount:1,uncertainCount:0};');
 const html=f.run('telegramSettingsCard()');assert.match(html,/data-action="telegram-retry"/);assert.match(html,/临时错误会自动重试/);assert.match(html,/检查配置后手动重试/);assert.ok(!html.includes('后台将按计划重试'));
});

function selectionFixture(servers){
 const f=fixture();f.backend().servers=clone(servers);f.context.servers=clone(servers);
 f.run('S.workspace.servers=servers;S.page="settings";');
 const boxes=servers.map(s=>({value:s.id,checked:s.expiryReminder===true,dataset:{undated:String(!s.renewalDate)}}));
 const controls={disabled:false},count={textContent:''},conflict={hidden:true,innerHTML:'',scrollIntoView(){}},error={textContent:'',isConnected:true,scrollIntoView(){}};
 Object.assign(f.form,{button:{textContent:'确定选择',type:'submit',disabled:false},cancel:{type:'button',disabled:false},dataset:{form:'telegram-servers',revision:'1'},boxes,controls,count,conflict,error,querySelector(sel){return sel==='.telegram-selection-controls'?controls:sel==='[data-selection-count]'?count:sel==='.telegram-selection-conflict'?conflict:sel==='button[type="submit"]'?this.button:sel==='.form-error'?error:null;},querySelectorAll(sel){return sel==='input[name="serverIds"]'?boxes:sel.includes('dialog-close')?[this.button,this.cancel]:[];},matches(sel){return sel==='form[data-form]';}});
 f.run('updateTelegramSelectionCount(form)');return f;
}
const selectionServers=[{id:'a',name:'Tokyo',provider:'Provider A',expiryReminder:true,renewalDate:'2030-05-15'},{id:'b',name:'London',provider:'Provider B',expiryReminder:false,renewalDate:null},{id:'c',name:'Sydney',expiryReminder:false,renewalDate:'2030-06-15'}];

test('settings show a compact selection entry and render machines only when opened',async()=>{
 const f=selectionFixture(selectionServers);let html=f.run('telegramSettingsCard()');
 assert.match(html,/data-action="telegram-servers"/);assert.match(html,/已选择 1 台/);assert.ok(!html.includes('name="serverIds"'));assert.ok(!html.includes('Tokyo'));assert.ok(!html.includes('telegram-machine-list'));
 assert.equal(f.dialog.open,false);await f.run("handleAction('telegram-servers')");html=f.dialog.innerHTML;assert.equal(f.dialog.open,true);assert.match(html,/选择提醒机器/);assert.match(html,/确定选择/);assert.match(html,/data-action="dialog-close"/);assert.match(html,/name="serverIds" value="a"[^>]*checked/);assert.ok(!/name="serverIds" value="b"[^>]*checked/.test(html));assert.equal((html.match(/<label class="telegram-machine-row">/g)||[]).length,3);assert.match(html,/到期：2030/);assert.match(html,/未填写续费日期/);assert.match(html,/提醒总开关尚未开启/);assert.match(html,/已选择 1 台 \/ 共 3 台/);assert.equal(f.run('telegramSelectionState(form).revision'),1);assert.equal(f.requests.length,0);
});

test('selection dialog escapes content, handles configuration states and empty machines',()=>{
 const f=selectionFixture(selectionServers);f.run('S.workspace.settings.telegram.enabled=true');assert.match(f.run('telegramSelectionForm()'),/向你的 TG 发送一条确认消息/);
 f.run('S.workspace.settings.telegram.configured=false');assert.match(f.run('telegramSelectionForm()'),/提醒配置尚未完成/);
 f.context.bad={id:'"><script>alert(1)</script>',name:'<img src=x onerror=alert(1)>',provider:'<svg onload=alert(1)>'};f.run('S.workspace.servers=[bad];telegramSelectionDialog()');let html=f.dialog.innerHTML;assert.ok(!html.includes('<img'));assert.ok(!html.includes('<script>'));assert.ok(!html.includes('<svg onload'));assert.match(html,/&lt;img/);assert.match(html,/&quot;&gt;&lt;script/);
 f.run('S.workspace.servers=[];telegramSelectionDialog()');html=f.dialog.innerHTML;assert.match(html,/暂无机器/);assert.match(html,/type="submit" disabled/);assert.equal(f.requests.length,0);
});

test('select all, clear all, and a single checkbox update counts without sending messages or changing settings',async()=>{
 const f=selectionFixture(selectionServers),node={closest(){return f.form;}};f.context.node=node;
 await f.run("handleAction('telegram-select-all','',node)");assert.ok(f.form.boxes.every(b=>b.checked));assert.match(f.form.count.textContent,/已选择 3 台/);assert.match(f.form.count.textContent,/1 台未填写有效续费日期/);
 await f.run("handleAction('telegram-select-none','',node)");assert.ok(f.form.boxes.every(b=>!b.checked));assert.match(f.form.count.textContent,/已选择 0 台/);
 f.form.boxes[2].checked=true;f.listeners.change({target:{matches:()=>true,closest:()=>f.form}});assert.match(f.form.count.textContent,/已选择 1 台/);assert.equal(f.requests.length,0);assert.equal(f.backend().settings.telegram.enabled,false);
});

test('confirm saves selected IDs with an idempotency key and shows a persistent TG receipt',async()=>{
 const f=selectionFixture(selectionServers);f.form.boxes[0].checked=false;f.form.boxes[1].checked=true;f.form.boxes[2].checked=true;
 await f.run('handleSubmit(form)');assert.equal(f.requests.length,1);assert.deepEqual(f.requests[0],{path:'/api/settings/telegram/servers',revision:1,body:{serverIds:['b','c'],confirmationId:'00000000-0000-0000-0000-000000000001'}});
 assert.deepEqual(f.backend().servers.map(s=>s.expiryReminder),[false,true,true]);assert.deepEqual(f.backend().settings.telegram,{enabled:false,configured:true,hasToken:true,chatId:'123'});assert.match(f.dialog.innerHTML,/提醒选择已保存/);assert.match(f.dialog.innerHTML,/TG 确认消息已发送/);assert.match(f.dialog.innerHTML,/已选择 2 台/);assert.ok(!f.dialog.innerHTML.includes('name="serverIds"'));assert.equal(f.dialog.open,true);assert.ok(!f.app.innerHTML.includes('name="serverIds"'));
});

test('clearing the selection submits an empty array and confirming unchanged choices still sends once',async()=>{
 const f=selectionFixture(selectionServers);f.run('selectTelegramServers(form,false)');await f.run('saveTelegramSelection(form)');assert.deepEqual(f.requests[0].body.serverIds,[]);assert.ok(f.backend().servers.every(s=>!s.expiryReminder));
 const unchanged=selectionFixture(selectionServers);await unchanged.run('saveTelegramSelection(form)');assert.deepEqual(unchanged.requests[0].body.serverIds,['a']);assert.equal(unchanged.requests.length,1);assert.match(unchanged.dialog.innerHTML,/TG 确认消息已发送/);
});

test('stale selection keeps its draft until explicit reload replaces the modal with latest machines',async()=>{
 const f=selectionFixture(selectionServers);f.form.boxes[1].checked=true;f.app.innerHTML='CURRENT-PAGE';
 f.backend().servers=[{...selectionServers[0],expiryReminder:false},{id:'new',name:'New server',expiryReminder:true,renewalDate:'2031-01-01'}];f.backend().revision=2;f.run('S.revision=99');
 assert.equal(await f.run('saveTelegramSelection(form)'),false);assert.equal(f.requests[0].revision,1);assert.equal(f.app.innerHTML,'CURRENT-PAGE');assert.deepEqual(f.form.boxes.map(b=>b.checked),[true,true,false]);assert.equal(f.form.controls.disabled,true);assert.equal(f.form.conflict.hidden,false);assert.match(f.form.conflict.innerHTML,/重新加载会替换/);assert.equal(f.run('telegramSelectionState(form).revision'),1);await assert.rejects(f.run('saveTelegramSelection(form)'),/重新加载最新选择/);assert.equal(f.requests.length,1);
 f.run('selectTelegramServers(form,false)');assert.deepEqual(f.form.boxes.map(b=>b.checked),[true,true,false]);await f.run('reloadTelegramSelection(form)');assert.equal(f.requests.length,1);assert.equal(f.run('telegramSelectionState(form).revision'),2);assert.match(f.dialog.innerHTML,/name="serverIds" value="new"[^>]*checked/);assert.ok(!f.dialog.innerHTML.includes('value="b"'));assert.ok(!f.dialog.innerHTML.includes('value="c"'));assert.ok(!/name="serverIds" value="a"[^>]*checked/.test(f.dialog.innerHTML));assert.ok(!f.app.innerHTML.includes('name="serverIds"'));
});

test('pending confirmation locks controls, prevents close and Escape, and ignores duplicate submit',async()=>{
 const f=selectionFixture(selectionServers);f.run('telegramSelectionDialog()');let release;f.setRequestGate(new Promise(resolve=>release=resolve));
 const pending=f.run('saveTelegramSelection(form)');assert.equal(f.form.controls.disabled,true);assert.equal(f.form.cancel.disabled,true);assert.equal(f.form.button.disabled,true);assert.equal(f.requests.length,1);
 f.run('selectTelegramServers(form,false)');assert.equal(f.form.boxes[0].checked,true);assert.equal(await f.run('saveTelegramSelection(form)'),false);assert.equal(f.run('closeDialog()'),false);assert.equal(f.dialog.open,true);let prevented=false;f.dialogListeners.cancel({preventDefault(){prevented=true;}});assert.equal(prevented,true);assert.equal(f.dialog.open,true);assert.equal(f.requests.length,1);
 release();assert.equal(await pending,true);assert.equal(f.form.controls.disabled,false);assert.equal(f.run('telegramSelectionState(form).busy'),false);assert.equal(f.run('closeDialog()'),true);assert.equal(f.dialog.open,false);
});

test('request errors preserve checks and request ID; editing selected machines creates a fresh ID',async()=>{
 const f=selectionFixture(selectionServers);f.setSelectionError(new Error('Network unavailable'));
 await assert.rejects(f.run('saveTelegramSelection(form)'),/暂时无法确认/);const originalId=f.requests[0].body.confirmationId;assert.deepEqual(f.form.boxes.map(b=>b.checked),[true,false,false]);assert.equal(f.form.controls.disabled,false);assert.equal(f.run('telegramSelectionState(form).busy'),false);
 await assert.rejects(f.run('saveTelegramSelection(form)'),/暂时无法确认/);assert.equal(f.requests[1].body.confirmationId,originalId);f.form.boxes[1].checked=true;await assert.rejects(f.run('saveTelegramSelection(form)'),/暂时无法确认/);assert.notEqual(f.requests[2].body.confirmationId,originalId);assert.equal(f.requests.length,3);
});

test('failed, uncertain, skipped, and pending receipts distinguish saved choices from TG delivery',async()=>{
 for(const [status,phrase] of [['failed','发送失败'],['uncertain','发送结果暂时无法确认'],['skipped','没有发送确认消息'],['pending','正在处理']]){
  const f=selectionFixture(selectionServers);f.setConfirmation({status,message:'<script>synthetic unsafe response</script>'});await f.run('saveTelegramSelection(form)');assert.equal(f.requests.length,1);assert.equal(f.backend().servers[0].expiryReminder,true);assert.match(f.dialog.innerHTML,/提醒选择已保存/);assert.match(f.dialog.innerHTML,/选择已生效/);assert.ok(f.dialog.innerHTML.includes(phrase));assert.ok(f.dialog.innerHTML.includes('&lt;script&gt;'));assert.ok(!f.dialog.innerHTML.includes('<script>'));assert.ok(!f.dialog.innerHTML.includes('TG 确认消息已发送'));
 }
});

test('post-save refresh failure still reports selection and TG confirmation success',async()=>{
 const f=selectionFixture(selectionServers);f.setWorkspaceError(true);assert.equal(await f.run('saveTelegramSelection(form)'),true);assert.match(f.dialog.innerHTML,/提醒选择已保存/);assert.match(f.dialog.innerHTML,/TG 确认消息已发送/);assert.match(f.dialog.innerHTML,/资料暂未刷新成功/);assert.equal(f.requests.length,1);
});

test('actual supervisor state controls the recovery label',()=>{
 const f=fixture();assert.ok(!f.run('telegramSettingsCard()').includes('异常自动恢复'));f.run('S.workspace.telegramStatus={supervisionEnabled:true};');assert.match(f.run('telegramSettingsCard()'),/异常自动恢复/);
});
