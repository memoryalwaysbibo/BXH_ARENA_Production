'use strict';
const {createLimiter}=require('./admission.cjs');
const {createCursorCodec}=require('./cursor.cjs');
const SCHEMA=24,RELEASE='individual-family-v24',SCOPE='individual-family',PAGE_SIZE=16;
const PATHS={rollout:'myEventsMembershipControl/rollout',jobs:'myEventRoomJobs',failures:'myEventMembershipFailuresV24',bootstrap:'myEventBootstrapRunsV26',rebuilds:'myEventRebuildsV26'};
const uidOK=x=>typeof x==='string'&&/^[^\s/]{1,128}$/.test(x),codeOK=x=>typeof x==='string'&&/^[A-Za-z0-9_-]{1,100}$/.test(x);
const keys=['selfConfirmed','selfWaitlist','familyConfirmed','familyWaitlist','unsupported'];
const timestamp=t=>t&&Number.isSafeInteger(t.seconds)&&Number.isInteger(t.nanoseconds)&&t.nanoseconds>=0&&t.nanoseconds<1e9;
const sameTime=(a,b)=>timestamp(a)&&timestamp(b)&&a.seconds===b.seconds&&a.nanoseconds===b.nanoseconds;
const fail=reason=>{throw Object.assign(Error(reason),{readerReason:reason});};
const unknown=reason=>({schemaVersion:SCHEMA,scope:SCOPE,status:'unknown',complete:false,confirmedEmpty:false,cards:[],nextCursor:null,notices:[],reason});
function createAuthenticatedReader({enabled=false,bridge,verifyAuth,normalizeRoom=require('./lifecycle.js').normalizeLifecycle,cursorCodec=createCursorCodec(),timeoutMs=5000,mono=()=>performance.now()}={}){
 if(enabled!==true)return async()=>unknown('disabled');
 if(typeof verifyAuth!=='function'||typeof normalizeRoom!=='function'||!bridge?.run||!bridge?.doc||!bridge?.collection)throw Error('trusted-auth-sdk-normalizer-required');
 if(!Number.isFinite(timeoutMs)||timeoutMs<=0||timeoutMs>2147483647)throw Error('invalid-timeout');
 let last=-Infinity,bad=false;
 const clock=()=>{if(bad)fail('invalid-clock');let t;try{t=mono();}catch{bad=true;fail('invalid-clock');}if(!Number.isFinite(t)||t<0||t<last){bad=true;fail('invalid-clock');}last=t;return t;};
 const limiter=createLimiter(clock);
 return async(request={})=>{
  const data=request?.data??{};
  if(!data||typeof data!=='object'||Array.isArray(data)||Object.keys(data).some(k=>k!=='cursor')||(Object.hasOwn(data,'cursor')&&(typeof data.cursor!=='string'||!data.cursor.length)))return unknown('unsupported-input');
  let start;try{start=clock();}catch{return unknown('invalid-clock');}let closed=false,timer,release;
  const check=()=>{if(closed||clock()-start>=timeoutMs)fail('timeout');};
  const work=(async()=>{
   const auth=await verifyAuth(request);check();const uid=auth?.uid;if(!uidOK(uid))return unknown('unauthenticated');
   let continuation={after:null};if(data.cursor){try{continuation=cursorCodec.decode(data.cursor,uid);}catch{return unknown('invalid-cursor');}}
   release=limiter.take(uid);if(!release)return unknown('rate-limited');
   const output=await bridge.run('my-events-per-user-reader',async tx=>{
    const get=async path=>{check();const result=await tx.get(bridge.doc(path));check();return result;};
    const query=async q=>{check();const result=await tx.get(q);check();return result;};
    const user=await get('users/'+uid),u=user.data();if(!user.exists||u?.active!==true||u.deleted||u.familyTransferPending===true||['pending','deleted','disabled','frozen'].includes(u.accountStatus))return unknown('inactive-account');
    const baseline=await get(PATHS.rollout),b=baseline.data();if(!baseline.exists||b?.schemaVersion!==SCHEMA||b.release!==RELEASE||b.scope!==SCOPE||b.enabled!==true||b.baselineComplete!==true)return unknown('synchronizing');
    const same=s=>{if(!sameTime(user.readTime,s.readTime))fail('mixed-snapshot');};same(baseline);
    const bp=b.bootstrap;
    if(bp?.schemaVersion!==26||!codeOK(bp.runId)||bp.engineVersion!=='membership-v26-generation-1')return unknown('bootstrap-unproven');
    const run=await get(PATHS.bootstrap+'/'+bp.runId);same(run);const evidence=run.data();
    if(!run.exists||evidence?.schemaVersion!==26||evidence.runId!==bp.runId||evidence.engineVersion!==bp.engineVersion||evidence.scope!==SCOPE||evidence.state!=='complete'||evidence.phase!=='complete'||evidence.pending!==false||evidence.roomDiscoveryDone!==true||evidence.summaryDiscoveryDone!==true||!Number.isSafeInteger(evidence.queuedRooms)||evidence.queuedRooms<0||evidence.completedRooms!==evidence.queuedRooms||evidence.failedRooms!==0||!Number.isSafeInteger(evidence.rebuiltRooms)||evidence.rebuiltRooms<0||!Number.isSafeInteger(evidence.quarantinedRooms)||evidence.quarantinedRooms<0||evidence.completedRooms!==evidence.rebuiltRooms+evidence.quarantinedRooms||evidence.disposition!==(evidence.quarantinedRooms===0?'clean':'with-quarantine')||!Number.isSafeInteger(evidence.completedAt)||evidence.completedAt<0||evidence.captureMode!=='same-service-engine')return unknown('bootstrap-unproven');

    const restore=await query(bridge.collection(PATHS.jobs).where('release','==',RELEASE).where('target','==','active').where('dirty','==',true).where('restoration','==',true).limit(1));same(restore);
    const failures=await query(bridge.collection(PATHS.failures).where('release','==',RELEASE).where('open','==',true).limit(1));same(failures);
    const ownerErrors=await query(bridge.collection('users/'+uid+'/myEventErrors').where('release','==',RELEASE).where('open','==',true).limit(1));same(ownerErrors);
    const notices=[];if(restore.size)notices.push('restore-synchronizing');if(failures.size)notices.push('known-owner-failure');if(ownerErrors.size)notices.push('own-membership-error');
    let q=bridge.collection('users/'+uid+'/myEventRooms').where('candidate','==',true).orderBy('__name__');if(continuation.after)q=q.startAfter(continuation.after);
    const candidates=await query(q.limit(PAGE_SIZE+1));same(candidates);
    if(candidates.docs.length!==candidates.size||candidates.size>PAGE_SIZE+1)fail('invalid-page');
    const hasMore=candidates.size>PAGE_SIZE,page=candidates.docs.slice(0,PAGE_SIZE),cards=[];let lastCode=continuation.after;
    for(const doc of page){
     same(doc);const m=doc.data(),code=doc.id??doc.ref.path.split('/').at(-1);
     if(!codeOK(code)||doc.ref.path!=='users/'+uid+'/myEventRooms/'+code||m?.code!==code||m.ownerUid!==uid||m.schemaVersion!==SCHEMA||m.release!==RELEASE||m.candidate!==true||lastCode!==null&&code<=lastCode)fail('invalid-membership');lastCode=code;
     if((Object.hasOwn(m,'pendingRebuildGeneration')||Object.hasOwn(m,'quarantinedRebuildGeneration'))){notices.push('membership-unresolved');continue;}
     const room=await get('tournaments/'+code);same(room);
     if(!room.exists){notices.push('room-unavailable');continue;}if(!sameTime(m.roomIncarnation,room.createTime))fail('room-incarnation-mismatch');
     // Shared private canonical normalizer is the only phase authority.
     const life=normalizeRoom(room.data());
     if(life?.status==='supported'&&life.active===false)continue;
     if(life?.status==='unsupported'){notices.push('unsupported-scope');continue;}
     if(life?.status!=='supported'||life.active!==true||!['waiting','live','settling'].includes(life.phase)){notices.push('room-unavailable');continue;}
     if(m.state==='unsupported'){notices.push('unsupported-scope');continue;}if(m.state!=='ready'){notices.push('membership-unresolved');continue;}
     if(!m.counts||keys.some(k=>!Number.isSafeInteger(m.counts[k])||m.counts[k]<0))fail('invalid-counters');
     const c=m.counts;if(c.unsupported>0){notices.push('unsupported-scope');continue;}if(!keys.slice(0,4).some(k=>c[k]>0))fail('invalid-counters');
     cards.push({code,phase:life.phase,participantKinds:[...(c.familyConfirmed+c.familyWaitlist>0?['family']:[]),...(c.selfConfirmed+c.selfWaitlist>0?['self']:[])],registrationStatuses:[...(c.selfConfirmed+c.familyConfirmed>0?['confirmed']:[]),...(c.selfWaitlist+c.familyWaitlist>0?['waitlist']:[])]});
    }
    const complete=!hasMore;
    const nextCursor=hasMore?cursorCodec.encode({uid,after:lastCode}):null;
    const status=cards.length?'ready':hasMore?'continue':notices.length?'synchronizing':'ready';
    return {schemaVersion:SCHEMA,scope:SCOPE,status,complete,confirmedEmpty:complete&&!continuation.after&&!cards.length&&!notices.length,cards,nextCursor,notices:[...new Set(notices)],semantics:'currently-synchronized-eventual-pages'};
   },{readOnly:true});check();return output.value;
  })().finally(()=>{if(release)release();}).catch(e=>unknown(e.readerReason||'rpc-error'));
  const timeout=new Promise(resolve=>{timer=setTimeout(()=>{closed=true;resolve(unknown('timeout'));},timeoutMs);});
  try{const result=await Promise.race([work,timeout]);check();return result;}catch(e){return unknown(e.readerReason||'rpc-error');}finally{closed=true;clearTimeout(timer);}
 };
}
module.exports={createAuthenticatedReader,unknown,SCHEMA,RELEASE,SCOPE,PAGE_SIZE,PATHS,sameTime};
