'use strict';
// RDW P2-1 research-only immutable pre-match tier contract. No production writes.
const TIERS=Object.freeze(['ungraded','e','d','c','b','a','s','national']);
const VERSION='rdw-prematch-tier-v1';
function validTier(t){return typeof t==='string'&&TIERS.includes(t);}
function buildPair({eventId,matchId,revision=0,playerA,playerB,tierA,tierB,capturedAt,matchStartedAt,source='server'}){
  if(source!=='server')throw Error('server-only');
  if(!eventId||!matchId||!playerA||!playerB||playerA===playerB||!Number.isSafeInteger(revision)||revision<0)throw Error('identity-invalid');
  if(!validTier(tierA)||!validTier(tierB))throw Error('tier-invalid');
  if(!Number.isFinite(capturedAt)||!Number.isFinite(matchStartedAt)||capturedAt<=0||capturedAt>=matchStartedAt)throw Error('prematch-time-invalid');
  const common={source:'server',verified:true,version:VERSION,eventId,matchId,revision,capturedAt,matchStartedAt};
  return {a:{...common,selfUid:playerA,opponentUid:playerB,selfTierBefore:tierA,opponentTierBefore:tierB},b:{...common,selfUid:playerB,opponentUid:playerA,selfTierBefore:tierB,opponentTierBefore:tierA}};
}
function seal(existing,input){
  const proposed=buildPair(input);
  if(existing==null)return {pair:proposed,created:true};
  // Idempotent retry only. Never overwrite even when a new grade is higher.
  if(JSON.stringify(existing)!==JSON.stringify(proposed))throw Error('snapshot-conflict');
  return {pair:existing,created:false};
}
module.exports={VERSION,TIERS,buildPair,seal};
