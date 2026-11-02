import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {formatReminderTable} from '../lib/telegram-table.mjs';
const now = new Date('2026-10-29T14:00:00Z');
const digest = value => createHash('sha256').update(value).digest('hex');
const machine = (id,name,date,extra={}) => ({id,name,renewalDate:date,expiryReminder:true,...extra});
const fixture = servers => ({settings:{telegram:{enabled:true,botToken:'123456:PRIVATE-BOT-TOKEN',chatId:'987654321'}},servers,telegramDeliveries:{}});
const escape=value=>value.replace(/[&<>]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));
const items=messages=>messages.flatMap(message=>[...message.matchAll(/<b>([^\n]*?)<\/b>\n(?:(\d{4}-\d{2}-\d{2})  ·  <b>([^<\n]*)<\/b>|(未填写续费日期，暂无法提醒))(?:\n<i>([^<\n]*)<\/i>)?/gu)].map(match=>({name:match[1],date:match[2]||null,remaining:match[3]||null,missing:!!match[4],status:match[5]||null})));
function receipt(state,server,kind,date=server.renewalDate,chatId=state.settings.telegram.chatId) {
 const destination=digest(state.settings.telegram.botToken.split(':')[0]+'\n'+chatId);
 state.telegramDeliveries[digest(server.id+'\n'+date+'\n'+destination)]={state:kind,serverId:server.id,renewalDate:date};
}
function assertMobile(message) {
 assert.ok(message.length<3500);assert.ok(!/<\/?(?:pre|code|table|blockquote)\b/i.test(message));assert.ok(!/<(?!\/?(?:b|i)>)/.test(message));assert.ok(!message.includes('机器全名'));assert.ok(items([message]).length<=5);
 assert.match(message,/<i>北京时间：\d{4}-\d{2}-\d{2} \d{2}:\d{2}<\/i>$/);assert.equal((message.match(/北京时间：/g)||[]).length,1);
 const stack=[];for(const [,closing,tag]of message.matchAll(/<(\/?)(b|i)>/g)){if(closing)assert.equal(stack.pop(),tag);else stack.push(tag);}assert.equal(stack.length,0);
}

test('compact list shows only selected machines in expiry groups and hides redundant normal status',()=>{
 const state=fixture([machine('far','Later','2027-01-01'),machine('missing','No date',''),machine('near','Soon','2026-11-02'),machine('expired','Past','2026-10-28'),machine('off','Hidden','2026-10-29',{expiryReminder:false})]);
 const output=formatReminderTable(state,{now}),data=items(output);assert.equal(data.length,4);assertMobile(output[0]);assert.match(output[0],/^<b>VPS 到期提醒<\/b>/);assert.match(output[0],/已选 4 台 · 7 天内到期 1 台/);assert.ok(!/第 1\/1 页|自动提醒已开启/.test(output[0]));
 assert.deepEqual(data[0],{name:'Past',date:'2026-10-28',remaining:'已过期 1 天',missing:false,status:null});assert.deepEqual(data[1],{name:'Soon',date:'2026-11-02',remaining:'4 天后到期',missing:false,status:'等待发送'});assert.equal(data[2].name,'Later');assert.equal(data[2].status,null);assert.deepEqual(data[3],{name:'No date',date:null,remaining:null,missing:true,status:null});assert.ok(!output.join('').includes('Hidden'));
 const groups=['🔴 已过期','🟠 7 天内到期','🔵 后续提醒','⚪ 待补日期'];for(let i=1;i<groups.length;i++)assert.ok(output[0].indexOf(groups[i-1])<output[0].indexOf(groups[i]));
});

test('Beijing midnight changes remaining calendar day and timestamp appears only at the end',()=>{
 const state=fixture([machine('a','Next day','2026-10-30')]);assert.equal(items(formatReminderTable(state,{now:new Date('2026-10-29T15:59:00Z')}))[0].remaining,'1 天后到期');
 const output=formatReminderTable(state,{now:new Date('2026-10-29T16:01:00Z')});assert.match(output[0],/北京时间：2026-10-30 00:01<\/i>$/);assert.equal(items(output)[0].remaining,'今天到期');
});

test('seven-day and eight-day boundaries enter distinct groups and legacy dates work',()=>{
 const state=fixture([machine('a','Seven','2026-11-05'),machine('b','Eight',null,{renewalDateText:'2026/11/6'})]);const output=formatReminderTable(state,{now}),data=items(output);
 assert.equal(data[0].remaining,'7 天后到期');assert.equal(data[0].status,'等待发送');assert.equal(data[1].date,'2026-11-06');assert.equal(data[1].remaining,'8 天后到期');assert.equal(data[1].status,null);assert.match(output[0],/7 天内到期 1 台/);assert.match(output[0],/🟠 7 天内到期/);assert.match(output[0],/🔵 后续提醒/);assert.ok(!/🔴 已过期|⚪ 待补日期/.test(output[0]));
});

test('current destination and expiry receipts retain all exceptional delivery states',()=>{
 const servers=['sent','failed','uncertain','pending'].map((status,index)=>machine(String(index),status,'2026-11-01'));const state=fixture(servers);servers.forEach(server=>receipt(state,server,server.name));assert.deepEqual(new Set(items(formatReminderTable(state,{now})).map(item=>item.status)),new Set(['✓ 已发送','⚠ 发送失败','⚠ 待确认','发送中']));
 const changed=fixture([machine('a','Changed','2026-11-01')]);receipt(changed,changed.servers[0],'sent','2026-10-31');receipt(changed,changed.servers[0],'failed','2026-11-01','222222');assert.equal(items(formatReminderTable(changed,{now}))[0].status,'等待发送');
});

test('paused and unconfigured reminders appear once globally without repetitive per-machine statuses',()=>{
 const state=fixture([machine('a','Soon','2026-11-01'),machine('b','Missing','')]);state.settings.telegram.enabled=false;let output=formatReminderTable(state,{now});assert.equal((output[0].match(/自动提醒已暂停/g)||[]).length,1);assert.equal(items(output)[0].status,null);assert.equal(items(output)[1].missing,true);
 state.settings.telegram.enabled=true;state.settings.telegram.botToken='';output=formatReminderTable(state,{now});assert.equal((output[0].match(/自动提醒未配置/g)||[]).length,1);assert.equal(items(output)[0].status,null);
});

test('empty selection gives guidance without empty groups',()=>{
 const output=formatReminderTable(fixture([machine('off','Unselected','2026-11-01',{expiryReminder:false})]),{now});assert.equal(output.length,1);assert.match(output[0],/已选 0 台/);assert.match(output[0],/尚未选择/);assert.equal(items(output).length,0);assert.ok(!/🔴|🟠|🔵|⚪/.test(output[0]));assertMobile(output[0]);
});

test('HTML is escaped and control characters cannot inject entries or conceal fields',()=>{
 const output=formatReminderTable(fixture([machine('a','<b>&X\nY\tZ\u202e','2026-11-01')]),{now}),data=items(output);assert.equal(data.length,1);assert.equal(data[0].name,'&lt;b&gt;&amp;X Y Z');assert.ok(!output[0].includes('\u202e'));assert.ok(!output[0].includes('\t'));assertMobile(output[0]);
});

test('Latin, CJK, full-width, emoji and long names remain complete with wrapping text',()=>{
 const names=['A','香港','ＡＢ','🖥️机器','这是一个很长很长很长的机器名称','e\u0301'];const output=formatReminderTable(fixture(names.map((name,index)=>machine(String(index),name,'2026-11-01'))),{now});assert.equal(output.length,2);assert.deepEqual(new Set(items(output).map(item=>item.name)),new Set(names.map(name=>name.normalize('NFC'))));for(const message of output){assertMobile(message);assert.ok(!/ {3,}/.test(message));assert.ok(!message.includes('...'));}
});

test('only reminder metadata is emitted and source state stays unchanged',()=>{
 const state=fixture([machine('a','Visible','2026-11-01',{ipAddress:'PRIVATE-IP',username:'PRIVATE-USER',sshPassword:'PRIVATE-SSH',serverURLPassword:'PRIVATE-CONSOLE',panelPassword:'PRIVATE-PANEL',notes:'PRIVATE-NOTES'})]);state.account={password:'PRIVATE-ACCOUNT'};const before=structuredClone(state),output=formatReminderTable(state,{now}).join('');for(const secret of ['PRIVATE-IP','PRIVATE-USER','PRIVATE-SSH','PRIVATE-CONSOLE','PRIVATE-PANEL','PRIVATE-NOTES','PRIVATE-ACCOUNT','PRIVATE-BOT-TOKEN','987654321'])assert.ok(!output.includes(secret));assert.deepEqual(state,before);
});

test('1000 machines paginate at five per message, repeating only the nonempty group heading',()=>{
 const names=Array.from({length:1000},(_,index)=>'&&&&&&&&&&&&&&&&'+String(index).padStart(4,'0'));const output=formatReminderTable(fixture(names.map((name,index)=>machine(String(index),name,'2026-11-01'))),{now}),data=items(output);assert.equal(output.length,200);assert.equal(data.length,1000);assert.deepEqual(data.map(item=>item.name),names.map(escape));for(const [index,message]of output.entries()){assertMobile(message);assert.equal(items([message]).length,5);assert.match(message,new RegExp('第 '+(index+1)+'/'+output.length+' 页'));assert.equal((message.match(/<b>🟠 7 天内到期<\/b>/g)||[]).length,1);assert.ok(!/🔴 已过期|🔵 后续提醒|⚪ 待补日期/.test(message));}
});

test('invalid dates are grouped as missing and invalid query times are rejected',()=>{
 const state=fixture([machine('a','Invalid','2026-02-30')]),output=formatReminderTable(state,{now});assert.equal(items(output)[0].missing,true);assert.match(output[0],/⚪ 待补日期/);assert.throws(()=>formatReminderTable(state,{now:'not-a-date'}),TypeError);
});

test('near-identical long names preserve identifying tails in their headings',()=>{
 const prefix='Ciallo · 香港高防公网备用节点组',names=[prefix+'机器 01',prefix+'机器 02'];const output=formatReminderTable(fixture(names.map((name,index)=>machine(String(index),name,'2026-11-01'))),{now});assert.equal(output.length,1);assert.deepEqual(items(output).map(item=>item.name),names);assert.ok(!output[0].includes('机器全名'));assert.ok(!output[0].includes('...'));assertMobile(output[0]);
});

test('escaped 120-character names stay in whole entries under the message limit without duplication',()=>{
 const names=Array.from({length:200},(_,index)=>'<>&'.repeat(39)+String(index).padStart(3,'0'));const output=formatReminderTable(fixture(names.map((name,index)=>machine(String(index),name,'2026-11-01'))),{now}),data=items(output);assert.ok(output.length>1);assert.equal(data.length,names.length);assert.deepEqual(data.map(item=>item.name),names.map(escape));for(const message of output){assertMobile(message);assert.ok(items([message]).length>=1);}
});
