import net from 'node:net';

export const AI_AGENT_VERIFICATION_STATUS = Object.freeze({
  VERIFIED: 'verified',
  UNVERIFIED: 'unverified',
  UNAVAILABLE: 'unavailable',
  DISABLED: 'disabled',
  NOT_APPLICABLE: 'not_applicable'
});

const FEEDS = Object.freeze({
  'openai:gptbot': {
    url:'https://openai.com/gptbot.json',
    method:'published_cidr',
    scope:'family_network',
    source:'openai_gptbot_ranges'
  },
  'openai:oai-searchbot': {
    url:'https://openai.com/searchbot.json',
    method:'published_cidr',
    scope:'family_network',
    source:'openai_searchbot_ranges'
  },
  'openai:chatgpt-user': {
    url:'https://openai.com/chatgpt-user.json',
    method:'published_cidr',
    scope:'family_network',
    source:'openai_chatgpt_user_ranges'
  },
  'openai:oai-adsbot': {
    url:'https://openai.com/adsbot.json',
    method:'published_cidr',
    scope:'family_network',
    source:'openai_adsbot_ranges'
  },
  'perplexity:perplexitybot': {
    url:'https://www.perplexity.com/perplexitybot.json',
    method:'published_cidr',
    scope:'family_network',
    source:'perplexity_bot_ranges'
  },
  'perplexity:perplexity-user': {
    url:'https://www.perplexity.com/perplexity-user.json',
    method:'published_cidr',
    scope:'family_network',
    source:'perplexity_user_ranges'
  },
  'google:google-agent': {
    url:'https://developers.google.com/crawling/ipranges/user-triggered-agents.json',
    method:'published_cidr',
    scope:'provider_category_network',
    source:'google_user_triggered_agent_ranges'
  },
  'google:google-gemininotebook': {
    url:'https://developers.google.com/crawling/ipranges/user-triggered-fetchers-google.json',
    method:'published_cidr',
    scope:'provider_category_network',
    source:'google_user_triggered_fetcher_ranges'
  },
  'google:google-cloudvertexbot': {
    url:'https://developers.google.com/crawling/ipranges/common-crawlers.json',
    method:'published_cidr',
    scope:'provider_category_network',
    source:'google_common_crawler_ranges'
  }
});

const ALLOWED_URLS = new Set(Object.values(FEEDS).map(x=>x.url));
const MAX_RESPONSE_BYTES = 131072;
const MAX_PREFIXES = 4096;

function v4ToBigInt(ip) {
  if(net.isIP(ip)!==4) return null;
  let out=0n;
  for(const part of ip.split('.')) out=(out<<8n)|BigInt(Number(part));
  return out;
}

function v6ToBigInt(value) {
  if(net.isIP(value)!==6) return null;
  let ip=String(value).split('%')[0].toLowerCase();
  if(ip.includes('.')) {
    const lastColon=ip.lastIndexOf(':');
    const v4=ip.slice(lastColon+1);
    const n=v4ToBigInt(v4);
    if(n===null)return null;
    ip=`${ip.slice(0,lastColon)}:${((n>>16n)&0xffffn).toString(16)}:${(n&0xffffn).toString(16)}`;
  }
  const halves=ip.split('::');
  if(halves.length>2)return null;
  const left=halves[0]?halves[0].split(':').filter(Boolean):[];
  const right=halves.length===2 && halves[1]?halves[1].split(':').filter(Boolean):[];
  const missing=8-left.length-right.length;
  if(missing<0 || (halves.length===1 && missing!==0))return null;
  const groups=[...left,...Array(missing).fill('0'),...right];
  if(groups.length!==8)return null;
  let out=0n;
  for(const group of groups){
    if(!/^[0-9a-f]{1,4}$/i.test(group))return null;
    out=(out<<16n)|BigInt(parseInt(group,16));
  }
  return out;
}

function ipToBigInt(ip) {
  const version=net.isIP(ip);
  if(version===4)return {version,value:v4ToBigInt(ip),bits:32};
  if(version===6)return {version,value:v6ToBigInt(ip),bits:128};
  return null;
}

export function normalizeCidr(value) {
  const raw=String(value||'').trim();
  const match=raw.match(/^([^/]+)\/(\d{1,3})$/);
  if(!match)return null;
  const parsed=ipToBigInt(match[1]);
  if(!parsed || parsed.value===null)return null;
  const prefix=Number(match[2]);
  if(!Number.isInteger(prefix)||prefix<0||prefix>parsed.bits)return null;
  return {text:raw,version:parsed.version,value:parsed.value,prefix,bits:parsed.bits};
}

export function ipInCidr(ip,cidr) {
  const parsedIp=ipToBigInt(String(ip||'').trim());
  const parsedCidr=typeof cidr==='string'?normalizeCidr(cidr):cidr;
  if(!parsedIp || parsedIp.value===null || !parsedCidr || parsedIp.version!==parsedCidr.version)return false;
  const hostBits=BigInt(parsedCidr.bits-parsedCidr.prefix);
  if(hostBits===BigInt(parsedCidr.bits))return true;
  const mask=((1n<<BigInt(parsedCidr.bits))-1n)^((1n<<hostBits)-1n);
  return (parsedIp.value & mask)===(parsedCidr.value & mask);
}

export function parsePublishedPrefixes(payload) {
  if(!payload || typeof payload!=='object' || !Array.isArray(payload.prefixes))throw new Error('invalid_prefix_feed');
  if(payload.prefixes.length>MAX_PREFIXES)throw new Error('too_many_prefixes');
  const out=[];
  for(const item of payload.prefixes){
    if(!item || typeof item!=='object')continue;
    for(const key of ['ipv4Prefix','ipv6Prefix']){
      if(typeof item[key]!=='string')continue;
      const cidr=normalizeCidr(item[key]);
      if(!cidr)throw new Error('invalid_prefix');
      out.push(cidr);
      if(out.length>MAX_PREFIXES)throw new Error('too_many_prefixes');
    }
  }
  if(!out.length)throw new Error('empty_prefix_feed');
  return out;
}

function result(status, identity={}, extra={}) {
  return {
    version:1,
    status,
    verified:status===AI_AGENT_VERIFICATION_STATUS.VERIFIED,
    provider:typeof identity?.provider==='string'?identity.provider:null,
    family:typeof identity?.family==='string'?identity.family:null,
    method:extra.method||null,
    scope:extra.scope||null,
    source:extra.source||null,
    reason:extra.reason||null,
    cache:extra.cache||null,
    trustGranted:false
  };
}

async function boundedJsonFetch(url, {fetchImpl, timeoutMs}) {
  if(!ALLOWED_URLS.has(url))throw new Error('verification_feed_not_allowlisted');
  if(typeof fetchImpl!=='function')throw new Error('fetch_unavailable');
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),timeoutMs);
  try{
    const response=await fetchImpl(url,{
      method:'GET',
      redirect:'error',
      headers:{accept:'application/json','user-agent':'AnchorWeight-AI-Agent-Verifier/1'},
      signal:controller.signal
    });
    if(!response?.ok)throw new Error(`verification_feed_http_${Number(response?.status)||0}`);
    const length=Number(response.headers?.get?.('content-length')||0);
    if(length>MAX_RESPONSE_BYTES)throw new Error('verification_feed_too_large');
    const text=await response.text();
    if(Buffer.byteLength(text)>MAX_RESPONSE_BYTES)throw new Error('verification_feed_too_large');
    let parsed;
    try{parsed=JSON.parse(text);}catch{throw new Error('verification_feed_invalid_json');}
    return parsed;
  } finally {
    clearTimeout(timer);
  }
}

export function describeAiAgentVerification(config={}) {
  return {
    version:1,
    enabled:config.aiAgentVerificationEnabled!==false,
    methods:['published_cidr'],
    providers:{
      openai:'family_published_cidr',
      perplexity:'family_published_cidr',
      google:'provider_category_published_cidr',
      anthropic:'provider_ranges_unpublished'
    },
    requiresTrustedClientIdentity:true,
    allowGrantsTrust:false,
    requestDenyDependsOnVerification:false,
    rawIpExposed:false,
    rawRangesExposed:false,
    googleWebBotAuth:{
      status:'experimental_not_implemented',
      identity:'https://agent.bot.goog',
      fallback:'published_cidr'
    }
  };
}

export class AiAgentVerifier {
  constructor(config={}, options={}) {
    this.config=config;
    this.fetchImpl=options.fetchImpl||globalThis.fetch;
    this.now=options.now||(()=>Date.now());
    this.cache=new Map();
  }

  async prefixesFor(feed) {
    const now=Number(this.now())||Date.now();
    const cached=this.cache.get(feed.url);
    if(cached && cached.expiresAt>now)return {prefixes:cached.prefixes,cache:'hit'};
    const timeoutMs=Math.max(250,Math.min(10000,Number(this.config.aiAgentVerificationTimeoutMs)||1500));
    const payload=await boundedJsonFetch(feed.url,{fetchImpl:this.fetchImpl,timeoutMs});
    const prefixes=parsePublishedPrefixes(payload);
    const ttlMinutes=Math.max(5,Math.min(1440,Number(this.config.aiAgentVerificationCacheMinutes)||360));
    this.cache.set(feed.url,{prefixes,expiresAt:now+ttlMinutes*60000});
    return {prefixes,cache:'refresh'};
  }

  async verify(identity={}, clientIdentity={}) {
    if(this.config.aiAgentVerificationEnabled===false)
      return result(AI_AGENT_VERIFICATION_STATUS.DISABLED,identity,{reason:'verification_disabled'});
    if(!identity?.declared || !identity?.provider || !identity?.family)
      return result(AI_AGENT_VERIFICATION_STATUS.NOT_APPLICABLE,identity,{reason:'not_declared_ai_agent'});
    if(identity.provider==='anthropic')
      return result(AI_AGENT_VERIFICATION_STATUS.UNAVAILABLE,identity,{reason:'provider_ranges_unpublished'});
    const feed=FEEDS[`${identity.provider}:${identity.family}`];
    if(!feed)
      return result(AI_AGENT_VERIFICATION_STATUS.UNAVAILABLE,identity,{reason:'no_published_verification_feed'});
    if(clientIdentity?.enforcementSafe!==true || typeof clientIdentity?.ip!=='string' || !net.isIP(clientIdentity.ip))
      return result(AI_AGENT_VERIFICATION_STATUS.UNAVAILABLE,identity,{method:feed.method,scope:feed.scope,source:feed.source,reason:'trusted_client_identity_required'});
    try{
      const loaded=await this.prefixesFor(feed);
      const matched=loaded.prefixes.some(cidr=>ipInCidr(clientIdentity.ip,cidr));
      return result(matched?AI_AGENT_VERIFICATION_STATUS.VERIFIED:AI_AGENT_VERIFICATION_STATUS.UNVERIFIED,identity,{
        method:feed.method,scope:feed.scope,source:feed.source,
        reason:matched?'published_range_match':'published_range_mismatch',
        cache:loaded.cache
      });
    }catch(err){
      return result(AI_AGENT_VERIFICATION_STATUS.UNAVAILABLE,identity,{
        method:feed.method,scope:feed.scope,source:feed.source,
        reason:String(err?.message||'verification_feed_unavailable').slice(0,96)
      });
    }
  }
}

export function createAiAgentVerifier(config={},options={}) {
  return new AiAgentVerifier(config,options);
}
