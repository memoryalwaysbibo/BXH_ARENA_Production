'use strict';
/**
 * Emulator-only preview of version-pointer activation and rollback.
 * It never publishes rules or changes player records. No production endpoint.
 */
const {doc,runTransaction}=require('firebase/firestore');
const {verifyEmulator}=require('./catalog-emulator-transactions.cjs');
const ID=/^[A-Za-z0-9_-]{2,80}$/;
const SCOPE='assembly';
async function simulateReleaseSwitch({db,target,authVerifier,idToken,toReleaseId,expectedRevision,reason}={}){
 verifyEmulator(db,target);
 if(!authVerifier||typeof authVerifier.verifyIdToken!=='function')throw Error('TOKEN_VERIFIER_REQUIRED');
 if(!ID.test(toReleaseId||'')||!Number.isSafeInteger(expectedRevision)||expectedRevision<0)throw Error('SWITCH_INPUT_INVALID');
 if(typeof reason!=='string'||reason.trim().length<12)throw Error('CHANGE_REASON_REQUIRED');
 const token=await authVerifier.verifyIdToken(idToken,true);
 const uid=token?.uid;
 if(!ID.test(uid||'')||token.firebase?.sign_in_provider==='anonymous')throw Error('VERIFIED_USER_REQUIRED');
 const pointerRef=doc(db,'beyCatalogEmulatorPointers',SCOPE);
 const userRef=doc(db,'users',uid);
 const releaseRef=doc(db,'beyCatalogRuleReleases',toReleaseId);
 return runTransaction(db,async tx=>{
  const [profile,pointer,release]=await Promise.all([tx.get(userRef),tx.get(pointerRef),tx.get(releaseRef)]);
  const actor=profile.exists()?profile.data():null;
  if(!actor||actor.active!==true||actor.isTestAccount===true||actor.role!=='super_admin')throw Error('SUPER_ADMIN_REQUIRED');
  const current=pointer.exists()?pointer.data():{revision:0,activeReleaseId:null};
  if(current.revision!==expectedRevision)throw Error('STALE_RELEASE_POINTER');
  if(!release.exists())throw Error('RELEASE_NOT_FOUND');
  const candidate=release.data();
  if(candidate.publicationStatus!=='unpublished'||candidate.active!==false||candidate.selectable!==false||candidate.origin!=='reviewed_proposal'||candidate.releaseId!==toReleaseId||!candidate.checksum)throw Error('UNSAFE_RELEASE_PROPOSAL');
  if(current.activeReleaseId===toReleaseId)throw Error('ALREADY_SELECTED');
  const nextRevision=current.revision+1;
  const auditRef=doc(db,'beyCatalogEmulatorPointerAudits',SCOPE+'_'+nextRevision);
  const event={scope:SCOPE,revision:nextRevision,from:current.activeReleaseId||null,to:toReleaseId,actorUid:uid,reason:reason.trim(),mode:'emulator_preview',publicationStatus:'unpublished'};
  tx.set(pointerRef,{revision:nextRevision,activeReleaseId:toReleaseId,mode:'emulator_preview',publicationStatus:'unpublished'});
  tx.set(auditRef,event);
  return {status:'simulated',revision:nextRevision,from:event.from,to:toReleaseId,published:false,playerRecordsMutated:0};
 },{maxAttempts:5});
}
module.exports={simulateReleaseSwitch};
