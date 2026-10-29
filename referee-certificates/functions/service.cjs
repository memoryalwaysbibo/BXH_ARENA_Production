'use strict';
const D=require('./domain.cjs'), S=require('./sources.cjs');

const MUTATIONS=new Set(['saveBackfill','revokeBackfill','restoreBackfill','grant','setChief','photo']);
const ROOT='refereeCertificates';
const SYSTEM='refereeCertificateSystem';
function profileName(user) {return {realName:String(user.realName||'').slice(0,120),nickname:String(user.nickname||user.gameId||user.displayName||'').slice(0,120)};}
function searchPerson(uid,user) {return {uid,...profileName(user),active:D.active(user),accountStatus:typeof user.accountStatus==='string'?user.accountStatus.slice(0,40):null};}
function revisionOf(value) {return D.integer(value??0,'stored-revision');}
function normalizedRequest(request) {
  if(!request.auth?.uid) D.fail('unauthenticated','auth-required');
  const actorUid=D.uid(request.auth.uid),data=request.data;
  if(!data||typeof data!=='object'||Array.isArray(data)) D.fail('invalid-argument','request-invalid');
  const action=data.action;
  if(!['get','search',...MUTATIONS].includes(action)) D.fail('invalid-argument','action-invalid');
  if(action==='search') return {action,actorUid,query:D.text(data.query,'query',80,true)};
  const out={action,actorUid,targetUid:data.targetUid==null?actorUid:D.uid(data.targetUid)};
  if(!MUTATIONS.has(action)) return out;
  if(typeof data.operationId!=='string'||! /^[A-Za-z0-9_-]{8,128}$/.test(data.operationId)) D.fail('invalid-argument','operation-id-invalid');
  Object.assign(out,{operationId:data.operationId,expectedRevision:D.integer(data.expectedRevision,'expected-revision')});
  if(action==='saveBackfill') out.entry={...D.normalizeBackfill(data.entry),...(data.entry.id?{id:D.entryId(data.entry.id)}:{})};
  if(action==='revokeBackfill'||action==='restoreBackfill') out.entryId=D.entryId(data.entryId);
  if(action==='grant') {
    out.level=D.integer(data.level,'level',9);
    if(out.level<2) D.fail('invalid-argument','grant-level-must-be-2-to-9');
  }
  if(action==='setChief') {
    if(typeof data.appointed!=='boolean') D.fail('invalid-argument','appointed-invalid');
    out.appointed=data.appointed;out.expectedChiefRevision=D.integer(data.expectedChiefRevision,'expected-chief-revision');
  }
  if(action==='photo') out.dataUrl=D.normalizePhoto(data.dataUrl);
  return out;
}
function cleanRecord(row,id) {
  if(!['active','revoked'].includes(row.status)) D.fail('failed-precondition','stored-backfill-invalid');
  return {id,...D.normalizeBackfill(row),revision:revisionOf(row.revision),status:row.status,
    updatedBy:String(row.updatedBy||''),updatedAt:Number(row.updatedAt)||null,createdAt:Number(row.createdAt)||null,
    source:'official-memory-estimate'};
}
async function readEntries(tx,db,targetUid,limits) {
  const [rows,audits]=await Promise.all([
    tx.get(db.collection(ROOT+'/'+targetUid+'/records').limit(limits.backfills+1)),
    tx.get(db.collection(ROOT+'/'+targetUid+'/audit').orderBy('revision','desc').limit(limits.auditHistory+1))
  ]);
  const incomplete=rows.docs.length>limits.backfills;
  const entries=rows.docs.slice(0,limits.backfills).map(doc=>cleanRecord(doc.data(),doc.id));
  const history=audits.docs.slice(0,limits.auditHistory).map(doc=>({...doc.data(),id:doc.id}));
  return {entries,history,incomplete,entriesIncomplete:incomplete,historyTruncated:audits.docs.length>limits.auditHistory,
    incompleteReasons:incomplete?['backfills-limit']:[]};
}
function historyFor(id,history) {
  return history.filter(item=>item.entryId===id).sort((a,b)=>Number(a.revision)-Number(b.revision)).map(item=>({
    action:item.action,revision:item.revision,updatedBy:item.updatedBy,updatedAt:item.updatedAt,before:item.before||null,after:item.after||null
  }));
}
function snapshotOf(context) {
  const {targetUid,user,profile,chief,entries,history,source,incomplete,incompleteReasons,historyTruncated}=context;
  const stats=D.aggregate(source,entries),awardedLevel=Number(profile.awardedLevel)||0;
  const certificate=profile.number?{number:profile.number,awardedLevel,issuedAt:profile.issuedAt||null,photoDataUrl:profile.photoDataUrl||null,
    isChief:chief.uid===targetUid,revision:revisionOf(profile.revision)}:null;
  return {uid:targetUid,person:profileName(user),certificate,photoDataUrl:profile.photoDataUrl||null,revision:revisionOf(profile.revision),stats,eligibleLevel:D.eligibleLevel(stats),
    ranks:D.RANKS,milestoneDefinitions:D.MILESTONES,backfills:entries.map(entry=>({...entry,history:historyFor(entry.id,history)})),
    systemRecords:source.systemRecords,chiefRevision:revisionOf(chief.revision),isChief:chief.uid===targetUid,incomplete,
    incompleteReasons:[...new Set(incompleteReasons)],historyTruncated:!!historyTruncated};
}
async function searchUsers(tx,db,query,limit) {
  const items=new Map();
  const fields=['realName','nickname','gameId','displayName'];
  const snapshots=await Promise.all(fields.map(field=>tx.get(db.collection('users').where(field,'>=',query).where(field,'<=',query+'\uf8ff').limit(limit+1))));
  let incomplete=false;
  snapshots.forEach(snapshot=>{
    if(snapshot.docs.length>limit) incomplete=true;
    snapshot.docs.slice(0,limit).forEach(doc=>{const p=doc.data();if(p.role!=='tester'&&p.isTestAccount!==true&&p.deleted!==true)items.set(doc.id,searchPerson(doc.id,p));});
  });
  if(/^[A-Za-z0-9_-]{1,128}$/.test(query)) {
    const snap=await tx.get(db.doc('users/'+query));
    // Exact UID also exposes historical inactive/test targets to an authorized administrator for revocation.
    if(snap.exists)items.set(snap.id,searchPerson(snap.id,snap.data()));
  }
  return {ok:true,items:[...items.values()].slice(0,limit),incomplete:incomplete||items.size>limit};
}

function createService(db,{clock=Date.now,limits:overrides={}}={}) {
  const limits={...D.LIMITS,...overrides};
  for(const [key,value] of Object.entries(limits)) if(!Number.isSafeInteger(value)||value<1) throw Error('invalid-limit:'+key);
  return async function refereeCertificateService(request) {
    const input=normalizedRequest(request),{actorUid,action}=input;
    return db.runTransaction(async tx=>{
      const [actorSnap,configSnap]=await Promise.all([tx.get(db.doc('users/'+actorUid)),tx.get(db.doc('systemConfig/refereeCertificatesV1'))]);
      const actor=actorSnap.exists?actorSnap.data():null;
      if(!D.active(actor)) D.fail('permission-denied','active-nontest-account-required');
      if(configSnap.data()?.enabled!==true) D.fail('failed-precondition','referee-certificates-disabled');
      if(action==='search') {
        if(!D.superAdmin(actor)) D.fail('permission-denied','super-admin-required');
        return searchUsers(tx,db,input.query,limits.searchPerField);
      }
      const {targetUid}=input,superActor=D.superAdmin(actor),mutating=MUTATIONS.has(action);
      if(action==='get'&&targetUid!==actorUid&&!superActor) D.fail('permission-denied','self-only');
      if(mutating&&!(action==='photo'&&targetUid===actorUid)&&!superActor) D.fail('permission-denied','super-admin-required');
      const profileRef=db.doc(ROOT+'/'+targetUid),chiefRef=db.doc(SYSTEM+'/chief'),numberRef=db.doc(SYSTEM+'/numbering');
      // One receipt namespace per actor prevents reusing an operation id against a different target/action.
      const operationKey=mutating?D.hash(actorUid+':'+input.operationId):null;
      const receiptRef=mutating?db.doc('refereeCertificateOperations/'+operationKey):null;
      const [targetSnap,profileSnap,chiefSnap,numberSnap,receiptSnap]=await Promise.all([
        targetUid===actorUid?Promise.resolve(actorSnap):tx.get(db.doc('users/'+targetUid)),
        tx.get(profileRef),tx.get(chiefRef),tx.get(numberRef),receiptRef?tx.get(receiptRef):Promise.resolve(null)
      ]);
      if(!targetSnap.exists) D.fail('not-found','target-not-found');
      const user=targetSnap.data(),oldProfile=profileSnap.exists?profileSnap.data():{},oldChief=chiefSnap.exists?chiefSnap.data():{uid:null,revision:0};
      const oldRevision=revisionOf(oldProfile.revision),chiefRevision=revisionOf(oldChief.revision);
      const payloadHash=mutating?D.hash(input):null;
      const replay=!!receiptSnap?.exists;
      // Always verify live authorization above, but deduplicate before checking the old expected revision.
      if(replay&&receiptSnap.data().payloadHash!==payloadHash) D.fail('already-exists','operation-conflict');
      if(mutating&&!replay&&input.expectedRevision!==oldRevision) D.fail('aborted','revision-conflict');
      if(action==='setChief'&&!replay&&input.expectedChiefRevision!==chiefRevision) D.fail('aborted','chief-revision-conflict');
      const correctiveAction=action==='revokeBackfill'||(action==='setChief'&&input.appointed===false);
      if(mutating&&!replay&&!correctiveAction&&(user.role==='tester'||user.isTestAccount===true)) D.fail('failed-precondition','target-test-account');
      if(action==='setChief'&&!replay&&input.appointed&&!D.active(user)) D.fail('failed-precondition','chief-target-inactive');
      const [ledger,source]=await Promise.all([readEntries(tx,db,targetUid,limits),S.readSystemSources(tx,db,targetUid,limits)]);
      const incomplete=ledger.incomplete||source.incomplete,incompleteReasons=[...ledger.incompleteReasons,...source.incompleteReasons];
      const context={targetUid,user,profile:{...oldProfile,revision:oldRevision},chief:{...oldChief,revision:chiefRevision},entries:ledger.entries,
        history:ledger.history,historyTruncated:ledger.historyTruncated,source,incomplete,incompleteReasons};
      if(replay) return {ok:true,snapshot:snapshotOf(context),replayed:true};

      const now=clock();
      if(!Number.isFinite(now)||now<=0) D.fail('internal','clock-invalid');
      let changed=false,entryWrite=null,audit=null,chiefChanged=false,numberChanged=false;
      const nextRevision=oldRevision+1;
      D.integer(nextRevision,'next-revision');
      if(mutating) {
        if(ledger.entriesIncomplete&&['saveBackfill','revokeBackfill','restoreBackfill'].includes(action)) D.fail('failed-precondition','ledger-incomplete');
        changed=true;
        audit={action,uid:targetUid,updatedBy:actorUid,updatedAt:now,revision:nextRevision};
        if(action==='saveBackfill') {
          const id=input.entry.id||'bf_'+operationKey.slice(0,32);
          const previous=context.entries.find(row=>row.id===id);
          if(input.entry.id&&!previous) D.fail('not-found','backfill-not-found');
          if(!previous&&context.entries.length>=limits.backfills) D.fail('failed-precondition','backfill-limit-reached');
          if(previous?.status==='revoked') D.fail('failed-precondition','restore-before-edit');
          const row={id,...D.normalizeBackfill(input.entry),status:'active',revision:previous?previous.revision+1:1,
            createdAt:previous?.createdAt||now,updatedAt:now,updatedBy:actorUid,source:'official-memory-estimate'};
          context.entries=previous?context.entries.map(entry=>entry.id===id?row:entry):context.entries.concat(row);
          entryWrite=row;Object.assign(audit,{entryId:id,before:previous||null,after:row});
        } else if(action==='revokeBackfill'||action==='restoreBackfill') {
          const previous=context.entries.find(row=>row.id===input.entryId);
          if(!previous) D.fail('not-found','backfill-not-found');
          const status=action==='revokeBackfill'?'revoked':'active';
          if(previous.status===status) D.fail('failed-precondition','backfill-already-'+status);
          const row={...previous,status,revision:previous.revision+1,updatedBy:actorUid,updatedAt:now};
          context.entries=context.entries.map(entry=>entry.id===row.id?row:entry);entryWrite=row;
          Object.assign(audit,{entryId:row.id,before:previous,after:row});
        } else if(action==='photo') {
          const previous=context.profile.photoDataUrl||null;
          context.profile.photoDataUrl=input.dataUrl;
          Object.assign(audit,{beforePhotoHash:previous?D.hash(previous):null,afterPhotoHash:input.dataUrl?D.hash(input.dataUrl):null,
            photoDataUrlLength:input.dataUrl?.length||0});
        } else if(action==='setChief') {
          if(!input.appointed&&oldChief.uid!==targetUid) D.fail('failed-precondition','target-is-not-chief');
          context.chief={uid:input.appointed?targetUid:null,revision:chiefRevision+1,updatedBy:actorUid,updatedAt:now};
          chiefChanged=true;Object.assign(audit,{previousChiefUid:oldChief.uid||null,chiefUid:context.chief.uid,chiefRevision:context.chief.revision});
        }
      }
      const stats=D.aggregate(source,context.entries),eligible=D.eligibleLevel(stats);
      if(action==='grant') {
        if(incomplete) D.fail('failed-precondition','sources-incomplete');
        if(input.level>eligible) D.fail('failed-precondition','rank-not-eligible');
        if(input.level<=Number(oldProfile.awardedLevel||0)) D.fail('failed-precondition','rank-not-higher');
        context.profile.awardedLevel=input.level;
        context.profile.awardedAt=now;context.profile.awardedBy=actorUid;
        Object.assign(audit,{fromLevel:Number(oldProfile.awardedLevel)||0,toLevel:input.level});
      }
      // Initial issuance is the only automatic award. Partial source reads never issue a certificate.
      if(!context.profile.number&&stats.decisions>=1&&!incomplete&&user.role!=='tester'&&user.isTestAccount!==true) {
        const last=D.integer(numberSnap.data()?.lastIssuedNumber??0,'number-counter');
        const next=D.add(last,1);
        context.profile.number='R'+String(next).padStart(6,'0');
        context.profile.issuedAt=now;context.profile.awardedLevel=Math.max(1,Number(context.profile.awardedLevel)||0);
        context.profile.awardedAt=context.profile.awardedAt||now;context.profile.awardedBy=context.profile.awardedBy||'system:L1';
        numberChanged=true;changed=true;context.nextNumber=next;
        if(!audit) audit={action:'autoIssueL1',uid:targetUid,updatedBy:'system:L1',updatedAt:now,revision:nextRevision,toLevel:1};
        audit.issuedNumber=context.profile.number;
      }
      if(changed) {
        context.profile.revision=nextRevision;context.profile.updatedAt=now;context.profile.updatedBy=actorUid;
        const auditKey=operationKey||'auto_'+D.hash(targetUid+':'+context.profile.number);
        context.history=context.history.concat({...audit,id:auditKey});
        if(context.history.length>limits.auditHistory) {
          context.history=context.history.sort((a,b)=>Number(b.revision)-Number(a.revision)).slice(0,limits.auditHistory);
          context.historyTruncated=true;
        }
        // All reads have completed. Profiles, backfills, receipts, and global uniqueness commit atomically.
        tx.set(profileRef,context.profile);
        if(entryWrite) tx.set(db.doc(ROOT+'/'+targetUid+'/records/'+entryWrite.id),entryWrite);
        if(chiefChanged) {
          tx.set(chiefRef,context.chief);
          tx.create(db.doc(SYSTEM+'/chief/audit/'+operationKey),{action:'setChief',previousUid:oldChief.uid||null,uid:context.chief.uid,
            revision:context.chief.revision,updatedBy:actorUid,updatedAt:now});
        }
        if(numberChanged) tx.set(numberRef,{lastIssuedNumber:context.nextNumber,updatedAt:now});
        tx.create(db.doc(ROOT+'/'+targetUid+'/audit/'+auditKey),audit);
        if(mutating) tx.create(receiptRef,{actorUid,targetUid,action,payloadHash,revision:nextRevision,createdAt:now});
      }
      return {ok:true,snapshot:snapshotOf(context)};
    });
  };
}

module.exports={createService,normalizedRequest,snapshotOf,profileName,ROOT,SYSTEM};
