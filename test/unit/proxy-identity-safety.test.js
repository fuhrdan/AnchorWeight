import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { createReverseProxy } from '../../src/proxy.js';

async function listen(server){server.listen(0,'127.0.0.1');await once(server,'listening');return server.address().port;}
function request(port,path,headers={}){return new Promise((resolve,reject)=>{const r=http.request({hostname:'127.0.0.1',port,path,headers},res=>{res.resume();res.on('end',()=>resolve(res));});r.on('error',reject);r.end();});}

test('proxy strips caller-controlled client IP headers when client identity is degraded',async t=>{
  let seen=null;
  const origin=http.createServer((req,res)=>{seen=req.headers;res.end('ok');});
  const originPort=await listen(origin); t.after(()=>origin.close());
  const config={originUrl:`http://127.0.0.1:${originPort}`,proxyTimeoutMs:2000,proxyBodyMaxBytes:1024,blackholeEnabled:false,clientEnvironmentEnabled:false,publicScheme:'https',proxyEnabled:true,trustProxy:false,gatewayMaintenanceEnabled:false};
  const proxy=createReverseProxy(config);
  const edge=http.createServer((req,res)=>proxy(req,res));
  const edgePort=await listen(edge); t.after(()=>edge.close());
  await request(edgePort,'/',{'x-forwarded-proto':'https','x-forwarded-host':'public.example','x-forwarded-for':'203.0.113.111','x-real-ip':'198.51.100.222','true-client-ip':'192.0.2.44'});
  assert.equal(seen['x-forwarded-for'],undefined);
  assert.equal(seen['x-real-ip'],undefined);
  assert.equal(seen['true-client-ip'],undefined);
});

test('proxy emits canonical X-Forwarded-For for a trusted direct socket',async t=>{
  let seen=null;
  const origin=http.createServer((req,res)=>{seen=req.headers;res.end('ok');});
  const originPort=await listen(origin); t.after(()=>origin.close());
  const config={originUrl:`http://127.0.0.1:${originPort}`,proxyTimeoutMs:2000,proxyBodyMaxBytes:1024,blackholeEnabled:false,clientEnvironmentEnabled:false,publicScheme:'https',proxyEnabled:true,trustProxy:false,gatewayMaintenanceEnabled:false};
  const proxy=createReverseProxy(config);
  const edge=http.createServer((req,res)=>proxy(req,res));
  const edgePort=await listen(edge); t.after(()=>edge.close());
  await request(edgePort,'/',{'x-forwarded-for':'203.0.113.111','x-real-ip':'198.51.100.222'});
  assert.equal(seen['x-forwarded-for'],'127.0.0.1');
  assert.equal(seen['x-real-ip'],undefined);
});
