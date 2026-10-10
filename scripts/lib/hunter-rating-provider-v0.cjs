'use strict';

const snapshotContract=require('./hunter-prematch-rating-snapshot.cjs');

const VERSION='hunter-rating-elo-v0';
const SCALE='elo-400';
const DEFAULT_RATING=1000;
const K=24;

function finite(n){return typeof n==='number'&&Number.isFinite(n);}
function playerState(raw){
  if(raw==null)return {version:VERSION,scale:SCALE,rating:DEFAULT_RATING,games:0};
  if(raw.version!==VERSION||raw.scale!==SCALE||!finite(raw.rating)||!Number.isSafeInteger(raw.games)||raw.games<0)throw Error('rating-state-invalid');
  return {version:VERSION,scale:SCALE,rating:raw.rating,games:raw.games};
}
function expected(self,opponent){return 1/(1+Math.pow(10,(opponent-self)/400));}
function nextRating(self,opponent,score){
  if(!finite(self)||!finite(opponent)||![0,0.5,1].includes(score))throw Error('rating-input-invalid');
  return Number((self+K*(score-expected(self,opponent))).toFixed(4));
}
function providerPayload(selfState,opponentState){
  const self=playerState(selfState),opponent=playerState(opponentState);
  return {source:'server',verified:true,version:VERSION,scale:SCALE,selfBefore:self.rating,opponentBefore:opponent.rating};
}

async function sealMatchSnapshots({tx,matchRef,aRef,bRef,capturedAt,matchStartedAt}){
  if(!tx||typeof tx.get!=='function'||typeof tx.set!=='function')throw Error('transaction-required');
  const [matchSnap,aSnap,bSnap]=await Promise.all([tx.get(matchRef),tx.get(aRef),tx.get(bRef)]);
  const match=matchSnap&&matchSnap.exists?matchSnap.data():{};
  const a=playerState(aSnap&&aSnap.exists?aSnap.data():null);
  const b=playerState(bSnap&&bSnap.exists?bSnap.data():null);
  const aSnapshot=snapshotContract.seal(match?.hunterRatingSnapshots?.a||null,{capturedAt,matchStartedAt,provider:providerPayload(a,b)}).snapshot;
  const bSnapshot=snapshotContract.seal(match?.hunterRatingSnapshots?.b||null,{capturedAt,matchStartedAt,provider:providerPayload(b,a)}).snapshot;
  const pair={a:aSnapshot,b:bSnapshot,providerVersion:VERSION,ratingScale:SCALE};
  tx.set(matchRef,{hunterRatingSnapshots:pair},{merge:true});
  return pair;
}

function settlePair(aRaw,bRaw,winner){
  if(!['a','b','draw'].includes(winner))throw Error('winner-invalid');
  const a=playerState(aRaw),b=playerState(bRaw);
  const scoreA=winner==='a'?1:winner==='b'?0:0.5;
  const scoreB=1-scoreA;
  const nextA=nextRating(a.rating,b.rating,scoreA);
  const nextB=nextRating(b.rating,a.rating,scoreB);
  return {
    a:{version:VERSION,scale:SCALE,rating:nextA,games:a.games+1},
    b:{version:VERSION,scale:SCALE,rating:nextB,games:b.games+1},
    deltaA:Number((nextA-a.rating).toFixed(4)),
    deltaB:Number((nextB-b.rating).toFixed(4))
  };
}

module.exports={VERSION,SCALE,DEFAULT_RATING,K,playerState,expected,nextRating,providerPayload,sealMatchSnapshots,settlePair};
