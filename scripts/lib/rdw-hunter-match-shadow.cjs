'use strict';
// RDW Hunter 2.1 shadow-only match assessment.
// RESEARCH ONLY: caller must supply verified results from the trusted Hunter Reader.
// No Firebase, season ladder, XP, awards, or production start hooks.
const {verifiedCurrentTier}=require('./rdw-current-tier-source.cjs');
const {buildPair}=require('./rdw-prematch-tier-snapshot.cjs');
const {evaluate}=require('./rdw-shadow-comparison.cjs');
const SCOPE='public-official-canonical-self-history-v1';
function validateEvidence(value,uid,capturedAt){
 if(!value||value.ok!==true||value.uid!==uid||value.source!=='server'||value.verified!==true||
    value.complete!==true||value.unresolvedIdentities!==0||value.sourceScope!==SCOPE||
    !/^[a-f0-9]{64}$/.test(value.sourceDigest||'')||
    value.current?.tier!==value.tier)return {ok:false,reason:'hunter-evidence-untrusted'};
 return verifiedCurrentTier(value,{uid,atMs:capturedAt});
}
function assessMatch({eventId,matchId,revision=0,playerA,playerB,evidenceA,evidenceB,capturedAt,matchStartedAt,winnerUid}={}){
 if(typeof playerA!=='string'||!playerA||typeof playerB!=='string'||!playerB||playerA===playerB||
    ![playerA,playerB].includes(winnerUid))return {ok:false,reason:'match-identity-invalid'};
 if(!Number.isSafeInteger(capturedAt)||capturedAt<=0||
    !Number.isSafeInteger(matchStartedAt)||matchStartedAt<=capturedAt)return {ok:false,reason:'prematch-time-invalid'};
 const a=validateEvidence(evidenceA,playerA,capturedAt);
 const b=validateEvidence(evidenceB,playerB,capturedAt);
 if(!a.ok||!b.ok)return {ok:false,reason:'hunter-evidence-untrusted'};
 // A pure candidate snapshot, not a persisted or trusted server-sealed snapshot.
 const pair=buildPair({eventId,matchId,revision,playerA,playerB,tierA:a.tier,tierB:b.tier,capturedAt,matchStartedAt});
 const comparison=evaluate([{isWin:winnerUid===playerA,snapshot:pair.a},{isWin:winnerUid===playerB,snapshot:pair.b}]);
 return {ok:true,mode:'hunter-rdw-shadow-only',eventId,matchId,revision,
  tiers:{[playerA]:a.tier,[playerB]:b.tier},comparison};
}
module.exports={assessMatch};
