const TYPES = Object.freeze({
  NORMAL_RESPONSE:'normal_response',
  SHADOW_BRANCH:'shadow_branch',
  SIGNED_DECOY:'signed_decoy',
  DEPTH_EXTENSION:'depth_extension',
  RATE_FRICTION:'rate_friction',
  REAUTH_CHALLENGE:'reauth_challenge',
  QUARANTINE:'quarantine'
});

function clamp(n,min,max){ return Math.max(min,Math.min(max,Number(n)||0)); }

export function createAdaptiveDeception(config, log=()=>{}, now=()=>Date.now()) {
  const enabled = config.adaptiveDeceptionEnabled !== false;
  const shadowOnly = config.adaptiveDeceptionShadowMode !== false;
  const maxHistory = clamp(config.adaptiveDeceptionHistoryLimit ?? 24,4,100);

  function ensure(profile){
    profile.adaptiveDeception ||= {
      observations:0, interventions:0, lastAt:null, lastIntervention:null,
      history:[], attackerCost:{requestsDiverted:0,shadowTraversals:0,decoyInteractions:0,
        additionalDepth:0,estimatedDelayMs:0,originRequestsPrevented:0}
    };
    return profile.adaptiveDeception;
  }

  function recommend(profile, event={}) {
    if (!enabled) return {type:TYPES.NORMAL_RESPONSE, reason:'disabled', shadowOnly:true};
    const risk=Number(profile.score)||0;
    const proof=Number(profile.proofOfCrawl)||0;
    const depth=Math.max(Number(profile.maxDepth)||0,Number(event.depth)||0);
    const invalid=Number(profile.invalidTraversals)||0;
    const rapid=Number(profile.rapidRequestCount)||0;
    let type=TYPES.NORMAL_RESPONSE, reason='insufficient_evidence';
    if (proof>0 && depth>=3) { type=TYPES.DEPTH_EXTENSION; reason='proof_of_crawl_with_persistence'; }
    else if ((profile.blackholeVisits||0)>0) { type=TYPES.SIGNED_DECOY; reason='blackhole_persistence'; }
    else if (invalid>=3 && risk>=25) { type=TYPES.SHADOW_BRANCH; reason='repeated_invalid_enumeration'; }
    else if (rapid>=6 && risk>=20) { type=TYPES.RATE_FRICTION; reason='rapid_high_risk_enumeration'; }
    return {type,reason,shadowOnly};
  }

  function observe(profile, event={}) {
    const state=ensure(profile); const at=now();
    state.observations++; state.lastAt=at;
    const recommendation=recommend(profile,event);
    const kind=String(event.kind||'request');
    if (['traversal','proof_of_crawl','blackhole'].includes(kind)) {
      state.attackerCost.requestsDiverted++;
      state.attackerCost.originRequestsPrevented++;
    }
    if (kind==='traversal') {
      state.attackerCost.shadowTraversals++;
      state.attackerCost.additionalDepth=Math.max(state.attackerCost.additionalDepth,Number(event.depth)||0);
      state.attackerCost.estimatedDelayMs += clamp(event.elapsedMs,0,300000);
    }
    if (kind==='blackhole') state.attackerCost.decoyInteractions++;
    if (recommendation.type!==TYPES.NORMAL_RESPONSE) {
      state.interventions++; state.lastIntervention=recommendation.type;
    }
    const entry={at,kind,recommendation:recommendation.type,reason:recommendation.reason,shadowOnly};
    state.history.push(entry); if(state.history.length>maxHistory)state.history.shift();
    log({type:'adaptive_deception',...entry});
    return {recommendation,attackerCost:{...state.attackerCost}};
  }

  return {enabled,shadowOnly,recommend,observe,ensure,TYPES};
}

export { TYPES as ADAPTIVE_INTERVENTIONS };
