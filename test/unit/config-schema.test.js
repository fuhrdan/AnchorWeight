import test from 'node:test';
import assert from 'node:assert/strict';
import { validateConfig } from '../../src/config-schema.js';

function base(){return {port:8080,basePath:'/anchor',blockDepth:3,blockMinutes:60,repeatBlockMinutes:1440,proxyTimeoutMs:15000,eventRetentionDays:30,eventMaxMb:50,adminRateLimitPerMinute:60,csrfTtlMinutes:15,adminBodyMaxBytes:8192,proxyBodyMaxBytes:26214400,shutdownGraceMs:10000,quarantineMode:'decoy',publicScheme:'https',secret:'12345678901234567890123456789012',dashboardEnabled:true,dashboardToken:'12345678901234567890123456789012',proxyEnabled:true,originUrl:'http://127.0.0.1:8081',trustProxy:false,allowQueryAdminToken:false,scoreEnforcementEnabled:false};}

test('config schema accepts conservative production config',()=>{
  const r=validateConfig(base()); assert.equal(r.valid,true); assert.equal(r.errors.length,0);
});

test('config schema rejects invalid path and credentialed origin',()=>{
  const c=base(); c.basePath='anchor bad'; c.originUrl='http://user:pass@localhost:8081';
  const r=validateConfig(c); assert.equal(r.valid,false); assert.ok(r.errors.some(x=>x.includes('basePath'))); assert.ok(r.errors.some(x=>x.includes('credentials')));
});
