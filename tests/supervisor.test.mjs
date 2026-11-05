import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
import {spawn} from 'node:child_process';
import https from 'node:https';
import {runSupervisor,healthyWorker,rotatingLog,processIdentity,isSameProcess,createHealthCheck} from '../bin/supervisor.mjs';
const root=resolve('.');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function until(predicate,timeout=5000){const start=Date.now();while(!predicate()){if(Date.now()-start>timeout)throw Error('Timed out waiting for test condition');await sleep(10);}}
function fixture(t,mode='normal'){
  const workspace=resolve(`runtime/supervisor-test-${randomUUID()}`);fs.mkdirSync(workspace,{mode:0o700});fs.mkdirSync(resolve(workspace,'.private'),{mode:0o700});
  const events=resolve(workspace,'events.jsonl'),script=resolve(workspace,'server.mjs');
  fs.writeFileSync(script,`import fs from 'node:fs';\nconst file=${JSON.stringify(events)};const write=event=>fs.appendFileSync(file,JSON.stringify({event,pid:process.pid,supervised:process.env.VPS_SUPERVISED})+'\\n');\nconst prior=fs.existsSync(file)?fs.readFileSync(file,'utf8'):'';write('start');\nconst hold=setInterval(()=>{},1000);\nprocess.on('SIGTERM',()=>{write('term');${mode==='ignore'?'':"setTimeout(()=>{write('exit');process.exit(0);},70);"}});\n${mode==='crash' ? "if(!prior.includes('start'))setTimeout(()=>{write('crash');process.exit(7);},50);" : ''}\n`,{mode:0o600});
  const read=()=>fs.existsSync(events)?fs.readFileSync(events,'utf8').trim().split('\n').filter(Boolean).map(x=>JSON.parse(x)):[];
  const result={workspace,script,read};
  t.after(async()=>{if(result.supervisor)await result.supervisor.stop();if(result.cliStop)await result.cliStop();fs.rmSync(workspace,{recursive:true,force:true});});
  return result;
}
function supervise(fixture,options={}){
  return fixture.supervisor=runSupervisor({workspace:fixture.workspace,args:[fixture.script],healthCheck:async()=>true,checkInterval:20,startupGrace:0,failureThreshold:3,gracefulStop:300,restartMin:20,restartMax:80,stableAfter:10000,...options});
}

test('health requires a fresh worker heartbeat and rejects missing, stale or future dates',()=>{
  const now=Date.now(),body={ok:true,worker:{loopHealthy:true,lastCheckedAt:new Date(now).toISOString()}};
  assert.equal(healthyWorker(body,now),true);
  for(const invalid of [{ok:true},{...body,ok:false},{ok:true,worker:{...body.worker,loopHealthy:false}},{ok:true,worker:{loopHealthy:true,lastCheckedAt:null}},{ok:true,worker:{loopHealthy:true,lastCheckedAt:new Date(now-420001).toISOString()}},{ok:true,worker:{loopHealthy:true,lastCheckedAt:new Date(now+60001).toISOString()}}])assert.equal(healthyWorker(invalid,now),false);
});

test('bounded private logs rotate without unbounded files',t=>{
  const f=fixture(t),file=resolve(f.workspace,'rotation.log'),write=rotatingLog(file,100);
  for(let i=0;i<10;i++)write('x'.repeat(80));
  for(const suffix of ['','.1','.2']){assert.ok(fs.statSync(file+suffix).size<=100);assert.equal(fs.statSync(file+suffix).mode&0o777,0o600);}
  assert.equal(fs.existsSync(file+'.3'),false);
});

test('crashed child restarts, never overlaps and manual stop drains the replacement',async t=>{
  const f=fixture(t,'crash'),s=supervise(f);t.after(()=>s.stop());
  await until(()=>f.read().filter(x=>x.event==='start').length===2);
  assert.equal(s.snapshot().restarts,1);assert.equal(f.read().filter(x=>x.event==='start')[0].supervised,'1');
  const running=s.snapshot().childPID,identity=processIdentity(running,f.script);assert.ok(identity);assert.equal(isSameProcess(identity),true);assert.equal(processIdentity(running,resolve(f.workspace,'other.mjs')),null);assert.equal(isSameProcess({...identity,startTime:'wrong'}),false);
  await s.stop();assert.equal(isSameProcess(identity),false);assert.equal(s.snapshot().status,'stopped');
  const eventNames=f.read().map(x=>x.event);assert.deepEqual(eventNames,['start','crash','start','term','exit']);
  assert.equal(fs.existsSync(resolve(f.workspace,'.private/server.pid')),false);
  await sleep(90);assert.equal(f.read().filter(x=>x.event==='start').length,2);
});

test('three consecutive failed checks restart once after graceful child exit',async t=>{
  const f=fixture(t);let checks=0;const s=supervise(f,{healthCheck:async()=>{if(!f.read().some(x=>x.event==='start'))return true;checks++;return checks>3;}});t.after(()=>s.stop());
  await until(()=>f.read().filter(x=>x.event==='start').length===2);
  await until(()=>s.snapshot().status==='healthy');assert.equal(s.snapshot().restarts,1);
  assert.deepEqual(f.read().slice(0,4).map(x=>x.event),['start','term','exit','start']);
  await s.stop();
});

test('successful check resets failures and startup grace avoids early restarts',async t=>{
  const f=fixture(t);let checks=0;const s=supervise(f,{startupGrace:120,healthCheck:async()=>{checks++;return checks>=5&&checks%3===0;}});t.after(()=>s.stop());
  await until(()=>checks>=12);assert.equal(s.snapshot().restarts,0);assert.equal(f.read().filter(x=>x.event==='start').length,1);await s.stop();
});

test('hung child is killed only after grace and replacement waits for OS exit',async t=>{
  const f=fixture(t,'ignore');let fail=true;
  const s=supervise(f,{gracefulStop:80,healthCheck:async()=>{
    // A prior child's start event cannot mark its replacement as ready.
    const ready=f.read().some(x=>x.event==='start'&&x.pid===s.snapshot().childPID);
    return !ready||!fail;
  }});t.after(()=>s.stop());
  await until(()=>f.read().filter(x=>x.event==='start').length===2);fail=false;
  const starts=f.read().filter(x=>x.event==='start');assert.equal(s.snapshot().restarts,1);
  assert.equal(processIdentity(starts[0].pid,f.script),null);assert.ok(processIdentity(starts[1].pid,f.script));await s.stop();
});

test('manual stop during crash backoff prevents a replacement',async t=>{
  const f=fixture(t,'crash'),s=supervise(f,{restartMin:1000});t.after(()=>s.stop());
  await until(()=>s.snapshot().status==='restarting');await s.stop();await sleep(100);assert.equal(f.read().filter(x=>x.event==='start').length,1);
});

test('HTTPS health probe verifies the project CA, request host and worker status',async t=>{
  let receivedHost='',response={ok:true,worker:{loopHealthy:true,lastCheckedAt:new Date().toISOString()}};
  const server=https.createServer({key:fs.readFileSync('.private/tls/server.key'),cert:fs.readFileSync('.private/tls/server.crt')},(req,res)=>{receivedHost=req.headers.host;res.setHeader('Content-Type','application/json');res.end(JSON.stringify(response));});
  await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>server.close(r)));
  const check=createHealthCheck({origin:'https://workspace.example.test',port:server.address().port,tls:true},root);
  assert.equal(await check(),true);assert.equal(receivedHost,'workspace.example.test');response.worker.loopHealthy=false;assert.equal(await check(),false);
});

function command(cmd,args,options={}){
  return new Promise((resolveCommand,reject)=>{const child=spawn(cmd,args,{cwd:root,stdio:['ignore','pipe','pipe'],...options});let output='';child.stdout.on('data',x=>output+=x);child.stderr.on('data',x=>output+=x);child.once('error',reject);child.once('exit',code=>resolveCommand({code,output}));});
}

test('concurrent CLI starts share one supervisor, stop drains it, stale foreign PID is ignored',async t=>{
  const f=fixture(t),bin=resolve(f.workspace,'bin');fs.mkdirSync(bin,{mode:0o700});
  for(const name of ['supervisor.mjs','start.sh','stop.sh'])fs.copyFileSync(resolve(root,'bin',name),resolve(bin,name));
  fs.writeFileSync(resolve(f.workspace,'.private/config.json'),JSON.stringify({origin:'http://127.0.0.1:19999',host:'127.0.0.1',port:19999}),{mode:0o600});
  f.cliStop=()=>command('/bin/bash',[resolve(bin,'stop.sh')]);
  const results=await Promise.all([command('/bin/bash',[resolve(bin,'start.sh')]),command('/bin/bash',[resolve(bin,'start.sh')])]);
  for(const result of results)assert.equal(result.code,0,result.output);
  await until(()=>f.read().filter(x=>x.event==='start').length===1);
  const pid=Number(fs.readFileSync(resolve(f.workspace,'.private/supervisor.pid'),'utf8')),identity=processIdentity(pid,resolve(bin,'supervisor.mjs'));assert.ok(identity);
  const stopped=await command('/bin/bash',[resolve(bin,'stop.sh')]);assert.equal(stopped.code,0,stopped.output);assert.equal(isSameProcess(identity),false);assert.equal(f.read().filter(x=>x.event==='start').length,1);
  fs.writeFileSync(resolve(f.workspace,'.private/server.pid'),String(process.pid));
  const stale=await command('/bin/bash',[resolve(bin,'stop.sh')]);assert.equal(stale.code,0,stale.output);assert.equal(process.kill(process.pid,0),true);
});
