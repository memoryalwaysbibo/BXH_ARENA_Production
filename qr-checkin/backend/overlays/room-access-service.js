'use strict';
const {FieldValue}=require('firebase-admin/firestore');
const {createHash}=require('node:crypto');
const C=require('./room-access-core');
const hash=v=>createHash('sha256').update(String(v||'')).digest('hex');

function createRoomAccessService(db,clock=Date.now){
 return async function roomAccess(request){
  const uid=request.auth?.uid,d=request.data||{},action=String(d.action||''),code=C.normalizeCode(d.code),now=clock();
  if(!uid)throw Error('auth-required');
  if(!C.validCode(code))throw Error('invalid-room-code');
  if(!['status','verify','configure'].includes(action))throw Error('invalid-action');
  const tr=db.doc('tournaments/'+code),pr=db.doc('publicTournaments/'+code),ur=db.doc('users/'+uid);
  if(action==='status'){
   const [ts,us,grant]=await Promise.all([tr.get(),ur.get(),tr.collection('accessGrants').doc(uid).get()]);
   if(!ts.exists)throw Error('room-not-found');if(!C.active(us.data()))throw Error('auth-required');
   const t=ts.data(),mode=C.normalizeMode(t.roomAccessMode);
   const bypass=C.canBypass(uid,us.data(),t),hasAccess=mode!=='password'||bypass||C.grantValid(grant.data(),t,now);
   return {ok:true,code,mode,locked:mode==='password',hasAccess,accessVersion:Number(t.roomAccessVersion||0)};
  }
  if(action==='configure'){
   if(typeof d.operationId!=='string'||!/^[A-Za-z0-9_-]{8,100}$/.test(d.operationId))throw Error('invalid-operation');
   const mode=C.normalizeMode(d.mode);
   const result=await db.runTransaction(async tx=>{
    const [ts,ps,us]=await Promise.all([tx.get(tr),tx.get(pr),tx.get(ur)]);
    if(!ts.exists||!ps.exists)throw Error('room-not-found');if(!C.active(us.data()))throw Error('auth-required');
    const t=ts.data();if(!C.canBypass(uid,us.data(),t))throw Error('room-access-denied');
    if(t.eventAuthority!=='community')throw Error('community-room-only');
    if(!C.roomUnlockedForConfig(t))throw Error('room-access-locked');
    const op=tr.collection('accessActions').doc(hash(uid+'|'+d.operationId)),prior=await tx.get(op);
    if(prior.exists)return {...prior.data().result,replayed:true};
    const previousMode=C.normalizeMode(t.roomAccessMode),passwordSupplied=typeof d.password==='string'&&d.password.trim()!=='';
    let accessVersion=Number(t.roomAccessVersion||0),privatePatch={},changed=previousMode!==mode;
    if(mode==='password'){
     if(passwordSupplied){
      const rec=C.createPasswordRecord(d.password);privatePatch.roomAccessSalt=rec.salt;privatePatch.roomAccessHash=rec.hash;changed=true;
     }else if(previousMode!=='password'||!t.roomAccessSalt||!t.roomAccessHash)throw Error('invalid-room-password');
    }else{
     privatePatch.roomAccessSalt=FieldValue.delete();privatePatch.roomAccessHash=FieldValue.delete();
    }
    if(changed)accessVersion++;
    const s=C.parseState(t);s.meta=s.meta||{};s.meta.roomAccessMode=mode;s.updatedAt=now;
    Object.assign(privatePatch,{roomAccessMode:mode,roomAccessVersion:accessVersion,roomAccessUpdatedAt:now,data:JSON.stringify(s),updatedAt:now});
    const publicPatch={roomAccessMode:mode,roomAccessVersion:accessVersion,roomLocked:mode==='password',updatedAt:now};
    tx.update(tr,privatePatch);tx.update(pr,publicPatch);
    const out={ok:true,code,mode,locked:mode==='password',accessVersion};
    tx.create(op,{action:'configure',actorUid:uid,previousMode,nextMode:mode,accessVersion,createdAt:now,result:out});
    return out;
   });
   return result;
  }
  const result=await db.runTransaction(async tx=>{
   const grantRef=tr.collection('accessGrants').doc(uid),attemptRef=db.doc('roomAccessAttempts/'+hash(code+'|'+uid));
   const [ts,us,grant,attempt]=await Promise.all([tx.get(tr),tx.get(ur),tx.get(grantRef),tx.get(attemptRef)]);
   if(!ts.exists)return {error:'room-not-found'};if(!C.active(us.data()))return {error:'auth-required'};
   const t=ts.data(),mode=C.normalizeMode(t.roomAccessMode);
   if(mode!=='password'||C.canBypass(uid,us.data(),t)||C.grantValid(grant.data(),t,now))return {ok:true,code,mode,hasAccess:true,alreadyGranted:true};
   const a=attempt.data()||{},lockedUntil=Number(a.lockedUntil||0);
   if(lockedUntil>now)return {error:'room-access-rate-limited',retryAfterMs:lockedUntil-now};
   if(!t.roomAccessSalt||!t.roomAccessHash)return {error:'room-access-not-ready'};
   if(!C.verifyPassword(d.password,t.roomAccessSalt,t.roomAccessHash)){
    const sameWindow=Number(a.windowStartedAt||0)>now-C.ATTEMPT_WINDOW_MS,failedCount=(sameWindow?Number(a.failedCount||0):0)+1,windowStartedAt=sameWindow?Number(a.windowStartedAt):now;
    const nextLockedUntil=failedCount>=C.MAX_FAILED_ATTEMPTS?now+C.ATTEMPT_LOCK_MS:0;
    tx.set(attemptRef,{code,uid,failedCount,windowStartedAt,lockedUntil:nextLockedUntil,updatedAt:now},{merge:true});
    return {error:nextLockedUntil?'room-access-rate-limited':'room-password-invalid',remainingAttempts:Math.max(0,C.MAX_FAILED_ATTEMPTS-failedCount),retryAfterMs:nextLockedUntil?C.ATTEMPT_LOCK_MS:0};
   }
   const expiresAt=now+C.ACCESS_GRANT_MS;
   tx.set(grantRef,{uid,code,accessVersion:Number(t.roomAccessVersion||0),method:'password',grantedAt:now,expiresAt});
   tx.set(attemptRef,{code,uid,failedCount:0,windowStartedAt:now,lockedUntil:0,updatedAt:now},{merge:true});
   return {ok:true,code,mode,hasAccess:true,expiresAt,accessVersion:Number(t.roomAccessVersion||0)};
  });
  if(result?.error){const e=Error(result.error);e.details=result;throw e;}
  return result;
 };
}
module.exports={createRoomAccessService};
