'use strict';

const {createHash} = require('node:crypto');

class CertificateError extends Error {
  constructor(code, reason) { super(reason); this.code = code; }
}
const fail = (code, reason) => { throw new CertificateError(code, reason); };
const RANKS = Object.freeze([
  [1,'萌新裁判',0,0,0,0,'#40701D','#85CE62'],
  [2,'青銅裁判',20,0,0,0,'#8B542F','#C9956B'],
  [3,'白銀裁判',50,1,0,0,'#596775','#C4CEDC'],
  [4,'黃金裁判',100,2,1,0,'#886300','#EAC45A'],
  [5,'白金裁判',200,3,2,0,'#08766B','#56D1BF'],
  [6,'鑽石裁判',450,4,3,0,'#2265A3','#6BBAF5'],
  [7,'星耀裁判',750,6,4,1,'#7950B5','#B79AFA'],
  [8,'王牌裁判',1100,8,5,2,'#BE2C4D','#FF8298'],
  [9,'傳奇裁判',1500,10,6,3,'#A84910','#FFAD61']
].map(([level,name,decisions,c64,c96,c128,light,dark]) =>
  Object.freeze({level,name,decisions,scales:Object.freeze({64:c64,96:c96,128:c128}),light,dark})));
const MILESTONES = Object.freeze(['百人','兩百人','三百人','四百人','五百人','六百人','七百人','八百人','九百人','千人']
  .map((name,i) => Object.freeze({threshold:(i+1)*100,name:name+'賽事'})));
const THRESHOLDS = Object.freeze([...new Set([64,96,128,...MILESTONES.map(x=>x.threshold)])].sort((a,b)=>a-b));
const LIMITS = Object.freeze({logs:3000,rooms:128,backfills:200,auditHistory:1000,scoreAudits:500,auditRooms:16,searchPerField:20});
const PHOTO_LIMIT = 600000;
const PHOTO_BYTES = 450000;
const MAX_COUNT = 1000000;

function integer(value, name, max=Number.MAX_SAFE_INTEGER) {
  if (!Number.isSafeInteger(value) || value<0 || value>max) fail('invalid-argument',name+'-invalid');
  return value;
}
function add(a,b) { const n=a+b; if(!Number.isSafeInteger(n)) fail('failed-precondition','count-overflow'); return n; }
function text(value,name,max,required=false) {
  if(typeof value!=='string') fail('invalid-argument',name+'-invalid');
  const result=value.trim();
  if(result.length>max || (required&&!result) || /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(result)) fail('invalid-argument',name+'-invalid');
  return result;
}
function uid(value) {
  if(typeof value!=='string'||! /^[A-Za-z0-9_-]{1,128}$/.test(value)) fail('invalid-argument','uid-invalid');
  return value;
}
function entryId(value) {
  if(typeof value!=='string'||! /^[A-Za-z0-9_-]{1,100}$/.test(value)) fail('invalid-argument','entry-id-invalid');
  return value;
}
function normalizeBackfill(value) {
  if(!value||typeof value!=='object'||Array.isArray(value)) fail('invalid-argument','backfill-invalid');
  const decisions=integer(value.decisions,'decisions',MAX_COUNT), events=integer(value.events,'events',MAX_COUNT);
  const auxiliary=integer(value.auxiliary??0,'auxiliary',MAX_COUNT);
  if(!decisions&&!events&&!auxiliary) fail('invalid-argument','empty-backfill');
  let precision=value.precision||'unknown',size=value.size??null;
  if(!['exact','at_least','unknown'].includes(precision)) fail('invalid-argument','precision-invalid');
  if(!events) {size=null;precision='unknown';}
  else if(precision==='unknown') {
    if(size!==null) fail('invalid-argument','unknown-size-must-be-null');
  } else {
    integer(size,'size',MAX_COUNT);
    if(size===0) fail('invalid-argument','size-invalid');
  }
  const base={decisions,events,size,precision,period:text(value.period,'period',100,true),note:text(value.note??'','note',500)};
  if(!value.kind) return base; // Legacy records remain readable, but require re-recognition.
  if(!['decision','event','auxiliary'].includes(value.kind)) fail('invalid-argument','recognition-kind-invalid');
  if(value.kind==='decision'&&(!decisions||decisions>200||events||auxiliary)||value.kind==='event'&&(events!==1||decisions||auxiliary)||value.kind==='auxiliary'&&(!auxiliary||decisions||events)) fail('invalid-argument','recognition-count-invalid');
  const keys=value.kind==='decision'&&Array.isArray(value.sourceKeys)?value.sourceKeys:[value.sourceKey];
  if(keys.length>200||!keys.length||value.kind==='decision'&&keys.length!==decisions)fail('invalid-argument','source-keys-count-mismatch');
  const sourceKeys=keys.map(k=>text(k,'source-key',160,true));
  if(new Set(sourceKeys).size!==sourceKeys.length)fail('invalid-argument','duplicate-source-key');
  for(const key of sourceKeys){
    if(!/^(?:match:BXH-[A-Z0-9]{4,24}:[A-Za-z0-9_-]{1,100}|event:BXH-[A-Z0-9]{4,24}|historical:[A-Za-z0-9_-]{1,100})$/.test(key)) fail('invalid-argument','source-key-invalid');
    if(value.kind==='decision'&&key.startsWith('event:')||value.kind==='event'&&key.startsWith('match:')) fail('invalid-argument','source-kind-conflict');
  }
  return {...base,kind:value.kind,auxiliary,sourceKey:sourceKeys[0],...(value.kind==='decision'?{sourceKeys}:{}),basis:text(value.basis,'recognition-basis',500,true),sourceUid:value.sourceUid?uid(value.sourceUid):null};
}
function active(profile) {
  return !!profile&&profile.active===true&&profile.isTestAccount!==true&&profile.role!=='tester'&&profile.deleted!==true
    &&!['frozen','disabled','deleted'].includes(profile.accountStatus);
}
function superAdmin(profile) {return active(profile)&&profile.role==='super_admin';}
function canonical(value) {
  if(Array.isArray(value)) return '['+value.map(canonical).join(',')+']';
  if(value&&typeof value==='object') return '{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+canonical(value[key])).join(',')+'}';
  return JSON.stringify(value);
}
function hash(value) {return createHash('sha256').update(typeof value==='string'?value:canonical(value)).digest('hex');}

function normalizePhoto(dataUrl) {
  if(dataUrl===null||dataUrl==='') return null;
  if(typeof dataUrl!=='string'||dataUrl.length>PHOTO_LIMIT) fail('invalid-argument','photo-too-large');
  const match=/^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(dataUrl);
  if(!match) fail('invalid-argument','photo-format-invalid');
  const bytes=Buffer.from(match[2],'base64');
  if(bytes.length>PHOTO_BYTES||bytes.toString('base64')!==match[2]) fail('invalid-argument','photo-base64-invalid');
  let valid=false;
  if(match[1]==='jpeg') valid=bytes.length>=12&&bytes[0]===0xff&&bytes[1]===0xd8&&bytes[2]===0xff&&bytes[bytes.length-2]===0xff&&bytes[bytes.length-1]===0xd9;
  if(match[1]==='png') valid=bytes.length>=33&&bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))
    &&bytes.readUInt32BE(8)===13&&bytes.toString('ascii',12,16)==='IHDR'&&bytes.readUInt32BE(16)>0&&bytes.readUInt32BE(20)>0;
  if(match[1]==='webp') valid=bytes.length>=20&&bytes.toString('ascii',0,4)==='RIFF'&&bytes.toString('ascii',8,12)==='WEBP'
    &&bytes.readUInt32LE(4)+8===bytes.length&&['VP8 ','VP8L','VP8X'].includes(bytes.toString('ascii',12,16));
  if(!valid) fail('invalid-argument','photo-signature-invalid');
  return dataUrl;
}
function emptySource() {
  return {decisions:0,eventCount:0,counts:Object.fromEntries(THRESHOLDS.map(n=>[n,0])),unknownScaleEvents:0,
    knownMaxSize:0,maxPrecision:'unknown',pendingLogCount:0,pendingEvents:0,excludedLogCount:0,systemRecords:[],incomplete:false,incompleteReasons:[]};
}
function addEvent(stats, events, size, precision) {
  stats.eventCount=add(stats.eventCount,events);
  if(!events) return;
  if(precision==='unknown'||size==null) {
    stats.unknownScaleEvents=add(stats.unknownScaleEvents,events);
    if(stats.knownMaxSize>0) stats.maxPrecision='at_least';
    return;
  }
  const hadUncertainty=stats.maxPrecision==='at_least'||stats.unknownScaleEvents>0;
  stats.knownMaxSize=Math.max(stats.knownMaxSize,size);
  stats.maxPrecision=hadUncertainty||precision==='at_least'?'at_least':'exact';
  for(const threshold of THRESHOLDS) if(size>=threshold) stats.counts[threshold]=add(stats.counts[threshold],events);
}
function aggregate(source,entries) {
  const out={...source,counts:{...source.counts}};
  let backfillDecisions=0,backfillEvents=0,auxiliaryCount=0,pendingBackfills=0;
  const seen=new Set((source.systemRecords||[]).filter(r=>['verified','pending_event'].includes(r.status)).map(r=>'match:'+r.tournamentCode+':'+r.matchId));
  for(const key of source.recognizedEventKeys||[]) seen.add(key);
  for(const entry of entries) {
    if(entry.status!=='active') continue;
    if(!entry.kind||entry.recognitionValid!==true){pendingBackfills++;continue;}
    const row=normalizeBackfill(entry);
    const keys=(row.sourceKeys||[row.sourceKey]).map(key=>(row.kind==='auxiliary'?'auxiliary:':'')+key);
    const fresh=keys.filter(key=>!seen.has(key));if(!fresh.length)continue;
    fresh.forEach(key=>seen.add(key));
    if(row.kind==='decision')row.decisions=fresh.length;
    if(row.kind==='auxiliary'){auxiliaryCount=add(auxiliaryCount,row.auxiliary);continue;}
    backfillDecisions=add(backfillDecisions,row.decisions);backfillEvents=add(backfillEvents,row.events);
    out.decisions=add(out.decisions,row.decisions);addEvent(out,row.events,row.size,row.precision);
  }
  return {decisions:out.decisions,eventCount:out.eventCount,scales:Object.fromEntries([64,96,128].map(n=>[n,out.counts[n]])),
    milestones:Object.fromEntries(MILESTONES.map(m=>[m.threshold,out.counts[m.threshold]])),unknownScaleEvents:out.unknownScaleEvents,
    pendingLogCount:Math.max(0,source.pendingLogCount-(source.systemRecords||[]).filter(r=>r.reason==='responsibility-unverified'&&seen.has('match:'+r.tournamentCode+':'+r.matchId)).length),pendingEvents:source.pendingEvents,excludedLogCount:source.excludedLogCount,
    systemDecisions:source.decisions,systemEventCount:source.eventCount,backfillDecisions,backfillEvents,auxiliaryCount,pendingBackfills,
    knownMaxSize:out.knownMaxSize,maxPrecision:out.knownMaxSize?out.maxPrecision:'unknown'};
}
function eligibleLevel(stats) {
  let level=0;
  for(const rank of RANKS) if(stats.decisions>=rank.decisions&&Object.entries(rank.scales).every(([n,count])=>stats.scales[n]>=count)) level=rank.level;
  return level;
}

module.exports={CertificateError,fail,RANKS,MILESTONES,THRESHOLDS,LIMITS,PHOTO_LIMIT,PHOTO_BYTES,MAX_COUNT,integer,add,text,uid,entryId,
  normalizeBackfill,active,superAdmin,canonical,hash,normalizePhoto,emptySource,addEvent,aggregate,eligibleLevel};
