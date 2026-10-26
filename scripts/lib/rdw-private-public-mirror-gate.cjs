'use strict';
// P3-42: read-only private/public tournament mirror agreement gate.
// The actual ARENA cloud runtime uses tournaments/{code}.data and
// publicTournaments/{code}.bracketView, both serialized JSON.
// This is a PRE-FLIGHT reference, not a production start writer.
function parseObject(value){
 if(typeof value==='string'){try{value=JSON.parse(value);}catch{return null;}}
 return value&&typeof value==='object'&&!Array.isArray(value)?value:null;
}
function compareMirrors({privateDoc,publicDoc,eventCode}={}){
 if(!/^BXH-[A-Z0-9]{6}$/.test(eventCode||''))return {ok:false,reason:'event-code-invalid'};
 const p=parseObject(privateDoc?.data),q=parseObject(publicDoc?.bracketView);
 if(!p||!q)return {ok:false,reason:'mirror-json-invalid'};
 if(p.cloudCode&&p.cloudCode!==eventCode)return {ok:false,reason:'private-room-mismatch'};
 if(privateDoc?.code&&privateDoc.code!==eventCode)return {ok:false,reason:'private-room-mismatch'};
 if(q.cloudCode&&q.cloudCode!==eventCode)return {ok:false,reason:'public-room-mismatch'};
 if(p.startedAt!=null||q.startedAt!=null)return {ok:false,reason:'already-started'};
 if(p.rosterLocked===true)return {ok:false,reason:'already-locked'};
 if(!Number.isSafeInteger(p.registrationRosterRevision)||p.registrationRosterRevision<0||
    Number(q.registrationRosterRevision)!==p.registrationRosterRevision)return {ok:false,reason:'roster-revision-mismatch'};
 if(!Array.isArray(p.players)||!Array.isArray(q.players))return {ok:false,reason:'mirror-players-missing'};
 const privateIds=p.players.map(x=>x?.id),publicIds=q.players.map(x=>x?.id);
 if(privateIds.some(x=>typeof x!=='string'||!x)||publicIds.some(x=>typeof x!=='string'||!x)||
    JSON.stringify(privateIds)!==JSON.stringify(publicIds))return {ok:false,reason:'mirror-roster-mismatch'};
 if(!Array.isArray(p.matches)||!Array.isArray(q.matches))return {ok:false,reason:'mirror-matches-missing'};
 const summarize=matches=>matches.map(m=>({id:m?.id,a:m?.a?.playerId||null,b:m?.b?.playerId||null,completed:m?.completed===true,winnerId:m?.winnerId||null}));
 if(JSON.stringify(summarize(p.matches))!==JSON.stringify(summarize(q.matches)))return {ok:false,reason:'mirror-bracket-mismatch'};
 if(!p.drawnAt||!q.drawnAt||Number(p.drawnAt)!==Number(q.drawnAt))return {ok:false,reason:'mirror-draw-mismatch'};
 return {ok:true,eventCode,rosterRevision:p.registrationRosterRevision,players:privateIds.length,matches:p.matches.length};
}
async function inspectMirrorsInTransaction({tx,privateRef,publicRef,eventCode}={}){
 if(typeof tx?.get!=='function'||!privateRef||!publicRef)throw Error('mirror-tx-required');
 const [privateSnap,publicSnap]=await Promise.all([tx.get(privateRef),tx.get(publicRef)]);
 if(!privateSnap?.exists||!publicSnap?.exists)return {ok:false,reason:'mirror-document-missing'};
 return compareMirrors({privateDoc:privateSnap.data(),publicDoc:publicSnap.data(),eventCode});
}
module.exports={compareMirrors,inspectMirrorsInTransaction};
