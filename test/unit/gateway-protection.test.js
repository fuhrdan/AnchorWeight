import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCidr,parseRatePaths,createGatewayPolicy } from '../../src/gateway-policy.js';
import { validateConfig } from '../../src/config-schema.js';
import { maintenanceResponse,createUpstreamHealth } from '../../src/upstream-health.js';
import { loadConfig } from '../../src/config.js';
import http from 'node:http';
import { once } from 'node:events';

const req=(ip='192.0.2.5',headers={})=>({socket:{remoteAddress:ip},headers});
const config=overrides=>({secret:'test-secret-32-chars-minimum------',trustProxy:false,gatewayAccessEnabled:true,gatewayRateEnabled:true,gatewayShadowMode:false,
 gatewayAllowIps:[],gatewayDenyIps:[],gatewayRatePerMinute:2,gatewayRatePaths:[],...overrides});

test('IPv4 and IPv6 CIDRs, mapped IPv4, invalid masks rejected',()=>{
 assert.equal(parseCidr('192.0.2.0/24').prefix,24);
 assert.equal(parseCidr('2001:db8::/32').family,6);
 assert.throws(()=>parseCidr('192.0.2.1/33'));
 assert.throws(()=>parseCidr('2001:db8::/129'));
 assert.throws(()=>parseCidr('not-an-ip/24'));
 const p=createGatewayPolicy(config({gatewayDenyIps:['192.0.2.0/24','2001:db8::/32']}));
 assert.equal(p.check(req(),'/x').action,'deny');
 assert.equal(p.check(req('::ffff:192.0.2.4'),'/x').action,'deny');
 assert.equal(p.check(req('2001:db8::abc'),'/x').action,'deny');
 assert.equal(p.check(req('2001:db9::abc'),'/x').action,'pass');
});
test('deny precedence, allow only bypasses rate, no raw IP in statistics',()=>{
 const p=createGatewayPolicy(config({gatewayAllowIps:['192.0.2.5'],gatewayDenyIps:['192.0.2.5']}));
 assert.equal(p.check(req(),'/x').action,'deny');
 assert.doesNotMatch(JSON.stringify(p.snapshot()),/192\.0\.2/);
 const bypass=createGatewayPolicy(config({gatewayAllowIps:['192.0.2.5']}));
 for(let i=0;i<5;i++)assert.equal(bypass.check(req(),'/x').action,'pass');
});
test('per-IP minute windows and most-specific path, shadow is not an IP conviction',()=>{
 let clock=0;
 const c=config({gatewayRatePerMinute:3,gatewayRatePaths:[{path:'/api/login',perMinute:1}]});
 const p=createGatewayPolicy(c,{now:()=>clock});
 assert.equal(p.check(req(),'/api/login').action,'pass');
 const rejection=p.check(req(),'/api/login');
 assert.equal(rejection.action,'rate_limit');assert.equal(rejection.retryAfter,60);
 assert.equal(p.check(req(),' /api/login').action,'pass');
 assert.equal(p.check(req('192.0.2.6'),'/api/login').action,'pass');
 clock=61000;assert.equal(p.check(req(),'/api/login').action,'pass');
 const shadow=createGatewayPolicy({...c,gatewayShadowMode:true},{now:()=>clock});
 shadow.check(req(),'/api/login');assert.equal(shadow.check(req(),'/api/login').action,'pass');
 assert.equal(shadow.snapshot().wouldRateLimit,1);
 const shadowDeny=createGatewayPolicy({...c,gatewayDenyIps:['192.0.2.5'],gatewayShadowMode:true});
 assert.equal(shadowDeny.check(req(),'/any').action,'pass');assert.equal(shadowDeny.snapshot().wouldDeny,1);
});
test('invalid client address fails open without merging visitors into unknown quota',()=>{
 const p=createGatewayPolicy(config({gatewayRatePerMinute:1}));
 for(let i=0;i<10;i++)assert.equal(p.check(req('unknown'),'/a').action,'pass');
});
test('spoofed forwarding header ignored unless trustProxy explicitly enabled',()=>{
 const raw=req('192.0.2.5',{'x-forwarded-for':'203.0.113.88'});
 const opts=config({gatewayDenyIps:['203.0.113.0/24'],gatewayRateEnabled:false});
 assert.equal(createGatewayPolicy(opts).check(raw,'/').action,'pass');
 assert.equal(createGatewayPolicy({...opts,trustProxy:true}).check(raw,'/').action,'deny');
});
test('strict path and config validation',()=>{
 assert.deepEqual(parseRatePaths('[{"path":"/api/login","perMinute":10}]'),[{path:'/api/login',perMinute:10}]);
 for(const input of ['not-json','[{"path":"/a","perMinute":0}]','[{"path":"/a","perMinute":1,"origin":"http://evil"}]'])
  assert.throws(()=>parseRatePaths(input));
 // A standalone gateway configuration must not inherit unrelated cPanel modes.
 const base=loadConfig({gatewayRatePaths:[],gatewayDenyIps:['192.0.2.0/24'],
  routesEnabled:false,setupConfigEnabled:false,setupWritesEnabled:false,
  declarativeEnabled:false,declarativeWritesEnabled:false,intelligenceEnabled:false,
  trustedJa4Enabled:false,appAuthEnabled:false});
 assert.equal(validateConfig(base).valid,true);
 assert.equal(validateConfig({...base,gatewayDenyIps:['127.0.0.1/99']}).valid,false);
 assert.equal(validateConfig({...base,gatewayRatePaths:[{path:'/api',perMinute:0}]}).valid,false);
});
test('health probe checks only active origin and updates status without requiring proxy restart',async()=>{
 const origin=http.createServer((req,res)=>{res.statusCode=503;res.end();});
 origin.listen(0,'127.0.0.1');await once(origin,'listening');
 try{
  let enabled=false;let current=`http://127.0.0.1:${origin.address().port}`;
  const health=createUpstreamHealth({gatewayHealthEnabled:true,gatewayHealthTimeoutMs:500,gatewayHealthIntervalMs:10000},{getOrigin:()=>current,getProxyEnabled:()=>enabled});
  assert.equal((await health.probe()).status,'disabled');
  enabled=true;assert.equal((await health.probe()).status,'degraded');
  assert.equal((await health.probe()).status,'unavailable');
  origin.removeAllListeners('request');origin.on('request',(_req,res)=>{res.statusCode=204;res.end();});
  assert.equal((await health.probe()).status,'healthy');
  enabled=false;assert.equal(health.snapshot().status,'disabled');health.stop();
 }finally{origin.closeAllConnections();origin.close();}
});
test('opt-in maintenance response preserves status 503 and content type',()=>{
 const calls=[];
 const res={headersSent:false,writeHead:(status,headers)=>{calls.push([status,headers]);},end:body=>calls.push(body)};
 maintenanceResponse({method:'GET',headers:{accept:'application/json'},url:'/x'},res);
 assert.equal(calls[0][0],503);assert.equal(calls[0][1]['Retry-After'],'30');
 assert.equal(JSON.parse(calls[1]).error,'upstream_unavailable');
 const html=[];maintenanceResponse({method:'GET',headers:{accept:'text/html'},url:'/x'},
   {headersSent:false,writeHead:(status,headers)=>html.push([status,headers]),end:body=>html.push(body)},
   {title:'Newlands <Maintenance>',message:'Please wait & retry'});
 assert.match(html[1],/Newlands &lt;Maintenance&gt;/);assert.match(html[1],/Please wait &amp; retry/);
});
