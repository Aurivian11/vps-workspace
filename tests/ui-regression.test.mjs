import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {normalizeServer,normalizeCommand,redactServer} from '../lib/domain.mjs';

const source=fs.readFileSync(new URL('../public/app.js',import.meta.url),'utf8').replace(/\ninit\(\);\s*$/,'');
const clone=value=>JSON.parse(JSON.stringify(value));
function fixture(kind='server'){
  const server=normalizeServer({name:'Original server',notes:'Original note'});
  const command=normalizeCommand({title:'Original command',command:'echo original',note:'Original note'});
  const initial=kind==='server'?server:command;
  let backend={revision:1,servers:[server],commands:[command],settings:{},costs:{}};
  const requests=[];
  const app={innerHTML:''};
  const dialog={dataset:{},open:false,addEventListener(){},close(){this.open=false;},showModal(){this.open=true;}};
  const toast={classList:{add(){},remove(){}}};
  function panel(){return {innerHTML:'',scrollIntoView(){},remove(){if(this.parent?.panel===this)this.parent.panel=null;}};}
  class TestFormData{constructor(form){this.values=form.values;}get(key){return this.values[key]??null;}has(key){return Object.hasOwn(this.values,key);}}
  const context=vm.createContext({console,URL,URLSearchParams,structuredClone,FormData:TestFormData,
    setTimeout(){return 1;},clearTimeout(){},location:{hash:'',pathname:'/',search:''},history:{replaceState(){}},
    document:{querySelector(s){return s==='#app'?app:s==='#dialog'?dialog:toast;},createElement:panel,addEventListener(){}},
    crypto:{randomUUID(){return '00000000-0000-0000-0000-000000000001';}},
    fetch:async(path,opts)=>{
      if(path==='/api/workspace')return {ok:true,status:200,json:async()=>({...clone(backend),servers:backend.servers.map(redactServer)})};
      const collection=path.startsWith('/api/servers')?'servers':'commands';
      const revision=Number(opts.headers['If-Match']);
      requests.push({path,method:opts.method,revision,body:JSON.parse(opts.body)});
      if(revision!==backend.revision)return {ok:false,status:409,json:async()=>({error:'Conflict'})};
      const normalize=collection==='servers'?normalizeServer:normalizeCommand;
      if(opts.method==='POST')backend[collection].push(normalize(JSON.parse(opts.body)));
      else backend[collection][0]=normalize(JSON.parse(opts.body),backend[collection][0]);
      backend.revision++;
      return {ok:true,status:200,json:async()=>({})};
    }});
  vm.runInContext(source,context);
  context.initial=kind==='server'?redactServer(initial):clone(initial);
  context.workspace={...clone(backend),servers:backend.servers.map(redactServer)};
  vm.runInContext("S.session={authenticated:true,account:{username:'Synthetic'}};S.workspace=workspace;S.revision=1;",context);
  const values={...clone(context.initial),tagsText:'',renewalDate:''};
  for(const key of ['autoRenew','isPinned'])if(!values[key])delete values[key];
  const form={dataset:{form:kind,id:initial.id},values,panel:null,choices:{},button:{textContent:'Save'},rows:{},
    querySelector(selector){
      if(selector==='.edit-conflict')return this.panel;
      if(selector==='.dialog-body')return {prepend:p=>{this.panel=p;p.parent=this;this.choices={};}};
      if(selector==='button[type="submit"]')return this.button;
      const m=/^\[data-edit-choice="([^"]+)"\]$/.exec(selector);
      if(m)return {value:this.choices[m[1]]||''};
      return null;
    },querySelectorAll(selector){return this.rows[selector]||[];}};
  context.form=form;vm.runInContext('rememberEditor(form,form.dataset.id)',context);
  return {context,form,requests,run:code=>vm.runInContext(code,context),save:()=>vm.runInContext('saveEditor(form)',context),
    latest:()=>backend[kind==='server'?'servers':'commands'][0],
    change:patch=>{Object.assign(backend[kind==='server'?'servers':'commands'][0],patch);backend.revision++;},
    remove:()=>{backend[kind==='server'?'servers':'commands']=[];backend.revision++;},backend:()=>backend};
}
for(const kind of ['server','command']){
  const title=kind==='server'?'name':'title',note=kind==='server'?'notes':'note';
  test(`${kind}: conflict preserves draft and merges disjoint edits only after review`,async()=>{
    const f=fixture(kind);f.form.values[title]='My draft';f.change({[note]:'Other tab note'});
    assert.equal(await f.save(),false);
    assert.equal(f.form.values[title],'My draft');assert.equal(f.form.values[note],'Original note');
    assert.equal(f.run('editorStates.get(form).revision'),1);
    assert.equal(f.run('editorStates.get(form).review.revision'),2);
    assert.match(f.form.panel.innerHTML,/草稿/);
    assert.deepEqual(f.requests[0].body,{[title]:'My draft'});
    assert.equal(await f.save(),true);
    assert.equal(f.latest()[title],'My draft');assert.equal(f.latest()[note],'Other tab note');
    assert.deepEqual(f.requests.map(r=>r.revision),[1,2]);
  });
  test(`${kind}: repeated conflicts keep original version and require new explicit choices`,async()=>{
    const f=fixture(kind);f.form.values[title]='My draft';f.change({[title]:'Other tab v2'});
    assert.equal(await f.save(),false);
    await assert.rejects(f.save(),/每个冲突项/);assert.equal(f.requests.length,1);
    f.form.choices[title]='draft';f.change({[title]:'Other tab v3'});
    assert.equal(await f.save(),false);
    assert.equal(f.form.values[title],'My draft');assert.equal(f.run('editorStates.get(form).revision'),1);
    assert.equal(f.run('editorStates.get(form).review.revision'),3);
    assert.deepEqual(f.requests.map(r=>r.revision),[1,2]);
    await assert.rejects(f.save(),/每个冲突项/);assert.equal(f.requests.length,2);
    f.form.choices[title]='latest';assert.equal(await f.save(),true);
    assert.equal(f.latest()[title],'Other tab v3');
  });
}

test('changing a draft after review rebuilds its choices without sending it',async()=>{
  const f=fixture();f.form.values.name='Draft';f.change({notes:'New note'});await f.save();
  f.form.values.notes='My competing note';assert.equal(await f.save(),false);
  assert.equal(f.requests.length,1);assert.match(f.form.panel.innerHTML,/data-edit-choice="notes"/);
  f.form.choices.notes='draft';assert.equal(await f.save(),true);assert.equal(f.latest().notes,'My competing note');
});

test('secret and array changes require explicit choices without displaying any password',async()=>{
  const f=fixture();f.form.values.sshPassword='SYNTHETIC-secret-never-render';f.form.values.tagsText='my tag';
  f.change({notes:'Other edit',sshPassword:'SYNTHETIC-other-secret'});assert.equal(await f.save(),false);
  assert.deepEqual(clone(f.run('editorStates.get(form).review.conflicts')).sort(),['sshPassword','tags']);
  assert.ok(!f.form.panel.innerHTML.includes('SYNTHETIC-secret-never-render'));
  assert.ok(!f.form.panel.innerHTML.includes('SYNTHETIC-other-secret'));
  f.form.choices.sshPassword='latest';f.form.choices.tags='draft';assert.equal(await f.save(),true);
  assert.equal(f.latest().sshPassword,'SYNTHETIC-other-secret');assert.deepEqual(f.latest().tags,['my tag']);
  assert.ok(!Object.hasOwn(f.requests.at(-1).body,'sshPassword'));
});

test('conflict values and labels are HTML escaped',async()=>{
  const f=fixture();f.form.values.notes='<img src=x onerror=alert(1)>';f.change({notes:'<script>alert(2)</script>'});
  await f.save();const html=f.form.panel.innerHTML;
  assert.ok(html.includes('&lt;img'));assert.ok(html.includes('&lt;script&gt;'));
  assert.ok(!html.includes('<img'));assert.ok(!html.includes('<script>'));
  f.run("editLabels.notes='<img src=x onerror=alert(3)>';showEditConflict(form,editorStates.get(form),readEditor(form))");
  assert.ok(!f.form.panel.innerHTML.includes('<img'));
});

test('a deleted record keeps the draft and can be explicitly saved as a new record',async()=>{
  const f=fixture();f.form.values.name='Retained draft';f.remove();assert.equal(await f.save(),false);
  assert.equal(f.form.values.name,'Retained draft');await assert.rejects(f.save(),/另存/);
  f.run('saveDraftAsNew(form)');assert.equal(f.form.dataset.id,'');assert.equal(await f.save(),true);
  assert.equal(f.requests.at(-1).method,'POST');assert.equal(f.latest().name,'Retained draft');
});

test('renewal date and its legacy text resolve as one field',async()=>{
  const f=fixture();f.form.values.name='My name';f.form.values.renewalDate='2026-12-01';
  f.change({renewalDate:'2027-01-01T00:00:00.000Z',renewalDateText:'2027-01-01'});await f.save();
  assert.ok(f.run('editorStates.get(form).review.conflicts.includes("renewalDate")'));
  assert.ok(!f.run('editorStates.get(form).review.conflicts.includes("renewalDateText")'));
  f.form.choices.renewalDate='latest';assert.equal(await f.save(),true);
  assert.equal(f.latest().renewalDate,'2027-01-01T00:00:00.000Z');assert.equal(f.latest().renewalDateText,'2027-01-01');
});

test('calendar dates use local today and preserve stored days in both timezone directions',()=>{
  const previousTZ=process.env.TZ;
  try{
    process.env.TZ='Asia/Shanghai';const f=fixture();
    f.context.Date=class extends Date{constructor(...args){super(...(args.length?args:['2026-10-13T00:30:00+08:00']));}};
    assert.equal(f.run('dateValue(new Date())'),'2026-10-13');
    assert.match(f.run('usageEntry()'),/value="2026-10-13"/);
    assert.equal(f.run('dateValue("2026-10-13T00:00:00.000Z")'),'2026-10-13');
    process.env.TZ='America/Los_Angeles';
    assert.equal(f.run('dateValue("2026-10-13T00:00:00.000Z")'),'2026-10-13');
    assert.equal(f.run('shortDate("2026-10-13T00:00:00.000Z")'),'2026/10/13');
    assert.equal(f.run('dateValue("")'),'');assert.equal(f.run('dateValue("not-a-date")'),'');
    process.env.TZ='America/New_York';
    f.context.Date=class extends Date{constructor(...args){super(...(args.length?args:['2026-10-31T12:00:00-04:00']));}};
    assert.equal(f.run('daysLeft({renewalDate:"2026-11-02T00:00:00.000Z"})'),2);
  }finally{if(previousTZ===undefined)delete process.env.TZ;else process.env.TZ=previousTZ;}
});
