import test from 'node:test';
import assert from 'node:assert/strict';
import { AdminSecurity } from '../../src/admin-security.js';

test('CSRF expires and is client-bound',()=>{
  let now=1000; const a=new AdminSecurity({secret:'s',csrfTtlMinutes:1,adminRateLimitPerMinute:60},()=>now);
  const req={headers:{},socket:{remoteAddress:'203.0.113.1'}}; const token=a.issueCsrf(req);
  assert.equal(a.validateCsrf({...req,headers:{'x-aw-csrf':token}}),true);
  assert.equal(a.validateCsrf({headers:{'x-aw-csrf':token},socket:{remoteAddress:'203.0.113.2'}}),false);
  now=61001; assert.equal(a.validateCsrf({...req,headers:{'x-aw-csrf':token}}),false);
});
