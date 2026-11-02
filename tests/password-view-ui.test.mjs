import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source=fs.readFileSync(new URL('../public/app.js',import.meta.url),'utf8').replace(/\ninit\(\);\s*$/,'');
const fields=['sshPassword','serverURLPassword','panelPassword'];
const secrets={sshPassword:'synthetic-ssh-password',serverURLPassword:'synthetic-provider-password',panelPassword:'synthetic-panel-password'};
const reply=(status,body)=>({ok:status>=200&&status<300,status,json:async()=>body});
function fixture(overrides={},field='sshPassword'){
 const requests=[],pending=[],timers=new Map(),listeners=new Map(),dialogListeners=new Map();let timerId=0;
 const app={innerHTML:''},toast={textContent:'',classList:{add(){},remove(){}}};
 const dialog={dataset:{},open:false,html:'',shell:null,rows:new Map(),cards:new Map(),
  get innerHTML(){return this.html;},set innerHTML(html){
   for(const row of this.rows.values())row.isConnected=false;
   this.html=html;this.shell=html?{}:null;this.rows=new Map();this.cards=new Map();const shell=this.shell;
   for(const match of html.matchAll(/<section class="credential-card">[\s\S]*?<\/section>/g)){
    const card=match[0],field=/data-secret-field="([^"]+)"/.exec(card)?.[1];if(!field)continue;
    const value={textContent:/data-secret-value>([^<]*)</.exec(card)?.[1]||'',set innerHTML(_){throw new Error('Passwords must never be inserted as HTML');}};
    const row={dataset:{secretField:field},isConnected:true,value,button:null,querySelector:s=>s==='[data-secret-value]'?value:s==='[data-action="secrets"]'?row.button:null};
    if(card.includes('data-action="secrets"'))row.button={dataset:{secret:field},disabled:false,textContent:'查看',attributes:{'aria-pressed':'false'},setAttribute(name,value){this.attributes[name]=value;},closest:s=>s==='.dialog-shell'?shell:s==='.credential-secret'?row:null};
    this.rows.set(field,row);this.cards.set(field,card);
   }
  },
  querySelector(s){return s==='.dialog-shell'?this.shell:s==='.dialog-head>div'?{insertAdjacentHTML(){}}:null;},
  addEventListener(name,fn){dialogListeners.set(name,fn);},
  close(){this.open=false;dialogListeners.get('close')?.();},showModal(){this.open=true;}};
 const document={hidden:false,title:'',querySelector:s=>s==='#app'?app:s==='#dialog'?dialog:toast,addEventListener:(name,fn)=>{const previous=listeners.get(name);listeners.set(name,previous?event=>{previous(event);return fn(event);}:fn);}};
 const serverSeed={id:'server-one',name:'Test server',status:'online',tags:[],domains:[],usages:[],username:'ssh-user',ipAddress:'192.0.2.10',sshPort:22,serverURL:'https://provider.example/',serverURLUsername:'provider-user',panelURL:'https://panel.example/',panelUsername:'panel-user',hasSecrets:Object.fromEntries(fields.map(field=>[field,true])),...overrides};
 const context=vm.createContext({console,URL,URLSearchParams,structuredClone,document,serverSeed,
  setTimeout(fn,ms){const id=++timerId;timers.set(id,{fn,ms});return id;},clearTimeout(id){timers.delete(id);},
  location:{hash:'',pathname:'/',search:''},history:{replaceState(){}},
  fetch(path,options){requests.push({path,options});if(path==='/api/session')return Promise.resolve(reply(200,{authenticated:false}));return new Promise(resolve=>pending.push({path,resolve}));}});
 vm.runInContext(source,context);
 const run=code=>vm.runInContext(code,context);
 run("S.session={authenticated:true,csrfToken:'synthetic-csrf',account:{username:'Test',totpEnabled:true}};S.workspace={servers:[structuredClone(serverSeed)],commands:[],settings:{},costs:{}};S.revision=1;");
 run(`detailServer('server-one','overview',${JSON.stringify(field)});`);
 return {run,requests,pending,timers,dialog,document,app,toast,listeners,
  row:(field='sshPassword')=>dialog.rows.get(field),
   select(field){return run(`detailServer('server-one','overview',${JSON.stringify(field)});`);},
  click(field='sshPassword'){context.button=dialog.rows.get(field)?.button;return run("handleAction('secrets','server-one',button)");},
  resolve(status=200,body=secrets,path='/api/servers/server-one/secrets'){const index=pending.findIndex(p=>p.path===path);assert.ok(index>=0,'expected pending request');pending.splice(index,1)[0].resolve(reply(status,body));},
  visibility(hidden){document.hidden=hidden;listeners.get('visibilitychange')();},
  navigate(page){return listeners.get('click')({target:{closest:s=>s==='[data-nav]'?{dataset:{nav:page}}:null}});}};
}
function assertMasked(row){assert.equal(row.value.textContent,'••••••••');assert.notEqual(row.dataset.revealed,'true');assert.equal(row.button.textContent,'查看');assert.equal(row.button.attributes['aria-pressed'],'false');}

// The three accounts stay paired with their own masked password in the detail view.
test('each account card pairs its username and address with the matching password field',()=>{
 const f=fixture();
 for(const [field,title,user,address] of [
  ['sshPassword','SSH 连接','ssh-user','192.0.2.10'],
  ['serverURLPassword','服务商控制台','provider-user','provider.example'],
  ['panelPassword','管理面板','panel-user','panel.example']
 ]){
  f.select(field);const card=f.dialog.cards.get(field);assert.ok(card.includes(title));assert.ok(card.includes(user));assert.ok(card.includes(address));assert.ok(card.includes(`data-secret="${field}"`));assertMasked(f.row(field));
  for(const other of fields.filter(other=>other!==field))assert.ok(!card.includes(`data-secret="${other}"`));
 }
 assert.doesNotMatch(f.dialog.innerHTML,/密码资料|验证身份后|name="password"|name="otp"/);
});

test('missing passwords have no reveal button and absent optional accounts are omitted',()=>{
 const f=fixture({hasSecrets:{},serverURL:'',serverURLUsername:'',panelURL:'',panelUsername:''});
 assert.deepEqual([...f.dialog.rows.keys()],['sshPassword']);assert.equal(f.row().button,null);assert.equal(f.row().value.textContent,'未保存');
});

for(const field of fields){
 test(`${field} reveals only its own account password and keeps workspace secrets absent`,async()=>{
  const f=fixture({},field),row=f.row(field),original=f.run('JSON.stringify(S.workspace)'),shell=f.dialog.shell,opening=f.click(field);f.resolve();await opening;
  assert.equal(row.value.textContent,secrets[field]);assert.equal(row.dataset.revealed,'true');assert.equal(row.button.textContent,'隐藏');assert.equal(row.button.attributes['aria-pressed'],'true');
  assert.equal(f.dialog.rows.size,1);for(const other of fields.filter(other=>other!==field))assert.equal(f.row(other),undefined);
  assert.equal(f.dialog.shell,shell);assert.equal(f.dialog.open,true);assert.equal(f.run('JSON.stringify(S.workspace)'),original);assert.equal(f.run('credentialTimers.size'),1);
 });
}

test('direct reveal posts no credentials, prevents duplicate clicks and inserts plain text',async()=>{
 const f=fixture(),row=f.row(),button=row.button,opening=f.click();assert.equal(button.disabled,true);await f.click();assert.equal(f.requests.length,1);
 const {path,options}=f.requests[0];assert.equal(path,'/api/servers/server-one/secrets');assert.equal(options.method,'POST');assert.equal(options.body,'{}');assert.equal(options.headers['X-CSRF-Token'],'synthetic-csrf');assert.equal(options.credentials,'same-origin');assert.equal(options.cache,'no-store');
 const password='<img src=x onerror=alert(1)> & "quoted"';f.resolve(200,{...secrets,sshPassword:password});await opening;
 assert.equal(button.disabled,false);assert.equal(row.value.textContent,password);assert.doesNotMatch(f.dialog.innerHTML,/<img|name="password"|name="otp"/);assert.equal(f.row('serverURLPassword'),undefined);
});

test('manual hide and sixty-second auto-hide clear the selected account password',async()=>{
 const f=fixture(),ssh=f.row();let opening=f.click();f.resolve();await opening;assert.equal(f.run('credentialTimers.size'),1);await f.click();assertMasked(ssh);assert.equal(f.run('credentialTimers.size'),0);
 f.select('panelPassword');opening=f.click('panelPassword');f.resolve();await opening;assertMasked(ssh);assert.equal(f.row('panelPassword').value.textContent,secrets.panelPassword);assert.equal(f.requests.length,2);assert.equal(f.run('credentialTimers.size'),1);
 const autoHide=[...f.timers.values()].filter(t=>t.ms===60000);assert.equal(autoHide.length,1);autoHide[0].fn();assertMasked(f.row('panelPassword'));assert.equal(f.run('credentialTimers.size'),0);assert.equal(f.dialog.open,true);
});

for(const [name,change] of [
 ['closed dialog',f=>f.run('closeDialog()')],
 ['native dialog close',f=>f.dialog.close()],
 ['replacement dialog',f=>f.run("showDialog('Another dialog','','<p>Other contents</p>')")],
 ['hidden tab',f=>f.visibility(true)],
 ['navigation',f=>f.navigate('servers')],
 ['workspace render',f=>f.run('render()')],
 ['login render',f=>f.run('renderAuth()')],
 ['another account tab',f=>f.select('panelPassword')],
 ['another detail tab',f=>f.run("detailServer('server-one','billing')")]
]){
 test(`visible passwords and timers are cleared on ${name}`,async()=>{
  const f=fixture(),row=f.row(),opening=f.click();f.resolve();await opening;await change(f);
  assertMasked(row);assert.equal(f.run('credentialTimers.size'),0);assert.equal([...f.timers.values()].filter(t=>t.ms===60000).length,0);
 });
}

for(const [name,change] of [
 ['closed dialog',f=>f.run('closeDialog()')],
 ['replacement dialog',f=>f.run("showDialog('Another dialog','','<p>Other contents</p>')")],
 ['logged-out session',f=>f.run('S.session=null')],
 ['replacement session',f=>f.run("S.session={authenticated:true,csrfToken:'new-session'}")],
 ['changed CSRF token',f=>f.run("S.session.csrfToken='new-csrf'")],
 ['hidden tab before response',f=>f.visibility(true)],
 ['hidden and restored tab before response',f=>{f.visibility(true);f.visibility(false);}],
 ['navigation away and back',async f=>{await f.navigate('servers');await f.navigate('overview');}],
 ['workspace render',f=>f.run('render()')],
 ['login render',f=>f.run('renderAuth()')],
 ['another account tab',f=>f.select('panelPassword')],
 ['another detail tab',f=>f.run("detailServer('server-one','billing')")],
 ['detached password row',f=>{f.row().isConnected=false;}],
 ['another account tab',f=>f.select('panelPassword')],
 ['another detail tab',f=>f.run("detailServer('server-one','billing')")]
]){
 test(`late password response is discarded after ${name}`,async()=>{
  const f=fixture(),row=f.row(),opening=f.click();await change(f);f.resolve(200,{sshPassword:'must-not-be-shown'});await opening;
  assertMasked(row);assert.doesNotMatch(f.dialog.innerHTML,/must-not-be-shown/);assert.equal(f.run('credentialTimers.size'),0);assert.equal(row.button.disabled,false);
 });
}

test('logout intent immediately clears visible passwords and invalidates pending views',async()=>{
 const shown=fixture(),visible=shown.row(),reveal=shown.click();shown.resolve();await reveal;const firstLogout=shown.run("handleAction('logout')");assertMasked(visible);assert.equal(shown.run('credentialTimers.size'),0);shown.resolve(200,{},'/api/logout');await firstLogout;
 const f=fixture(),pending=f.row(),opening=f.click(),logout=f.run("handleAction('logout')");f.resolve(200,{sshPassword:'must-not-be-shown'});await opening;assertMasked(pending);
 f.resolve(200,{},'/api/logout');await logout;assert.equal(f.dialog.open,false);assert.equal(f.dialog.innerHTML,'');assert.equal(f.run('credentialTimers.size'),0);
});

test('expired-session response clears the workspace and returns to login',async()=>{
 const f=fixture(),opening=f.click();f.resolve(401,{error:'Session expired'});await assert.rejects(opening,/Session expired/);
 assert.equal(f.dialog.open,false);assert.equal(f.dialog.innerHTML,'');assert.equal(f.run('S.session.authenticated'),false);assert.equal(f.run('S.workspace.servers.length'),0);assert.match(f.app.innerHTML,/data-form="login"/);assert.equal(f.requests.at(-1).path,'/api/session');
});

test('a failed password request restores its button and can be retried',async()=>{
 const f=fixture(),row=f.row(),opening=f.click();f.resolve(503,{error:'Try later'});await assert.rejects(opening,/Try later/);assert.equal(row.button.disabled,false);assert.equal(f.dialog.open,true);assertMasked(row);
 const retry=f.click();f.resolve();await retry;assert.equal(row.value.textContent,secrets.sshPassword);
});

test('unknown or mismatched fields cannot request a password',async()=>{
 const f=fixture(),row=f.row();row.button.dataset.secret='unknown';await f.click();row.button.dataset.secret='panelPassword';await f.click();assert.equal(f.requests.length,0);assertMasked(row);
});

test('backup and account security operations still request administrator credentials',()=>{
 const f=fixture();
 for(const kind of ['backup','totp-start','totp-disable']){f.run(`securityDialog('${kind}')`);assert.match(f.dialog.innerHTML,/name="password"/);assert.match(f.dialog.innerHTML,/name="otp"/);}
 f.run("securityDialog('password-change')");assert.match(f.dialog.innerHTML,/name="currentPassword"/);assert.match(f.dialog.innerHTML,/name="otp"/);
});
