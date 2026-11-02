import fs from 'node:fs';
import {dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomBytes} from 'node:crypto';
import {unseal,seal} from '../lib/vault.mjs';
process.chdir(dirname(dirname(fileURLToPath(import.meta.url))));
if(process.getuid?.()!==0)throw Error('Run restore as the project administrator.');
const source=process.argv[2];
if(!/^runtime\/backups\/[A-Za-z0-9_.-]+\.vpsvault$/.test(source||'')||!fs.lstatSync(source).isFile()||fs.lstatSync(source).isSymbolicLink())throw Error('Choose an existing project backup file.');
if(!process.env.VPS_CONFIG&&fs.existsSync('.private/server.pid')){try{process.kill(Number(fs.readFileSync('.private/server.pid','utf8')),0);throw Error('Stop the service with bin/stop.sh before restoring.');}catch(error){if(error.code!=='ESRCH')throw error;}}
const config=JSON.parse(fs.readFileSync(process.env.VPS_CONFIG||'.private/config.json','utf8')),key=Buffer.from(config.key,'base64');
const decoded=unseal(fs.readFileSync(source,'utf8'),key);
const value=decoded?.format==='vps-backup'&&decoded.version===1?decoded.workspace:decoded;
if(value.version!==1||!Array.isArray(value.servers)||!Array.isArray(value.commands))throw Error('Invalid backup data.');
const target=config.vaultFile||'runtime/workspace.vault';
if(!/^runtime\/[a-zA-Z0-9_./-]+$/.test(target)||target.includes('..'))throw Error('Invalid vault destination.');
const temporary=target+'.restore-'+randomBytes(10).toString('hex');let fd;
try{fd=fs.openSync(temporary,'wx',0o600);fs.writeFileSync(fd,seal(value,key));fs.fchownSync(fd,config.serviceUID,config.serviceGID);fs.fsyncSync(fd);fs.closeSync(fd);fd=undefined;fs.renameSync(temporary,target);const directory=fs.openSync(dirname(target),'r');fs.fsyncSync(directory);fs.closeSync(directory);console.log('Encrypted backup authenticated and restored. Credentials and 2FA reflect the selected backup.');}finally{if(fd!==undefined)fs.closeSync(fd);if(fs.existsSync(temporary))fs.unlinkSync(temporary);}
