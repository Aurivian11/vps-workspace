import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import {spawn} from 'node:child_process';
import {randomBytes,randomUUID} from 'node:crypto';
import {seal,unseal} from '../lib/vault.mjs';
import {digest,totp} from '../lib/security.mjs';
import {DEFAULT_RATES} from '../lib/domain.mjs';
const root=process.cwd(),password='Synthetic-regression-password-92184',replacement='Synthetic-replacement-password-62711';
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function instance(t,port,trustedProxies=[]){
  const dir=`runtime/session-regression-${randomUUID()}`,key=randomBytes(32),setup=randomUUID(),origin=`http://127.0.0.1:${port}`;
  fs.mkdirSync(dir,{mode:0o700});fs.chownSync(dir,62031,62031);
  const file=`${dir}/workspace.vault`,configFile=`${dir}/config.json`;
  fs.writeFileSync(file,seal({version:1,revision:0,account:null,servers:[],commands:[],settings:{rates:DEFAULT_RATES,rateSource:'Synthetic regression'}},key),{mode:0o600});fs.chownSync(file,62031,62031);
  fs.writeFileSync(configFile,JSON.stringify({mode:'private',host:'127.0.0.1',port,origin,key:key.toString('base64'),setupHash:digest(setup),serviceUID:62031,serviceGID:62031,vaultFile:file,trustedProxies}),{mode:0o600});
  const child=spawn(process.execPath,['server.mjs'],{cwd:root,env:{...process.env,VPS_CONFIG:configFile},stdio:['ignore','pipe','pipe']});let output='';
  child.stdout.on('data',x=>output+=x);child.stderr.on('data',x=>output+=x);
  const sockets=new Set();
  t.after(async()=>{for(const socket of sockets)socket.destroy();child.kill('SIGTERM');await new Promise(resolve=>{if(child.exitCode!==null)return resolve();child.once('exit',resolve);setTimeout(()=>{child.kill('SIGKILL');resolve();},6000).unref();});fs.rmSync(dir,{recursive:true,force:true});});
  let ready=false;for(let i=0;i<60;i++){if(child.exitCode!==null)break;try{if((await fetch(origin+'/api/health')).ok){ready=true;break;}}catch{}await delay(100);}assert.ok(ready,output);
  function headers(ctx,data,extra={}){return{Origin:origin,...(ctx?.cookie?{Cookie:ctx.cookie}:{}),...(ctx?.csrf?{'X-CSRF-Token':ctx.csrf}:{}),'If-Match':String(ctx?.revision??0),...(data!==undefined?{'Content-Type':'application/json'}:{}),...extra};}
  async function call(ctx,path,method='GET',data,extra={}){const response=await fetch(origin+path,{method,headers:headers(ctx,data,extra),body:data===undefined?undefined:JSON.stringify(data)}),value=await response.json();const cookie=response.headers.get('set-cookie');if(ctx){if(cookie)ctx.cookie=cookie.split(';')[0];if(value.csrfToken)ctx.csrf=value.csrfToken;if(Number.isInteger(value.revision))ctx.revision=value.revision;}return{status:response.status,value};}
  function slow(ctx,path,data,method='POST'){
    const payload=JSON.stringify(data);let request;
    const result=new Promise((resolve,reject)=>{request=http.request(origin+path,{method,headers:headers(ctx,data,{'Content-Length':Buffer.byteLength(payload)})},response=>{let text='';response.on('data',x=>text+=x);response.on('end',()=>resolve({status:response.statusCode,value:JSON.parse(text)}));});request.on('error',reject);request.on('socket',socket=>{sockets.add(socket);socket.once('close',()=>sockets.delete(socket));});request.write(payload.slice(0,1));});
    return{result,finish:()=>request.end(payload.slice(1))};
  }
  function pipeline(ctx,requests){return new Promise((resolve,reject)=>{const socket=net.createConnection({host:'127.0.0.1',port},()=>{socket.write(requests.map(([path,data],i)=>{const body=JSON.stringify(data),all={Host:`127.0.0.1:${port}`,...headers(ctx,data),Connection:i===requests.length-1?'close':'keep-alive','Content-Length':Buffer.byteLength(body)};return`POST ${path} HTTP/1.1\r\n${Object.entries(all).map(([k,v])=>`${k}: ${v}`).join('\r\n')}\r\n\r\n${body}`;}).join(''));});sockets.add(socket);let text='';socket.on('data',x=>text+=x);socket.on('error',reject);socket.on('end',()=>resolve([...text.matchAll(/HTTP\/1\.1 (\d{3})/g)].map(x=>Number(x[1]))));socket.once('close',()=>sockets.delete(socket));});}
  const ctx={};assert.equal((await call(ctx,'/api/setup','POST',{token:setup,username:'regression_admin',password})).status,201);
  return{ctx,call,slow,pipeline,state:()=>unseal(fs.readFileSync(file,'utf8'),key)};
}

test('revoked sessions cannot commit slow requests or complete asynchronous reauthentication',async t=>{
  const app=await instance(t,19789),{ctx,call,slow,state}=app;
  const added=await call(ctx,'/api/servers','POST',{name:'Synthetic existing host',ipAddress:'192.0.2.19',sshPassword:'SYNTHETIC-ONLY-SECRET'});assert.equal(added.status,201);const id=added.value.server.id;
  const pending=[slow(ctx,'/api/servers',{name:'Should never be stored'}),slow(ctx,`/api/servers/${id}/secrets`,{}),slow(ctx,'/api/security/totp/start',{password}),slow(ctx,'/api/security/password',{currentPassword:password,newPassword:replacement})];
  await delay(75);assert.equal((await call(ctx,'/api/logout','POST',{})).status,200);
  for(const request of pending)request.finish();for(const request of pending)assert.equal((await request.result).status,401);
  assert.equal(state().servers.length,1);assert.equal(state().revision,1);
  assert.equal((await call(ctx,'/api/login','POST',{username:'regression_admin',password})).status,200);
  const beforePasswordChange=slow(ctx,'/api/commands',{title:'Must not persist',command:'echo regression'});await delay(75);
  const old={...ctx};assert.equal((await call(ctx,'/api/security/password','POST',{currentPassword:password,newPassword:replacement})).status,200);
  assert.equal((await call(old,'/api/workspace')).status,401);beforePasswordChange.finish();assert.equal((await beforePasswordChange.result).status,401);assert.equal(state().commands.length,0);
  assert.equal((await call(ctx,'/api/login','POST',{username:'regression_admin',password:replacement})).status,200);
  const codes=await call(ctx,'/api/security/totp/start','POST',{password:replacement});assert.equal(codes.status,200);
  const beforeTotpChange=slow(ctx,'/api/servers',{name:'Stale same-session write'});await delay(75);
  const enabled=await call(ctx,'/api/security/totp/confirm','POST',{code:totp(codes.value.secret)});assert.equal(enabled.status,200);
  beforeTotpChange.finish();assert.equal((await beforeTotpChange.result).status,401);assert.equal((await call(ctx,'/api/workspace')).status,200);
  const beforeDisable=slow(ctx,'/api/servers',{name:'Stale before disabling 2FA'});await delay(75);
  assert.equal((await call(ctx,'/api/security/totp/disable','POST',{password:replacement,code:enabled.value.recoveryCodes[0]})).status,200);
  beforeDisable.finish();assert.equal((await beforeDisable.result).status,401);assert.equal(state().servers.length,1);
  // Both requests arrive in the same TCP write. Logout runs while scrypt is pending.
  assert.deepEqual(await app.pipeline(ctx,[['/api/security/totp/start',{password:replacement}],['/api/logout',{}]]),[401,200]);
});

test('trusted proxy clients have separate limits and direct clients cannot spoof headers',async t=>{
  const trusted=await instance(t,19789,['127.0.0.1']);
  for(let i=0;i<12;i++)assert.equal((await trusted.call({},'/api/login','POST',{username:'regression_admin',password:'incorrect'},{'X-Real-IP':'198.51.100.1'})).status,401);
  assert.equal((await trusted.call({},'/api/login','POST',{username:'regression_admin',password},{'X-Real-IP':'198.51.100.1'})).status,429);
  assert.equal((await trusted.call({},'/api/login','POST',{username:'regression_admin',password},{'X-Real-IP':'203.0.113.2','X-Forwarded-For':'198.51.100.1'})).status,200);
  const direct=await instance(t,19790);
  for(let i=0;i<12;i++)assert.equal((await direct.call({},'/api/login','POST',{username:'regression_admin',password:'incorrect'},{'X-Real-IP':`198.51.100.${i+1}`,'X-Forwarded-For':`203.0.113.${i+1}`})).status,401);
  assert.equal((await direct.call({},'/api/login','POST',{username:'regression_admin',password},{'X-Real-IP':'192.0.2.99','X-Forwarded-For':'192.0.2.100'})).status,429);
});
