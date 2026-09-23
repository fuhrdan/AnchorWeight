// Optional bounded HEAD probes for the currently active, already approved origin.
// Monitor state is advisory; transport errors are handled by the proxy itself.
import http from 'node:http';
import https from 'node:https';

const escapeHtml=value=>String(value).replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
export function maintenanceResponse(req,res,{title='Service temporarily unavailable',message='Please try again shortly.'}={}){
  if(res.headersSent){res.destroy();return;}
  const accept=String(req.headers.accept||'');
  const json=accept.includes('application/json')||req.url?.startsWith('/api/');
  const body=json?JSON.stringify({error:'upstream_unavailable',message:title}):
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title></head><body><main><h1>${escapeHtml(title)}</h1><p>${escapeHtml(message)}</p></main></body></html>`;
  res.writeHead(503,{'Content-Type':json?'application/json; charset=utf-8':'text/html; charset=utf-8',
    'Cache-Control':'no-store','Retry-After':'30','X-Content-Type-Options':'nosniff'});
  res.end(req.method==='HEAD'?'':body);
}
export function createUpstreamHealth(config,{getOrigin=()=>config.originUrl,getProxyEnabled=()=>config.proxyEnabled,
  requestHttp=http.request,requestHttps=https.request}={}){
  let state={status:'disabled',lastCheckedAt:null,lastHttpStatus:null,consecutiveFailures:0,latencyMs:null};
  let timer=null,stopped=false,inFlight=false,activeOrigin=null;
  async function probe(){
    if(stopped||inFlight)return snapshot();
    if(!config.gatewayHealthEnabled||!getProxyEnabled()){
      state={...state,status:'disabled'};return snapshot();
    }
    inFlight=true;
    const started=Date.now();
    const origin=new URL(getOrigin());
    const probedOrigin=origin.href;
    if(activeOrigin!==probedOrigin){
      activeOrigin=probedOrigin;
      state={status:'unknown',lastCheckedAt:null,lastHttpStatus:null,consecutiveFailures:0,latencyMs:null};
    }
    const result=await new Promise(resolve=>{
      const transport=origin.protocol==='https:'?requestHttps:requestHttp;
      let settled=false;
      const done=value=>{if(!settled){settled=true;resolve(value);}};
      const req=transport(origin,{method:'HEAD',timeout:config.gatewayHealthTimeoutMs||2000},res=>{
        res.resume();done({httpStatus:res.statusCode,ok:(res.statusCode||500)<500});
      });
      req.once('timeout',()=>req.destroy(new Error('timeout')));
      req.once('error',()=>done({ok:false,httpStatus:null}));
      req.end();
    });
    if(activeOrigin!==probedOrigin||!getProxyEnabled()||new URL(getOrigin()).href!==probedOrigin){
      inFlight=false;
      queueMicrotask(()=>{probe().catch(()=>{inFlight=false;});});
      return snapshot(); // Never attribute an old origin's health to a newly selected origin.
    }
    const failures=result.ok?0:state.consecutiveFailures+1;
    state={status:result.ok?'healthy':failures>=2?'unavailable':'degraded',
      lastCheckedAt:new Date().toISOString(),lastHttpStatus:result.httpStatus||null,
      consecutiveFailures:failures,latencyMs:Date.now()-started};
    inFlight=false;
    return snapshot();
  }
  function start(){
    if(!config.gatewayHealthEnabled||timer)return;
    stopped=false;
    timer=setInterval(()=>{probe().catch(()=>{inFlight=false;});},config.gatewayHealthIntervalMs||30000);
    timer.unref?.();
    probe().catch(()=>{inFlight=false;});
  }
  function stop(){stopped=true;if(timer)clearInterval(timer);timer=null;}
  function snapshot(){const current=getProxyEnabled()?new URL(getOrigin()).href:null;
    return {...state,status:!config.gatewayHealthEnabled||!current?'disabled':current!==activeOrigin?'unknown':state.status,enabled:!!config.gatewayHealthEnabled,probeMethod:'HEAD',scope:'local_process'};}
  return {start,stop,probe,snapshot};
}
