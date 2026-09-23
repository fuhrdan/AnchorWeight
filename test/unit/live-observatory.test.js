import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createTrafficTelemetry } from '../../src/telemetry.js';
import { createLiveObservatory } from '../../src/live-observatory.js';

function request(tel,status,route='/api',ms=5) {
  const res=new EventEmitter();res.statusCode=status;
  const ctx=tel.begin({url:'/api?secret=raw-sensitive',headers:{authorization:'password'},socket:{remoteAddress:'192.0.2.12'}},res);
  ctx.markProxied();ctx.setRoute(route);ctx.upstreamStart();ctx.upstreamResponse(status);
  ctx.upstreamEnd();res.emit('finish');res.emit('close');return ctx;
}
test('bounded per-route histograms, percentiles and redacted recent response events',()=>{
  let now=60000;const emitted=[];const tel=createTrafficTelemetry({now:()=>now,onEvent:e=>emitted.push(e)});
  for(let i=0;i<51;i++){const res=new EventEmitter();res.statusCode=i%2?503:200;const ctx=tel.begin({url:'/private?apiKey=secret',headers:{authorization:'password'},socket:{remoteAddress:'192.0.2.19'}},res);ctx.markProxied();ctx.setRoute('/api');ctx.upstreamStart();now+=6;ctx.upstreamResponse();ctx.upstreamEnd();now+=18;res.emit('finish');}
  const snap=tel.snapshot();assert.equal(snap.proxiedRequests,51);assert.equal(snap.routes[0].path,'/api');assert.equal(snap.routes[0].latency.samples,51);
  assert.equal(snap.routes[0].latency.p95,35);assert.equal(snap.routes[0].upstreamFirstHeader.p95,10);
  assert.equal(snap.recentEvents.length,50);assert.equal(emitted.length,51);
  assert.doesNotMatch(JSON.stringify(snap),/192\.0\.2|apiKey|password|raw-sensitive/);
  assert.deepEqual(Object.keys(snap.recentEvents[0]).sort(),['at','durationMs','kind','route','seq','status']);
});
test('transport error has safe reason and is counted once; nonproxy has no live event',()=>{
  let time=0;const emitted=[];const tel=createTrafficTelemetry({now:()=>time,onEvent:event=>emitted.push(event)});
  const res=new EventEmitter();res.statusCode=502;const ctx=tel.begin({},res);ctx.markProxied();ctx.upstreamStart();ctx.upstreamFailure();ctx.upstreamFailure('ECONNREFUSED');res.emit('close');res.emit('finish');
  const admin=new EventEmitter();admin.statusCode=200;tel.begin({},admin);admin.emit('finish');
  assert.equal(tel.snapshot().upstreamFailures,1);assert.equal(emitted.length,1);assert.equal(emitted[0].upstreamError,'connection_refused');
});
test('tickets are disabled by default; live tickets are unique and bounded',()=>{
  assert.equal(createLiveObservatory().issueTicket(),null);
  let time=0;const obs=createLiveObservatory({enabled:true,now:()=>time});
  const tickets=Array.from({length:64},()=>obs.issueTicket());assert.equal(new Set(tickets.map(t=>t.ticket)).size,64);
  assert.equal(obs.issueTicket(),null);time+=31000;assert.ok(obs.issueTicket());obs.stop();assert.equal(obs.issueTicket(),null);
});
