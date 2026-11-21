'use strict';
const {buildHomePublication,projectPublicCard}=require('./home-publisher.cjs');
const {extractPhase,skipProjection}=require('./home-lifecycle-proof.cjs');
const {createLabCatalogStore}=require('./home-catalog-store.cjs');
const {isDeepStrictEqual}=require('node:util');
const NAMESPACE='arenaHomeLab';
const PROJECT='demo-arena-home-compare';
const INPUT='arenaHomeLabSource';
const PRIVATE_LIFECYCLE='arenaHomeLabPrivateLifecycle';
const MAX_SOURCE=250;
const toEpoch=value=>{
 if(Number.isSafeInteger(value))return value;
 if(value instanceof Date)return Number.isFinite(value.valueOf())?value.valueOf():null;
 if(typeof value?.toMillis==='function')return value.toMillis();
 if(typeof value!=='string')return null;
 let zoned=value;
 if(/^\d{4}-\d\d-\d\dT\d\d:\d\d(?::\d\d(?:\.\d{1,3})?)?$/.test(value))zoned=value+'+08:00';
 if(!/^\d{4}-\d\d-\d\dT\d\d:\d\d(?::\d\d(?:\.\d{1,3})?)?(?:Z|[+-]\d\d:\d\d)$/.test(zoned))return null;
 const n=Date.parse(zoned);return Number.isFinite(n)?n:null;
};
const statuses=new Set(['draft','scheduled','open','full','closed','started','cancelled']);
const firstString=(...values)=>values.find(v=>typeof v==='string'&&v.trim().length>0);
const ptnPattern=/^PTN-[A-Z0-9]{6}$/;
function projectMirror(id,d,proof){
 if(skipProjection(d))return null;
 const community=d.eventAuthority==='community';
 const authority=community?'community':typeof id==='string'&&ptnPattern.test(id)?'partner':'official';
 const publishedAt=toEpoch(d.publishedAt);
 if(!community&&!(publishedAt>0))return null;
 const quick=community&&d.battleMode!=='team'&&d.communityQuickRegistration===true;
 const eventDate=/^\d{4}-\d\d-\d\d$/.test(d.eventDate??'')?d.eventDate:undefined;
 const startAt=/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(d.startAt??'')?d.startAt:undefined;
 const eventAt=toEpoch(d.eventAt)??(eventDate?toEpoch(eventDate+'T'+(startAt??'00:00')+':00+08:00'):null);
 const flags={visibility:d.visibility,deleted:d.deleted,deletionStatus:d.deletionStatus,registrationVisibility:d.registrationVisibility,testMode:d.testMode,eventCancelled:d.eventCancelled};
 const lifecycle=extractPhase(id,d,proof);
 const canonicalPhase=lifecycle.phase;
 let registrationStatus=statuses.has(d.registrationStatus)?d.registrationStatus:'unknown';
 if(canonicalPhase==='cancelled')registrationStatus='cancelled';
 else if(lifecycle.locked)registrationStatus='started';
 else if(d.registrationSelection&&d.registrationSelection.status!=='open')registrationStatus='closed';
 const values={
  id,title:firstString(d.name,d.title)??'未命名賽事',eventAt,eventDate,startAt,publishedAt,
  authority,hostName:firstString(d.hostName,d.createdByName,d.ownerName)??(community?'玩家主辦':'BXH'),location:d.location,
  eventPhase:canonicalPhase,openAt:toEpoch(d.registrationOpenAt??d.openAt),closeAt:toEpoch(d.registrationCloseAt??d.closeAt),cancellationDeadline:toEpoch(d.cancellationDeadline),registrationStatus,
  ranked:!community&&(d.ladderMode==='ranked'||d.ranked===true),
  capacity:d.capacity,confirmedCount:quick?d.communityParticipantCount??d.confirmedCount:d.confirmedCount,waitlistCount:d.waitlistCount,waitlistCapacity:d.waitlistCapacity,waitlistEnabled:d.waitlistEnabled,
  registrationEnabled:d.registrationEnabled,communityQuickRegistration:quick,communityParticipantCount:quick?d.communityParticipantCount:undefined,
  targetGroup:d.targetGroup,roomAccessMode:d.roomAccessMode??'public',formatType:d.formatType??'single',battleMode:d.battleMode==='team'?'team':'individual',teamSize:Number.isSafeInteger(d.teamSize)&&d.teamSize>=3?d.teamSize:3,
  registrationSelection:d.registrationSelection,registeredCount:d.registeredCount,
  systemClosed:lifecycle.systemClosed,fee:d.fee,checkInAt:d.checkInAt,playMode:d.playMode
 };
 return projectPublicCard({...values,...flags});
}
function makeLabWriter(db,env=process.env,{readTrustedLifecycle=false,enableCatalog=false,atomicSourcePublication=false,categoryAwarePreview=false,pinnedParity=false}={}){
 if(env.FIRESTORE_EMULATOR_HOST!==process.env.FIRESTORE_EMULATOR_HOST||!/^127\.0\.0\.1:[1-9]\d{3,4}$/.test(env.FIRESTORE_EMULATOR_HOST??'')||env.GOOGLE_CLOUD_PROJECT!==PROJECT||db.projectId!==PROJECT)throw Error('home-writer-demo-only');
 if(pinnedParity&&(!atomicSourcePublication||!enableCatalog||!categoryAwarePreview||readTrustedLifecycle))throw Error('home-pinned-atomic-catalog-preview-only');
 const pinned=pinnedParity?require('../arena-home-integration/release-parity/public-card-projection.cjs').projectPinnedCard:null;
 const first=db.doc(NAMESPACE+'/first'), signal=db.doc(NAMESPACE+'/version'), delta=db.doc(NAMESPACE+'/delta');
 const catalog=enableCatalog?createLabCatalogStore(db,env):null;
 const source=db.collection(INPUT).where('visibility','==','public').limit(MAX_SOURCE+1);
 function revision(doc){
  return doc.exists?`${doc.updateTime.seconds}:${doc.updateTime.nanoseconds}`:null;
 }
 async function transact(pending=null){
  return db.runTransaction(async tx=>{
   let targetRef,revoking=false;
   if(pending){
    targetRef=db.collection(INPUT).doc(pending.id);
    const target=await tx.get(targetRef);
    if(revision(target)!==pending.expectedRevision)throw Error('home-source-stale');
    revoking=pinned?target.exists&&pinned(pending.id,target.data()).status!=='excluded'&&
      pinned(pending.id,pending.replacement).status==='excluded':
      !!projectMirror(pending.id,target.data())&&!projectMirror(pending.id,pending.replacement);
   }
   const prior=await tx.get(first);
   const snapshot=await tx.get(source);
   if(snapshot.size>MAX_SOURCE)throw Error('home-writer-source-limit');
   const effective=new Map(snapshot.docs.map(doc=>[doc.id,doc.data()]));
   if(pending){
    effective.delete(pending.id);
    if(pending.replacement?.visibility==='public')effective.set(pending.id,pending.replacement);
   }
   if(effective.size>MAX_SOURCE)throw Error('home-writer-source-limit');
   // Explicit opt-in lab adapter: private proofs are projected scalars written by
   // a synthetic authority; nothing on the public source can impersonate them.
   const proofRefs=readTrustedLifecycle?[...effective.keys()].map(id=>db.doc(PRIVATE_LIFECYCLE+'/'+id)):[];
   const proofs=proofRefs.length?await tx.getAll(...proofRefs):[];
   const proofById=new Map(proofs.map(doc=>[doc.id,doc.data()]));
   let rooms,priorCatalog,privacyOnly=false,blocked=0;
   if(pinned){
    const projections=new Map([...effective].map(([id,data])=>[id,pinned(id,data)]));
    blocked=[...projections.values()].filter(r=>r.status==='requires-canonical-backfill').length;
    if(blocked&&!revoking) {
     // No staged writes: ordinary unknown shapes cannot silently disappear
     // from preview/catalog or alter the previously verified source revision.
     const e=new Error('home-pinned-backfill-required');
     e.blockedCount=blocked;
     throw e;
    }
    if(blocked){
     // Preserve authorized visibility revocation even with an unrelated old
     // source. This path does not admit any new cards or update card payloads:
     // only retain previously published cards still independently proven public.
     privacyOnly=true;
     priorCatalog=await catalog.previousGeneration(tx);
     rooms=(priorCatalog?.cards??prior.data()?.cards??[])
      .filter(card=>card.id!==pending.id&&projections.get(card.id)?.status==='ready')
      .map(card=>({...card,visibility:'public'}));
    }else{
     rooms=[...projections.values()].filter(r=>r.status==='ready').map(r=>({...r.card,visibility:'public'}));
    }
   }else{
    rooms=[...effective].map(([id,data])=>projectMirror(id,data,proofById.get(id))).filter(Boolean).map(c=>({...c,visibility:'public'}));
   }
   let result=buildHomePublication(prior.exists?prior.data():null,rooms,{categoryAwarePreview});
   // A room already pushed out of preview may still be an ID-only tombstone
   // in the latest delta. Clear that mention too before reporting revocation.
   if(revoking&&!result.changed){
    const previousDelta=(await tx.get(delta)).data();
    const previousSignal=(await tx.get(signal)).data();
    if(previousSignal?.ids?.includes(pending.id)||previousDelta?.remove?.includes(pending.id)||previousDelta?.order?.includes(pending.id)||previousDelta?.upsert?.some(x=>x.id===pending.id)){
     const version=result.first.version+1;
     if(!Number.isSafeInteger(version))throw Error('home-publication-version-overflow');
     result={changed:true,first:{...result.first,version},delta:null,signal:{version,previous:null,ids:[]}};
    }
   }
   const nextCatalog=catalog?await catalog.prepare(tx,rooms,priorCatalog):null;
   const catalogState=nextCatalog?{catalogVersion:nextCatalog.version,catalogChanged:nextCatalog.changed}:{};
   if(privacyOnly)Object.assign(catalogState,{privacyOnly:true,blockedCount:blocked});
   if(pending){
    if(pending.replacement===null)tx.delete(targetRef);
    else tx.set(targetRef,pending.replacement);
   }
   if(nextCatalog)catalog.stage(tx,nextCatalog);
   if(!result.changed)return {version:result.first.version,changed:false,...catalogState};
   tx.set(first,result.first);
   // Remove even the old ID from public metadata when visibility is revoked;
   // affected clients read the current bounded page, not a public tombstone.
   if(result.delta&&!revoking)tx.set(delta,result.delta);
   else tx.delete(delta);
   tx.set(signal,revoking?{version:result.first.version,previous:null,ids:[]}:result.signal);
   return {version:result.first.version,changed:true,...catalogState};
  });
 }
 const reconcile=()=>transact();
 function validateId(id){
  if(typeof id!=='string'||!/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(id))throw Error('home-source-id');
 }
 async function sourceRevision(id){
  validateId(id);
  return revision(await db.collection(INPUT).doc(id).get());
 }
 async function commitSource(id,replacement,{expectedRevision}={}){
  validateId(id);
  if(replacement!==null&&(!replacement||typeof replacement!=='object'||Object.getPrototypeOf(replacement)!==Object.prototype))throw Error('home-source-replacement');
  if(expectedRevision!==null&&(typeof expectedRevision!=='string'||!/^\d+:\d+$/.test(expectedRevision)))throw Error('home-source-revision');
  return transact({id,replacement,expectedRevision});
 }
 async function afterWrite({id,before,after}){
  const a=pinned?pinned(id,before):projectMirror(id,before),b=pinned?pinned(id,after):projectMirror(id,after);
  if(isDeepStrictEqual(a,b)&&b?.status!=='requires-canonical-backfill')return {changed:false,skippedSourceScan:true};
  // Events are invalidation hints only; never replay the stale before/after
  // payload into the current feed. Admin transaction reads committed authority.
  return reconcile();
 }
 return {afterWrite,reconcile,...(atomicSourcePublication?{sourceRevision,commitSource}:{}),...(catalog?{readCatalog:catalog.readCatalog,watchCatalogVersion:catalog.watchCatalogVersion}:{}),...(readTrustedLifecycle?{afterAuthoritativeWrite:reconcile}:{})};
}
module.exports={PROJECT,NAMESPACE,INPUT,PRIVATE_LIFECYCLE,makeLabWriter,projectMirror};
