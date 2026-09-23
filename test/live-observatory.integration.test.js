/** Real HTTP + Node WebSocket upgrade, without external WS dependencies. */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import net from 'node:net';
import {once} from 'node:events';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const app=fileURLToPath(new URL('../app.js',import.meta.url));
async function listen(server){server.listen(0,'127.0.0.1');await once(server,'listening');return server.address().port;}
async function unusedPort(){const server=net.createServer();const port=await listen(server);server.close();await once(server,'close');return port;}
async function stop(child){if(child.exitCode!==null||child.signalCode!==null)return;const done=once(child,'exit');child.kill('SIGTERM');const timer=setTimeout(()=>child.kill('SIGKILL'),2000);try{await done;}finally{clearTimeout(timer);}}
async function upgrade(port,ticket,origin,host){return new Promise((resolve,reject)=>{
 const socket=net.connect(port,'127.0.0.1'),parts=[];const timer=setTimeout(()=>{socket.destroy();reject(Error('upgrade_timeout'));},4000);
 socket.on('connect',()=>socket.write(`GET /anchor/api/observatory/live?ticket=${encodeURIComponent(ticket)} HTTP/1.1\r\nHost: ${host}\r\nOrigin: ${origin}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Key: AAAAAAAAAAAAAAAAAAAAAA==\r\n\r\n`));
 socket.on('data',chunk=>{parts.push(chunk);const data=Buffer.concat(parts);if(data.includes(Buffer.from('\r\n\r\n'))){clearTimeout(timer);resolve({socket,handshake:data.toString('latin1'),data});}});
 socket.on('error',error=>{clearTimeout(timer);reject(error);});
 });}
test('live observatory: authenticated one-use ticket, redacted route metrics and no public bypass',async t=>{
 const origin=http.createServer((req,res)=>{res.setHeader('content-type','text/plain');res.end('hello');});
 const upstream=await listen(origin);t.after(()=>{origin.closeAllConnections();origin.close();});
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'aw-live-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const port=await unusedPort(),base=`http://127.0.0.1:${port}`,host=`127.0.0.1:${port}`;
 const env={...Object.fromEntries(Object.entries(process.env).filter(([k])=>!k.startsWith('AW_'))),
  PORT:String(port),AW_SECRET:'observatory-integration-secret-test',AW_DASHBOARD_TOKEN:'observatory-integration-dashboard-token',AW_PROXY_ENABLED:'true',AW_ORIGIN_URL:`http://127.0.0.1:${upstream}/`,AW_OBSERVATORY_LIVE_ENABLED:'true',AW_PUBLIC_SCHEME:'http',AW_BLACKHOLE_ENABLED:'false',AW_AUDIT_ENABLED:'false'};
 const child=spawn(process.execPath,['-e',`require(${JSON.stringify(app)})`],{cwd:dir,env,stdio:['ignore','pipe','pipe']});t.after(async()=>stop(child));child.stdout.resume();let errors='';child.stderr.on('data',x=>errors+=x);
 for(let i=0;i<100;i++){if(child.exitCode!==null)throw Error('startup_failed '+errors);try{if((await fetch(base+'/live')).ok)break;}catch{}await new Promise(resolve=>setTimeout(resolve,50));}
 assert.equal((await(await fetch(base+'/live')).json()).version,'2.5.0');
 const url=base+'/anchor/api/observatory/ticket',headers={authorization:'Bearer observatory-integration-dashboard-token'};
 assert.equal((await fetch(url)).status,401);
 const ticketResponse=await fetch(url,{headers});assert.equal(ticketResponse.status,200);const {ticket}=await ticketResponse.json();
 assert.equal(ticket.length,43);
 const denied=await upgrade(port,ticket,'http://evil.example',host);assert.match(denied.handshake,/403 Forbidden/);denied.socket.destroy();
 const accepted=await upgrade(port,ticket,'http://'+host,host);assert.match(accepted.handshake,/101 Switching Protocols/);t.after(()=>accepted.socket.destroy());
 const replay=await upgrade(port,ticket,'http://'+host,host);assert.match(replay.handshake,/403 Forbidden/);replay.socket.destroy();
 let liveFrames=accepted.data.toString('latin1');
 const received=new Promise((resolve,reject)=>{
  const timer=setTimeout(()=>reject(Error('missing_live_response_frame')),3000);
  function receive(data){liveFrames+=data.toString('latin1');if(liveFrames.includes('"kind":"response"')){clearTimeout(timer);accepted.socket.off('data',receive);resolve(liveFrames);}}
  accepted.socket.on('data',receive);
 });
 assert.equal((await fetch(base+'/very/private?password=leak',{headers:{authorization:'Bearer secret'}})).status,200);
 const redactedFeed=await received;assert.match(redactedFeed,/"kind":"response"/);assert.doesNotMatch(redactedFeed,/password=leak|Bearer secret|very\/private/);
 const statsResponse=await fetch(base+'/anchor/api/stats',{headers});assert.equal(statsResponse.status,200);const stats=await statsResponse.json();
 assert.equal(stats.observatory.enabled,true);assert.ok(stats.telemetry.routes.some(r=>r.path==='(default)'&&r.requests>=1));
 assert.ok(stats.telemetry.recentEvents.length>=1);assert.doesNotMatch(JSON.stringify(stats.telemetry),/password=leak|Bearer secret/);
});
