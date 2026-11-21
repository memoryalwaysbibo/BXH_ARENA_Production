'use strict';
const TITLE_HISTORY_START_MS=Date.parse('2026-09-21T00:00:00+08:00');
function stateOf(t){try{return typeof t.data==='string'?JSON.parse(t.data):t.data||{};}catch{return {};}}
function millis(v){
 if(!v)return 0;
 if(typeof v.toMillis==='function')return v.toMillis();
 const n=Number(v);if(Number.isFinite(n)&&n>0)return n;
 const text=String(v||'').trim();if(!text)return 0;
 const parsed=/^\d{4}-\d{2}-\d{2}$/.test(text)?Date.parse(text+'T00:00:00+08:00'):Date.parse(text);
 return Number.isFinite(parsed)?parsed:0;
}
function completedAt(t,s){
 for(const v of [s?.completedAt,t?.completedAt,t?.ladderAwardedAt,s?.meta?.date,t?.eventDate]){
  const ms=millis(v);if(ms>0)return ms;
 }
 return 0;
}
function completion(t,profile){
 const s=stateOf(t),players=s.players||[],matches=(s.matches||[]).filter(m=>!m.isBye);
 if(!profile||profile.active!==true||profile.role==='tester'||profile.isTestAccount===true||t.testMode||s.testMode||t.eventAuthority==='test'||s.meta?.eventAuthority==='test'||t.createdByRole==='tester')return null;
 if(t.systemClosed||s.meta?.eventCancelled||t.eventCancelled||t.tournamentPhase==='cancelled'||(s.systemClosure&&!s.systemClosure.restoredAt))return null;
 if(s.archiveStatus!=='completed'||players.length<2||!matches.length||matches.some(m=>!m.completed))return null;
 const ids=new Set(players.map(p=>p.id));
 if(!matches.some(m=>m.a?.playerId&&m.b?.playerId&&m.a.playerId!==m.b.playerId&&ids.has(m.a.playerId)&&ids.has(m.b.playerId)&&[m.a.playerId,m.b.playerId].includes(m.winnerId)&&!m.forfeit&&!m.walkover&&!m.disqualified))return null;
 const doneAt=completedAt(t,s);if(!doneAt||doneAt<TITLE_HISTORY_START_MS)return null;
 return {name:s.meta?.name||t.name||'',eventDate:s.meta?.date||t.eventDate||'',playerCount:players.length,completedAt:doneAt,eventAuthority:t.eventAuthority||s.meta?.eventAuthority||'official'};
}
module.exports={stateOf,completion,millis,completedAt,TITLE_HISTORY_START_MS};
