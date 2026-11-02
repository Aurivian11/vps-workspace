import test from 'node:test';
import assert from 'node:assert/strict';
import {createClientIPResolver} from '../lib/request-ip.mjs';
const req=(peer,headers={})=>({socket:{remoteAddress:peer},headers});
test('direct clients cannot choose their rate-limit address using proxy headers',()=>{
  const resolve=createClientIPResolver();
  assert.equal(resolve(req('198.51.100.8',{'x-real-ip':'203.0.113.9','x-forwarded-for':'203.0.113.10'})),'198.51.100.8');
  assert.equal(createClientIPResolver(['172.18.0.2'])(req('198.51.100.8',{'x-real-ip':'203.0.113.9'})),'198.51.100.8');
});
test('an explicit trusted proxy may supply one valid X-Real-IP address',()=>{
  const resolve=createClientIPResolver(['172.18.0.2']);
  assert.equal(resolve(req('172.18.0.2',{'x-real-ip':'203.0.113.9','x-forwarded-for':'198.51.100.99'})),'203.0.113.9');
  assert.equal(resolve(req('::ffff:172.18.0.2',{'x-real-ip':'2001:0db8:0:0:0:0:0:1'})),'2001:db8::1');
  assert.equal(resolve(req('::ffff:ac12:2',{'x-real-ip':'::ffff:203.0.113.9'})),'203.0.113.9');
});
test('malformed or multiple client IPs fall back to the trusted socket peer',()=>{
  const resolve=createClientIPResolver(['172.18.0.2']);
  for(const value of [undefined,'','unknown','203.0.113.1, 198.51.100.1',['203.0.113.1'],'203.0.113.1:5000','fe80::1%eth0'])assert.equal(resolve(req('172.18.0.2',{'x-real-ip':value,'x-forwarded-for':'198.51.100.9'})),'172.18.0.2');
});
test('trusted proxies require explicit valid IP addresses',()=>{
  for(const value of [null,'172.18.0.2',{},['*'],['172.18.0.0/16'],['localhost'],['fe80::1%eth0']])assert.throws(()=>createClientIPResolver(value));
});
