import crypto from 'node:crypto';

const MAX_DIMENSION = 32768;
const MAX_DPR = 16;
const MAX_HARDWARE_CONCURRENCY = 1024;
const MAX_TOUCH_POINTS = 100;
const ALLOWED_ORIENTATIONS = new Set([
  'portrait-primary','portrait-secondary','landscape-primary','landscape-secondary','unknown'
]);

function finiteNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function integer(value) {
  const n = finiteNumber(value);
  return n == null ? null : Math.round(n);
}

function boundedInteger(value, min, max) {
  const n = integer(value);
  return n == null || n < min || n > max ? null : n;
}

function optionalBoolean(value) {
  return typeof value === 'boolean' ? value : null;
}

function shortHash(secret, value) {
  return crypto.createHmac('sha256', secret).update(String(value)).digest('hex').slice(0, 16);
}

export function normalizeClientEnvironment(input = {}) {
  const screenWidth=integer(input.screenWidth), screenHeight=integer(input.screenHeight);
  const availWidth=integer(input.availWidth), availHeight=integer(input.availHeight);
  const viewportWidth=integer(input.viewportWidth), viewportHeight=integer(input.viewportHeight);
  const devicePixelRatio=finiteNumber(input.devicePixelRatio);
  const colorDepth=integer(input.colorDepth);
  const orientation=ALLOWED_ORIENTATIONS.has(String(input.orientation || 'unknown'))
    ? String(input.orientation || 'unknown') : 'unknown';

  return {
    screenAvailable: input.screenAvailable !== false,
    screenWidth, screenHeight, availWidth, availHeight,
    viewportWidth, viewportHeight,
    devicePixelRatio: devicePixelRatio == null ? null : Math.round(devicePixelRatio * 100) / 100,
    colorDepth, orientation,
    webdriver: optionalBoolean(input.webdriver),
    screenExtendedAvailable: input.screenExtendedAvailable === true,
    screenExtended: optionalBoolean(input.screenExtended),
    windowManagementApiAvailable: input.windowManagementApiAvailable === true,
    hardwareConcurrency: boundedInteger(input.hardwareConcurrency, 1, MAX_HARDWARE_CONCURRENCY),
    maxTouchPoints: boundedInteger(input.maxTouchPoints, 0, MAX_TOUCH_POINTS)
  };
}

export function assessHeadlessConsistency(environment = {}) {
  const indicators=[];
  const add=(reason, strength='supporting')=>{
    if(!indicators.some(x=>x.reason===reason)) indicators.push({reason,strength});
  };

  if (environment.webdriver === true) add('webdriver_automation_controlled','strong');
  if (!environment.screenAvailable) add('screen_api_unavailable','supporting');
  if (!environment.screenAvailable && environment.viewportWidth && environment.viewportHeight)
    add('viewport_without_screen_api','supporting');

  const multiScreenState = environment.screenExtendedAvailable
    ? (environment.screenExtended === true ? 'extended' : 'not_extended')
    : 'unavailable';

  return {
    observationOnly: true,
    automationControlled: environment.webdriver === true,
    indicators,
    multiScreenState,
    capabilities: {
      webdriverReported: environment.webdriver !== null,
      screenExtendedAvailable: !!environment.screenExtendedAvailable,
      windowManagementApiAvailable: !!environment.windowManagementApiAvailable,
      exactScreenCountCollected: false,
      permissionPromptRequested: false
    },
    hardwareConcurrency: environment.hardwareConcurrency,
    maxTouchPoints: environment.maxTouchPoints
  };
}

export function assessClientEnvironment(input = {}, { secret='anchorweight', previousFingerprints=[] } = {}) {
  const e=normalizeClientEnvironment(input);
  const reasons=[];
  let points=0;
  const add=(reason,value)=>{ if(value>0 && !reasons.some(x=>x.reason===reason)){reasons.push({reason,points:value});points+=value;} };

  if (!e.screenAvailable) add('screen_api_unavailable', 12);

  const dims=[e.screenWidth,e.screenHeight,e.availWidth,e.availHeight,e.viewportWidth,e.viewportHeight];
  if (e.screenAvailable && dims.some(v=>v == null)) add('display_values_missing', 8);
  if (dims.some(v=>v != null && (v <= 0 || v > MAX_DIMENSION))) add('display_dimensions_invalid', 25);

  if (e.screenWidth && e.screenHeight && e.availWidth && e.availHeight) {
    if (e.availWidth > e.screenWidth || e.availHeight > e.screenHeight) add('available_area_exceeds_screen', 20);
  }
  if (e.screenWidth && e.screenHeight && e.viewportWidth && e.viewportHeight) {
    if (e.viewportWidth > e.screenWidth * 1.25 || e.viewportHeight > e.screenHeight * 1.25)
      add('viewport_materially_exceeds_screen', 15);
  }
  if (e.devicePixelRatio != null && (e.devicePixelRatio <= 0 || e.devicePixelRatio > MAX_DPR))
    add('device_pixel_ratio_invalid', 15);
  if (e.colorDepth != null && ![1,4,8,15,16,24,30,32,36,48].includes(e.colorDepth))
    add('unusual_color_depth', 3);

  if (e.screenWidth && e.screenHeight && e.orientation !== 'unknown') {
    const portrait=e.screenHeight > e.screenWidth;
    const saysPortrait=e.orientation.startsWith('portrait');
    if (portrait !== saysPortrait && e.screenWidth !== e.screenHeight) add('orientation_dimension_mismatch', 5);
  }

  if (e.screenWidth && e.screenHeight) {
    const ratio=Math.max(e.screenWidth/e.screenHeight,e.screenHeight/e.screenWidth);
    if (ratio > 5) add('unusual_aspect_ratio', 2);
    if (e.screenWidth < 240 || e.screenHeight < 240) add('unusual_small_screen', 2);
  }

  const tuple=[
    e.screenAvailable?1:0,e.screenWidth,e.screenHeight,e.availWidth,e.availHeight,
    e.viewportWidth,e.viewportHeight,e.devicePixelRatio,e.colorDepth,e.orientation,
    e.webdriver,e.screenExtendedAvailable,e.screenExtended,e.windowManagementApiAvailable,
    e.hardwareConcurrency,e.maxTouchPoints
  ].join('|');
  const fingerprint=shortHash(secret,`display:${tuple}`);
  const prior=[...new Set((previousFingerprints || []).map(String))];
  if (prior.length >= 2 && !prior.includes(fingerprint)) add('display_fingerprint_changed_repeatedly', 5);

  return {
    environment:e,
    fingerprint,
    points:Math.min(points,100),
    reasons,
    headlessConsistency:assessHeadlessConsistency(e)
  };
}

export function clientEnvironmentCollector(basePath='/anchor') {
  const endpoint=`${String(basePath).replace(/\/$/,'')}/client-environment`;
  return `<script data-anchorweight-client-environment>(function(){try{var s=window.screen||null,o=s&&s.orientation,n=window.navigator||{};var ex=!!s&&typeof s.isExtended==='boolean';var p={screenAvailable:!!s,screenWidth:s&&s.width,screenHeight:s&&s.height,availWidth:s&&s.availWidth,availHeight:s&&s.availHeight,viewportWidth:window.innerWidth,viewportHeight:window.innerHeight,devicePixelRatio:window.devicePixelRatio,colorDepth:s&&s.colorDepth,orientation:o&&o.type||'unknown',webdriver:typeof n.webdriver==='boolean'?n.webdriver:null,screenExtendedAvailable:ex,screenExtended:ex?s.isExtended:null,windowManagementApiAvailable:typeof window.getScreenDetails==='function',hardwareConcurrency:n.hardwareConcurrency,maxTouchPoints:n.maxTouchPoints};fetch(${JSON.stringify(endpoint)},{method:'POST',credentials:'same-origin',keepalive:true,headers:{'content-type':'application/json'},body:JSON.stringify(p)}).catch(function(){});}catch(e){}})();</script>`;
}

export function injectClientEnvironmentCollector(html, basePath) {
  const text=String(html ?? '');
  if (text.includes('data-anchorweight-client-environment')) return text;
  const script=clientEnvironmentCollector(basePath);
  if (/<\/body\s*>/i.test(text)) return text.replace(/<\/body\s*>/i,`${script}</body>`);
  return `${text}${script}`;
}
