import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {normalizeRenewalHistory,recordRenewal,suggestRenewalDate} from '../lib/renewals.mjs';
const now=()=>new Date('2026-10-21T02:00:00.000Z');
const base=()=>({id:randomUUID(),name:'Fixture',renewalDate:'2026-10-31T00:00:00.000Z',renewalDateText:'2026/10/31',monthlyCostAmount:'13.73',monthlyCostCurrency:'CNY',monthlyCostCycle:'monthly',excludeFromCosts:true,expiryReminder:true,sshPassword:'fixture-secret',panelPassword:'fixture-panel',domains:[{domain:'example.test'}],notes:'unchanged'});
const input=(extra={})=>({requestId:randomUUID(),amount:'13.73',currency:'CNY',cycle:'monthly',periods:1,paidOn:'2026-10-21',note:'已在商家续费',...extra});
const bad=fn=>assert.throws(fn,error=>error.status===400);

test('record only changes expiry, history and updatedAt; does not change planned price or secrets',()=>{
 const server=base(),original=structuredClone(server),request=input({amount:'8.5',currency:'USD',cycle:'yearly'});
 const result=recordRenewal(server,request,{now});
 assert.deepEqual(server,original);assert.equal(result.duplicate,false);
 assert.equal(result.server.renewalDate,'2027-10-31T00:00:00.000Z');
 assert.equal(result.server.renewalDateText,'2027-10-31');
 assert.equal(result.server.updatedAt,now().toISOString());
 for(const key of Object.keys(original).filter(key=>!['renewalDate','renewalDateText','updatedAt'].includes(key)))assert.deepEqual(result.server[key],original[key],key);
 assert.equal(result.record.amount,'8.5');assert.equal(result.record.currency,'USD');
 assert.equal(result.record.previousExpiry,'2026-10-31');assert.equal(result.record.baseDate,'2026-10-31');
 assert.equal(result.record.id,request.requestId);assert.deepEqual(result.server.renewalHistory,[result.record]);
});

test('monthly and quarterly dates clamp month-end; leap years and multiple periods use total months',()=>{
 for(const [date,cycle,periods,expected] of [
  ['2027-01-31','monthly',1,'2027-02-28'],['2028-01-31','monthly',1,'2028-02-29'],
  ['2028-02-29','yearly',1,'2029-02-28'],['2026-11-30','quarterly',1,'2027-02-28'],
  ['2027-01-31','monthly',2,'2027-03-31'],['2026-12-31','quarterly',2,'2027-06-30'],
  ['2026-10-21','yearly',120,'2146-10-21'],['0099-01-31','monthly',1,'0099-02-28'],
 ])assert.equal(suggestRenewalDate({renewalDateText:date},cycle,periods),expected);
});

test('calendar dates retain meaning without timezone conversion and fall back to legacy text',()=>{
 assert.equal(suggestRenewalDate({renewalDate:'2026-10-31T23:00:00-08:00'},'monthly',1),'2026-11-30');
 assert.equal(suggestRenewalDate({renewalDate:null,renewalDateText:'2026/10/31'},'monthly',1),'2026-11-30');
 assert.equal(suggestRenewalDate({renewalDate:'invalid',renewalDateText:'2026-10-31'},'monthly',1),'2026-11-30');
});

test('overdue subscription extends the recorded due date rather than silently starting today',()=>{
 const result=recordRenewal({...base(),renewalDate:'2025-01-31T00:00:00.000Z'},input(),{now});
 assert.equal(result.record.newExpiry,'2025-02-28');
});

test('missing expiry requires an explicit base or explicit new expiry',()=>{
 const server={...base(),renewalDate:null,renewalDateText:'无期'};
 bad(()=>recordRenewal(server,input(),{now}));
 const based=recordRenewal(server,input({baseDate:'2026-10-21'}),{now});
 assert.equal(based.record.newExpiry,'2026-11-21');assert.equal(based.record.previousExpiry,null);
 const explicit=recordRenewal(server,input({newExpiry:'2027-01-01'}),{now});
 assert.equal(explicit.record.newExpiry,'2027-01-01');assert.equal(explicit.record.baseDate,null);
});

test('explicit expiry and base are supported without permitting expiry rollback',()=>{
 assert.equal(recordRenewal(base(),input({newExpiry:'2026-12-15'}),{now}).record.newExpiry,'2026-12-15');
 assert.equal(recordRenewal(base(),input({baseDate:'2026-12-01'}),{now}).record.newExpiry,'2027-01-01');
 for(const extra of [{newExpiry:'2026-10-31'},{newExpiry:'2026-10-30'},{baseDate:'2026-01-01'},{baseDate:'2027-01-01',newExpiry:'2027-01-01'}])bad(()=>recordRenewal(base(),input(extra),{now}));
});

test('idempotent retries do not extend again; changed payload conflicts',()=>{
 const request=input(),first=recordRenewal(base(),request,{now});
 const retry=recordRenewal(first.server,{...request,amount:'013.7300',note:' 已在商家续费 '},{now:()=>{throw Error('should not timestamp a duplicate')}});
 assert.equal(retry.duplicate,true);assert.equal(retry.server,first.server);assert.deepEqual(retry.record,first.record);
 for(const extra of [{amount:'15'},{currency:'USD'},{cycle:'yearly'},{periods:2},{paidOn:'2026-10-22'},{note:'different'},{baseDate:'2026-10-31'},{newExpiry:'2026-11-30'}])assert.throws(()=>recordRenewal(first.server,{...request,...extra},{now}),error=>error.status===409);
});

test('subsequent distinct renewals append history; canonical history round-trips',()=>{
 const first=recordRenewal(base(),input(),{now});
 const second=recordRenewal(first.server,input(),{now});
 assert.equal(second.server.renewalHistory.length,2);assert.equal(second.record.previousExpiry,'2026-11-30');assert.equal(second.record.newExpiry,'2026-12-30');
 assert.deepEqual(normalizeRenewalHistory(JSON.parse(JSON.stringify(second.server.renewalHistory))),second.server.renewalHistory);
 assert.deepEqual(normalizeRenewalHistory(undefined),[]);assert.deepEqual(normalizeRenewalHistory(null),[]);
});

test('amounts preserve precision and normalize equivalent decimal input, including zero',()=>{
 for(const [value,expected] of [['0','0'],['00.000','0'],['.5','0.5'],['0013.7300','13.73'],['999999999.999999','999999999.999999'],[' 0.000001 ','0.000001']])assert.equal(recordRenewal(base(),input({amount:value}),{now}).record.amount,expected);
 for(const value of ['',null,0,-1,'-1','1e3','Infinity','1,000','1000000000','0.0000001','1.','NaN'])bad(()=>recordRenewal(base(),input({amount:value}),{now}));
});

test('validation rejects malformed input and unsafe calendar values',()=>{
 for(const extra of [
  {requestId:'invalid'},{currency:'BTC'},{currency:'cny'},{cycle:'weekly'},{cycle:'toString'},
  {periods:0},{periods:121},{periods:1.5},{periods:'1'},{paidOn:'2027-02-29'},
  {paidOn:'2028-02-30'},{paidOn:'2026-1-1'},{paidOn:'2026-10-21T00:00:00Z'},{paidOn:'0000-01-01'},
  {newExpiry:'2027-02-30'},{baseDate:'no date'},{note:'a'.repeat(1001)},{note:'a\0b'},
 ])bad(()=>recordRenewal(base(),input(extra),{now}));
 bad(()=>recordRenewal(null,input(),{now}));bad(()=>recordRenewal(base(),[],{now}));
 bad(()=>recordRenewal(base(),input(),{now:()=>new Date(NaN)}));
 bad(()=>suggestRenewalDate({renewalDateText:'9999-12-31'},'monthly',1));
});

test('history rejects malformed, duplicate or contradictory records without dropping evidence',()=>{
 const record=recordRenewal(base(),input(),{now}).record;
 for(const history of [{},[null],[record,record],[{...record,id:randomUUID()}],[{...record,requestFingerprint:'bad'}],[{...record,amount:'-1'}],[{...record,newExpiry:record.previousExpiry}],[{...record,createdAt:'2026-02-30T00:00:00.000Z'}]])bad(()=>normalizeRenewalHistory(history));
 const history=Array.from({length:1000},()=>{const requestId=randomUUID();return {...record,id:requestId,requestId};});
 assert.equal(normalizeRenewalHistory(history).length,1000);
 bad(()=>recordRenewal({...base(),renewalHistory:history},input(),{now}));
 bad(()=>normalizeRenewalHistory([...history,{...record}]));
 const request=input(),first=recordRenewal(base(),request,{now});
 const full=[first.record,...history.slice(1)];
 assert.equal(recordRenewal({...first.server,renewalHistory:full},request,{now}).duplicate,true);
});
