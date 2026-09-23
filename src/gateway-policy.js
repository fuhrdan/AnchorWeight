// Independent edge-access policy. This is not Bot DNA evidence or a DDoS firewall.
// All policy is explicitly opt-in; avoid storing raw IPs in snapshots/logs.
import net from 'node:net';
import crypto from 'node:crypto';

function addressBytes(value) {
  if (net.isIP(value) === 4) return {family:4, bytes:Buffer.from(value.split('.').map(Number))};
  if (net.isIP(value) !== 6) throw Error('invalid_ip_rule');
  let address=value.toLowerCase().split('%')[0];
  let ipv4=null;
  if (address.includes('.')) {
    const at=address.lastIndexOf(':');
    const part=address.slice(at+1);
    if (net.isIP(part)!==4) throw Error('invalid_ip_rule');
    const pieces=part.split('.').map(Number);
    ipv4=pieces;
    address=address.slice(0,at)+':'+((pieces[0]<<8)|pieces[1]).toString(16)+':'+((pieces[2]<<8)|pieces[3]).toString(16);
  }
  const segments=address.split('::');
  if (segments.length>2) throw Error('invalid_ip_rule');
  const left=segments[0]?segments[0].split(':'):[];
  const right=segments.length===2&&segments[1]?segments[1].split(':'):[];
  if (segments.length===1&&left.length!==8 || segments.length===2&&left.length+right.length>=8) throw Error('invalid_ip_rule');
  const words=[...left,...Array(8-left.length-right.length).fill('0'),...right];
  if(words.length!==8||words.some(x=>!/^[0-9a-f]{1,4}$/.test(x)))throw Error('invalid_ip_rule');
  const bytes=Buffer.alloc(16);
  words.forEach((w,i)=>bytes.writeUInt16BE(parseInt(w,16),i*2));
  // Normalize IPv4-mapped IPv6 to IPv4 for consistent IPv4 access policies.
  if(bytes.subarray(0,10).every(b=>b===0) && bytes[10]===255 && bytes[11]===255)
    return {family:4,bytes:bytes.subarray(12)};
  return {family:6,bytes};
}
export function parseCidr(raw) {
  if(typeof raw!=='string'||raw.length>64)throw Error('invalid_ip_rule');
  const segments=raw.trim().split('/');
  if(segments.length>2)throw Error('invalid_ip_rule');
  const address=addressBytes(segments[0]);
  const bits=address.family===4?32:128;
  let prefix=bits;
  if(segments.length===2) {
    if(!/^(0|[1-9]\d{0,2})$/.test(segments[1]))throw Error('invalid_ip_rule');
    prefix=Number(segments[1]);
    if(prefix>bits)throw Error('invalid_ip_rule');
  }
  return {...address,prefix};
}
function matches(addr,rule){
  if(addr.family!==rule.family)return false;
  const full=rule.prefix>>>3,partial=rule.prefix%8;
  for(let i=0;i<full;i++)if(addr.bytes[i]!==rule.bytes[i])return false;
  return !partial || (addr.bytes[full]>>(8-partial))===(rule.bytes[full]>>(8-partial));
}
export function parseRules(values=[]) {return values.map(parseCidr);}
function boundedRules(input){
  if (!Array.isArray(input)||input.length>16)throw Error('invalid_rate_paths');
  return input.map(item=>{
    if(!item||typeof item!=='object'||Array.isArray(item)||Object.keys(item).sort().join(',')!=='path,perMinute' ||
      typeof item.path!=='string'||!/^(\/|\/[A-Za-z0-9/_-]{1,127})$/.test(item.path)||
      !Number.isInteger(item.perMinute)||item.perMinute<1||item.perMinute>100000)throw Error('invalid_rate_paths');
    return {...item};
  }).sort((a,b)=>b.path.length-a.path.length);
}
export function parseRatePaths(raw='[]') {
  try{return boundedRules(JSON.parse(raw));}catch{throw Error('invalid_rate_paths');}
}
export function createGatewayPolicy(config,{now=()=>Date.now()}={}) {
  const allow=parseRules(config.gatewayAllowIps||[]), deny=parseRules(config.gatewayDenyIps||[]);
  const paths=boundedRules(config.gatewayRatePaths||[]);
  const clients=new Map();
  const stats={observed:0,denied:0,wouldDeny:0,rateLimited:0,wouldRateLimit:0};
  const secret=config.secret || 'temporary-gateway-secret';
  function identify(req) {
    let ip=req.socket?.remoteAddress||'';
    if(config.trustProxy){
      const forwarded=req.headers['x-forwarded-for'];
      if(typeof forwarded==='string' && forwarded.length<1024) ip=forwarded.split(',')[0].trim();
    }
    try{return addressBytes(ip);}catch{return null;}
  }
  function pathLimit(pathname){
    const rule=paths.find(r=>pathname===r.path || pathname.startsWith(r.path.endsWith('/')?r.path:r.path+'/'));
    return rule?{name:rule.path,perMinute:rule.perMinute}:{name:'default',perMinute:config.gatewayRatePerMinute||120};
  }
  function prune(time){for(const [k,v] of clients)if(time-v.minute>1)clients.delete(k);}
  function check(req,pathname){
    if(!config.gatewayAccessEnabled&&!config.gatewayRateEnabled)return {action:'pass'};
    const time=Math.floor(now()/60000);
    if(clients.size>=10000)prune(time);
    stats.observed++;
    const addr=identify(req);
    // Unparseable identifiers must not acquire blanket allow privileges.
    if(!addr)return {action:'pass'}; // Do not group unrelated clients under an unknown IP.
    const denied=addr&&deny.some(x=>matches(addr,x));
    const allowed=addr&&allow.some(x=>matches(addr,x));
    if(config.gatewayAccessEnabled&&denied){
      const shadow=!!config.gatewayShadowMode;
      stats[shadow?'wouldDeny':'denied']++;
      return {action:shadow?'pass':'deny',reason:'ip_deny_rule',observed:true};
    }
    if(!config.gatewayRateEnabled||allowed)return {action:'pass'};
    const limit=pathLimit(pathname);
    const ip=addr?`${addr.family}:${addr.bytes.toString('hex')}`:'unknown';
    const key=crypto.createHmac('sha256',secret).update(ip+'\0'+limit.name).digest('hex');
    const previous=clients.get(key);
    const count=previous?.minute===time?previous.count+1:1;
    if(clients.size>=10000&&!clients.has(key))prune(time);
    if(clients.size>=10000&&!clients.has(key))return {action:'pass'}; // Capacity reached; avoid falsely blocking an unrelated visitor.
    clients.set(key,{minute:time,count});
    // Reject only after threshold; don't treat request rate as crawler conviction.
    if(count>limit.perMinute){
      const shadow=!!config.gatewayShadowMode;
      stats[shadow?'wouldRateLimit':'rateLimited']++;
      return {action:shadow?'pass':'rate_limit',reason:'edge_rate_limit',retryAfter:Math.max(1,60-Math.floor(now()/1000)%60),observed:true};
    }
    return {action:'pass'};
  }
  return {check,snapshot:()=>({enabled:!!(config.gatewayAccessEnabled||config.gatewayRateEnabled),shadowMode:!!config.gatewayShadowMode,accessEnabled:!!config.gatewayAccessEnabled,rateEnabled:!!config.gatewayRateEnabled,defaultPerMinute:config.gatewayRatePerMinute,ratePathCount:paths.length,allowRuleCount:allow.length,denyRuleCount:deny.length,...stats})};
}
