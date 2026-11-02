import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source=fs.readFileSync(new URL('../public/app.js',import.meta.url),'utf8').replace(/\ninit\(\);\s*$/,'');
const fields=['sshPassword','serverURLPassword','panelPassword'];
const secrets={sshPassword:'synthetic-ssh-password',serverURLPassword:'synthetic-provider-password',panelPassword:'synthetic-panel-password'};
const reply=(status,body)=>({ok:status>=200&&status<300,status,json:async()=>body});
function fixture(options={}){
 const requests=[],pending=[],writes=[],writeCalls=[],timers=new Map(),listeners=new Map(),dialogListeners=new Map();let timerId=0;
 const app={innerHTML:''},toast={textContent:'',classList:{add(){},remove(){}}};
 const selected=[];
 const selection={removeAllRanges(){selected.length=0;},addRange(range){selected.push(range.node);}};
 const dialog={dataset:{},open:false,html:'',shell:null,rows:new Map(),cards:new Map(),
  get innerHTML(){return this.html;},set innerHTML(html){
   for(const row of this.rows.values())row.isConnected=false;
   this.html=html;this.shell=html?{}:null;this.rows=new Map();this.cards=new Map();const shell=this.shell;
   for(const match of html.matchAll(/<section class="credential-card">[\s\S]*?<\/section>/g)){
    const card=match[0],field=/data-secret-field="([^"]+)"/.exec(card)?.[1];if(!field)continue;
    const value={textContent:/data-secret-value>([^<]*)</.exec(card)?.[1]||'',set innerHTML(_){throw new Error('Passwords must never be inserted as HTML');}};
    const row={dataset:{secretField:field},isConnected:true,value,button:null,copyButton:null,querySelector:s=>s==='[data-secret-value]'?value:s==='[data-action="secrets"]'?row.button:s==='[data-action="secret-copy"]'?row.copyButton:null};
    const button=(action,label)=>({dataset:{action,secret:field,id:'server-one'},disabled:false,textContent:label,attributes:{'aria-pressed':'false'},setAttribute(name,value){this.attributes[name]=value;},removeAttribute(name){delete this.attributes[name];},closest:s=>s==='.dialog-shell'?shell:s==='.credential-secret'?row:null});
    if(card.includes('data-action="secrets"'))row.button=button('secrets','查看');
    if(card.includes('data-action="secret-copy"'))row.copyButton=button('secret-copy','复制');
    this.rows.set(field,row);this.cards.set(field,card);
   }
  },
  querySelector(s){return s==='.dialog-shell'?this.shell:s==='.dialog-head>div'?{insertAdjacentHTML(){}}:null;},
  addEventListener(name,fn){dialogListeners.set(name,fn);},
  close(){this.open=false;dialogListeners.get('close')?.();},showModal(){this.open=true;}};
 const document={hidden:false,title:'',querySelector:s=>s==='#app'?app:s==='#dialog'?dialog:toast,addEventListener:(name,fn)=>{const previous=listeners.get(name);listeners.set(name,previous?event=>{previous(event);return fn(event);}:fn);},getSelection:()=>selection,createRange:()=>({selectNodeContents(node){this.node=node;}}),createElement(){throw new Error('Password copy must not create a persistent fallback input');}};
 const serverSeed={id:'server-one',name:'Test server',status:'online',tags:[],domains:[],usages:[],username:'ssh-user',ipAddress:'192.0.2.10',sshPort:22,serverURL:'https://provider.example/',serverURLUsername:'provider-user',panelURL:'https://panel.example/',panelUsername:'panel-user',hasSecrets:Object.fromEntries(fields.map(field=>[field,true])),...options.server};
 const clipboardState={reject:!!options.rejectClipboard};
 const clipboard=options.clipboard==='none'?undefined:{
  async writeText(text){writeCalls.push({type:'text',text});if(clipboardState.reject)throw new Error('Clipboard permission denied');writes.push(text);},
  ...(options.clipboard==='item'?{async write(items){writeCalls.push({type:'item',items});if(clipboardState.reject)throw new Error('Clipboard permission denied');for(const item of items){const blob=await item.data['text/plain'];writes.push(await blob.text());}}}:{})
 };
 const storage={setItem(){throw new Error('Password must not be persisted in browser storage');},getItem(){return null;},removeItem(){}};
 const context=vm.createContext({console,URL,URLSearchParams,structuredClone,document,serverSeed,Blob,DOMException,navigator:{clipboard},window:{getSelection:()=>selection},getSelection:()=>selection,localStorage:storage,sessionStorage:storage,
  ...(options.clipboard==='item'?{ClipboardItem:class ClipboardItem{constructor(data){this.data=data;}}}:{}),
  setTimeout(fn,ms){const id=++timerId;timers.set(id,{fn,ms});return id;},clearTimeout(id){timers.delete(id);},
  location:{hash:'',pathname:'/',search:''},history:{replaceState(){}},
  fetch(path,options){requests.push({path,options});if(path==='/api/session')return Promise.resolve(reply(200,{authenticated:false}));return new Promise(resolve=>pending.push({path,resolve}));}});
 vm.runInContext(source,context);
 const run=code=>vm.runInContext(code,context);
 run("S.session={authenticated:true,csrfToken:'synthetic-csrf',account:{username:'Test',totpEnabled:true}};S.workspace={servers:[structuredClone(serverSeed)],commands:[],settings:{},costs:{}};S.revision=1;");
 run(`detailServer('server-one','overview',${JSON.stringify(options.field||'sshPassword')});`);
 return {run,requests,pending,timers,dialog,document,app,toast,listeners,writes,writeCalls,selected,clipboardState,
  row:(field='sshPassword')=>dialog.rows.get(field),
   select(field){return run(`detailServer('server-one','overview',${JSON.stringify(field)});`);},
  click(field='sshPassword'){context.button=dialog.rows.get(field)?.copyButton;return run("handleAction('secret-copy','server-one',button)");},
  resolve(status=200,body=secrets,path='/api/servers/server-one/secrets',offset=0){const matches=pending.map((p,i)=>p.path===path?i:-1).filter(i=>i>=0);assert.ok(matches.length>offset,'expected pending request');pending.splice(matches[offset],1)[0].resolve(reply(status,body));},
  visibility(hidden){document.hidden=hidden;listeners.get('visibilitychange')();},
  navigate(page){return listeners.get('click')({target:{closest:s=>s==='[data-nav]'?{dataset:{nav:page}}:null}});}};
}
function assertMasked(row){assert.equal(row.value.textContent,'••••••••');assert.notEqual(row.dataset.revealed,'true');assert.equal(row.button.textContent,'查看');assert.equal(row.button.attributes['aria-pressed'],'false');}
function assertNoSecretPersistence(f,original,passwords=Object.values(secrets)){
 assert.equal(f.run('JSON.stringify(S.workspace)'),original);
 for(const password of passwords){assert.ok(!f.dialog.innerHTML.includes(password));for(const row of f.dialog.rows.values()){assert.ok(!JSON.stringify(row.dataset).includes(password));assert.ok(!JSON.stringify(row.copyButton?.dataset).includes(password));assert.ok(!JSON.stringify(row.button?.dataset).includes(password));}}
}

for(const field of fields){
 test(`${field} can be copied directly from its matching masked account without revealing`,async()=>{
  const f=fixture({field}),row=f.row(field),original=f.run('JSON.stringify(S.workspace)');assert.ok(row.copyButton);assert.equal(row.copyButton.dataset.secret,field);
  const opening=f.click(field);f.resolve();await opening;assert.deepEqual(f.writes,[secrets[field]]);assert.equal(row.copyButton.disabled,false);
  assertMasked(row);assert.equal(f.dialog.rows.size,1);for(const other of fields.filter(other=>other!==field))assert.equal(f.row(other),undefined);assert.equal(f.run('credentialTimers.size'),0);assertNoSecretPersistence(f,original);assert.match(f.toast.textContent,/复制/);
 });
}

test('direct copy preserves whitespace, newlines and HTML-looking characters exactly',async()=>{
 const f=fixture(),original=f.run('JSON.stringify(S.workspace)'),password='  <img src=x onerror=alert(1)> & "quoted"\nsecond line\t  ',opening=f.click();
 f.resolve(200,{...secrets,sshPassword:password});await opening;assert.deepEqual(f.writes,[password]);assertMasked(f.row());assertNoSecretPersistence(f,original,[password]);
});

test('direct copy posts no administrator credentials and rejects duplicate clicks while pending',async()=>{
 const f=fixture(),row=f.row(),opening=f.click();assert.equal(row.copyButton.disabled,true);await f.click();assert.equal(f.requests.length,1);
 const {path,options}=f.requests[0];assert.equal(path,'/api/servers/server-one/secrets');assert.equal(options.method,'POST');assert.equal(options.body,'{}');assert.equal(options.headers['X-CSRF-Token'],'synthetic-csrf');assert.equal(options.credentials,'same-origin');assert.equal(options.cache,'no-store');
 f.resolve();await opening;assert.equal(row.copyButton.disabled,false);assert.deepEqual(f.writes,[secrets.sshPassword]);
 const retry=f.click();f.resolve();await retry;assert.equal(f.writes.length,2);
});

test('missing passwords do not offer a copy button',()=>{
 const f=fixture({server:{hasSecrets:{}}});for(const field of fields){f.select(field);assert.equal(f.row(field).copyButton,null);assert.equal(f.row(field).value.textContent,'未保存');}
});

test('unknown or mismatched fields cannot request or copy passwords',async()=>{
 const f=fixture(),row=f.row();assert.ok(row.copyButton);row.copyButton.dataset.secret='unknown';await f.click();row.copyButton.dataset.secret='panelPassword';await f.click();assert.equal(f.requests.length,0);assert.deepEqual(f.writes,[]);assertMasked(row);
});

for(const [name,change] of [
 ['closed dialog',f=>f.run('closeDialog()')],
 ['native dialog close',f=>f.dialog.close()],
 ['replacement dialog',f=>f.run("showDialog('Another dialog','','<p>Other contents</p>')")],
 ['logged-out session',f=>f.run('S.session=null')],
 ['replacement session',f=>f.run("S.session={authenticated:true,csrfToken:'new-session'}")],
 ['changed CSRF token',f=>f.run("S.session.csrfToken='new-csrf'")],
 ['hidden tab before response',f=>f.visibility(true)],
 ['hidden and restored tab before response',f=>{f.visibility(true);f.visibility(false);}],
 ['navigation away and back',async f=>{await f.navigate('servers');await f.navigate('overview');}],
 ['workspace render',f=>f.run('render()')],
 ['login render',f=>f.run('renderAuth()')],
 ['detached password row',f=>{f.row().isConnected=false;}],
  ['another account tab',f=>f.select('panelPassword')],
  ['another detail tab',f=>f.run("detailServer('server-one','billing')")]
]){
 test(`late copy response is discarded after ${name}`,async()=>{
  const f=fixture(),row=f.row(),opening=f.click();await change(f);f.resolve();await opening;
  assert.deepEqual(f.writes,[]);assertMasked(row);assert.equal(f.run('credentialTimers.size'),0);assert.equal(row.copyButton.disabled,false);
 });
}

test('a later copy on another account tab supersedes an earlier unresolved copy',async()=>{
 const f=fixture(),firstRow=f.row(),first=f.click();f.select('panelPassword');const secondRow=f.row('panelPassword'),second=f.click('panelPassword');f.resolve(200,secrets,'/api/servers/server-one/secrets',1);await second;f.resolve();await first;
 assert.deepEqual(f.writes,[secrets.panelPassword]);assertMasked(firstRow);assertMasked(secondRow);assert.equal(firstRow.copyButton.disabled,false);assert.equal(secondRow.copyButton.disabled,false);
});

test('logout intent invalidates a pending copy immediately',async()=>{
 const f=fixture(),row=f.row(),opening=f.click(),logout=f.run("handleAction('logout')");f.resolve();await opening;assert.deepEqual(f.writes,[]);assertMasked(row);
 f.resolve(200,{},'/api/logout');await logout;assert.equal(f.dialog.open,false);assert.equal(f.dialog.innerHTML,'');
});

for(const status of [403,503]){
 test(`HTTP ${status} never copies or reveals and allows retry`,async()=>{
  const f=fixture(),row=f.row(),opening=f.click();f.resolve(status,{error:'Synthetic request failed'});await assert.rejects(opening,/Synthetic request failed/);assert.deepEqual(f.writes,[]);assertMasked(row);assert.equal(row.copyButton.disabled,false);
  const retry=f.click();f.resolve();await retry;assert.deepEqual(f.writes,[secrets.sshPassword]);
 });
}

test('HTTP 401 clears the expired session without copying or revealing',async()=>{
 const f=fixture(),opening=f.click();f.resolve(401,{error:'Session expired'});await opening;assert.deepEqual(f.writes,[]);assert.equal(f.dialog.open,false);assert.equal(f.dialog.innerHTML,'');assert.equal(f.run('S.session.authenticated'),false);assert.equal(f.run('S.workspace.servers.length'),0);assert.match(f.app.innerHTML,/data-form="login"/);
});

for(const value of ['',null,undefined]){
 test(`empty or missing password ${String(value)} is not copied`,async()=>{
  const f=fixture(),row=f.row(),opening=f.click();f.resolve(200,{sshPassword:value});await assert.rejects(opening);assert.deepEqual(f.writes,[]);assertMasked(row);assert.equal(row.copyButton.disabled,false);
 });
}

test('ClipboardItem write starts synchronously before password retrieval resolves',async()=>{
 const f=fixture({clipboard:'item'}),opening=f.click();assert.equal(f.writeCalls.length,1);assert.equal(f.writeCalls[0].type,'item');assert.equal(typeof f.writeCalls[0].items[0].data['text/plain'].then,'function');assert.deepEqual(f.writes,[]);
 f.resolve();await opening;assert.deepEqual(f.writes,[secrets.sshPassword]);assertMasked(f.row());assert.equal(f.run('credentialTimers.size'),0);
});

for(const [name,change] of [
 ['dialog close',f=>f.run('closeDialog()')],
 ['hidden then restored tab',f=>{f.visibility(true);f.visibility(false);}],
 ['session replacement',f=>f.run("S.session={authenticated:true,csrfToken:'new-session'}")]
]){
 test(`pending ClipboardItem cannot receive plaintext after ${name}`,async()=>{
  const f=fixture({clipboard:'item'}),row=f.row(),opening=f.click();await change(f);f.resolve();await opening;assert.deepEqual(f.writes,[]);assertMasked(row);assert.equal(row.copyButton.disabled,false);
 });
}

for(const clipboard of ['text','item','none']){
 test(`${clipboard} clipboard failure reveals only corresponding account for manual copy and clears after sixty seconds`,async()=>{
  const f=fixture({clipboard,rejectClipboard:true,field:'panelPassword'}),row=f.row('panelPassword'),original=f.run('JSON.stringify(S.workspace)'),opening=f.click('panelPassword');f.resolve();await opening;
  assert.deepEqual(f.writes,[]);assert.equal(row.value.textContent,secrets.panelPassword);assert.equal(row.dataset.revealed,'true');assert.equal(row.button.textContent,'隐藏');assert.deepEqual(f.selected,[row.value]);assert.equal(f.dialog.rows.size,1);assert.equal(f.row(),undefined);assert.equal(f.row('serverURLPassword'),undefined);assert.match(f.toast.textContent,/手动/);assert.equal(row.copyButton.disabled,false);assertNoSecretPersistence(f,original);
  const timers=[...f.timers.values()].filter(t=>t.ms===60000);assert.equal(timers.length,1);timers[0].fn();assertMasked(row);assert.equal(f.run('credentialTimers.size'),0);
 });
}

test('clipboard denial can be retried without reauthentication',async()=>{
 const f=fixture({rejectClipboard:true}),opening=f.click();f.resolve();await opening;f.clipboardState.reject=false;const retry=f.click();f.resolve();await retry;assert.deepEqual(f.writes,[secrets.sshPassword]);assert.equal(f.row().copyButton.disabled,false);assert.equal(f.requests.length,2);
});

for(const [name,change] of [['close',f=>f.run('closeDialog()')],['background',f=>f.visibility(true)]]){
 test(`manual-copy fallback is cleared on ${name}`,async()=>{
  const f=fixture({rejectClipboard:true}),row=f.row(),opening=f.click();f.resolve();await opening;assert.equal(row.value.textContent,secrets.sshPassword);await change(f);assertMasked(row);assert.equal(f.run('credentialTimers.size'),0);
 });
}
