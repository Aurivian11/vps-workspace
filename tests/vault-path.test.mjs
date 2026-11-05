import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
const moduleURL=new URL('../lib/vault.mjs',import.meta.url).href;
for(const absolute of [false,true])test(`custom vault directory works without a runtime folder (${absolute?'absolute':'relative'})`,()=>{
 const workspace=fs.mkdtempSync(resolve('tmp/vault-path-'));
 try{
  fs.mkdirSync(resolve(workspace,'custom-state'),{mode:0o700});
  const file=absolute?resolve(workspace,'custom-state/workspace.vault'):'custom-state/workspace.vault';
  const code=`import assert from 'node:assert/strict';import fs from 'node:fs';import {randomBytes} from 'node:crypto';import {Vault} from ${JSON.stringify(moduleURL)};
const key=randomBytes(32),initial={version:1,revision:0,servers:[],commands:[]};
assert.equal(fs.existsSync('runtime'),false);
const vault=new Vault(${JSON.stringify(file)},key,initial);const next=vault.snapshot();next.revision++;next.servers.push({name:'Synthetic custom-path record'});vault.save(next);
assert.deepEqual(new Vault(${JSON.stringify(file)},key,{}).snapshot(),next);assert.equal(fs.existsSync('runtime'),false);assert.equal(fs.statSync(${JSON.stringify(file)}).mode&0o777,0o600);`;
  const result=spawnSync(process.execPath,['--input-type=module','-e',code],{cwd:workspace,env:process.env,encoding:'utf8'});
  assert.equal(result.status,0,result.stderr);
 }finally{fs.rmSync(workspace,{recursive:true,force:true});}
});
