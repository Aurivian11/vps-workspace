import fs from 'node:fs';
import {seal} from '../lib/vault.mjs';
import {DEFAULT_RATES} from '../lib/domain.mjs';
import { randomBytes,createHash } from 'node:crypto';
for(const directory of ['.private','runtime','runtime/backups']){if(fs.existsSync(directory)&&(!fs.lstatSync(directory).isDirectory()||fs.lstatSync(directory).isSymbolicLink()))throw Error('Refusing unsafe project directory.');}
if(fs.existsSync('.private/config.json'))throw Error('Already initialized; existing keys were preserved.');
const setup=randomBytes(32).toString('base64url');
const config={mode:'private',origin:'http://127.0.0.1:8787',host:'127.0.0.1',port:8787,serviceUID:62031,serviceGID:62031,key:randomBytes(32).toString('base64'),setupHash:createHash('sha256').update(setup).digest('hex')};
fs.mkdirSync('.private',{recursive:true,mode:0o700});fs.mkdirSync('runtime/backups',{recursive:true,mode:0o700});
fs.writeFileSync('.private/config.json',JSON.stringify(config,null,2)+'\n',{mode:0o600,flag:'wx'});
fs.writeFileSync('.private/setup-token',setup+'\n',{mode:0o600,flag:'wx'});
fs.chmodSync('.',0o755);fs.chmodSync('runtime',0o700);fs.chownSync('runtime',config.serviceUID,config.serviceGID);fs.chownSync('runtime/backups',config.serviceUID,config.serviceGID);
const initial={version:1,revision:0,account:null,servers:[],commands:[],settings:{rates:DEFAULT_RATES,rateSource:'应用内参考汇率 · 仅供估算'}};
fs.writeFileSync('runtime/workspace.vault',seal(initial,Buffer.from(config.key,'base64')),{mode:0o600,flag:'wx'});
fs.chownSync('runtime/workspace.vault',config.serviceUID,config.serviceGID);
console.log('Initialized private loopback service. Keys and setup token remain only in /root/VPS/.private.');
