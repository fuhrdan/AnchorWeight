import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {readOperatorSettings} from '../../src/setup.js';

const config={setupConfigEnabled:true,setupBaselineOrigin:'http://127.0.0.1:8081/',
  setupAllowedOrigins:[],setupPublicHost:'aw.example.com',proxyEnabled:false,
  originUrl:'http://127.0.0.1:8081/',basePath:'/anchor',port:8080,
  blockDepth:3,branchCount:7,blockMinutes:60,repeatBlockMinutes:1440,proxyTimeoutMs:15000,
  eventRetentionDays:30,eventMaxMb:50,adminRateLimitPerMinute:60,csrfTtlMinutes:15,
  adminBodyMaxBytes:8192,proxyBodyMaxBytes:26214400,shutdownGraceMs:10000,
  stateBackend:'json',quarantineMode:'decoy',publicScheme:'https'};

function temp(t){const d=fs.mkdtempSync(path.join(os.tmpdir(),'aw-v2-reader-'));t.after(()=>fs.rmSync(d,{recursive:true,force:true}));return d;}
function readQuiet(file){const warn=console.warn;console.warn=()=>{};try{return readOperatorSettings(config,file);}finally{console.warn=warn;}}
test('v2 operator file reader rejects a symlink, oversized files and directories without crashing startup',t=>{
 const dir=temp(t);const settings=path.join(dir,'private.json');
 fs.writeFileSync(settings,JSON.stringify({version:1,settings:{originUrl:'http://127.0.0.1:8081/',proxyEnabled:true}}));
 assert.deepEqual(readQuiet(settings),{originUrl:'http://127.0.0.1:8081/',proxyEnabled:true});
 const link=path.join(dir,'link.json');fs.symlinkSync(settings,link);
 assert.equal(readQuiet(link),null);
 fs.writeFileSync(settings,' '.repeat(16385));assert.equal(readQuiet(settings),null);
 assert.equal(readQuiet(dir),null);
});
test('v2 operator file fallback does not allow an invalid saved destination',t=>{
 const dir=temp(t);const file=path.join(dir,'private.json');
 fs.writeFileSync(file,JSON.stringify({version:1,settings:{originUrl:'http://169.254.169.254/',proxyEnabled:true}}));
 assert.equal(readQuiet(file),null);
 assert.equal(readQuiet(path.join(dir,'not-found.json')),null);
});
