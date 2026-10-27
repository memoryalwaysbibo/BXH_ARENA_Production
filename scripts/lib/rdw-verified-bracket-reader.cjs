'use strict';
// Server-only bracket guard used inside the SAME Firestore transaction as start.
// This is read-only and does not itself authorize or start a tournament.
function parse(raw){if(typeof raw==='string'){try{return JSON.parse(raw);}catch{return null;}}return raw&&typeof raw==='object'&&!Array.isArray(raw)?raw:null;}
function createVerifiedBracketReader({db}={}){
 if(typeof db?.doc!=='function')throw Error('firestore-required');
 return async function verifyBracketInTransaction({tx,eventCode,drawRevision,expectedRosterRevision}={}){
  if(typeof tx?.get!=='function'||!/^BXH-[A-Z0-9]{6}$/.test(eventCode||'')||
    !Number.isSafeInteger(drawRevision)||drawRevision<=0||
    !Number.isSafeInteger(expectedRosterRevision)||expectedRosterRevision<0)return false;
  const [privateSnap,publicSnap]=await Promise.all([
    tx.get(db.doc('tournaments/'+eventCode)),tx.get(db.doc('publicTournaments/'+eventCode))
  ]);
  if(!privateSnap?.exists||!publicSnap?.exists)return false;
  const p=parse(privateSnap.data()?.data),q=parse(publicSnap.data()?.bracketView);
  if(!p||!q||p.startedAt||q.startedAt||p.rosterLocked===true||
    p.meta?.ladderMode!=='ranked'||p.meta?.battleMode==='team'||
    p.registrationRosterRevision!==expectedRosterRevision||
    q.registrationRosterRevision!==expectedRosterRevision)return false;
  const a=p.bracketDraw,b=q.bracketDraw;
  if(!a?.id||typeof a.id!=='string'||a.revision!==drawRevision||
     b?.id!==a.id||b?.revision!==drawRevision)return false;
  // Exact bracket identity across both mirrors, not merely a matching counter.
  const signature=x=>JSON.stringify({
    drawnAt:x.drawnAt??null,bracketSize:x.bracketSize??null,
    formatType:x.meta?.formatType||'single',battleMode:x.meta?.battleMode||'individual',
    matches:(x.matches||[]).map(m=>[m.id,m.bracket,m.round,m.indexInRound,m.a?.playerId??null,m.b?.playerId??null,m.teamIds??null]).sort((l,r)=>String(l[0]).localeCompare(String(r[0])))
  });
  if(!Array.isArray(p.matches)||p.matches.length===0||!Array.isArray(q.matches)||
     signature(p)!==signature(q))return false;
  return true;
 };
}
module.exports={createVerifiedBracketReader};
