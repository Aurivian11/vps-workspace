import fs from 'node:fs';
import { dirname } from 'node:path';
import { randomBytes, createCipheriv, createDecipheriv } from 'node:crypto';
const AAD=Buffer.from('VPS-PRIVATE-WORKSPACE-V1');
export function seal(value,key){const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key,iv);cipher.setAAD(AAD);const encrypted=Buffer.concat([cipher.update(JSON.stringify(value),'utf8'),cipher.final()]);return JSON.stringify({version:1,iv:iv.toString('base64'),tag:cipher.getAuthTag().toString('base64'),ciphertext:encrypted.toString('base64')});}
export function unseal(text,key){const x=JSON.parse(text);if(x.version!==1||typeof x.iv!=='string'||typeof x.tag!=='string'||typeof x.ciphertext!=='string'||Buffer.from(x.iv,'base64').length!==12||Buffer.from(x.tag,'base64').length!==16)throw Error('Unsupported vault format');const decipher=createDecipheriv('aes-256-gcm',key,Buffer.from(x.iv,'base64'));decipher.setAAD(AAD);decipher.setAuthTag(Buffer.from(x.tag,'base64'));return JSON.parse(Buffer.concat([decipher.update(Buffer.from(x.ciphertext,'base64')),decipher.final()]).toString('utf8'));}
export class Vault {
  constructor(file,key,initial){this.file=file;this.key=key;if(fs.existsSync(file)){this.state=unseal(fs.readFileSync(file,'utf8'),key);if(this.state.version!==1||!Array.isArray(this.state.servers)||!Array.isArray(this.state.commands))throw Error('Invalid vault schema');}else{this.state=initial;this.save(initial);}}
  save(next){const content=seal(next,this.key),temp=`${this.file}.${randomBytes(8).toString('hex')}.pending`;let fd;try{fd=fs.openSync(temp,'wx',0o600);fs.writeFileSync(fd,content);fs.fsyncSync(fd);fs.closeSync(fd);fd=undefined;fs.renameSync(temp,this.file);const dir=fs.openSync(dirname(this.file),'r');try{fs.fsyncSync(dir);}finally{fs.closeSync(dir);}this.state=next;}finally{if(fd!==undefined)fs.closeSync(fd);if(fs.existsSync(temp))fs.unlinkSync(temp);}}
  snapshot(){return structuredClone(this.state);}
}
