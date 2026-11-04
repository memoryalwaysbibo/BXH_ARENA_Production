'use strict';
const {createLimiter}=require('./admission.cjs');
const {decode,encode}=require('./detail-cursor.cjs');
const {collectOwners}=require('./owners.js');
const SCHEMA=24,RELEASE='individual-family-v24',SCOPE='individual-family',PAGE_SIZE=16;
const PATHS={rollout:'myEventsMembershipControl/rollout',jobs:'myEventRoomJobs',failures:'myEventMembershipFailuresV24',bootstrap:'myEventBootstrapRunsV26',rebuilds:'myEventRebuildsV26'};
const uidOK=x=>typeof x==='string'&&/^[^\s/]{1,128}$/.test(x),codeOK=x=>typeof x==='string'&&/^[A-Za-z0-9_-]{1,100}$/.test(x);
const keys=['selfConfirmed','selfWaitlist','familyConfirmed','familyWaitlist','unsupported'];
const timestamp=t=>t&&Number.isSafeInteger(t.seconds)&&Number.isInteger(t.nanoseconds)&&t.nanoseconds>=0&&t.nanoseconds<1e9;
const sameTime=(a,b)=>timestamp(a)&&timestamp(b)&&a.seconds===b.seconds&&a.nanoseconds===b.nanoseconds;
const fail=reason=>{throw Object.assign(Error(reason),{readerReason:reason});};
const response=(status,extra={})=>({schemaVersion:1,scope:SCOPE,status,rows:[],hasMore:false,nextCursor:null,notices:[],...extra});
const unknown=reason=>response('unknown',{reason});
const compareTime=(a,b)=>a.seconds-b.seconds||a.nanoseconds-b.nanoseconds;
function createDetailReader({enabled=false,bridge,verifyAuth,normalizeRoom=require('./lifecycle.js').normalizeLifecycle,timeoutMs=5000,mono=()=>performance.now()}={}){
 if(enabled!==true)return async()=>unknown('disabled');
 if(typeof verifyAuth!=='function'||typeof normalizeRoom!=='function'||!bridge?.run||!bridge?.doc||!bridge?.collection)throw Error('trusted-auth-sdk-normalizer-required');
 if(!Number.isFinite(timeoutMs)||timeoutMs<=0||timeoutMs>2147483647)throw Error('invalid-timeout');
 let last=-Infinity,bad=false;
 const clock=()=>{if(bad)fail('invalid-clock');let t;try{t=mono();}catch{bad=true;fail('invalid-clock');}if(!Number.isFinite(t)||t<0||t<last){bad=true;fail('invalid-clock');}last=t;return t;};
 const limiter=createLimiter(clock);
 return async(request={})=>{
  const data=request?.data??{};
  if(!data||typeof data!=='object'||Array.isArray(data)||Object.keys(data).some(k=>!['code','cursor'].includes(k))||!codeOK(data.code)||(Object.hasOwn(data,'cursor')&&(typeof data.cursor!=='string'||!data.cursor.length)))return unknown('unsupported-input');
  let start;try{start=clock();}catch{return unknown('invalid-clock');}let closed=false,timer,release;
  const check=()=>{if(closed||clock()-start>=timeoutMs)fail('timeout');};
  const work=(async()=>{
   const auth=await verifyAuth(request);check();const uid=auth?.uid;if(!uidOK(uid))return unknown('unauthenticated');
   const code=data.code;
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
    const notices=[];if(restore.size)notices.push('restore-synchronizing');
    if(failures.size)notices.push('known-owner-failure');
    if(ownerErrors.size)notices.push('own-membership-error');
    const member=await get('users/'+uid+'/myEventRooms/'+code);same(member);const m=member.data();
    if(!member.exists||m?.ownerUid!==uid||m.code!==code||m.schemaVersion!==SCHEMA||m.release!==RELEASE||m.candidate!==true)return unknown('membership-unproven');
    if(Object.hasOwn(m,'pendingRebuildGeneration')||Object.hasOwn(m,'quarantinedRebuildGeneration')||m.state!=='ready')return response('synchronizing',{notices:['membership-unresolved']});
    if(!m.counts||keys.some(k=>!Number.isSafeInteger(m.counts[k])||m.counts[k]<0)||m.counts.unsupported>0||!keys.slice(0,4).some(k=>m.counts[k]>0))return unknown('membership-unproven');
    const room=await get('tournaments/'+code);same(room);
    if(!room.exists)return response('synchronizing',{notices:[...notices,'room-unavailable']});
    if(!sameTime(m.roomIncarnation,room.createTime))return unknown('room-incarnation-mismatch');
    if(!timestamp(room.updateTime)||compareTime(room.updateTime,room.createTime)<0||compareTime(room.updateTime,room.readTime)>0)fail('invalid-room-version');
    const life=normalizeRoom(room.data());
    if(life?.status==='supported'&&life.active===false)return response('inactive',{reason:'room-ended'});
    if(life?.status!=='supported'||life.active!==true||!['waiting','live','settling'].includes(life.phase))return response('synchronizing',{notices:['unsupported-room']});
    let after=null;
    if(data.cursor){try{after=decode(data.cursor,{uid,code,incarnation:room.createTime});}catch{return unknown('invalid-cursor');}}
    const self=after===null?await get('tournaments/'+code+'/registrations/'+uid):null;
    if(self)same(self);
    let q=bridge.collection('tournaments/'+code+'/registrations').where('guardianUid','==',uid).orderBy('__name__');
    if(after!==null)q=q.startAfter(after);
    const family=await query(q.limit(PAGE_SIZE+1));same(family);
    if(family.size!==family.docs.length||family.size>PAGE_SIZE+1)fail('invalid-page');
    const hasMore=family.size>PAGE_SIZE,rows=[],seen=new Set();let lastId=after;
    const accept=(doc,kind)=>{
     same(doc);if(!doc.exists)return;
     const r=doc.data(),id=doc.id;
     if(!uidOK(id)||doc.ref.path!=='tournaments/'+code+'/registrations/'+id)fail('invalid-registration-path');
     if(kind==='family'&&r?.guardianUid!==uid)fail('registration-owner-mismatch');
     if(kind==='self'&&(id!==uid||r?.uid!==uid||r?.familyPlayerId||r?.guardianUid)){notices.push('registration-unresolved');return;}
     const checkOwner=collectOwners({code,registrations:[{id,path:doc.ref.path,data:r}]});
     if(checkOwner.status!=='supported'){notices.push('registration-unresolved');return;}
     if(!timestamp(doc.createTime)||!timestamp(doc.updateTime)||compareTime(doc.createTime,room.createTime)<0||compareTime(doc.updateTime,doc.createTime)<0||compareTime(doc.updateTime,doc.readTime)>0){notices.push('registration-unresolved');return;}
     if(r.status==='cancelled'||seen.has(id))return;seen.add(id);
     if(checkOwner.ownerUids.length!==1||checkOwner.ownerUids[0]!==uid)fail('registration-owner-mismatch');
     const displayName=typeof r.displayName==='string'&&r.displayName.length<=256?r.displayName:typeof r.realName==='string'&&r.realName.length<=256?r.realName:null;
     if(!displayName){notices.push('registration-unresolved');return;}
     const out={tournamentCode:code,registrationId:id,uid:id,displayName,status:r.status};
     // Existing queue identity aliases, only from this authenticated canonical row.
     for(const key of ['publicName','participantName','realName'])if(typeof r[key]==='string'&&r[key].length<=256)out[key]=r[key];
     for(const key of ['runtimePlayerId','playerId','participantId','id'])if(uidOK(r[key]))out[key]=r[key];
     if(kind==='family')out.familyPlayerId=r.familyPlayerId;
     if(Number.isSafeInteger(r.waitRank)&&r.waitRank>0)out.waitRank=r.waitRank;
     rows.push(out);
    };
    if(self)accept(self,'self');
    for(const doc of family.docs){same(doc);if(!uidOK(doc.id)||lastId!==null&&doc.id<=lastId)fail('invalid-page');lastId=doc.id;}
    const page=family.docs.slice(0,PAGE_SIZE);for(const doc of page)accept(doc,'family');
    const nextCursor=hasMore?encode({uid,code,incarnation:room.createTime,after:page.at(-1).id}):null;
    // Empty details never prove empty membership, including a forged skip cursor.
    if(!rows.length)notices.push('details-unconfirmed');
    return response(rows.length?'ready':hasMore?'continue':'synchronizing',{rows,hasMore,nextCursor,notices:[...new Set(notices)],roomIncarnation:{seconds:room.createTime.seconds,nanoseconds:room.createTime.nanoseconds},roomUpdateTime:{seconds:room.updateTime.seconds,nanoseconds:room.updateTime.nanoseconds},phase:life.phase});
   },{readOnly:true});check();return output.value;
  })().finally(()=>{if(release)release();}).catch(e=>unknown(e.readerReason||'rpc-error'));
  const timeout=new Promise(resolve=>{timer=setTimeout(()=>{closed=true;resolve(unknown('timeout'));},timeoutMs);});
  try{const result=await Promise.race([work,timeout]);check();return result;}catch(e){return unknown(e.readerReason||'rpc-error');}finally{closed=true;clearTimeout(timer);}
 };
}
module.exports={createDetailReader,unknown};
