/** Read-only WebSocket feed; one-use tickets are issued only by the existing authenticated admin API.
 * No runtime dependencies. Socket buffering and subscriber count are bounded for shared hosting.
 */
import crypto from 'node:crypto';
const MAX_TICKETS=64,TICKET_MS=30000;
function frame(op,value=''){const payload=Buffer.isBuffer(value)?value:Buffer.from(value);const header=payload.length<126?Buffer.from([0x80|op,payload.length]):Buffer.from([0x80|op,126,payload.length>>>8,payload.length&255]);return Buffer.concat([header,payload]);}
function reject(socket){socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');}
export function createLiveObservatory({enabled=false,publicScheme='https',maxClients=8,now=()=>Date.now()}={}){
 const tickets=new Map(),clients=new Set();let stopped=false;
 function issueTicket(){if(!enabled||stopped)return null;for(const [k,expiry] of tickets)if(expiry<=now())tickets.delete(k);if(tickets.size>=MAX_TICKETS)return null;const ticket=crypto.randomBytes(32).toString('base64url');tickets.set(ticket,now()+TICKET_MS);return {ticket,expiresInSeconds:30};}
 function accept(req,socket,head,{basePath='/anchor'}={}){
  if(!enabled||stopped||clients.size>=maxClients)return reject(socket);
  let url,origin;try{url=new URL(req.url,'http://anchorweight.local');origin=new URL(req.headers.origin);}catch{return reject(socket);}
  const host=String(req.headers.host||'').toLowerCase();
  if(url.pathname!==`${basePath}/api/observatory/live`||origin.host.toLowerCase()!==host||origin.protocol!==`${publicScheme}:`||req.headers.upgrade?.toLowerCase()!=='websocket'||!String(req.headers.connection||'').toLowerCase().split(',').map(x=>x.trim()).includes('upgrade')||req.headers['sec-websocket-version']!=='13'||head.length)return reject(socket);
  const key=String(req.headers['sec-websocket-key']||'');if(!/^[A-Za-z0-9+/]{22}==$/.test(key))return reject(socket);
  const ticket=url.searchParams.get('ticket');const expiry=tickets.get(ticket);tickets.delete(ticket);
  if(typeof ticket!=='string'||ticket.length!==43||!expiry||expiry<=now())return reject(socket);
  const response=crypto.createHash('sha1').update(key+'258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
  socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: '+response+'\r\n\r\n');
  clients.add(socket);
  // Ping every 30 seconds; drop dead browsers so they cannot exhaust all eight slots.
  let awaitingPong=false;
  const heartbeat=setInterval(()=>{
    if(awaitingPong)return socket.destroy();
    awaitingPong=true;
    if(!socket.write(frame(9)))socket.destroy();
  },30000);
  heartbeat.unref?.();
  socket.on('close',()=>{clearInterval(heartbeat);clients.delete(socket);});
  socket.on('error',()=>socket.destroy());
  let input=Buffer.alloc(0);
  socket.on('data',chunk=>{input=Buffer.concat([input,chunk]);if(input.length>512)return socket.destroy();while(input.length>=2){const first=input[0],second=input[1],size=second&127,op=first&15;if((first&0x80)===0||(first&0x70)!==0||(second&0x80)===0||size>125||![8,9,10].includes(op))return socket.destroy();if(input.length<6+size)return;const mask=input.subarray(2,6),payload=Buffer.from(input.subarray(6,6+size));input=input.subarray(6+size);for(let i=0;i<size;i++)payload[i]^=mask[i%4];if(op===8){socket.end(frame(8));return;}if(op===10)awaitingPong=false;if(op===9&&!socket.write(frame(10,payload)))return socket.destroy();}});
  socket.write(frame(1,JSON.stringify({kind:'connected',scope:'per_process',redacted:true})));
 }
 function publish(event){
  if(!enabled||stopped||!event||event.kind!=='response')return;
  // Explicit projection prevents future callers from accidentally publishing raw metadata.
  const safe={kind:'response',seq:event.seq,at:event.at,route:event.route,
    status:event.status,durationMs:event.durationMs};
  if(['timeout','connection_reset','connection_refused','unreachable','transport_error'].includes(event.upstreamError))safe.upstreamError=event.upstreamError;
  const data=frame(1,JSON.stringify(safe));for(const socket of clients){if(socket.destroyed||socket.writableLength>32768||!socket.write(data))socket.destroy();}}
 function stop(){stopped=true;tickets.clear();for(const socket of clients)socket.destroy();clients.clear();}
 return {issueTicket,accept,publish,stop,snapshot:()=>({enabled,subscribers:clients.size,maxSubscribers:maxClients,transport:'websocket',ticketTtlSeconds:30,scope:'in_memory_per_process'})};
}
