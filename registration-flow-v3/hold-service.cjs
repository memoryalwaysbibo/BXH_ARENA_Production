'use strict';
const {createHash}=require('node:crypto');
const {applyHold,summary}=require('./hold-core.cjs');
const hash=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const active=u=>u?.active===true&&!u.deleted&&!['deleted','disabled','frozen'].includes(u.accountStatus);
const id=/^[A-Za-z0-9_-]{1,128}$/;

// Persistent Firestore candidate. No new service or schedule is required.
// The per-room ledger provides a single serialization point for exact capacity.
function createHoldService({db,authorizeJoin,authorizeReview,authorizeCancel,clock=Date.now,observe=()=>{}}) {
 for(const fn of [authorizeJoin,authorizeReview,authorizeCancel]) if(typeof fn!=='function') throw Error('registration-authorizers-required');
 return async request=>{
  const actor=request.auth?.uid,d=request.data||{},uid=d.registrationId??actor;
  if(typeof actor!=='string'||!id.test(actor))throw Error('auth-required');
  if(typeof uid!=='string'||!id.test(uid)||typeof d.code!=='string'||!/^BXH-[A-Z0-9]{4,16}$/.test(d.code)||
     !['join','approve','reject','cancel'].includes(d.action)||typeof d.operationId!=='string'||!id.test(d.operationId)||d.operationId.length<8)
    throw Error('invalid-operation');
  if(d.action==='join'&&uid!==actor)throw Error('invalid-participant');
  const room=db.doc('tournaments/'+d.code), ledger=room.collection('registrationV3State').doc('ledger'),
   hold=room.collection('registrationV3Holds').doc(uid), receipt=room.collection('registrationV3Operations').doc(hash([actor,d.operationId])),
   row=room.collection('registrations').doc(uid), account=db.doc('users/'+actor);
  const fingerprint=hash([d.action,uid,d.expectedAttemptId??null]);
  const begin=clock();let attempts=0,reads=0,writes=0,committedWrites=0;
  try {
   const result=await db.runTransaction(async tx=>{
    attempts++;let currentWrites=0;
    const get=async(...refs)=>{reads+=refs.length;return tx.getAll(...refs);};
    const [rs,ls,hs,os,us]=await get(room,ledger,hold,receipt,account);
    const t=rs.data(),l=ls.data(),previous=hs.data(),user=us.data();
    if(!active(user))throw Error('auth-required');
    if(t?.registrationFlowVersion!==3||!ls.exists)throw Error('registration-v3-required');
    if(os.exists){
     if(os.data().fingerprint!==fingerprint)throw Error('operation-conflict');
     committedWrites=0;return {...os.data().result,replayed:true};
    }
    if(t.tournamentPhase!=='waiting'||t.systemClosed||t.eventCancelled||t.capacity!==l.capacity)throw Error('registration-state-conflict');
    const now=clock(),context={tx:{getAll:get},uid:actor,user,room:t,registrationId:uid,previous,now,action:d.action,code:d.code};
    const authorize=d.action==='join'?authorizeJoin:d.action==='cancel'?authorizeCancel:authorizeReview;
    if(await authorize(context)!==true)throw Error('permission-denied');
    const next=applyHold(l,previous,{action:d.action,uid,operationId:d.operationId,expectedAttemptId:d.expectedAttemptId,now});
    let formal=null;
    if(d.action==='approve'){
     const [participant,existing]=await get(db.doc('users/'+uid),row);
     if(!active(participant.data())||existing.data()?.status==='confirmed')throw Error('registration-state-conflict');
     const name=String(participant.data().realName||'').trim();
     if(!name)throw Error('registration-name-missing');
     formal={uid,registrationId:uid,displayName:name,realName:name,publicName:name,status:'confirmed',
      registrationFlowVersion:3,attemptId:next.hold.attemptId,createdAt:previous.submittedAt,reviewedAt:now,reviewedBy:actor};
    }else if(d.action==='cancel'&&previous.status==='confirmed'){
     const [existing]=await get(row);
     if(existing.data()?.attemptId!==previous.attemptId||existing.data()?.status!=='confirmed')throw Error('registration-state-conflict');
     formal={...existing.data(),status:'cancelled',cancelledAt:now,cancelledBy:actor};
    }
    const result={ok:true,status:next.hold.status,attemptId:next.hold.attemptId,sequence:next.hold.sequence,summary:summary(next.ledger)};
    tx.set(hold,next.hold);tx.set(ledger,next.ledger);tx.create(receipt,{fingerprint,result,createdAt:now});
    currentWrites+=3;
    if(formal){tx.set(row,formal);currentWrites++;}
    writes+=currentWrites;committedWrites=currentWrites;
    return result;
   });
   try{observe({action:d.action,attempts,reads,writesAttempted:writes,committedWrites,elapsedMs:clock()-begin,ok:true});}catch{}
   return result;
  }catch(error){
   try{observe({action:d.action,attempts,reads,writesAttempted:writes,committedWrites:0,elapsedMs:clock()-begin,ok:false});}catch{}
   throw error;
  }
 };
}
module.exports={createHoldService};
