import { createHash } from 'node:crypto';
import { parseRenewalDate } from './renewal-date.mjs';
const CURRENCIES = new Set(['CNY','USD','HKD','EUR','JPY','GBP','CAD']);
const MONTHS = Object.freeze({monthly:1,quarterly:3,yearly:12});
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_HISTORY = 1000;
function invalid(message,status=400){const error=new Error(message);error.status=status;throw error;}
function object(value){
 if(!value||typeof value!=='object'||Array.isArray(value)||![Object.prototype,null].includes(Object.getPrototypeOf(value)))invalid('请检查续费记录格式。');
 return value;
}
function id(value){
 if(typeof value!=='string'||!UUID.test(value))invalid('续费请求编号无效，请重新打开续费窗口。');
 return value.toLowerCase();
}
function date(value,optional=false){
 if(optional&&(value===undefined||value===null||value===''))return null;
 if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value))invalid('续费日期必须是有效的年-月-日。');
 const parsed=parseRenewalDate(value);
 if(!parsed||value<'0001-01-01')invalid('续费日期必须是有效的年-月-日。');
 return parsed.date;
}
function amount(value){
 if(typeof value!=='string'||value.length>40)invalid('请填写有效的实际支付金额。');
 const raw=value.trim();
 if(!/^(?:\d{1,9}(?:\.\d{1,6})?|\.\d{1,6})$/.test(raw))invalid('实际支付金额须为非负数字，最多 9 位整数和 6 位小数。');
 const [whole='0',fraction='']=raw.split('.');
 const integer=(whole||'0').replace(/^0+(?=\d)/,'');
 const decimal=fraction.replace(/0+$/,'');
 return integer+(decimal?`.${decimal}`:'');
}
function currency(value){if(typeof value!=='string'||!CURRENCIES.has(value))invalid('请选择支持的支付币种。');return value;}
function cycle(value){if(typeof value!=='string'||!Object.hasOwn(MONTHS,value))invalid('请选择月付、季付或年付。');return value;}
function periods(value){if(!Number.isInteger(value)||value<1||value>120)invalid('续费周期数量须为 1 至 120 的整数。');return value;}
function note(value=''){
 if(typeof value!=='string'||value.length>1000||value.includes('\0'))invalid('续费备注不能超过 1000 个字符。');
 return value.trim();
}
function timestamp(value){
 if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value))invalid('续费记录时间无效。');
 const parsed=new Date(value);
 if(!Number.isFinite(parsed.getTime())||parsed.toISOString()!==value)invalid('续费记录时间无效。');
 return value;
}
function existingExpiry(server){
 const found=parseRenewalDate(server.renewalDate)||parseRenewalDate(server.renewalDateText);
 return found&&found.date>='0001-01-01'?found.date:null;
}
function addMonths(base,count){
 const [year,month,day]=base.split('-').map(Number);
 const offset=year*12+month-1+count;
 const nextYear=Math.floor(offset/12),nextMonth=offset%12;
 if(nextYear>9999)invalid('续费后的到期日期超出支持范围。');
 const last=new Date(0);last.setUTCFullYear(nextYear,nextMonth+1,0);last.setUTCHours(0,0,0,0);
 return [String(nextYear).padStart(4,'0'),String(nextMonth+1).padStart(2,'0'),String(Math.min(day,last.getUTCDate())).padStart(2,'0')].join('-');
}
// Calendar arithmetic intentionally does not convert the original date's timezone.
export function suggestRenewalDate(server,billingCycle,count,baseDate){
 object(server);
 const interval=MONTHS[cycle(billingCycle)]*periods(count);
 const base=date(baseDate,true)||existingExpiry(server);
 if(!base)invalid('这台机器没有有效到期日，请填写续费起算日或新的到期日。');
 return addMonths(base,interval);
}
export function normalizeRenewalHistory(value){
 if(value===undefined||value===null)return [];
 if(!Array.isArray(value)||value.length>MAX_HISTORY)invalid('续费历史格式无效或超过 1000 条。');
 const seen=new Set();
 return value.map(raw=>{
  object(raw);
  const requestId=id(raw.requestId);
  if(id(raw.id)!==requestId||seen.has(requestId))invalid('续费历史包含重复或不一致的编号。');
  seen.add(requestId);
  if(typeof raw.requestFingerprint!=='string'||!/^[a-f0-9]{64}$/.test(raw.requestFingerprint))invalid('续费记录校验信息无效。');
  const previousExpiry=date(raw.previousExpiry,true),newExpiry=date(raw.newExpiry),baseDate=date(raw.baseDate,true);
  if((previousExpiry&&newExpiry<=previousExpiry)||(baseDate&&newExpiry<=baseDate))invalid('续费后的到期日必须晚于原到期日和起算日。');
  return {
   id:requestId,requestId,requestFingerprint:raw.requestFingerprint,
   previousExpiry,newExpiry,baseDate,
   amount:amount(raw.amount),currency:currency(raw.currency),cycle:cycle(raw.cycle),periods:periods(raw.periods),
   paidOn:date(raw.paidOn),note:note(raw.note),createdAt:timestamp(raw.createdAt),
  };
 });
}
export function recordRenewal(server,input,{now=()=>new Date()}={}){
 object(server);object(input);
 const requestId=id(input.requestId);
 const payload={
  amount:amount(input.amount),currency:currency(input.currency),cycle:cycle(input.cycle),periods:periods(input.periods),
  paidOn:date(input.paidOn),newExpiry:date(input.newExpiry,true),baseDate:date(input.baseDate,true),note:note(input.note),
 };
 const requestFingerprint=createHash('sha256').update(JSON.stringify(payload)).digest('hex');
 const history=normalizeRenewalHistory(server.renewalHistory);
 const duplicate=history.find(record=>record.requestId===requestId);
 if(duplicate){
  if(duplicate.requestFingerprint!==requestFingerprint)invalid('这次续费请求已处理，但内容不一致。请刷新后重新操作。',409);
  return {server,record:duplicate,duplicate:true};
 }
 if(history.length>=MAX_HISTORY)invalid('这台机器已达到 1000 条续费记录上限。');
 const previousExpiry=existingExpiry(server);
 const baseDate=payload.baseDate||previousExpiry;
 const newExpiry=payload.newExpiry||suggestRenewalDate(server,payload.cycle,payload.periods,baseDate);
 if((previousExpiry&&newExpiry<=previousExpiry)||(baseDate&&newExpiry<=baseDate))invalid('续费后的到期日必须晚于原到期日和起算日。');
 const current=now();
 if(!(current instanceof Date)||!Number.isFinite(current.getTime()))invalid('续费记录时间无效。');
 const createdAt=timestamp(current.toISOString());
 const record={
  id:requestId,requestId,requestFingerprint,previousExpiry,newExpiry,baseDate,
  amount:payload.amount,currency:payload.currency,cycle:payload.cycle,periods:payload.periods,
  paidOn:payload.paidOn,note:payload.note,createdAt,
 };
 return {
  server:{...server,renewalDate:`${newExpiry}T00:00:00.000Z`,renewalDateText:newExpiry,renewalHistory:[...history,record],updatedAt:createdAt},
  record,duplicate:false,
 };
}
