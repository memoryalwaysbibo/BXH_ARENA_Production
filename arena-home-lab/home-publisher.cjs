'use strict';
// Synthetic scope only. The adapter must feed authoritative committed rooms,
// stage private snapshots atomically, and apply real authorization to reads.
const {allocateLobbyPreview}=require('./lobby-preview-plan.cjs');
const {isDeepStrictEqual}=require('node:util');
const idPattern=/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
const status=new Set(['draft','scheduled','open','full','closed','started','cancelled','unknown']);
const phase=new Set(['waiting','registration','live','settling','done','cancelled']);
const MAX_TIME=8640000000000000;
const text=(v,max)=>typeof v==='string'&&v.trim().length>0?v.trim().slice(0,max):null;
const number=(v,max)=>Number.isSafeInteger(v)&&v>=0&&v<=max?v:null;
const pick=(v,allowed)=>typeof v==='string'&&allowed.includes(v)?v:undefined;
const optionalText=(v,max)=>text(v,max)??undefined;
const valueOf=(obj,key)=>Object.hasOwn(obj,key)?obj[key]:undefined;
function publicExtras(room){
 const selection=valueOf(room,'registrationSelection');
 const selectionStatus=pick(selection?.status,['open','drawing','drawn','deleting']);
 const selectionCapacity=number(selection?.capacity,1000000);
 const format=optionalText(room.formatType,32);
 const extras={
  authority:pick(room.authority,['official','partner','community']),
  hostName:optionalText(room.hostName,120),location:optionalText(room.location,160),
  eventDate:/^\d{4}-\d{2}-\d{2}$/.test(room.eventDate??'')&&typeof room.eventDate==='string'?room.eventDate:undefined,
  startAt:/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(room.startAt??'')&&typeof room.startAt==='string'?room.startAt:undefined,
  checkInAt:optionalText(room.checkInAt,64),
  fee:number(room.fee,1000000)??undefined,
  publishedAt:number(room.publishedAt,MAX_TIME)??undefined,
  formatType:format&&/^[a-z][a-z0-9_-]*$/i.test(format)?format:undefined,
  battleMode:pick(room.battleMode,['individual','team']),teamSize:number(room.teamSize,1000)??undefined,
  playMode:pick(room.playMode,['standard','enchantment']),
  targetGroup:pick(room.targetGroup,['open','children']),
  registrationEnabled:typeof room.registrationEnabled==='boolean'?room.registrationEnabled:undefined,
  communityQuickRegistration:typeof room.communityQuickRegistration==='boolean'?room.communityQuickRegistration:undefined,
  communityParticipantCount:number(room.communityParticipantCount,1000000)??undefined,
  waitlistEnabled:typeof room.waitlistEnabled==='boolean'?room.waitlistEnabled:undefined,
  roomAccessMode:pick(room.roomAccessMode,['public','password']),
  registrationSelection:selectionStatus&&selectionCapacity>0?{status:selectionStatus,capacity:selectionCapacity}:undefined,
  registeredCount:number(room.registeredCount,1000000)??undefined,
  systemClosed:typeof room.systemClosed==='boolean'?room.systemClosed:undefined
 };
 return Object.fromEntries(Object.entries(extras).filter(([,v])=>v!==undefined));
}
const lexical=(a,b)=>a<b?-1:a>b?1:0;
function projectPublicCard(room){
 if(room?.visibility!=='public'||room.deleted===true||room.deletionStatus==='deleting'||
    room.registrationVisibility==='private'||room.roomAccessMode==='private'||room.testMode===true||
    typeof room.id!=='string'||!idPattern.test(room.id))return null;
 const title=text(room.title,120);
 if(!title||!status.has(room.registrationStatus))return null;
 const eventPhase=phase.has(room.eventPhase)?room.eventPhase:null;
 const registrationStatus=room.eventCancelled===true?'cancelled':room.registrationStatus;
 return {
  id:room.id,title,eventPhase:room.eventCancelled===true?'cancelled':eventPhase,registrationStatus,
  ranked:room.ranked===true,
  eventAt:number(room.eventAt,MAX_TIME),openAt:number(room.openAt,MAX_TIME),
  closeAt:number(room.closeAt,MAX_TIME),cancellationDeadline:number(room.cancellationDeadline,MAX_TIME),
  capacity:number(room.capacity,1000000),confirmedCount:number(room.confirmedCount,1000000),
  waitlistCount:number(room.waitlistCount,1000000),waitlistCapacity:number(room.waitlistCapacity,1000000),
  ...publicExtras(room)
 };
}
function buildHomePublication(previous,rooms,{maxCards=20,maxDeltaIds=8,categoryAwarePreview=false}={}){
 if(!Array.isArray(rooms)||!Number.isSafeInteger(maxCards)||maxCards<1||maxCards>100||
    (categoryAwarePreview&&maxCards>20)||!Number.isSafeInteger(maxDeltaIds)||maxDeltaIds<1||maxDeltaIds>100)throw Error('home-publication-input');
 const current=previous===null?{version:0,cards:[]}:previous;
 if(!Number.isSafeInteger(current?.version)||current.version<0||!Array.isArray(current.cards))throw Error('home-publication-previous');
 // Old versions should be persisted only from this publisher. Re-validate and
 // drop foreign fields rather than accidentally re-emitting private data.
 const oldCards=current.cards.map(p=>projectPublicCard({...p,visibility:'public'}));
 if(oldCards.some(v=>!v)||new Set(oldCards.map(v=>v.id)).size!==oldCards.length)throw Error('home-publication-previous-card');
 const byId=new Set();
 const projected=[];
 for(const room of rooms){
  if(typeof room?.id==='string'&&idPattern.test(room.id)){
   if(byId.has(room.id))throw Error('home-publication-duplicate-room');
   byId.add(room.id);
  }
  const card=projectPublicCard(room);if(card)projected.push(card);
 }
 const plan=categoryAwarePreview?allocateLobbyPreview(projected,{limit:maxCards}):null;
 const cards=plan?plan.first:projected.sort((a,b)=>(a.eventAt??Infinity)-(b.eventAt??Infinity)||lexical(a.id,b.id)).slice(0,maxCards);
 const preview=plan?{preview:{sections:plan.sections,complete:plan.complete}}:{};
 const metadataChanged=!isDeepStrictEqual(current.preview,preview.preview);
 if(previous===null&&cards.length===0)return {changed:true,first:{version:0,cards,...preview},signal:{version:0,previous:null,ids:[]},delta:null};
 if(!metadataChanged&&JSON.stringify(oldCards)===JSON.stringify(cards)){
  return {changed:false,first:{version:current.version,cards,...preview},signal:null,delta:null};
 }
 if(current.version===Number.MAX_SAFE_INTEGER)throw Error('home-publication-version-overflow');
 const version=current.version+1;
 const first={version,cards,...preview};
 const old=new Map(oldCards.map(card=>[card.id,JSON.stringify(card)]));
 const newIds=new Set(cards.map(card=>card.id));
 const remove=oldCards.map(card=>card.id).filter(id=>!newIds.has(id));
 const upsert=cards.filter(card=>old.get(card.id)!==JSON.stringify(card));
 const ids=[...remove,...upsert.map(card=>card.id)];
 if(ids.length>maxDeltaIds||metadataChanged)return {changed:true,first,signal:{version,previous:null,ids:[]},delta:null};
 return {changed:true,first,signal:{version,previous:current.version,ids},
  delta:{from:current.version,to:version,remove,upsert,order:cards.map(card=>card.id)}};
}
module.exports={projectPublicCard,buildHomePublication};
