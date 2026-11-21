'use strict';
// Synthetic-only parity adapter. No live source, browser transport or exports.
const {projectMirror}=require('../../arena-home-lab/home-writer.cjs');
const {skipProjection}=require('../../arena-home-lab/home-lifecycle-proof.cjs');
const {provePublicCardRegistrationCount}=require('./registration-count-proof.cjs');
const LIMIT=1024*1024;
const allowed=new Set(['official','ticket','community']);
const sourceFields=[
 'visibility','publishedAt','deleted','deletionStatus','registrationVisibility','testMode','eventCancelled','tournamentPhase','eventPhase',
 'archiveStatus','startedAt','systemClosed','systemClosure','registrationOpenAt','registrationCloseAt','openAt','closeAt',
 'cancellationDeadline','registrationStatus','registrationEnabled','capacity','confirmedCount','waitlistCount','waitlistCapacity',
 'waitlistEnabled','registrationSelection','registeredCount','communityParticipantCount','fee','playMode','bracketView'
];
const backfill=reason=>({status:'requires-canonical-backfill',reason});
const excluded={status:'excluded'};
const text=(value,limit)=>typeof value==='string'&&value.trim()===value&&value.length<=limit;
function displayString(value,max){
 if(!value)return '';
 if(!text(value,max))throw Error('unsupported-display-value');
 return value;
}
const dateOk=x=>!x||/^\d{4}-\d{2}-\d{2}$/.test(x);
const timeOk=x=>!x||/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(x);
function orderingValue(date,time){
 if(!date)return null;
 const ms=Date.parse(`${date}T${time||'00:00'}:00+08:00`);
 return Number.isSafeInteger(ms)?ms:null;
}

function projectPinnedCard(id,doc){
 if(typeof id!=='string'||!/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(id))return backfill('public-room-id');
 if(skipProjection(doc))return excluded;
 if(typeof doc.bracketView!=='string'||Buffer.byteLength(doc.bracketView)>LIMIT)return backfill('sanitized-public-bracket');
 let bracket;
 try{bracket=JSON.parse(doc.bracketView);}catch{return backfill('sanitized-public-bracket');}
 if(!bracket||typeof bracket!=='object'||Array.isArray(bracket))return backfill('sanitized-public-bracket');
 const meta=bracket.meta||{};
 if(bracket.testMode===true||meta.roomAccessMode==='private'||meta.eventAuthority==='test')return excluded;
 const authority=doc.eventAuthority||meta.eventAuthority||'official';
 if(!allowed.has(authority))return backfill('public-authority');
 // Pinned public eligibility is top-level community or truthy publishedAt.
 // An unpublished legacy meta-only community room was never visible.
 if(!doc.publishedAt&&doc.eventAuthority!=='community')return excluded;
 const access=doc.roomAccessMode||meta.roomAccessMode||'public';
 if(!['public','password'].includes(access))return backfill('public-access-shape');
 try{
  const displayedDate=displayString(meta.date||doc.eventDate,10);
  const displayedTime=displayString(meta.startTime||doc.startAt,5);
  const sortedDate=displayString(doc.eventDate||meta.date,10);
  const sortedTime=displayString(doc.startAt||meta.startTime,5);
  if(![displayedDate,sortedDate].every(dateOk)||![displayedTime,sortedTime].every(timeOk))return backfill('public-event-date-shape');
  const eventAt=orderingValue(sortedDate,sortedTime);
  if(sortedDate&&eventAt===null)return backfill('public-event-date-shape');
  const host=displayString(doc.hostName||doc.createdByName||doc.ownerName||meta.hostName||(authority==='official'?'BXH':'玩家主辦'),120);
  const title=displayString(meta.name||doc.name||'未命名賽事',120);
  const location=displayString(meta.location||doc.location,160);
  const format=displayString(doc.formatType||meta.formatType||'single',32);
  if(!/^[a-z][a-z0-9_-]*$/i.test(format))return backfill('public-format');
  const quick=authority==='community'&&(Object.hasOwn(doc,'communityQuickRegistration')?doc.communityQuickRegistration===true:meta.communityQuickRegistration===true);
  const battleMode=(doc.battleMode||meta.battleMode)==='team'?'team':'individual';
  const teamSize=Math.max(3,Number(doc.teamSize||meta.teamSize)||3);
  if(!Number.isSafeInteger(teamSize)||teamSize>1000)return backfill('public-team-size');
  const ranked=(doc.ladderMode??meta.ladderMode)==='ranked';
  if(authority==='community'&&ranked)return backfill('community-ranking-authority');
  const checkInAt=displayString(doc.checkInAt||meta.checkin,64);
  const tally=provePublicCardRegistrationCount(doc);
  if(tally.status!=='known'||!Number.isSafeInteger(tally.count)||tally.count>1000000)return backfill('public-registration-aggregate');
  // Whitelist upstream fields; never pass an asset URL, identity or full .data
  // to the serializer. The bounded sanitized bracket is only internal input.
  const source=Object.fromEntries(sourceFields.filter(k=>Object.hasOwn(doc,k)).map(k=>[k,doc[k]]));
  const partner=authority==='ticket'&&id.startsWith('PTN-');
  const projected=projectMirror(id,{...source,name:title,hostName:host,location,eventDate:displayedDate,startAt:displayedTime,
   eventAuthority:authority,ladderMode:ranked?'ranked':'general',formatType:format,battleMode,teamSize,
   targetGroup:doc.targetGroup||meta.targetGroup||'open',roomAccessMode:access,checkInAt,confirmedCount:tally.count,
   communityQuickRegistration:quick,...(quick&&battleMode!=='team'?{communityParticipantCount:tally.count}:{})});
  if(!projected)return backfill('public-projection');
  // Existing lab mapper derives partner by strict code pattern: override that
  // inference with the verified pinned public display decision. eventAt is
  // for ordering; screen date/time are independently preserved.
  return {status:'ready',card:{...projected,authority:authority==='community'?'community':partner?'partner':'official',
   eventAt,eventDate:displayedDate||undefined,startAt:displayedTime||undefined,ranked}};
 }catch(e){
  if(e.message==='unsupported-display-value')return backfill('public-display-shape');
  throw e;
 }
}

// Presentation seam: the original rendered card accepts a summary and a
// trusted markup generator. No image loads on the collapsed preview.
// The true image remains under the existing full event details entry point.
const STATIC_COVER='<span class="lobby-preview-cover-placeholder" aria-hidden="true">▧</span>';
function renderPreviewWithoutCover(markup){
 if(typeof markup!=='string'||!markup.includes('<summary>')||
    !markup.includes('<div class="lobby-card-with-cover">')||markup.includes('<img class="lobby-poster-cover"'))throw Error('unexpected-preview-template');
 return markup.replace('<div class="lobby-card-with-cover">','<div class="lobby-card-with-cover">'+STATIC_COVER);
}
// Legacy display prefers parsed meta but sort prefers top-level date/time.
// Bridge only synthetic display fields, without putting the bracket in the
// summary. This adapter is for the existing pinned card/ordering functions.
function toPinnedLobbyItem(card,toLobbyItem){
 const raw=toLobbyItem(card);
 const displayMeta={date:card.eventDate||'',startTime:card.startAt||''};
 if(!Number.isFinite(card.eventAt)){
  return {...raw,eventDate:displayMeta.date,startAt:displayMeta.startTime,parsedData:{meta:displayMeta}};
 }
 const [date,time]=new Date(card.eventAt+8*3600000).toISOString().slice(0,16).split('T');
 // A displayed empty string paired with an ordering time occurs with an
 // unspecified start; do not display inferred 00:00 as an announced time.
 const orderingTime=(displayMeta.startTime||time!=='00:00')?time:'';
 return {...raw,eventDate:date,startAt:orderingTime,parsedData:{meta:displayMeta}};
}
module.exports={projectPinnedCard,toPinnedLobbyItem,renderPreviewWithoutCover};
