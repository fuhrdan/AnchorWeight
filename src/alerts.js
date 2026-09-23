/**
 * v2.5 opt-in alerting and outbound webhooks.
 *
 * Trust boundary: only fixed, redacted event fields enter this module; neither
 * incoming HTTP headers nor client URLs can choose a webhook destination.
 * Configuration lives in a private 0600 JSON file and destinations must be in
 * the cPanel allowlist. Delivery uses a bounded, process-local queue. It is
 * best effort, NOT a durable audit log or guaranteed notification service.
 */
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import crypto from 'node:crypto';
import https from 'node:https';
import dns from 'node:dns/promises';

const MAX_FILE_BYTES=16*1024, MAX_WEBHOOKS=8, MAX_RULES=16;
const KINDS=new Set(['upstream_error','high_5xx','circuit_open','circuit_recovered']);
const ID=/^[a-z][a-z0-9_-]{0,31}$/;
const ROUTE=/^(?:\(default\)|\/|\/[A-Za-z0-9/_-]{1,127})$/;
const QUEUE_LIMIT=64;

function fields(value, expected) {
  return value && typeof value==='object' && !Array.isArray(value) &&
    Object.keys(value).sort().join(',')===expected.slice().sort().join(',');
}
function validWebhookUrl(value, hosts) {
  if(typeof value!=='string'||value.length>2048||value.trim()!==value)throw Error('invalid_webhook_url');
  let url;
  try{url=new URL(value);}catch{throw Error('invalid_webhook_url');}
  // Disallow IP literals, localhost and non-443 ports. DNS is checked and pinned on every delivery.
  const host=url.hostname.toLowerCase();
  if(url.protocol!=='https:'||url.username||url.password||url.hash||url.port||
      !/^(?=.{1,253}$)[a-z0-9-]+(?:\.[a-z0-9-]+)+$/.test(host)||
      host.endsWith('.localhost')||host.endsWith('.local')||host.endsWith('.internal')||
      net.isIP(host)||!hosts.includes(host)||url.pathname.length>512||url.search.length>512)
    throw Error('webhook_destination_not_approved');
  return url.href;
}

/** Reject private, reserved and non-global IPv4 addresses before a pinned HTTPS connection. */
export function publicIPv4(value) {
  if(net.isIP(value)!==4)return false;
  const [a,b,c]=value.split('.').map(Number);
  return !(a===0||a===10||a===127||a>=224||a===169&&b===254||
    a===172&&b>=16&&b<=31||a===192&&(b===168||b===0&&c===0||b===0&&c===2||b===88&&c===99)||
    a===100&&b>=64&&b<=127||a===198&&(b===18||b===19||b===51&&c===100)||
    a===203&&b===0&&c===113||a===192&&b===0&&c===0);
}

/** Fail closed on an enabled but invalid private alert configuration. */
export function validateAlertDocument(doc, config) {
  if(!fields(doc,['version','webhooks','rules'])||doc.version!==1||
      !Array.isArray(doc.webhooks)||doc.webhooks.length<1||doc.webhooks.length>MAX_WEBHOOKS||
      !Array.isArray(doc.rules)||doc.rules.length<1||doc.rules.length>MAX_RULES)
    throw Error('invalid_alert_document');
  const hosts=(config.alertAllowedHosts||[]).map(x=>x.toLowerCase());
  const hooks=new Map();
  for(const item of doc.webhooks) {
    if(!fields(item,['id','url'])||!ID.test(item.id)||hooks.has(item.id))throw Error('invalid_webhook_entry');
    hooks.set(item.id,validWebhookUrl(item.url,hosts));
  }
  const ids=new Set();
  const rules=doc.rules.map(item=>{
    if(!fields(item,['id','kind','route','threshold','cooldownSeconds','webhook'])||
        !ID.test(item.id)||ids.has(item.id)||!KINDS.has(item.kind)||
        !ROUTE.test(item.route)||!hooks.has(item.webhook)||
        !Number.isInteger(item.threshold)||item.threshold<1||item.threshold>10000||
        !Number.isInteger(item.cooldownSeconds)||item.cooldownSeconds<60||item.cooldownSeconds>86400||
        ((item.kind==='circuit_open'||item.kind==='circuit_recovered')&&item.threshold!==1))
      throw Error('invalid_alert_rule');
    ids.add(item.id);
    return Object.freeze({...item});
  });
  return {webhooks:hooks,rules:Object.freeze(rules)};
}
export function loadAlertDocument(config) {
  if(!config.alertsEnabled)return null;
  const file=path.resolve(config.alertsFile||'./data/anchorweight-alerts.json');
  const privateDir=path.resolve('./data');
  if(!file.startsWith(privateDir+path.sep)||!file.endsWith('.json'))throw Error('alerts_file_must_be_json_in_data');
  const fd=fs.openSync(file,fs.constants.O_RDONLY|(fs.constants.O_NOFOLLOW||0));
  try {
    const stat=fs.fstatSync(fd);
    if(!stat.isFile()||stat.size<1||stat.size>MAX_FILE_BYTES)throw Error('invalid_alert_file');
    if(process.platform!=='win32'&&(stat.mode&0o077)!==0)throw Error('alerts_file_permissions_require_0600');
    const buf=Buffer.alloc(stat.size+1),read=fs.readSync(fd,buf,0,buf.length,0);
    if(read!==stat.size)throw Error('alert_file_changed_during_read');
    return validateAlertDocument(JSON.parse(buf.subarray(0,read).toString('utf8')),config);
  }finally{fs.closeSync(fd);}
}

/**
 * Resolve each attempt afresh, and pin the resolved public IP to this TLS request.
 * No redirects, proxy environment variables, internal IPs or insecure HTTP.
 */
export async function deliverWebhook(url,body,config,{lookup=dns.lookup,request=https.request}={}) {
  const target=new URL(url);
  // DNS is allowed at most three seconds. A slow resolver must not occupy a delivery slot forever.
  const answers=await new Promise((resolve,reject)=>{
    const deadline=setTimeout(()=>reject(Error('webhook_dns_timeout')),3000);
    Promise.resolve().then(()=>lookup(target.hostname,{all:true,verbatim:true}))
      .then(value=>{clearTimeout(deadline);resolve(value);},error=>{clearTimeout(deadline);reject(error);});
  });
  if(!Array.isArray(answers)||answers.length===0||
      answers.some(a=>a.family===4&&!publicIPv4(a.address)))throw Error('webhook_dns_not_public');
  const selected=answers.find(a=>a.family===4&&publicIPv4(a.address));
  if(!selected)throw Error('webhook_ipv4_required'); // Deliberate IPv4-only delivery for this first version.
  const signature=crypto.createHmac('sha256',config.alertSigningKey).update(body).digest('hex');
  return new Promise(resolve=>{
    let settled=false;
    const done=success=>{if(!settled){settled=true;resolve(success);}};
    let req;
    try {
      req=request(target,{method:'POST',timeout:3000,
        lookup:(_host,_opts,callback)=>callback(null,selected.address,4),
        headers:{'Content-Type':'application/json','Content-Length':Buffer.byteLength(body),
          'User-Agent':'AnchorWeight-Alerts/2.5','X-AnchorWeight-Signature':`sha256=${signature}`,
          'Cache-Control':'no-store'}},res=>{res.resume();done(res.statusCode>=200&&res.statusCode<300);});
      req.on('timeout',()=>req.destroy(Error('webhook_timeout')));
      req.on('error',()=>done(false));req.end(body);
    }catch{req?.destroy();done(false);}
  });
}

/**
 * Rules are evaluated in-process on sanitized response and breaker transitions.
 * Callbacks are safe, typed extension hooks, NOT user-supplied JavaScript.
 */
export function createAlerts(config,{document=null,now=()=>Date.now(),send=deliverWebhook,onAlert=()=>{}}={}){
  const enabled=!!config.alertsEnabled;
  const source=enabled?(document||loadAlertDocument(config)):null;
  const rules=source?.rules||[],webhooks=source?.webhooks||new Map();
  const cooldown=new Map(),countBuckets=new Map(),pending=[],history=[];
  let active=0,stopped=false;
  const counters={generated:0,sent:0,failed:0,dropped:0,retried:0};
  // Wizard-managed routes can change without restart; never accept a client-supplied route label.
  const safeRoute=label=>label==='(default)'||(config.activeRoutes||[]).some(r=>r.path===label)
    ? label : '(default)';
  const maxConcurrent=2;
  function snapshot(){return {enabled,scope:'in_memory_per_process',webhookCount:webhooks.size,
    ruleCount:rules.length,pending:pending.length,active,...counters,
    recent:history.slice(-20).map(x=>({...x}))};}
  function record(rule,route,observed) {
    const time=now(),last=cooldown.get(rule.id);
    if(last!==undefined&&time-last<rule.cooldownSeconds*1000)return;
    cooldown.set(rule.id,time);
    const event=Object.freeze({schema:1,kind:rule.kind,rule:rule.id,route,
      observed,at:new Date(time).toISOString()});
    counters.generated++;
    history.push(event);if(history.length>20)history.shift();
    try{onAlert(event);}catch{} // A failing extension must never fail a proxied request.
    if(pending.length+active>=QUEUE_LIMIT){counters.dropped++;return;}
    pending.push({url:webhooks.get(rule.webhook),body:JSON.stringify(event),attempts:0});
    drain();
  }
  function drain(){
    while(!stopped&&active<maxConcurrent&&pending.length){
      const item=pending.shift();active++;
      // A failure is retried once, bounded and without holding up a request.
      Promise.resolve().then(()=>send(item.url,item.body,config)).then(ok=>{
        if(ok)counters.sent++;
        else if(item.attempts===0&&!stopped&&pending.length+active<QUEUE_LIMIT){
          item.attempts++;counters.retried++;pending.push(item);
        }else counters.failed++;
      }).catch(()=>{
        if(item.attempts===0&&!stopped&&pending.length+active<QUEUE_LIMIT){
          item.attempts++;counters.retried++;pending.push(item);
        }else counters.failed++;
      }).finally(()=>{active--;drain();});
    }
  }
  function response(event){
    if(!enabled||stopped||event?.kind!=='response')return;
    const route=safeRoute(event.route);
    for(const rule of rules){
      if(rule.route!=='/'&&rule.route!==route)continue; // '/' matches any configured route.
      if(rule.kind==='upstream_error'&&event.upstreamError)record(rule,route,1);
      if(rule.kind!=='high_5xx')continue;
      const minute=Math.floor(now()/60000),key=rule.id+'\0'+route;
      let buckets=countBuckets.get(key);
      if(!buckets){if(countBuckets.size>=MAX_RULES*17)countBuckets.delete(countBuckets.keys().next().value);
        buckets=new Map();countBuckets.set(key,buckets);}
      for(const m of buckets.keys())if(minute-m>=5)buckets.delete(m);
      if(event.status>=500)buckets.set(minute,(buckets.get(minute)||0)+1);
      const count=[...buckets.values()].reduce((a,b)=>a+b,0);
      if(count>=rule.threshold)record(rule,route,count);
    }
  }
  function circuit(event){
    if(!enabled||stopped||!['circuit_open','circuit_recovered'].includes(event?.kind))return;
    // Only use operator-defined route labels. Origin URLs never leave this process.
    const route=safeRoute(event.route);
    for(const rule of rules)if(rule.kind===event.kind&&(rule.route==='/'||rule.route===route))record(rule,route,1);
  }
  function stop(){stopped=true;counters.dropped+=pending.length;pending.length=0;}
  return {response,circuit,snapshot,stop};
}
