// Aggregate-only, bounded 60-minute traffic telemetry. No raw clients, paths or headers.
const WINDOW=60;
const statusClass=s=>s>=500?'5xx':s>=400?'4xx':s>=300?'3xx':s>=200?'2xx':'other';
const empty=minute=>({minute,requests:0,proxied:0,durationTotalMs:0,upstreamTotalMs:0,
  upstreamResponses:0,upstreamFailures:0,statuses:{'2xx':0,'3xx':0,'4xx':0,'5xx':0,other:0}});
export function createTrafficTelemetry({now=()=>Date.now()}={}) {
  const buckets=new Array(WINDOW);
  const totals=empty(0);
  let activeRequests=0,activeUpstream=0;
  function bucket(t) {
    const minute=Math.floor(t/60000),index=((minute%WINDOW)+WINDOW)%WINDOW;
    if (!buckets[index] || buckets[index].minute!==minute) buckets[index]=empty(minute);
    return buckets[index];
  }
  function begin(req,res) {
    const started=now();
    let proxied=false,completed=false,upstreamStarted=null,upstreamCompleted=false,upstreamHeaders=false;
    activeRequests++;
    function upstreamResponse(status) {
      if (upstreamStarted===null || upstreamCompleted || upstreamHeaders) return;
      upstreamHeaders=true;
      const elapsed=Math.max(0,now()-upstreamStarted);
      for(const b of [bucket(now()),totals]) {
        b.upstreamResponses++;
        b.upstreamTotalMs+=elapsed;
      }
    }
    function upstreamDone(failed=false) {
      if (upstreamStarted===null || upstreamCompleted) return;
      upstreamCompleted=true;
      activeUpstream=Math.max(0,activeUpstream-1);
      if (failed) for(const b of [bucket(now()),totals]) b.upstreamFailures++;
    }
    function complete() {
      if (completed)return;
      completed=true;
      activeRequests=Math.max(0,activeRequests-1);
      upstreamDone(true);
      const elapsed=Math.max(0,now()-started);
      for(const b of [bucket(now()),totals]){
        b.requests++;
        b.proxied+=Number(proxied);
        b.durationTotalMs+=elapsed;
        b.statuses[statusClass(res.statusCode||0)]++;
      }
    }
    res.once('finish',complete);res.once('close',complete);
    return {
      markProxied(){proxied=true;},
      upstreamStart(){if(upstreamStarted===null){upstreamStarted=now();activeUpstream++;}},
      upstreamResponse,
      upstreamEnd(){upstreamDone();},
      upstreamFailure(){upstreamDone(true);}
    };
  }
  function snapshot() {
    const minute=Math.floor(now()/60000),recent=[];
    for(let m=minute-59;m<=minute;m++){
      const b=buckets[((m%WINDOW)+WINDOW)%WINDOW];
      recent.push(b?.minute===m?b:empty(m));
    }
    return {period:'rolling_60_minutes',dataScope:'in_memory_per_process',
      totalRequests:totals.requests,proxiedRequests:totals.proxied,
      activeRequests,activeUpstream,upstreamResponses:totals.upstreamResponses,
      upstreamFailures:totals.upstreamFailures,
      avgDurationMs:totals.requests?Math.round(totals.durationTotalMs/totals.requests):0,
      avgUpstreamMs:totals.upstreamResponses?Math.round(totals.upstreamTotalMs/totals.upstreamResponses):0,
      requestsLastMinute:recent[59].requests,statuses:{...totals.statuses},
      trend:Array.from({length:12},(_,i)=>{const w=recent.slice(i*5,i*5+5);return {
        startMinute:w[0].minute,requests:w.reduce((n,b)=>n+b.requests,0),
        proxied:w.reduce((n,b)=>n+b.proxied,0)};})};
  }
  return {begin,snapshot};
}
