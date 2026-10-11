'use strict';

const provider=require('./hunter-rating-provider-v0.cjs');

const VERSION='hunter-rating-ledger-v0';
const SOURCE='official-standard';

function text(v){return String(v||'').trim();}
function integer(n){return Number.isSafeInteger(n)&&n>=0;}
function finite(n){return typeof n==='number'&&Number.isFinite(n);}
function matchIdentity(row){return text(row.eventCode).toUpperCase()+'|'+text(row.matchId);}
function eventKey(row){return matchIdentity(row)+'|r'+String(row.revision);}
function clone(v){return JSON.parse(JSON.stringify(v));}

function normalize(row){
  if(!row||row.version!==VERSION)throw Error('ledger-version-invalid');
  if(row.source!==SOURCE||row.scoringVersion!=='bxh-4pt-v1')throw Error('ledger-source-invalid');
  if(!text(row.eventCode)||!text(row.matchId)||!integer(row.revision))throw Error('ledger-key-invalid');
  if(!['completed','revoked'].includes(row.status))throw Error('ledger-status-invalid');
  if(!finite(row.updatedAt)||row.updatedAt<=0)throw Error('ledger-time-invalid');
  const a=text(row.playerA),b=text(row.playerB);
  if(!a||!b||a===b)throw Error('ledger-player-invalid');
  if(row.status==='completed'){
    if(!finite(row.completedAt)||row.completedAt<=0)throw Error('ledger-time-invalid');
    if(row.winnerUid!==a&&row.winnerUid!==b)throw Error('ledger-winner-invalid');
    if(row.confirmed!==true)throw Error('ledger-unconfirmed');
  }
  return {
    version:VERSION,
    source:SOURCE,
    scoringVersion:'bxh-4pt-v1',
    eventCode:text(row.eventCode).toUpperCase(),
    matchId:text(row.matchId),
    revision:row.revision,
    status:row.status,
    updatedAt:row.updatedAt,
    completedAt:row.status==='completed'?row.completedAt:null,
    playerA:a,
    playerB:b,
    winnerUid:row.status==='completed'?row.winnerUid:null,
    confirmed:row.status==='completed'
  };
}

function selectLatest(rows){
  const latest=new Map();
  for(const raw of rows||[]){
    const row=normalize(raw),id=matchIdentity(row),prev=latest.get(id);
    if(!prev){latest.set(id,row);continue;}
    if(row.revision<prev.revision)continue;
    if(row.revision===prev.revision){
      if(JSON.stringify(row)!==JSON.stringify(prev))throw Error('ledger-revision-conflict');
      continue;
    }
    latest.set(id,row);
  }
  return [...latest.values()];
}

function replay(rows){
  const selected=selectLatest(rows);
  const active=selected.filter(r=>r.status==='completed').sort((a,b)=>a.completedAt-b.completedAt||matchIdentity(a).localeCompare(matchIdentity(b)));
  const states=new Map(),history=[];
  const get=uid=>states.get(uid)||provider.playerState(null);
  for(const row of active){
    const aBefore=get(row.playerA),bBefore=get(row.playerB);
    const winner=row.winnerUid===row.playerA?'a':'b';
    const settled=provider.settlePair(aBefore,bBefore,winner);
    states.set(row.playerA,settled.a);
    states.set(row.playerB,settled.b);
    history.push({
      eventKey:eventKey(row),
      matchIdentity:matchIdentity(row),
      completedAt:row.completedAt,
      revision:row.revision,
      playerA:row.playerA,
      playerB:row.playerB,
      winnerUid:row.winnerUid,
      beforeA:aBefore.rating,
      beforeB:bBefore.rating,
      afterA:settled.a.rating,
      afterB:settled.b.rating
    });
  }
  return {
    version:VERSION,
    providerVersion:provider.VERSION,
    providerScale:provider.SCALE,
    selected:selected.map(clone),
    history,
    states:Object.fromEntries([...states.entries()].map(([uid,state])=>[uid,clone(state)]))
  };
}

function append(existing,row){
  const next=[...(existing||[]),normalize(row)];
  replay(next);
  return next;
}

module.exports={VERSION,SOURCE,normalize,matchIdentity,eventKey,selectLatest,replay,append};
