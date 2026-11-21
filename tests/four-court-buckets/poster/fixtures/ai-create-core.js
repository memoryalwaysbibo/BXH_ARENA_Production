'use strict';

const CONTRACT_VERSION='bxh-arena.ai-create.callable.v1';
const SCHEMA_VERSION='bxh-arena.ai-create.v1';
const TIMEZONE='Asia/Taipei';
const LOCALE='zh-Hant-TW';
const MAX_EVENTS=8;
const MAX_SOURCE_CHARS=12000;
const MAX_RESULT_JSON_CHARS=60000;

const TOP_LEVEL_REQUEST_KEYS=new Set([
  'contractVersion','schemaVersion','sourceText','locale','timezone','limits'
]);
const LIMIT_KEYS=new Set(['maxEvents','maxSourceChars']);

function fail(code){
  const e=new Error(code);
  e.code=code;
  throw e;
}
function assertPlainObject(value,code){
  if(!value||typeof value!=='object'||Array.isArray(value))fail(code);
  return value;
}
function rejectUnknownKeys(obj,allowed,code){
  for(const key of Object.keys(obj))if(!allowed.has(key))fail(code);
}
function isDate(value){
  return value==null||/^\d{4}-\d{2}-\d{2}$/.test(String(value));
}
function isTime(value){
  return value==null||/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(String(value));
}
function isIsoTimestamp(value){
  return value==null||(typeof value==='string'&&value.length<=40&&!Number.isNaN(Date.parse(value)));
}
function cleanString(value,max=500){
  if(value==null)return null;
  if(typeof value!=='string')fail('invalid-string');
  const out=value.trim();
  if(out.length>max)fail('string-too-long');
  return out;
}
function cleanNullableNumber(value,{integer=false,min=0,max=Number.MAX_SAFE_INTEGER}={}){
  if(value==null)return null;
  if(typeof value!=='number'||!Number.isFinite(value))fail('invalid-number');
  if(integer&&!Number.isInteger(value))fail('invalid-number');
  if(value<min||value>max)fail('invalid-number');
  return value;
}
function cleanStringArray(value,maxItems=24,maxChars=160){
  if(value==null)return [];
  if(!Array.isArray(value)||value.length>maxItems)fail('invalid-string-array');
  return value.map(item=>{
    if(typeof item!=='string')fail('invalid-string-array');
    const out=item.trim();
    if(!out||out.length>maxChars)fail('invalid-string-array');
    return out;
  });
}
function canonicalRestriction(value){
  const raw=String(value||'').trim();
  const lower=raw.toLowerCase();
  if(/\b(female|woman|women)\b/.test(lower)||/女性|女子|女生/.test(raw))return 'female';
  if(lower==='age-under-13'||/13\s*歲以下|未滿\s*13\s*歲/.test(raw))return 'age-under-13';
  return raw;
}
function normalizeEventKey(value,index){
  if(typeof value==='string'){
    const raw=value.trim().toLowerCase();
    if(/^[a-z0-9][a-z0-9_-]{0,99}$/.test(raw))return raw;
  }
  return 'event-'+(Number(index)+1);
}

function validateRequest(raw){
  const data=assertPlainObject(raw,'invalid-request');
  rejectUnknownKeys(data,TOP_LEVEL_REQUEST_KEYS,'unexpected-request-field');
  if(data.contractVersion!==CONTRACT_VERSION)fail('contract-version-mismatch');
  if(data.schemaVersion!==SCHEMA_VERSION)fail('schema-version-mismatch');
  if(data.locale!==LOCALE)fail('locale-mismatch');
  if(data.timezone!==TIMEZONE)fail('timezone-mismatch');

  if(typeof data.sourceText!=='string')fail('source-text-required');
  const sourceText=data.sourceText.trim();
  if(!sourceText)fail('source-text-required');
  if(data.sourceText.length>MAX_SOURCE_CHARS)fail('source-text-too-long');

  const limits=assertPlainObject(data.limits,'limits-required');
  rejectUnknownKeys(limits,LIMIT_KEYS,'unexpected-limit-field');
  if(limits.maxEvents!==MAX_EVENTS||limits.maxSourceChars!==MAX_SOURCE_CHARS)fail('limits-mismatch');

  return {
    contractVersion:CONTRACT_VERSION,
    schemaVersion:SCHEMA_VERSION,
    sourceText:data.sourceText,
    locale:LOCALE,
    timezone:TIMEZONE,
    limits:{maxEvents:MAX_EVENTS,maxSourceChars:MAX_SOURCE_CHARS}
  };
}

function normalizeActivity(raw){
  const a=assertPlainObject(raw,'activity-required');
  const name=cleanString(a.name,200);
  if(!isDate(a.date))fail('activity-date-invalid');
  if(!isIsoTimestamp(a.registrationOpenAt))fail('registration-open-invalid');
  if(!isIsoTimestamp(a.registrationCloseAt))fail('registration-close-invalid');
  return {
    name:name||null,
    date:a.date==null?null:String(a.date),
    locationName:cleanString(a.locationName,240),
    address:cleanString(a.address,300),
    registrationChannel:cleanString(a.registrationChannel,200),
    registrationOpenAt:a.registrationOpenAt==null?null:String(a.registrationOpenAt),
    registrationCloseAt:a.registrationCloseAt==null?null:String(a.registrationCloseAt)
  };
}

function normalizeEvent(raw,index){
  const e=assertPlainObject(raw,'event-invalid');
  const key=normalizeEventKey(e.key,index),name=cleanString(e.name,200);
  if(!isDate(e.date))fail('event-date-invalid');
  for(const field of ['checkInStart','checkInEnd','startAt','endAt'])if(!isTime(e[field]))fail('event-time-invalid');
  if(e.endDate!=null&&!isDate(e.endDate))fail('event-end-date-invalid');

  const targetGroup=e.targetGroup==null?null:String(e.targetGroup);
  if(![null,'open','children'].includes(targetGroup))fail('event-target-group-invalid');
  const formatType=e.formatType==null?null:String(e.formatType);
  if(![null,'single','double','roundrobin'].includes(formatType))fail('event-format-invalid');
  if(typeof e.registrationEnabled!=='boolean')fail('event-registration-enabled-invalid');

  return {
    key,
    name:name||null,
    date:e.date==null?null:String(e.date),
    checkInStart:e.checkInStart==null?null:String(e.checkInStart),
    checkInEnd:e.checkInEnd==null?null:String(e.checkInEnd),
    startAt:e.startAt==null?null:String(e.startAt),
    endAt:e.endAt==null?null:String(e.endAt),
    endDate:e.endDate==null?null:String(e.endDate),
    capacity:cleanNullableNumber(e.capacity,{integer:true,min:1,max:4096}),
    fee:cleanNullableNumber(e.fee,{min:0,max:1000000}),
    registrationEnabled:e.registrationEnabled,
    targetGroup,
    participantRestrictions:[...new Set(cleanStringArray(e.participantRestrictions,16,100).map(canonicalRestriction))],
    formatType,
    sourceIndex:index
  };
}

function normalizeBundleOffer(raw,validKeys){
  const b=assertPlainObject(raw,'bundle-offer-invalid');
  const eventKeys=cleanStringArray(b.eventKeys,MAX_EVENTS,100);
  if(!eventKeys.length||eventKeys.some(k=>!validKeys.has(k)))fail('bundle-event-key-invalid');
  return {
    eventKeys,
    price:cleanNullableNumber(b.price,{min:0,max:1000000}),
    regularPrice:cleanNullableNumber(b.regularPrice,{min:0,max:1000000}),
    discount:cleanNullableNumber(b.discount,{min:0,max:1000000}),
    benefits:cleanStringArray(b.benefits,16,200)
  };
}

function normalizeWarning(raw){
  const w=assertPlainObject(raw,'warning-invalid');
  const severity=String(w.severity||'info');
  if(!['info','warning'].includes(severity))fail('warning-severity-invalid');
  const code=cleanString(w.code,100),message=cleanString(w.message,500);
  if(!code||!message)fail('warning-required');
  return {
    severity,
    code,
    field:cleanString(w.field,160),
    message
  };
}

function normalizeResult(raw){
  const result=assertPlainObject(raw,'result-invalid');
  if(result.schemaVersion!==SCHEMA_VERSION)fail('result-schema-version-mismatch');
  if(result.timezone!==TIMEZONE)fail('result-timezone-mismatch');
  const activity=normalizeActivity(result.activity);
  if(!Array.isArray(result.events)||result.events.length<1||result.events.length>MAX_EVENTS)fail('events-count-invalid');
  const events=result.events.map(normalizeEvent);
  const keys=new Set();
  for(const event of events){
    if(keys.has(event.key))fail('event-key-duplicate');
    keys.add(event.key);
    delete event.sourceIndex;
  }
  const bundleOffers=result.bundleOffers==null?[]:(Array.isArray(result.bundleOffers)&&result.bundleOffers.length<=MAX_EVENTS?result.bundleOffers.map(x=>normalizeBundleOffer(x,keys)):(()=>{fail('bundle-offers-invalid');})());
  const warnings=result.warnings==null?[]:(Array.isArray(result.warnings)&&result.warnings.length<=32?result.warnings.map(normalizeWarning):(()=>{fail('warnings-invalid');})());

  const normalized={
    schemaVersion:SCHEMA_VERSION,
    sourceMode:'remote-callable',
    timezone:TIMEZONE,
    activity,
    events,
    bundleOffers,
    warnings
  };
  if(JSON.stringify(normalized).length>MAX_RESULT_JSON_CHARS)fail('result-too-large');
  return normalized;
}

function roleAllowed(profile){
  return !!profile&&profile.active===true&&profile.isTestAccount!==true&&
    profile.deleted!==true&&!['deleted','frozen','disabled'].includes(profile.accountStatus)&&
    ['super_admin','admin','staff'].includes(profile.role);
}
function betaActorAllowed(profile){
  return roleAllowed(profile);
}

module.exports={
  CONTRACT_VERSION,SCHEMA_VERSION,TIMEZONE,LOCALE,MAX_EVENTS,MAX_SOURCE_CHARS,
  validateRequest,normalizeResult,roleAllowed,betaActorAllowed
};
