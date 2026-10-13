import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { validateConfig } from '../../src/config-schema.js';
import { readOperatorSettings } from '../../src/setup.js';

function legacyBase(){
  return {
    port:8080,basePath:'/anchor',blockDepth:3,blockMinutes:60,repeatBlockMinutes:1440,
    proxyTimeoutMs:15000,eventRetentionDays:30,eventMaxMb:50,adminRateLimitPerMinute:60,
    csrfTtlMinutes:15,adminBodyMaxBytes:8192,proxyBodyMaxBytes:26214400,shutdownGraceMs:10000,
    quarantineMode:'decoy',publicScheme:'https',secret:'12345678901234567890123456789012',
    dashboardEnabled:true,dashboardToken:'12345678901234567890123456789012',proxyEnabled:true,
    originUrl:'http://127.0.0.1:8081',trustProxy:false,allowQueryAdminToken:false,scoreEnforcementEnabled:false
  };
}

test('v3.1 schema accepts v3.0 config objects with no AI-agent family-rules field',()=>{
  const result=validateConfig(legacyBase());
  assert.equal(result.valid,true,result.errors.join('\n'));
});

test('v3.1 operator settings remain compatible with a v3.0-era config object',t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'aw-ai-config-compat-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const file=path.join(dir,'private.json');
  fs.writeFileSync(file,JSON.stringify({version:1,settings:{originUrl:'http://127.0.0.1:8081/',proxyEnabled:true}}));
  const config={
    ...legacyBase(),setupConfigEnabled:true,setupBaselineOrigin:'http://127.0.0.1:8081/',
    setupAllowedOrigins:[],setupPublicHost:'aw.example.com',proxyEnabled:false,
    originUrl:'http://127.0.0.1:8081/',stateBackend:'json',branchCount:7
  };
  assert.deepEqual(readOperatorSettings(config,file),{originUrl:'http://127.0.0.1:8081/',proxyEnabled:true});
});
