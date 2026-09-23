import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { makeBasicCredential, makeApiCredential, validateAuthDocument,
  readAuthPolicies, createAppAuth } from '../../src/app-auth.js';

const basic = makeBasicCredential('alice', 'some-long-secret-password');
const api = makeApiCredential('service');
const doc = { version:1, policies:[
  {path:'/staging',mode:'basic',credentials:[basic]},
  {path:'/api/private',mode:'api_key',credentials:[api.credential]}
]};
function request(headers){return {headers:{...headers}};}

test('passwords and API keys are not stored in the policy document',()=>{
  const encoded=JSON.stringify(doc);
  assert.doesNotMatch(encoded,/some-long-secret-password/);
  assert.doesNotMatch(encoded,new RegExp(api.key));
  assert.equal(api.key.length,46);
  assert.equal(validateAuthDocument(doc).length,2);
});
test('bad paths, duplicate policies, invalid credentials, and unknown fields are rejected',()=>{
  for(const bad of [
    {...doc,extra:true},
    {version:1,policies:[...doc.policies,...doc.policies]},
    {version:1,policies:[{...doc.policies[0],path:'/anchor'}]},
    {version:1,policies:[{...doc.policies[0],path:'/ready'}]},
    {version:1,policies:[{...doc.policies[0],path:'//evil'}]},
    {version:1,policies:[{...doc.policies[0],path:'/staging/%2f'}]},
    {version:1,policies:[{...doc.policies[0],credentials:[{id:'a',salt:'x',hash:'bad'}]}]},
    {version:1,policies:[{...doc.policies[0],credentials:[]}]}
  ])assert.throws(()=>validateAuthDocument(bad));
});
test('disabled auth ignores missing file; enabled auth requires private, bounded file',t=>{
  const dir=path.join(process.cwd(),'data');fs.mkdirSync(dir,{recursive:true});
  const file=path.join(dir,`aw-auth-unit-${process.pid}-${crypto.randomBytes(4).toString('hex')}.json`);
  t.after(()=>{try{fs.rmSync(file,{force:true})}catch{}try{fs.rmSync(file+'.link',{force:true})}catch{}});
  assert.deepEqual(readAuthPolicies({appAuthEnabled:false,appAuthFile:file}),[]);
  assert.throws(()=>readAuthPolicies({appAuthEnabled:true,appAuthFile:file}),/ENOENT/);
  fs.writeFileSync(file,JSON.stringify(doc),{mode:0o600});
  assert.equal(readAuthPolicies({appAuthEnabled:true,appAuthFile:file}).length,2);
  if(process.platform!=='win32'){fs.chmodSync(file,0o644);assert.throws(()=>readAuthPolicies({appAuthEnabled:true,appAuthFile:file}),/permissions_require_0600/);fs.chmodSync(file,0o600);}
  fs.symlinkSync(file,file+'.link');
  if(fs.constants.O_NOFOLLOW)assert.throws(()=>readAuthPolicies({appAuthEnabled:true,appAuthFile:file+'.link'}));
  fs.writeFileSync(file,' '.repeat(33000));
  assert.throws(()=>readAuthPolicies({appAuthEnabled:true,appAuthFile:file}),/invalid_auth_file/);
  assert.throws(()=>readAuthPolicies({appAuthEnabled:true,appAuthFile:'/tmp/auth.json'}),/private_json_in_data/);
});
test('longest segment prefix, Basic password, key, stripping, and challenge behavior',async()=>{
  const auth=createAppAuth(validateAuthDocument(doc));
  const correctBasic=request({authorization:'Basic '+Buffer.from('alice:some-long-secret-password').toString('base64')});
  assert.equal((await auth.check(correctBasic,'/staging/home')).action,'pass');
  assert.equal(correctBasic.headers.authorization,undefined,'never forward credential to origin');
  assert.equal((await auth.check(request({authorization:'Basic '+Buffer.from('alice:wrong-password').toString('base64')}),'/staging')).action,'challenge');
  assert.equal((await auth.check(request({authorization:'Basic '+Buffer.from('alice:some-long-secret-password').toString('base64')}),'/stagingish')).action,'pass');
  assert.equal((await auth.check(request({}),'/staging')).mode,'basic');
  assert.equal((await auth.check(request({'x-api-key':'aw_wrong'}),'/api/private')).action,'challenge');
  const key=request({'x-api-key':api.key});
  assert.equal((await auth.check(key,'/api/private/v1')).action,'pass');
  assert.equal(key.headers['x-api-key'],undefined);
  assert.equal((await auth.check(request({'x-api-key':api.key}),'/api/public')).action,'pass');
  assert.equal(auth.snapshot().policyCount,2);
});
test('password verifier has bounded concurrency',async()=>{
  let pending,started;
  const wait=new Promise(resolve=>pending=resolve);
  const began=new Promise(resolve=>started=resolve);
  const scrypt=(_password,_salt,_len,_opts,callback)=>{started();wait.then(()=>callback(null,Buffer.from(basic.hash,'hex')));};
  const auth=createAppAuth(validateAuthDocument(doc),{scrypt,maxConcurrent:1});
  const header={authorization:'Basic '+Buffer.from('alice:some-long-secret-password').toString('base64')};
  const first=auth.check(request(header),'/staging');
  await began;
  assert.equal((await auth.check(request(header),'/staging')).action,'busy');
  pending();assert.equal((await first).action,'pass');
});
