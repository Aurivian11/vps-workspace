import { randomBytes, scrypt as scryptCallback, timingSafeEqual, createHmac, createHash } from 'node:crypto';
import { promisify } from 'node:util';
const scrypt = promisify(scryptCallback);
export const token = (n=32) => randomBytes(n).toString('base64url');
export const digest = value => createHash('sha256').update(String(value)).digest('hex');
export function equal(a,b) { const x=Buffer.from(String(a)), y=Buffer.from(String(b)); return x.length===y.length && timingSafeEqual(x,y); }
export function validatePassword(value) {
  if(typeof value!=='string'||value.length<14||value.length>128) throw Object.assign(new Error('请使用 14–128 位独立密码。'),{status:400});
  return value;
}
export async function hashPassword(password) {
  validatePassword(password); const salt=randomBytes(24).toString('base64url');
  const key=await scrypt(password,salt,64,{N:32768,r:8,p:1,maxmem:67108864});
  return {algorithm:'scrypt-v1',salt,hash:key.toString('base64url')};
}
export async function verifyPassword(password,record) {
  if(typeof password!=='string'||password.length>128) return false;
  const salt=record?.salt||'nonexistent-account-padding';
  const key=await scrypt(password,salt,64,{N:32768,r:8,p:1,maxmem:67108864});
  return !!record && record.algorithm==='scrypt-v1' && equal(key.toString('base64url'),record.hash);
}
const alphabet='ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
export function base32(bytes) { let bits=0,value=0,out=''; for(const byte of bytes){value=(value<<8)|byte;bits+=8;while(bits>=5){out+=alphabet[(value>>>(bits-5))&31];bits-=5;}} if(bits)out+=alphabet[(value<<(5-bits))&31]; return out; }
function decodeBase32(text) { let bits=0,value=0,out=[];for(const c of text){const n=alphabet.indexOf(c);if(n<0)throw Error('Invalid OTP secret');value=(value<<5)|n;bits+=5;if(bits>=8){out.push((value>>>(bits-8))&255);bits-=8;}}return Buffer.from(out); }
export function totp(secret,counter=Math.floor(Date.now()/30000)) { const b=Buffer.alloc(8);b.writeBigUInt64BE(BigInt(counter));const h=createHmac('sha1',decodeBase32(secret)).update(b).digest();const offset=h[19]&15;return String((h.readUInt32BE(offset)&0x7fffffff)%1000000).padStart(6,'0'); }
export function verifyTotp(secret,code,lastCounter=-1,now=Date.now()) {if(!/^\d{6}$/.test(String(code)))return null;const current=Math.floor(now/30000);for(const counter of [current,current-1,current+1])if(counter>lastCounter&&equal(totp(secret,counter),code))return counter;return null;}
export function newTotpSecret(){return base32(randomBytes(20));}
export class RateLimiter {
  constructor(){this.entries=new Map();}
  consume(key,limit=8,windowMs=900000){const now=Date.now();for(const[k,v]of this.entries)if(v.until<=now)this.entries.delete(k);if(this.entries.size>10000)return false;let e=this.entries.get(key);if(!e){e={n:0,until:now+windowMs};this.entries.set(key,e);}e.n++;return e.n<=limit;}
}
