const PROVIDERS = Object.freeze(['openai','anthropic','google','perplexity']);
const VERIFICATION_STATUSES = Object.freeze(['verified','unverified','unavailable','disabled','not_applicable']);
const ACTIONS = Object.freeze(['allow','observe','deny']);
const OUTCOMES = Object.freeze(['allowed','observed','would_deny','denied']);
const PURPOSES = Object.freeze(['model_training','search_indexing','user_retrieval','general_automation','unknown']);
const POLICY_SOURCES = Object.freeze(['declaration_policy','verification_rule']);
const MAX_FAMILIES = 32;
const MAX_RECENT = 24;

function freshCounter(keys) {
  return Object.fromEntries(keys.map(key => [key,0]));
}

function bump(target,key) {
  if (Object.prototype.hasOwnProperty.call(target,key)) target[key]++;
}

function familyName(value) {
  const text=String(value||'').toLowerCase();
  return /^[a-z0-9_-]{2,64}$/.test(text) ? text : null;
}

function purposeName(value) {
  const text=String(value||'unknown');
  return PURPOSES.includes(text) ? text : 'unknown';
}

function verificationName(value) {
  const text=String(value||'unavailable');
  return VERIFICATION_STATUSES.includes(text) ? text : 'unavailable';
}

function actionName(value) {
  const text=String(value||'observe');
  return ACTIONS.includes(text) ? text : 'observe';
}

function policySourceName(value) {
  const text=String(value||'declaration_policy');
  return POLICY_SOURCES.includes(text) ? text : 'declaration_policy';
}

function outcomeFor(decision={}) {
  const action=actionName(decision.action);
  if(action==='deny') return decision.enforcementEligible===true ? 'denied' : 'would_deny';
  if(action==='allow') return 'allowed';
  return 'observed';
}

function newBucket(nameKey,name) {
  return {
    [nameKey]:name,
    requests:0,
    verification:freshCounter(VERIFICATION_STATUSES),
    actions:freshCounter(ACTIONS),
    outcomes:freshCounter(OUTCOMES),
    verificationPolicyMatches:0
  };
}

function publicBucket(bucket) {
  return {
    ...bucket,
    verification:{...bucket.verification},
    actions:{...bucket.actions},
    outcomes:{...bucket.outcomes}
  };
}

export function describeAiAgentTrafficObservatory() {
  return {
    version:1,
    available:true,
    authenticated:true,
    processLocal:true,
    resetOnRestart:true,
    maxFamilies:MAX_FAMILIES,
    maxRecentDecisions:MAX_RECENT,
    enforcement:false,
    rawIpRetained:false,
    rawUserAgentRetained:false,
    rawPathRetained:false,
    rawQueryRetained:false,
    rawCookieRetained:false
  };
}

export class AiAgentTrafficObservatory {
  constructor({now=()=>Date.now()}={}) {
    this.now=now;
    this.requests=0;
    this.verification=freshCounter(VERIFICATION_STATUSES);
    this.actions=freshCounter(ACTIONS);
    this.outcomes=freshCounter(OUTCOMES);
    this.purposes=freshCounter(PURPOSES);
    this.policySources=freshCounter(POLICY_SOURCES);
    this.verificationPolicyMatches=0;
    this.providers=new Map();
    this.families=new Map();
    this.recent=[];
  }

  _provider(name) {
    let bucket=this.providers.get(name);
    if(!bucket) {
      bucket=newBucket('provider',name);
      this.providers.set(name,bucket);
    }
    return bucket;
  }

  _family(provider,family) {
    const key=`${provider}:${family}`;
    let bucket=this.families.get(key);
    if(bucket) return bucket;
    if(this.families.size>=MAX_FAMILIES) return null;
    bucket={...newBucket('family',family),provider};
    this.families.set(key,bucket);
    return bucket;
  }

  record(decision={},verification={}) {
    const provider=String(decision?.provider||verification?.provider||'').toLowerCase();
    if(!PROVIDERS.includes(provider)) return {recorded:false,reason:'unsupported_provider'};
    const family=familyName(decision?.family||verification?.family);
    if(!family) return {recorded:false,reason:'invalid_family'};

    const verificationStatus=verificationName(verification?.status||decision?.verificationStatus);
    const action=actionName(decision?.action);
    const purpose=purposeName(decision?.purpose);
    const policySource=policySourceName(decision?.policySource);
    const outcome=outcomeFor(decision);
    const matched=decision?.verificationPolicyMatched===true;

    this.requests++;
    bump(this.verification,verificationStatus);
    bump(this.actions,action);
    bump(this.outcomes,outcome);
    bump(this.purposes,purpose);
    bump(this.policySources,policySource);
    if(matched) this.verificationPolicyMatches++;

    const providerBucket=this._provider(provider);
    providerBucket.requests++;
    bump(providerBucket.verification,verificationStatus);
    bump(providerBucket.actions,action);
    bump(providerBucket.outcomes,outcome);
    if(matched) providerBucket.verificationPolicyMatches++;

    const familyBucket=this._family(provider,family);
    if(familyBucket) {
      familyBucket.requests++;
      bump(familyBucket.verification,verificationStatus);
      bump(familyBucket.actions,action);
      bump(familyBucket.outcomes,outcome);
      if(matched) familyBucket.verificationPolicyMatches++;
    }

    const at=new Date(Number(this.now())||Date.now()).toISOString();
    this.recent.push({
      at,provider,family,purpose,verificationStatus,action,outcome,policySource,
      verificationPolicyMatched:matched
    });
    if(this.recent.length>MAX_RECENT) this.recent.splice(0,this.recent.length-MAX_RECENT);

    return {recorded:true,outcome};
  }

  snapshot() {
    const providers=[...this.providers.values()]
      .sort((a,b)=>b.requests-a.requests || a.provider.localeCompare(b.provider))
      .map(provider=>{
        const families=[...this.families.values()]
          .filter(f=>f.provider===provider.provider)
          .sort((a,b)=>b.requests-a.requests || a.family.localeCompare(b.family))
          .map(publicBucket);
        return {...publicBucket(provider),families};
      });
    return {
      version:1,
      processLocal:true,
      resetOnRestart:true,
      requests:this.requests,
      declaredRequests:this.requests,
      verification:{...this.verification},
      actions:{...this.actions},
      outcomes:{...this.outcomes},
      purposes:{...this.purposes},
      policySources:{...this.policySources},
      verificationPolicyMatches:this.verificationPolicyMatches,
      providers,
      recent:this.recent.map(entry=>({...entry})),
      limits:{providers:PROVIDERS.length,families:MAX_FAMILIES,recent:MAX_RECENT},
      privacy:{
        rawIpRetained:false,
        rawUserAgentRetained:false,
        rawPathRetained:false,
        rawQueryRetained:false,
        rawCookieRetained:false
      },
      enforcement:false
    };
  }
}

export function createAiAgentTrafficObservatory(options={}) {
  return new AiAgentTrafficObservatory(options);
}
