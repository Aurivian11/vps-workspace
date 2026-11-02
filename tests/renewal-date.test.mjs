import test from 'node:test';import assert from 'node:assert/strict';
import {parseRenewalDate} from '../lib/renewal-date.mjs';
import {createReminderWorker} from '../lib/telegram.mjs';
import {createSelectionConfirmer} from '../lib/telegram-confirmation.mjs';
import {randomUUID} from 'node:crypto';
const vaultOf=state=>({state,snapshot(){return structuredClone(this.state)},save(next){this.state=next}});
const config={enabled:true,botToken:'123456789:ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijk',chatId:'123456789'};
test('imported calendar dates parse without timezone shifting and reject invalid dates',()=>{
 for(const [value,expected] of [['2027-3-1','2027-03-01'],['2027-11-6','2027-11-06'],['2026-11-11','2026-11-11'],['2028-5-27','2028-05-27'],['2027-4-26','2027-04-26'],['2028/2/29','2028-02-29'],['2026-11-11T00:00:00.000Z','2026-11-11']])assert.equal(parseRenewalDate(value).date,expected);
 for(const value of ['无期','2027-2-29','2026-13-1','2026-2-31','2026-0-1','',null,{}])assert.equal(parseRenewalDate(value),null);
});
test('legacy text-only expiry triggers seven-day reminder, dedupes and confirms correct missing count',async()=>{
 const servers=[{id:randomUUID(),name:'Legacy due date',expiryReminder:true,renewalDate:null,renewalDateText:'2026-11-11'},{id:randomUUID(),name:'No expiry',expiryReminder:true,renewalDate:null,renewalDateText:'无期'}];
 const vault=vaultOf({version:1,revision:1,servers,commands:[],settings:{telegram:config}});const sent=[];
 const send=async(c,text)=>{sent.push(text);return{messageId:sent.length}};
 const now=()=>new Date('2026-11-04T01:00:00Z');
 const worker=createReminderWorker({vault,origin:'https://example.com',now,send});
 await worker.tick();assert.equal(sent.length,1);assert.match(sent[0],/2026-11-11/);await worker.tick();assert.equal(sent.length,1);
 const confirmer=createSelectionConfirmer({vault,origin:'https://example.com',now,send});const state=vault.snapshot(),confirmationId=randomUUID();confirmer.prepare(state,{confirmationId,serverIds:servers.map(s=>s.id)});vault.save(state);await confirmer.deliver(confirmationId);
 assert.equal(sent.length,2);assert.match(sent[1],/Legacy due date — 2026-11-11/);assert.match(sent[1],/1 台未填写有效到期日期/);assert.equal(vault.state.servers[0].renewalDate,null);assert.equal(vault.state.servers[0].renewalDateText,'2026-11-11');
});
