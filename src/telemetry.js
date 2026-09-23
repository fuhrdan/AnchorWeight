/** Bounded per-process metrics. No raw IP, URL, headers or origin is retained. */
const WINDOW=60;
const LIMITS=[5,10,20,35,50,75,100,150,250,400,650,1000,2000,4000,8000,15000,30000,60000,120000,Infinity];
const statusClass=s=>s>=500?'5xx':s>=400?'4xx':s>=300?'3xx':s>=200?'2xx':'other';
const bins=()=>LIMITS.map(()=>0);
const empty=minute=>({minute,requests:0,proxied:0,durationTotalMs:0,upstreamTotalMs:0,upstreamResponses:0,upstreamFailures:0,statuses:{'2xx':0,'3xx':0,'4xx':0,'5xx':0,other:0}});
const bucketIndex=ms=>LIMITS.findIndex(bound=>ms<=bound);
const errorReason=code=>({ETIMEDOUT:'timeout',origin_timeout:'timeout',ECONNREFUSED:'connection_refused',ECONNRESET:'connection_reset',EPIPE:'connection_reset',EHOSTUNREACH:'unreachable',ENETUNREACH:'unreachable'}[code]||'transport_error');
function quantiles(hist){const total=hist.reduce((n,x)=>n+x,0);function at(q){if(!total)return null;let sum=0;for(let i=0;i<hist.length;i++){sum+=hist[i];if(sum>=Math.ceil(total*q))return Math.min(LIMITS[i],120000);}return 120000;}
 return {p50:at(.5),p95:at(.95),p99:at(.99),samples:total,method:'histogram_upper_bound_ms',overflowAboveMs:120000};}
export function createTrafficTelemetry({now=()=>Date.now(),onEvent=()=>{}}={}){
 const buckets=new Array(WINDOW),totals=empty(0),routeStats=new Map(),recent=[];
 let activeRequests=0,activeUpstream=0,sequence=0;
 function bucket(t){const minute=Math.floor(t/60000),index=((minute%WINDOW)+WINDOW)%WINDOW;if(!buckets[index]||buckets[index].minute!==minute)buckets[index]=empty(minute);return buckets[index];}
 function routeRecord(route){if(!routeStats.has(route)){if(routeStats.size>=17)routeStats.delete(routeStats.keys().next().value);routeStats.set(route,{path:route,requests:0,statuses:{'2xx':0,'3xx':0,'4xx':0,'5xx':0,other:0},upstreamFailures:0,durations:bins(),upstreamLatency:bins()});}return routeStats.get(route);}
 function begin(req,res){const started=now();let proxied=false,completed=false,route='(default)',upstreamStarted=null,upstreamCompleted=false,upstreamHeaders=false,reason=null;activeRequests++;
  function upstreamResponse(){if(upstreamStarted===null||upstreamCompleted||upstreamHeaders)return;upstreamHeaders=true;const ms=Math.max(0,now()-upstreamStarted);for(const b of [bucket(now()),totals]){b.upstreamResponses++;b.upstreamTotalMs+=ms;}const r=routeRecord(route);if(r)r.upstreamLatency[bucketIndex(ms)]++;}
  function upstreamDone(failed=false,code=null){if(upstreamStarted===null)return;if(upstreamCompleted){if(failed&&code)reason=errorReason(code);return;}upstreamCompleted=true;activeUpstream=Math.max(0,activeUpstream-1);if(failed){reason=errorReason(code);for(const b of [bucket(now()),totals])b.upstreamFailures++;const r=routeRecord(route);if(r)r.upstreamFailures++;}}
  function complete(){if(completed)return;completed=true;activeRequests=Math.max(0,activeRequests-1);upstreamDone(true);const ms=Math.max(0,now()-started),status=res.statusCode||0;for(const b of [bucket(now()),totals]){b.requests++;b.proxied+=Number(proxied);b.durationTotalMs+=ms;b.statuses[statusClass(status)]++;}
   if(proxied){const r=routeRecord(route);if(r){r.requests++;r.statuses[statusClass(status)]++;r.durations[bucketIndex(ms)]++;}
    // Event schema is fixed: NEVER forward req.url, req.headers or socket data.
    const event={seq:++sequence,at:new Date(now()).toISOString(),kind:'response',route,status,durationMs:Math.round(ms),...(reason?{upstreamError:reason}:{})};recent.push(event);if(recent.length>50)recent.shift();try{onEvent(event);}catch{}}
  }
  res.once('finish',complete);res.once('close',complete);
  return {markProxied(){proxied=true;},setRoute(label){route=typeof label==='string'&&label.length<=128?label:'(default)';},upstreamStart(){if(upstreamStarted===null){upstreamStarted=now();activeUpstream++;}},upstreamResponse,upstreamEnd(){upstreamDone();},upstreamFailure(code){upstreamDone(true,code);}};
 }
 function snapshot(){const minute=Math.floor(now()/60000),history=[];for(let m=minute-59;m<=minute;m++){const b=buckets[((m%WINDOW)+WINDOW)%WINDOW];history.push(b?.minute===m?b:empty(m));}
 return {period:'rolling_60_minutes',dataScope:'in_memory_per_process',totalRequests:totals.requests,proxiedRequests:totals.proxied,activeRequests,activeUpstream,upstreamResponses:totals.upstreamResponses,upstreamFailures:totals.upstreamFailures,avgDurationMs:totals.requests?Math.round(totals.durationTotalMs/totals.requests):0,avgUpstreamMs:totals.upstreamResponses?Math.round(totals.upstreamTotalMs/totals.upstreamResponses):0,requestsLastMinute:history[59].requests,statuses:{...totals.statuses},routes:[...routeStats.values()].map(r=>({path:r.path,requests:r.requests,statuses:{...r.statuses},upstreamFailures:r.upstreamFailures,latency:quantiles(r.durations),upstreamFirstHeader:quantiles(r.upstreamLatency)})).sort((a,b)=>a.path.localeCompare(b.path)),recentEvents:[...recent],trend:Array.from({length:12},(_,i)=>{const h=history.slice(i*5,i*5+5);return {startMinute:h[0].minute,requests:h.reduce((n,b)=>n+b.requests,0),proxied:h.reduce((n,b)=>n+b.proxied,0)};})};}
 return {begin,snapshot};
}
