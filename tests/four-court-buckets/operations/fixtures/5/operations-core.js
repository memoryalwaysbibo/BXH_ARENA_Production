'use strict';
const {createHash,randomInt}=require('node:crypto');
const DAY=86400000;
function fail(message){throw new Error(message);}
function parseState(doc){let s;try{s=JSON.parse(doc.data);}catch(e){fail('invalid-tournament-data');}if(!s||!Array.isArray(s.players)||!Array.isArray(s.matches)||!s.meta)fail('invalid-tournament-data');return s;}
function ms(v){if(v&&typeof v.toMillis==='function')return v.toMillis();return Number(v)||0;}
function stable(v){if(Array.isArray(v))return v.map(stable);if(v&&typeof v==='object')return Object.fromEntries(Object.keys(v).sort().filter(k=>!['updatedAt','lastSyncedAt','lastActivityAt','savedAt','currentMatchId','currentStation','selectedMatchId'].includes(k)).map(k=>[k,stable(v[k])]));return v;}
function fingerprint(doc){const s=parseState(doc);return createHash('sha256').update(JSON.stringify(stable({meta:s.meta,players:s.players,matches:s.matches,bracketSize:s.bracketSize,drawnAt:s.drawnAt,startedAt:s.startedAt,archiveStatus:s.archiveStatus,confirmedCount:doc.confirmedCount,waitlistCount:doc.waitlistCount,assignedStaffUids:doc.assignedStaffUids,refereeStationAssignments:doc.refereeStationAssignments,refereeStationUids:doc.refereeStationUids}))).digest('hex');}
function startMs(doc,s){const date=s.meta.date||doc.eventDate,time=s.meta.startTime||doc.startAt;if(!/^\d{4}-\d{2}-\d{2}$/.test(date||'')||!/^\d{2}:\d{2}(:\d{2})?$/.test(time||''))return 0;const n=Date.parse(`${date}T${time}+08:00`);return Number.isFinite(n)?n:0;}
function idleDecision(doc,tracker,config,now){
 const s=parseState(doc),start=startMs(doc,s);
 if(config.enabled!==true||!start||start>now||doc.systemClosed===true||s.meta.eventCancelled||doc.tournamentPhase==='cancelled'||doc.tournamentPhase==='done'||s.archiveStatus==='completed'||s.archiveStatus==='archived')return null;
 const real=s.matches.filter(m=>!m.isBye);if(real.length&&real.every(m=>m.completed))return null; // completed games awaiting settlement must not be fabricated as idle
 const since=Math.max(start,ms(tracker.lastAt),ms(tracker.observedAt),ms(config.enabledAt),ms(tracker.restoredAt));
 return since>0&&now-since>=DAY?{s,start,lastAt:since}:null;
}
function canManage(actor,uid,t,now){
 if(actor.active!==true)return false;
 if(actor.role==='tester'||actor.isTestAccount===true)return t.testMode===true&&t.eventAuthority==='test'&&t.ownerUid===uid&&t.createdBy===uid&&ms(t.testExpiresAt)>now;
 if(['super_admin','admin'].includes(actor.role))return true;
 if(actor.role==='staff')return !Array.isArray(t.assignedStaffUids)||t.assignedStaffUids.length===0||t.assignedStaffUids.includes(uid);
 const grant=actor.partnerOrganizer,expiry=Number(grant?.expiresAtMs)||Date.parse(grant?.expiresAt||'')||0;
 const partnerOrder=grant?.orderCode||actor.partnerContractOrderCode||'';
 if(actor.role==='player'&&grant?.status==='active'&&grant?.organizationId&&partnerOrder&&expiry>now)
   return t.eventAuthority==='official'&&t.createdBy===uid
     &&t.createdByRole==='partner_organizer'&&t.partnerOrganizationCode===grant.organizationId
     &&t.partnerContractOrderCode===partnerOrder;
 return actor.role==='tester'&&t.testMode===true&&t.eventAuthority==='test'&&t.ownerUid===uid&&t.createdBy===uid&&ms(t.testExpiresAt)>now;
}
function candidateKey(p){return p.registrationUid||p.uid?`uid:${p.registrationUid||p.uid}`:`onsite:${p.id}`;}
function candidates(s,mode,excluded=[]){
 if(!['general','first_round'].includes(mode))fail('invalid-raffle-mode');
 let losers=null;
 if(mode==='first_round'){
  if((s.meta.formatType||'single')!=='single')fail('first-round-single-only');
  const first=s.matches.filter(m=>m.bracket==='SE'&&Number(m.round)===0&&!m.isBye);
  if(!first.length||first.some(m=>!m.completed))fail('first-round-not-complete');
  losers=new Set(first.filter(m=>m.a&&m.b&&m.a.playerId&&m.b.playerId&&m.winnerId&&m.loserId&&m.winnerId!==m.loserId&&[m.a.playerId,m.b.playerId].includes(m.winnerId)&&[m.a.playerId,m.b.playerId].includes(m.loserId)&&!m.forfeit&&!m.walkover&&!m.disqualified).map(m=>m.loserId));
 }
 const out=new Map(),exclude=new Set(excluded);
 const source=mode==='general'&&Array.isArray(s.entryCandidates)?[...s.players,...s.entryCandidates.filter(x=>!s.players.some(p=>p.id===x.id))]:s.players;
 for(const p of source){if(!p.id||p.checkedIn!==true||p.withdrawn||p.disqualified||p.forfeit||['withdrawn','disqualified','cancelled'].includes(p.status)||losers&&!losers.has(p.id))continue;const key=candidateKey(p);if(!exclude.has(key)&&!out.has(key))out.set(key,{key,playerId:String(p.id),name:String(p.name||'未命名玩家').slice(0,100)});}
 return [...out.values()].sort((a,b)=>a.key.localeCompare(b.key));
}
function poolHash(pool){return createHash('sha256').update(JSON.stringify(pool)).digest('hex');}
function draw(pool,count,rng=randomInt){if(!Number.isInteger(count)||count<1||count>100)fail('invalid-winner-count');if(pool.length<count)fail('not-enough-candidates');const a=pool.slice();for(let i=0;i<count;i++){const j=rng(i,a.length);[a[i],a[j]]=[a[j],a[i]];}return a.slice(0,count);}
function cleanText(v,max=120){return String(v||'').trim().slice(0,max);}
function normalizePrizes(value,legacy={}){
 const source=Array.isArray(value)&&value.length?value:[{name:legacy.title,description:legacy.description,quantity:legacy.count}];
 if(source.length<1||source.length>20)fail('invalid-prizes');
 let totalCount=0;
 const prizes=source.map(raw=>{
  const name=cleanText(raw?.name??raw?.title,120),description=cleanText(raw?.description,500),quantity=Number(raw?.quantity??raw?.count);
  if(!name||!Number.isInteger(quantity)||quantity<1||quantity>100)fail('invalid-prizes');
  totalCount+=quantity;if(totalCount>100)fail('too-many-winners');
  return {name,description,quantity};
 });
 return {prizes,totalCount};
}
function assignPrizeWinners(selected,prizes){
 const out=[];let cursor=0;
 prizes.forEach((prize,prizeIndex)=>{
  for(let i=0;i<prize.quantity;i++){
   const player=selected[cursor++];if(!player)fail('not-enough-candidates');
   out.push({...player,status:'pending',prizeIndex,prizeName:prize.name,prizeDescription:prize.description});
  }
 });
 if(cursor!==selected.length)fail('winner-prize-count-mismatch');
 return out;
}
module.exports={DAY,parseState,ms,fingerprint,startMs,idleDecision,canManage,candidates,poolHash,draw,cleanText,normalizePrizes,assignPrizeWinners};
