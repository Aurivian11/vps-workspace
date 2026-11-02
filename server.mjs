import http from 'node:http';
import https from 'node:https';
import fs from 'node:fs';
import {fileURLToPath} from 'node:url';
import {dirname,resolve,sep} from 'node:path';
import {token,digest,equal,hashPassword,verifyPassword,newTotpSecret,verifyTotp,RateLimiter} from './lib/security.mjs';
import {Vault} from './lib/vault.mjs';
import {createBackupManager} from './lib/backups.mjs';
import {recordRenewal} from './lib/renewals.mjs';
import {createClientIPResolver} from './lib/request-ip.mjs';
import {normalizeTelegram,publicTelegram,sendTelegram,createReminderWorker} from './lib/telegram.mjs';
import {createSelectionConfirmer} from './lib/telegram-confirmation.mjs';
import {createTelegramQueryWorker} from './lib/telegram-query.mjs';
import {randomUUID} from 'node:crypto';
import {normalizeServer,normalizeCommand,redactServer,calculateCosts,calculateCustomMonthly,DEFAULT_RATES} from './lib/domain.mjs';
process.chdir(dirname(fileURLToPath(import.meta.url)));
const config=JSON.parse(fs.readFileSync(process.env.VPS_CONFIG||'.private/config.json','utf8'));
const origin=new URL(config.origin);
const clientIP=createClientIPResolver(config.trustedProxies);
if(config.mode==='private'){
  if(config.host!=='127.0.0.1'||origin.hostname!=='127.0.0.1'||origin.protocol!=='http:')throw Error('Private mode requires loopback binding and origin.');
}else if(origin.protocol!=='https:')throw Error('Public service requires a configured HTTPS origin.');
let tlsOptions=null;
if(config.tls){
  if(origin.protocol!=='https:')throw Error('TLS requires an HTTPS origin.');
  const workspace=fs.realpathSync(process.cwd()),directory=fs.realpathSync('.private/tls');
  if(!directory.startsWith(workspace+sep))throw Error('TLS directory must remain inside this project.');
  const readTLS=path=>{const real=fs.realpathSync(resolve(path));if(!real.startsWith(directory+sep)||!fs.statSync(real).isFile())throw Error('TLS files must remain inside the private TLS directory.');return fs.readFileSync(real);};
  tlsOptions={key:readTLS(config.tls.key),cert:readTLS(config.tls.cert),minVersion:'TLSv1.2'};
}
if(!tlsOptions&&!['127.0.0.1','::1'].includes(config.host))throw Error('A public listener requires TLS.');
const key=Buffer.from(config.key,'base64');if(key.length!==32)throw Error('Invalid encryption key.');
const assets=new Map();
for(const[name,type]of [['index.html','text/html; charset=utf-8'],['app.js','text/javascript; charset=utf-8'],['styles.css','text/css; charset=utf-8']])assets.set(name,{body:fs.readFileSync(`public/${name}`),type});
// Load immutable code, assets, and the root-owned master key before giving up root.
if(process.getuid?.()===0){process.setgroups([]);process.setgid(config.serviceGID);process.setuid(config.serviceUID);}
if(process.getuid?.()===0)throw Error('Refusing to serve HTTP as root.');
const vaultFile=config.vaultFile||'runtime/workspace.vault';
if(!/^runtime\/[a-zA-Z0-9_./-]+$/.test(vaultFile)||vaultFile.includes('..')||!fs.existsSync(vaultFile))throw Error('Vault missing or invalid; refusing to replace existing data.');
const vault=new Vault(vaultFile,key,{version:1,revision:0,account:null,servers:[],commands:[],settings:{rates:DEFAULT_RATES,rateSource:'应用内参考汇率 · 仅供估算'}});
const backups=createBackupManager({vault,key,directory:dirname(vaultFile)+'/backups'});
const backupPreviews=new Map();
const reminders=createReminderWorker({vault,origin:origin.origin});
const selectionConfirmer=createSelectionConfirmer({vault,origin:origin.origin});
const telegramQuery=createTelegramQueryWorker({vault,enabled:config.mode!=='private'});
const sessions=new Map(), limiter=new RateLimiter();
let telegramTestInFlight=false;
function checkReminders(){queueMicrotask(()=>reminders.tick().catch(()=>console.error(JSON.stringify({event:'telegram-worker-failed'}))));}
function publicSettings(settings){return {...settings,telegram:publicTelegram(settings.telegram)};}
let securityVersion=0;
const cookieName=origin.protocol==='https:'?'__Host-vps_session':'vps_session';
const fail=(status,message)=>Object.assign(new Error(message),{status});
function headers(res){res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('X-Frame-Options','DENY');res.setHeader('Permissions-Policy','camera=(), microphone=(), geolocation=()');res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; object-src 'none'; form-action 'self'");if(origin.protocol==='https:')res.setHeader('Strict-Transport-Security','max-age=31536000');}
function json(res,status,data){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(data));}
function sessionFor(req){const raw=(req.headers.cookie||'').split(';').map(x=>x.trim()).find(x=>x.startsWith(cookieName+'='))?.slice(cookieName.length+1);if(!raw||raw.length>100)return null;const id=digest(raw),s=sessions.get(id);if(!s)return null;const now=Date.now();if(now>s.expires||now-s.last>1800000){sessions.delete(id);return null;}s.last=now;return{id,...s,securityVersion};}
function publicSession(s){return{authenticated:!!s,setupRequired:!vault.state.account,...(s?{csrfToken:s.csrf,account:{username:vault.state.account.username,totpEnabled:!!vault.state.account.totp}}:{})};}
function createSession(res){for(const[k,v]of sessions)if(v.expires<Date.now()||Date.now()-v.last>1800000)sessions.delete(k);if(sessions.size>=64)sessions.delete(sessions.keys().next().value);const raw=token(),s={csrf:token(),created:Date.now(),last:Date.now(),expires:Date.now()+43200000};sessions.set(digest(raw),s);res.setHeader('Set-Cookie',`${cookieName}=${raw}; Path=/; HttpOnly; SameSite=Strict; Max-Age=43200${origin.protocol==='https:'?'; Secure':''}`);return s;}
function clearCookie(res){res.setHeader('Set-Cookie',`${cookieName}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${origin.protocol==='https:'?'; Secure':''}`);}
async function body(req){if(!String(req.headers['content-type']||'').startsWith('application/json'))throw fail(415,'请求必须使用 JSON。');let size=0,chunks=[];for await(const chunk of req){size+=chunk.length;if(size>262144)throw fail(413,'提交内容过大。');chunks.push(chunk);}try{const b=JSON.parse(Buffer.concat(chunks).toString('utf8')||'{}');if(!b||typeof b!=='object'||Array.isArray(b))throw Error();return b;}catch{throw fail(400,'提交的 JSON 格式无效。');}}
function auth(s){
  const current=s&&sessions.get(s.id),now=Date.now();
  if(current&&(now>=current.expires||now-current.last>1800000)){sessions.delete(s.id);throw fail(401,'会话已过期，请重新登录。');}
  if(!current||!equal(current.csrf,s.csrf)||s.securityVersion!==securityVersion)throw fail(401,'会话已失效，请重新登录。');
  return current;
}
function csrf(req,s){auth(s);if(!equal(req.headers['x-csrf-token']||'',s.csrf))throw fail(403,'会话校验失败，请刷新页面。');}
function matchRevision(req){if(String(req.headers['if-match'])!==String(vault.state.revision))throw fail(409,'资料已在其他页面更新，请刷新后重试。');}
function commit(state){state.revision++;vault.save(state);return state.revision;}
function rate(req,kind,limit=8){const ip=clientIP(req);if(!limiter.consume(`${kind}:${ip}`,limit))throw fail(429,'尝试次数过多，请 15 分钟后重试。');}
function consumeSecondFactor(code){const current=vault.state.account;if(!current?.totp)return true;const state=vault.snapshot(),t=state.account.totp;const counter=verifyTotp(t.secret,code,t.lastCounter);if(counter!==null){t.lastCounter=counter;vault.save(state);return true;}const hash=digest(String(code||'').trim()),index=t.recoveryHashes.findIndex(x=>equal(x,hash));if(index<0)return false;t.recoveryHashes.splice(index,1);vault.save(state);return true;}
async function reauthenticate(req,b,s){
  auth(s);rate(req,'reauth',10);const a=vault.state.account;
  const valid=await verifyPassword(b.password??b.currentPassword,a?.password);
  auth(s);
  if(!a||!valid||vault.state.account.password.hash!==a.password.hash)throw fail(401,'身份验证失败。');
  if(!consumeSecondFactor(b.otp??b.code))throw fail(401,'身份验证失败。');
}
function keepSession(id){for(const key of sessions.keys())if(key!==id)sessions.delete(key);}
const handler=async(req,res)=>{headers(res);const requestID=token(8);res.setHeader('X-Request-ID',requestID);try{
  if(req.headers.host!==origin.host)throw fail(400,'访问地址不匹配。');
  const url=new URL(req.url,origin),path=url.pathname,method=req.method;
  if(['POST','PUT','PATCH','DELETE'].includes(method)){
    if(req.headers.origin!==origin.origin||req.headers['sec-fetch-site']==='cross-site')throw fail(403,'不允许跨站请求。');
  }
  if(method==='GET'&&!path.startsWith('/api/')){const name=path==='/'?'index.html':path.replace(/^\/(assets\/)?/,'');const asset=assets.get(name);if(!asset)throw fail(404,'页面不存在。');res.writeHead(200,{'Content-Type':asset.type});res.end(asset.body);return;}
  const s=sessionFor(req);
  if(path==='/api/session'&&method==='GET'){json(res,200,publicSession(s));return;}
  if(path==='/api/health'&&method==='GET'){const checked=reminders.status().lastCheckedAt,q=telegramQuery.status(),queryHealthy=!q.enabled||!q.configured||q.loopHealthy;json(res,200,{ok:true,worker:{lastCheckedAt:checked,loopHealthy:!!checked&&Date.now()-Date.parse(checked)<420000&&queryHealthy},telegramQuery:{enabled:q.enabled,configured:q.configured,lastPollAt:q.lastPollAt,lastSuccessfulPollAt:q.lastSuccessfulPollAt,loopHealthy:q.loopHealthy}});return;}
  if(path==='/api/setup'&&method==='POST'){
    rate(req,'setup',5);if(vault.state.account)throw fail(409,'管理员已设置。');const b=await body(req);
    if(!equal(digest(b.token||''),config.setupHash))throw fail(403,'初始化凭据无效。');
    if(typeof b.username!=='string'||!/^[-_a-zA-Z0-9]{3,40}$/.test(b.username))throw fail(400,'用户名需为 3–40 位字母、数字、横线或下划线。');
    const password=await hashPassword(b.password);if(vault.state.account)throw fail(409,'管理员已设置。');
    const state=vault.snapshot();state.account={username:b.username,password,totp:null,createdAt:new Date().toISOString()};vault.save(state);json(res,201,publicSession(createSession(res)));return;
  }
  if(path==='/api/login'&&method==='POST'){
    rate(req,'login',12);const b=await body(req),a=vault.state.account,loginSecurityVersion=securityVersion;
    const valid=await verifyPassword(b.password,a?.password);
    if(!a||!valid||!equal(b.username||'',a.username)||loginSecurityVersion!==securityVersion||vault.state.account.password.hash!==a.password.hash)throw fail(401,'用户名、密码或验证码不正确。');
    if(!consumeSecondFactor(b.otp))throw fail(401,'用户名、密码或验证码不正确。');json(res,200,publicSession(createSession(res)));return;
  }
  auth(s);
  if(path==='/api/workspace'&&method==='GET'){const state=vault.state;json(res,200,{servers:state.servers.map(redactServer),commands:state.commands,settings:publicSettings(state.settings),telegramStatus:{...reminders.status(),supervisionEnabled:process.env.VPS_SUPERVISED==='1'},telegramQueryStatus:telegramQuery.status(),costs:calculateCosts(state.servers,state.settings.rates),customMonthly:calculateCustomMonthly(state.servers,state.settings.customMonthly?.serverIds,state.settings.rates),revision:state.revision});return;}
  if(method!=='GET')csrf(req,s);
  if(path==='/api/logout'&&method==='POST'){sessions.delete(s.id);clearCookie(res);json(res,200,{ok:true});return;}
  if(path==='/api/security/totp/start'&&method==='POST'){
    const b=await body(req);await reauthenticate(req,b,s);auth(s);if(vault.state.account.totp)throw fail(409,'双重验证已开启。');const secret=newTotpSecret();sessions.get(s.id).pendingTotp={secret,expires:Date.now()+300000};json(res,200,{secret,uri:`otpauth://totp/${encodeURIComponent('VPS 管家:'+vault.state.account.username)}?secret=${secret}&issuer=${encodeURIComponent('VPS 管家')}&algorithm=SHA1&digits=6&period=30`});return;
  }
  if(path==='/api/security/totp/confirm'&&method==='POST'){
    rate(req,'totp-confirm',8);const b=await body(req);const active=auth(s),pending=active.pendingTotp;if(!pending||pending.expires<Date.now())throw fail(400,'设置已过期，请重新开始。');const counter=verifyTotp(pending.secret,b.code);if(counter===null)throw fail(400,'验证码不正确。');const recoveryCodes=Array.from({length:8},()=>token(18));const state=vault.snapshot();state.account.totp={secret:pending.secret,lastCounter:counter,recoveryHashes:recoveryCodes.map(digest)};vault.save(state);securityVersion++;delete active.pendingTotp;keepSession(s.id);json(res,200,{recoveryCodes,...publicSession(s)});return;
  }
  if(path==='/api/security/totp/disable'&&method==='POST'){
    const b=await body(req);await reauthenticate(req,b,s);auth(s);const state=vault.snapshot();state.account.totp=null;vault.save(state);securityVersion++;keepSession(s.id);json(res,200,{ok:true,...publicSession(s)});return;
  }
  if(path==='/api/security/password'&&method==='POST'){
    const b=await body(req);await reauthenticate(req,b,s);auth(s);const previous=vault.state.account.password.hash,password=await hashPassword(b.newPassword);auth(s);if(vault.state.account.password.hash!==previous)throw fail(409,'密码已更新，请重新登录。');const state=vault.snapshot();state.account.password=password;vault.save(state);securityVersion++;sessions.clear();clearCookie(res);json(res,200,{ok:true,authenticated:false});return;
  }
  if(path==='/api/backup'&&method==='POST'){
    const b=await body(req);await reauthenticate(req,b,s);auth(s);const backup=backups.create('manual');json(res,201,{filename:backup.filename,message:'加密备份已保存在服务器项目目录。'});return;
  }
  if(path==='/api/backups'&&method==='GET'){json(res,200,backups.list());return;}
  if(path==='/api/backups/preview'&&method==='POST'){
    const b=await body(req);auth(s);
    const preview=backups.preview(b.filename),previewToken=token(),expiresAt=Date.now()+300000;
    for(const [id,item]of backupPreviews)if(item.expiresAt<Date.now()||item.sessionId===s.id)backupPreviews.delete(id);
    if(backupPreviews.size>=64)backupPreviews.delete(backupPreviews.keys().next().value);
    backupPreviews.set(previewToken,{sessionId:s.id,filename:b.filename,digest:preview.digest,revision:vault.state.revision,expiresAt});
    const changes=[...preview.servers.added.map(row=>({...row,type:'added',fields:[]})),...preview.servers.removed.map(row=>({...row,type:'removed',fields:[]})),...preview.servers.changed.map(row=>({...row,type:'changed'}))];
    json(res,200,{previewToken,filename:b.filename,createdAt:preview.backup.createdAt,revision:vault.state.revision,expiresAt:new Date(expiresAt).toISOString(),summary:{added:preview.servers.added.length,removed:preview.servers.removed.length,changed:preview.servers.changed.length,unchanged:vault.state.servers.length-preview.servers.removed.length-preview.servers.changed.length,commandsBefore:preview.commands.before,commandsAfter:preview.commands.after},changes,settingsChanged:preview.settingsChanged,commands:preview.commands,preserved:preview.preserved});return;
  }
  if(path==='/api/backups/restore'&&method==='POST'){
    const b=await body(req);auth(s);matchRevision(req);
    const preview=typeof b.previewToken==='string'&&backupPreviews.get(b.previewToken);
    if(!preview||preview.sessionId!==s.id||preview.expiresAt<Date.now()||preview.filename!==b.filename||preview.revision!==vault.state.revision)throw fail(409,'恢复预览已失效，请重新预览后确认。');
    if(b.confirm!==true)throw fail(400,'请先确认恢复预览。');
    const result=backups.restore(b.filename,preview.digest);backupPreviews.delete(b.previewToken);
    json(res,200,{revision:result.revision,backupFilename:result.backup.filename,message:'资料已恢复，恢复前的内容也已加密备份。'});checkReminders();return;
  }
  const renewalRoute=path.match(/^\/api\/servers\/([0-9a-f-]+)\/renewals$/i);
  if(renewalRoute&&method==='POST'){
    const b=await body(req);auth(s);const state=vault.snapshot(),index=state.servers.findIndex(row=>row.id===renewalRoute[1]);
    if(index<0)throw fail(404,'服务器不存在。');
    const result=recordRenewal(state.servers[index],b);
    if(result.duplicate){json(res,200,{revision:state.revision,record:result.record,duplicate:true});return;}
    matchRevision(req);state.servers[index]=result.server;const revision=commit(state);
    json(res,201,{revision,record:result.record,duplicate:false});checkReminders();return;
  }
  if(path==='/api/settings/custom-monthly/servers'&&method==='PUT'){
    const b=await body(req);auth(s);matchRevision(req);
    const ids=b.serverIds;
    if(!Array.isArray(ids)||ids.length>1000||ids.some(id=>typeof id!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id))||new Set(ids).size!==ids.length)throw fail(400,'请选择有效且不重复的服务器。');
    const state=vault.snapshot(),selected=new Set(ids),existing=new Set(state.servers.map(record=>record.id));
    if(ids.some(id=>!existing.has(id)))throw fail(400,'选择中包含不存在的服务器，请重新加载列表。');
    const previous=new Set(Array.isArray(state.settings.customMonthly?.serverIds)?state.settings.customMonthly.serverIds:[]);
    const changed=previous.size!==selected.size||ids.some(id=>!previous.has(id));
    if(changed)state.settings.customMonthly={serverIds:state.servers.filter(record=>selected.has(record.id)).map(record=>record.id)};
    const revision=changed?commit(state):state.revision;
    const customMonthly=calculateCustomMonthly(state.servers,state.settings.customMonthly?.serverIds,state.settings.rates);
    json(res,200,{revision,selectedCount:customMonthly.selectedCount,changed,customMonthly});return;
  }
  if(path==='/api/settings/costs/servers'&&method==='PUT'){
    const b=await body(req);auth(s);matchRevision(req);
    const ids=b.serverIds;
    if(!Array.isArray(ids)||ids.length>1000||ids.some(id=>typeof id!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id))||new Set(ids).size!==ids.length)throw fail(400,'请选择有效且不重复的服务器。');
    const state=vault.snapshot(),selected=new Set(ids),existing=new Set(state.servers.map(record=>record.id));
    if(ids.some(id=>!existing.has(id)))throw fail(400,'选择中包含不存在的服务器，请重新加载列表。');
    const updatedAt=new Date().toISOString();let changedCount=0;
    for(const record of state.servers){const excluded=!selected.has(record.id);if((record.excludeFromCosts===true)!==excluded){record.excludeFromCosts=excluded;record.updatedAt=updatedAt;changedCount++;}}
    const revision=changedCount?commit(state):state.revision;
    json(res,200,{revision,selectedCount:ids.length,changedCount});return;
  }
  if(path==='/api/settings/telegram/servers'&&method==='PUT'){
    const b=await body(req);auth(s);
    const ids=b.serverIds,confirmationId=b.confirmationId??randomUUID();
    if(!Array.isArray(ids)||ids.length>1000||ids.some(id=>typeof id!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id))||new Set(ids).size!==ids.length)throw fail(400,'请选择有效且不重复的机器。');
    if(typeof confirmationId!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(confirmationId))throw fail(400,'确认请求编号无效，请重新打开选择窗口。');
    const previous=selectionConfirmer.lookup(confirmationId,ids);
    if(previous){const confirmation=await selectionConfirmer.deliver(confirmationId);auth(s);json(res,200,{revision:vault.state.revision,selectedCount:ids.length,changedCount:0,confirmation});return;}
    matchRevision(req);
    const state=vault.snapshot(),selected=new Set(ids),existing=new Set(state.servers.map(record=>record.id));
    if(ids.some(id=>!existing.has(id)))throw fail(400,'选择中包含不存在的机器，请重新加载列表。');
    rate(req,'telegram-selection-confirm',12);
    const updatedAt=new Date().toISOString();let changedCount=0;
    for(const record of state.servers){const enabled=selected.has(record.id);if((record.expiryReminder===true)!==enabled){record.expiryReminder=enabled;record.updatedAt=updatedAt;changedCount++;}}
    selectionConfirmer.prepare(state,{confirmationId,serverIds:ids});
    if(changedCount)commit(state);else vault.save(state);
    const confirmation=await selectionConfirmer.deliver(confirmationId);auth(s);
    json(res,200,{revision:vault.state.revision,selectedCount:ids.length,changedCount,confirmation});if(changedCount)checkReminders();return;
  }
  if(path==='/api/settings/telegram'&&method==='PUT'){
    const b=await body(req);auth(s);matchRevision(req);
    // Validate before a costly password check; validate again against fresh state afterward.
    normalizeTelegram(b,vault.state.settings.telegram);
    await reauthenticate(req,b,s);auth(s);matchRevision(req);
    const state=vault.snapshot();state.settings.telegram=normalizeTelegram(b,state.settings.telegram);
    const revision=commit(state);json(res,200,{revision,telegram:publicTelegram(state.settings.telegram)});checkReminders();return;
  }
  if(path==='/api/settings/telegram/test'&&method==='POST'){
    const b=await body(req);await reauthenticate(req,b,s);auth(s);rate(req,'telegram-test',3);
    if(telegramTestInFlight)throw fail(409,'测试消息正在发送，请稍候。');
    const telegram=structuredClone(vault.state.settings.telegram||{});
    if(!publicTelegram(telegram).configured)throw fail(400,'请先保存 Bot Token 和 Chat ID。');
    telegramTestInFlight=true;
    try{await sendTelegram(telegram,'VPS 管家 · Telegram 测试消息\n连接成功。开启提醒的机器将在到期前 7 天收到通知。\n'+origin.origin);}
    catch(error){const safeMessage=error.deliveryState==='uncertain'?'发送结果暂时无法确认，请先检查 Telegram，避免重复发送。':'测试发送失败，请检查 Bot Token、Chat ID，并先向机器人发送 /start。';throw Object.assign(fail(502,safeMessage),{publicMessage:safeMessage});}
    finally{telegramTestInFlight=false;}
    auth(s);json(res,200,{ok:true,message:'测试消息已发送，请查看 Telegram。'});return;
  }
  if(path==='/api/settings/telegram/retry'&&method==='POST'){
    const b=await body(req);if(b.confirm!==true)throw fail(400,'请先确认已检查 Telegram，并接受重试可能产生重复消息。');
    await reauthenticate(req,b,s);auth(s);rate(req,'telegram-retry',3);
    const result=reminders.retryUncertain({confirmed:true});json(res,200,{ok:true,retried:result.resetCount});checkReminders();return;
  }
  const secrets=path.match(/^\/api\/servers\/([0-9a-f-]+)\/secrets$/i);
  if(secrets&&method==='POST'){await body(req);auth(s);const record=vault.state.servers.find(x=>x.id===secrets[1]);if(!record)throw fail(404,'服务器不存在。');json(res,200,{sshPassword:record.sshPassword||'',serverURLPassword:record.serverURLPassword||'',panelPassword:record.panelPassword||''});return;}
  const collection=path.match(/^\/api\/(servers|commands)(?:\/([0-9a-f-]+))?$/i);
  if(collection&&['POST','PUT','DELETE'].includes(method)){
    const type=collection[1],id=collection[2],normalize=type==='servers'?normalizeServer:normalizeCommand;
    const b=method==='DELETE'?{}:await body(req);auth(s);matchRevision(req);const state=vault.snapshot(),list=state[type],index=id?list.findIndex(x=>x.id===id):-1;
    if(id&&index<0)throw fail(404,'记录不存在。');
    let value;
    if(method==='POST'&&!id){if(list.length>=1000)throw fail(400,'最多保存 1000 条记录。');value=normalize(type==='servers'?{...b,renewalHistory:[]}:b);if(list.some(x=>x.id===value.id))throw fail(409,'记录编号重复。');list.unshift(value);}
    else if(method==='PUT'&&id){value=normalize(type==='servers'?{...b,renewalHistory:list[index].renewalHistory??[]}:b,list[index]);list[index]=value;}
    else if(method==='DELETE'&&id){list.splice(index,1);if(type==='servers'&&Array.isArray(state.settings.customMonthly?.serverIds))state.settings.customMonthly.serverIds=state.settings.customMonthly.serverIds.filter(serverId=>serverId!==id);}else throw fail(405,'不支持的操作。');
    const revision=commit(state);json(res,method==='POST'?201:200,{revision,...(value?{[type==='servers'?'server':'command']:type==='servers'?redactServer(value):value}:{})});if(type==='servers')checkReminders();return;
  }
  throw fail(404,'接口不存在。');
}catch(error){if(res.headersSent){res.end();return;}const status=Number(error.status)||500;if(status>=500)console.error(JSON.stringify({event:'request-failed',requestID,status}));json(res,status,{error:status>=500?(error.publicMessage||'服务暂时无法完成操作，请稍后重试。'):error.message,requestID});}};
const server=tlsOptions?https.createServer(tlsOptions,handler):http.createServer(handler);
server.requestTimeout=15000;server.headersTimeout=10000;server.keepAliveTimeout=5000;server.maxHeadersCount=50;
server.on('error',()=>{console.error('Unable to listen; existing services were not changed.');process.exit(1);});
server.listen(config.port,config.host,()=>{console.log(JSON.stringify({event:'ready',address:config.host,port:config.port,uid:process.getuid?.(),mode:config.mode}));reminders.start();backups.start();telegramQuery.start();Promise.resolve(selectionConfirmer.start()).catch(()=>console.error(JSON.stringify({event:'telegram-confirmation-recovery-failed'})));});
let shuttingDown=false;
for(const signal of ['SIGTERM','SIGINT'])process.on(signal,()=>{if(shuttingDown)return;shuttingDown=true;backups.stop();const stopped=Promise.all([reminders.stop(),selectionConfirmer.stop(),telegramQuery.stop()]);Promise.all([stopped,new Promise(resolve=>server.close(resolve))]).then(()=>process.exit(0),()=>process.exit(1));setTimeout(()=>process.exit(0),20000).unref();});
