export const AI_AGENT_VERIFICATION_RULE_STATUSES = Object.freeze([
  'verified','unverified','unavailable','disabled'
]);

const ACTIONS = new Set(['allow','observe','deny']);
const STATUSES = new Set(AI_AGENT_VERIFICATION_RULE_STATUSES);
const RULE_RE = /^([a-z0-9_-]{2,32}):([a-z0-9_-]{2,64})@(verified|unverified|unavailable|disabled)=(allow|observe|deny)$/;

export function parseAiAgentVerificationRules(input = []) {
  const source=Array.isArray(input) ? input : String(input||'').split(',');
  const rules=new Map();
  const invalid=[];
  for(const raw of source.slice(0,32)) {
    const value=String(raw||'').trim().toLowerCase();
    if(!value) continue;
    const match=value.match(RULE_RE);
    if(!match) { invalid.push(value.slice(0,160)); continue; }
    rules.set(`${match[1]}:${match[2]}@${match[3]}`,match[4]);
  }
  return {rules,invalid};
}

function recompute(action, config, pathname) {
  const denyRequested=action==='deny';
  const shadow=config.aiAgentPolicyShadowMode!==false;
  const explicitEnforcement=!!config.aiAgentPolicyEnforcementEnabled;
  const robotsDiscovery=String(pathname||'')==='/robots.txt';
  const enforcementEligible=denyRequested && explicitEnforcement && !shadow && !robotsDiscovery;
  if(denyRequested) {
    if(robotsDiscovery) return {enforcement:'shadow_only',enforcementEligible:false,reason:'robots_discovery_allowed'};
    if(!explicitEnforcement) return {enforcement:'shadow_only',enforcementEligible:false,reason:'enforcement_not_enabled'};
    if(shadow) return {enforcement:'shadow_only',enforcementEligible:false,reason:'ai_agent_shadow_mode'};
    return {enforcement:'deny',enforcementEligible:true,reason:'verification_rule'};
  }
  if(action==='observe') return {enforcement:'observe',enforcementEligible:false,reason:'verification_rule'};
  return {enforcement:'allow_without_trust',enforcementEligible:false,reason:'verification_rule'};
}

export function applyAiAgentVerificationPolicy(baseDecision={}, verification={}, config={}, {pathname=''}={}) {
  const status=STATUSES.has(String(verification?.status||'')) ? String(verification.status) : 'unavailable';
  const parsed=parseAiAgentVerificationRules(config.aiAgentVerificationRules ?? []);
  const provider=String(baseDecision?.provider||verification?.provider||'').toLowerCase();
  const family=String(baseDecision?.family||verification?.family||'').toLowerCase();
  const key=provider && family ? `${provider}:${family}@${status}` : '';
  const ruleAction=key ? parsed.rules.get(key) : undefined;

  // No explicit verification-aware rule means alpha.1 declaration policy remains authoritative.
  if(!baseDecision?.matched || !ruleAction || !ACTIONS.has(ruleAction)) {
    return {
      ...baseDecision,
      version:2,
      baseAction:baseDecision?.action||'allow',
      verificationStatus:status,
      verificationPolicyMatched:false,
      verificationPolicyKey:key||null,
      policySource:'declaration_policy',
      verificationRuleInvalidCount:parsed.invalid.length,
      trustGranted:false
    };
  }

  const posture=recompute(ruleAction,config,pathname);
  return {
    ...baseDecision,
    version:2,
    baseAction:baseDecision?.action||'allow',
    action:ruleAction,
    enforcement:posture.enforcement,
    enforcementEligible:posture.enforcementEligible,
    reason:posture.reason,
    verificationStatus:status,
    verificationPolicyMatched:true,
    verificationPolicyKey:key,
    policySource:'verification_rule',
    verificationRuleInvalidCount:parsed.invalid.length,
    trustGranted:false
  };
}

export function describeAiAgentVerificationPolicy(config={}) {
  const parsed=parseAiAgentVerificationRules(config.aiAgentVerificationRules ?? []);
  return {
    version:1,
    available:true,
    ruleSyntax:'provider:family@verification_status=allow|observe|deny',
    statuses:[...AI_AGENT_VERIFICATION_RULE_STATUSES],
    configuredRuleCount:parsed.rules.size,
    invalidRuleCount:parsed.invalid.length,
    defaultBehavior:'inherit_declaration_policy',
    unavailableFallsBackToDeclarationPolicy:true,
    verifiedAutomaticallyAllowed:false,
    unverifiedAutomaticallyDenied:false,
    allowGrantsTrust:false,
    rawIpExposed:false
  };
}
