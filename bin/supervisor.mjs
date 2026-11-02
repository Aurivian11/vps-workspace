import fs from 'node:fs';
import https from 'node:https';
import http from 'node:http';
import {checkServerIdentity} from 'node:tls';
import {spawn} from 'node:child_process';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {EventEmitter} from 'node:events';
const ROOT=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const quiet=fn=>{try{return fn();}catch{return null;}};
export function processIdentity(pid,script){
  if(!Number.isSafeInteger(Number(pid))||Number(pid)<2)return null;
  return quiet(()=>{
    const args=fs.readFileSync(`/proc/${pid}/cmdline`,'utf8').split('\0');
    if(!args.includes(script))return null;
    const stat=fs.readFileSync(`/proc/${pid}/stat`,'utf8');
    const fields=stat.slice(stat.lastIndexOf(')')+2).split(' ');
    if(fields[0]==='Z')return null;
    return{pid:Number(pid),startTime:fields[19],script};
  });
}
export function isSameProcess(identity){
  if(!identity)return false;
  const current=processIdentity(identity.pid,identity.script);
  return !!current&&current.startTime===identity.startTime;
}
function atomic(file,value){const temp=file+'.new';fs.writeFileSync(temp,value,{mode:0o600});fs.renameSync(temp,file);}
function ownedPID(directory,name,script){
  const pid=Number(quiet(()=>fs.readFileSync(resolve(directory,`${name}.pid`),'utf8')));
  const live=processIdentity(pid,script);if(!live)return null;
  const saved=quiet(()=>JSON.parse(fs.readFileSync(resolve(directory,`${name}.identity.json`),'utf8')));
  if(saved&&saved.pid===pid&&saved.startTime!==live.startTime)return null;
  return live;
}
function savePID(directory,name,identity){atomic(resolve(directory,`${name}.identity.json`),JSON.stringify(identity));atomic(resolve(directory,`${name}.pid`),String(identity.pid)+'\n');}
function clearPID(directory,name,identity){
  const saved=quiet(()=>JSON.parse(fs.readFileSync(resolve(directory,`${name}.identity.json`),'utf8')));
  if(saved?.pid===identity?.pid&&saved?.startTime===identity?.startTime){fs.rmSync(resolve(directory,`${name}.pid`),{force:true});fs.rmSync(resolve(directory,`${name}.identity.json`),{force:true});}
}
export function rotatingLog(file,maxBytes=1024*1024){
  return value=>{
    let data=Buffer.isBuffer(value)?value:Buffer.from(String(value));
    if(data.length>maxBytes)data=data.subarray(data.length-maxBytes);
    if((quiet(()=>fs.statSync(file).size)||0)+data.length>maxBytes){
      fs.rmSync(file+'.2',{force:true});if(fs.existsSync(file+'.1'))fs.renameSync(file+'.1',file+'.2');if(fs.existsSync(file))fs.renameSync(file,file+'.1');
    }
    fs.appendFileSync(file,data,{mode:0o600});fs.chmodSync(file,0o600);
  };
}
export function healthyWorker(body,now=Date.now(),maxAge=420000){
  const checked=Date.parse(body?.worker?.lastCheckedAt);
  return body?.ok===true&&body?.worker?.loopHealthy===true&&Number.isFinite(checked)&&checked<=now+60000&&now-checked<=maxAge;
}
export function createHealthCheck(config,workspace=ROOT){
  const origin=new URL(config.origin),secure=!!config.tls;
  const ca=secure?fs.readFileSync(resolve(workspace,'.private/tls/ca.crt')):undefined;
  return()=>new Promise(resolveCheck=>{
    let settled=false;const finish=value=>{if(!settled){settled=true;resolveCheck(value);}};
    const request=(secure?https:http).request({hostname:'127.0.0.1',port:config.port,path:'/api/health',method:'GET',headers:{Host:origin.host},ca,servername:'',checkServerIdentity:(_name,cert)=>checkServerIdentity('127.0.0.1',cert),rejectUnauthorized:true,timeout:5000},response=>{
      let size=0,chunks=[];
      response.on('data',chunk=>{size+=chunk.length;if(size>8192){response.destroy();finish(false);}else chunks.push(chunk);});
      response.on('error',()=>finish(false));response.on('end',()=>{try{finish(response.statusCode===200&&healthyWorker(JSON.parse(Buffer.concat(chunks).toString('utf8'))));}catch{finish(false);}});
    });
    const deadline=setTimeout(()=>{request.destroy();finish(false);},6000);
    request.on('close',()=>clearTimeout(deadline));request.on('timeout',()=>{request.destroy();finish(false);});request.on('error',()=>finish(false));request.end();
  });
}

// Each replacement waits for the previous child's exit to prevent competing vault writers.
export function runSupervisor({workspace=ROOT,command=process.execPath,args=[resolve(workspace,'server.mjs')],env=process.env,healthCheck,checkInterval=30000,startupGrace=90000,failureThreshold=3,gracefulStop=25000,restartMin=5000,restartMax=60000,stableAfter=300000,recordPID=true}={}){
  if(typeof healthCheck!=='function')throw Error('Health check required.');
  const directory=resolve(workspace,'.private');fs.mkdirSync(directory,{recursive:true,mode:0o700});
  const events=new EventEmitter(),log=rotatingLog(resolve(directory,'supervisor.log')),serverLog=rotatingLog(resolve(directory,'server.log'));
  let stopping=false,child=null,childIdentity=null,exitPromise=null,childDone=true;
  function wait(ms,watchChild=false){
    return new Promise(resolveWait=>{
      let timer;const ended=()=>finish('exit'),stopped=()=>finish('stop');
      function finish(result){clearTimeout(timer);events.off('_stop',stopped);events.off('_child-exit',ended);resolveWait(result);}
      events.once('_stop',stopped);if(watchChild)events.once('_child-exit',ended);
      timer=setTimeout(()=>finish('check'),ms);
      if(stopping)finish('stop');else if(watchChild&&childDone)finish('exit');
    });
  }
  const state={status:'starting',supervisorPID:process.pid,childPID:null,restarts:0,consecutiveFailures:0,lastCheckedAt:null,lastHealthyAt:null,startedAt:new Date().toISOString()};
  const publish=()=>{atomic(resolve(directory,'supervisor-state.json'),JSON.stringify(state));events.emit('state',{...state});};
  const event=(name,extra={})=>log(JSON.stringify({time:new Date().toISOString(),event:name,...extra})+'\n');
  async function stopChild(reason){
    if(!child||child.exitCode!==null||child.signalCode!==null)return;
    state.status='stopping-child';publish();event('child-stopping',{reason});
    if(isSameProcess(childIdentity))child.kill('SIGTERM');
    let timer;const deadline=new Promise(r=>{timer=setTimeout(()=>r(false),gracefulStop);});
    const exited=await Promise.race([exitPromise.then(()=>true),deadline]);clearTimeout(timer);
    if(!exited&&isSameProcess(childIdentity)){event('child-forced-stop');child.kill('SIGKILL');}
    await exitPromise;
  }
  events.stop=()=>{if(!stopping){stopping=true;events.emit('_stop');}return events.done;};
  events.snapshot=()=>({...state});
  events.done=Promise.resolve().then(async()=>{
    let delay=restartMin;
    while(!stopping){
      const started=Date.now();state.status='starting';state.consecutiveFailures=0;publish();
      childDone=false;
      child=spawn(command,args,{cwd:workspace,env:{...env,TMPDIR:resolve(workspace,'tmp'),XDG_CACHE_HOME:resolve(workspace,'.cache'),PYTHONDONTWRITEBYTECODE:'1',VPS_SUPERVISED:'1'},stdio:['ignore','pipe','pipe']});
      child.stdout.on('data',serverLog);child.stderr.on('data',serverLog);
      exitPromise=new Promise(resolveExit=>{const finish=result=>{childDone=true;events.emit('_child-exit');resolveExit(result);};child.once('exit',(code,signal)=>finish({code,signal}));child.once('error',()=>finish({code:null,signal:null,error:true}));});
      childIdentity=child.pid?processIdentity(child.pid,args.find(x=>x.endsWith('.mjs'))||args[0]):null;
      for(let retry=0;!childIdentity&&child.pid&&retry<20;retry++){await sleep(5);childIdentity=processIdentity(child.pid,args.find(x=>x.endsWith('.mjs'))||args[0]);}
      if(!childIdentity&&child.pid&&child.exitCode===null&&child.signalCode===null){child.kill('SIGTERM');await exitPromise;throw Error('Cannot verify child process identity.');}
      state.childPID=child.pid||null;if(recordPID&&childIdentity)savePID(directory,'server',childIdentity);publish();event('child-started',{pid:state.childPID});
      let exited=false;exitPromise.then(()=>{exited=true;});
      while(!exited&&!stopping){
        const action=await wait(checkInterval,true);
        if(action!=='check')break;
        let valid=false;try{valid=await healthCheck();}catch{}
        if(exited||stopping)break;
        const now=Date.now();state.lastCheckedAt=new Date(now).toISOString();
        if(valid){state.lastHealthyAt=state.lastCheckedAt;state.consecutiveFailures=0;state.status='healthy';}
        else if(now-started>=startupGrace){state.consecutiveFailures++;state.status='unhealthy';}
        publish();
        if(state.consecutiveFailures>=failureThreshold){await stopChild('health-check');break;}
      }
      if(stopping)await stopChild('manual-stop');
      const result=await exitPromise;if(recordPID)clearPID(directory,'server',childIdentity);state.childPID=null;child=null;childIdentity=null;
      if(stopping)break;
      event('child-exited',{code:result.code,signal:result.signal});state.restarts++;state.status='restarting';publish();
      if(Date.now()-started>=stableAfter)delay=restartMin;
      await wait(delay);delay=Math.min(restartMax,delay*2);
    }
    state.status='stopped';state.childPID=null;publish();event('supervisor-stopped');
  }).catch(async()=>{stopping=true;events.emit('_stop');if(child)await stopChild('supervisor-error');state.status='failed';publish();event('supervisor-failed');throw Error('Supervisor failed; inspect state.');});
  return events;
}

async function stopExisting(){
  const directory=resolve(ROOT,'.private'),supervisor=ownedPID(directory,'supervisor',resolve(ROOT,'bin/supervisor.mjs'));
  if(supervisor){
    process.kill(supervisor.pid,'SIGTERM');
    for(let i=0;i<350&&isSameProcess(supervisor);i++)await sleep(100);
    if(isSameProcess(supervisor))throw Error('Supervisor is still stopping; do not start a second process.');
    clearPID(directory,'supervisor',supervisor);
  }
  const server=ownedPID(directory,'server',resolve(ROOT,'server.mjs'));
  if(server){
    process.kill(server.pid,'SIGTERM');for(let i=0;i<260&&isSameProcess(server);i++)await sleep(100);
    if(isSameProcess(server)){process.kill(server.pid,'SIGKILL');for(let i=0;i<50&&isSameProcess(server);i++)await sleep(100);}
    if(isSameProcess(server))throw Error('Server is still stopping; PID retained.');
    const current=Number(quiet(()=>fs.readFileSync(resolve(directory,'server.pid'),'utf8')));if(current===server.pid){fs.rmSync(resolve(directory,'server.pid'),{force:true});fs.rmSync(resolve(directory,'server.identity.json'),{force:true});}
  }
}
async function cli(){
  process.chdir(ROOT);process.umask(0o077);const directory=resolve(ROOT,'.private');
  const action=process.argv[2];
  if(action==='status'){process.exitCode=ownedPID(directory,'supervisor',resolve(ROOT,'bin/supervisor.mjs'))?0:1;return;}
  if(action==='stop'){await stopExisting();console.log('VPS supervisor and service stopped.');return;}
  if(action!=='--locked')throw Error('Start with bin/start.sh or the prepared systemd unit.');
  if(ownedPID(directory,'supervisor',resolve(ROOT,'bin/supervisor.mjs'))||ownedPID(directory,'server',resolve(ROOT,'server.mjs')))throw Error('A project process is already running; stop it first.');
  const identity=processIdentity(process.pid,resolve(ROOT,'bin/supervisor.mjs'));if(!identity)throw Error('Cannot verify supervisor identity.');
  const config=JSON.parse(fs.readFileSync(resolve(directory,'config.json'),'utf8'));
  const healthCheck=createHealthCheck(config);savePID(directory,'supervisor',identity);
  const supervisor=runSupervisor({healthCheck});
  for(const signal of ['SIGTERM','SIGINT'])process.on(signal,()=>{supervisor.stop();});
  try{await supervisor.done;}finally{clearPID(directory,'supervisor',identity);}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))cli().catch(error=>{console.error(error.message);process.exitCode=1;});
