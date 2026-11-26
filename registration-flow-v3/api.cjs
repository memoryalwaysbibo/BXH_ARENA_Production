'use strict';
const {createHoldService}=require('./hold-service.cjs');
const {createAuthorizers,canReview}=require('./permissions.cjs');
const {summary}=require('./hold-core.cjs');
const active=u=>u?.active===true&&!u.deleted&&!['deleted','disabled','frozen'].includes(u.accountStatus);
const id=/^[A-Za-z0-9_-]{1,128}$/;
const codePattern=/^BXH-[A-Z0-9]{4,16}$/;
const ownView=h=>h?{status:h.status,sequence:h.sequence,submittedAt:h.submittedAt,updatedAt:h.updatedAt,attemptId:h.attemptId}:null;

// Callable factory; registration with Firebase is a separate release step.
// Mutations and reads share the same trusted room version and account checks.
function createApi({db,clock=Date.now,observe}){
 const mutate=createHoldService({db,...createAuthorizers({db}),clock,observe});
 return async request=>{
  const uid=request.auth?.uid,d=request.data||{};
  if(typeof uid!=='string'||!id.test(uid))throw Error('auth-required');
  if(typeof d.code!=='string'||!codePattern.test(d.code))throw Error('invalid-code');
  if(['join','approve','reject','cancel'].includes(d.action))return mutate(request);
  if(!['mine','reviewPage'].includes(d.action))throw Error('invalid-operation');
  const room=db.doc('tournaments/'+d.code),ledger=room.collection('registrationV3State').doc('ledger');
  return db.runTransaction(async tx=>{
   const [rs,ls,us]=await tx.getAll(room,ledger,db.doc('users/'+uid));
   const t=rs.data(),l=ls.data(),user=us.data();
   if(!active(user))throw Error('auth-required');
   if(t?.registrationFlowVersion!==3||!ls.exists)throw Error('registration-v3-required');
   if(d.action==='mine'){
    const [hs]=await tx.getAll(room.collection('registrationV3Holds').doc(uid));
    // Do not expose non-public room details to an unrelated account.
    if(!hs.exists&&t.visibility!=='public')throw Error('permission-denied');
    return {ok:true,hold:ownView(hs.data())};
   }
   if(!canReview({room:t,user,uid,now:clock()}))throw Error('permission-denied');
   const after=d.afterSequence??0;
   if(!Number.isSafeInteger(after)||after<0)throw Error('invalid-cursor');
   const limit=d.limit??20;
   if(!Number.isSafeInteger(limit)||limit<1||limit>30)throw Error('invalid-limit');
   const query=room.collection('registrationV3Holds').where('status','==','pending_review')
    .where('sequence','>',after).orderBy('sequence').limit(limit+1);
   const snapshot=await tx.get(query);
   const holds=snapshot.docs.slice(0,limit).map(doc=>doc.data());
   const accounts=holds.length?await tx.getAll(...holds.map(h=>db.doc('users/'+h.uid))):[];
   const rows=holds.map((h,i)=>({uid:h.uid,...ownView(h),displayName:String(accounts[i].data()?.realName||'').slice(0,120)}));
   return {ok:true,rows,summary:summary(l),nextSequence:snapshot.docs.length>limit?holds.at(-1).sequence:null};
  });
 };
}
module.exports={createApi};
