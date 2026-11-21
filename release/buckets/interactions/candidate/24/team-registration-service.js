'use strict';
const {FieldValue}=require("./_qr_checkin/admin-firestore.cjs");
const {createHash}=require('node:crypto');
const Access=require('./room-access-core');
const Core=require('./team-registration-core');
const {assertLegacyRosterWritable}=require('./onsite-waitlist-writer-guards');

const hash=s=>createHash('sha256').update(String(s)).digest('hex');
const active=p=>p?.active===true&&!p.deleted&&!['deleted','disabled','frozen'].includes(p.accountStatus);
const ms=x=>x?.toMillis?x.toMillis():Number(x)||0;
function runtimeState(t){try{return typeof t.data==='string'?JSON.parse(t.data||'{}'):(t.data||{});}catch{return {};}}
function teamConfig(t,pub,s){
  const battleMode=t.battleMode||pub.battleMode||s.meta?.battleMode||'individual';
  const teamSize=Math.max(3,Number(t.teamSize||pub.teamSize||s.meta?.teamSize)||3);
  return {battleMode,teamSize};
}
function createTeamRegistration(db,clock=Date.now){return async req=>{
  const uid=req.auth?.uid,d=req.data||{},now=clock();
  if(!uid)throw Error('auth-required');
  const code=String(d.code||'').toUpperCase();
  if(!/^BXH-[A-Z0-9]{4,16}$/.test(code))throw Error('invalid-code');
  const userRef=db.doc('users/'+uid),tr=db.doc('tournaments/'+code),pr=db.doc('publicTournaments/'+code);
  const user=await userRef.get();
  if(!active(user.data()))throw Error('auth-required');

  if(d.action==='mine'){
    const snap=await tr.collection('registrations').doc(uid).get();
    if(!snap.exists)return {ok:true,rows:[]};
    const row={...snap.data(),registrationId:snap.id,createdAt:ms(snap.data().createdAt)};
    return {ok:true,rows:row.registrationKind==='team'?[row]:[]};
  }

  if(!['preview','join','cancel'].includes(d.action))throw Error('invalid-operation');
  if(d.action!=='preview'&&!/^[a-zA-Z0-9_-]{8,100}$/.test(d.operationId||''))throw Error('invalid-operation');

  return db.runTransaction(async tx=>{
    const actionRef=userRef.collection('teamRegistrationActions').doc(hash(d.operationId||('preview:'+code)));
    const [ts,ps,us,prior]=await Promise.all([tx.get(tr),tx.get(pr),tx.get(userRef),tx.get(actionRef)]);
    if(!active(us.data()))throw Error('auth-required');
    if(!ts.exists||!ps.exists)throw Error('not-found');
    const t=ts.data(),pub=ps.data(),u=us.data();
    if([t,pub].some(x=>x&&['scoreStorage','scoreBucketProjection','bucketMigration','deletionStatus'].some(k=>Object.prototype.hasOwnProperty.call(x,k))))throw Error('bucket-scoring-required');
    const s=runtimeState(t),cfg=teamConfig(t,pub,s);
    assertLegacyRosterWritable(t,pub,s);
    if(cfg.battleMode!=='team')throw Error('team-mode-required');

    if(['preview','join'].includes(d.action)&&Access.normalizeMode(t.roomAccessMode)==='password'&&!Access.canBypass(uid,u,t)){
      const grant=await tx.get(tr.collection('accessGrants').doc(uid));
      if(!Access.grantValid(grant.data(),t,now))throw Error('room-password-required');
    }
    const requestHash=hash(JSON.stringify(d));
    if(d.action!=='preview'&&prior.exists){
      if(prior.data().requestHash!==requestHash)throw Error('operation-conflict');
      return {...prior.data().result,ok:true,replayed:true};
    }
    if(t.registrationSelection||pub.registrationSelection)throw Error('team-lottery-unavailable');
    if(t.systemClosed||t.eventCancelled||s.meta?.eventCancelled||s.startedAt||s.archiveStatus==='completed'||t.archiveStatus==='completed'||t.tournamentPhase!=='waiting')throw Error('tournament-started');
    if(Number(pub.confirmedCount||0)!==Number(t.confirmedCount||0)||Number(pub.waitlistCount||0)!==Number(t.waitlistCount||0))throw Error('registration-state-conflict');

    const regRef=tr.collection('registrations').doc(uid);
    const regSnap=await tx.get(regRef);
    const existing=regSnap.data();

    if(d.action==='cancel'){
      if(!existing||existing.registrationKind!=='team')throw Error('not-registered');
      if(!ms(t.cancellationDeadline)||now>=ms(t.cancellationDeadline))throw Error('cancel-deadline-passed');
      const result={ok:true,teamId:existing.teamId||null};
      if(existing.status!=='cancelled'){
        if(!['confirmed','waitlist'].includes(existing.status))throw Error('nothing-to-cancel');
        const field=existing.status==='confirmed'?'confirmedCount':'waitlistCount';
        if(Number(t[field]||0)<1)throw Error('registration-state-conflict');
        tx.update(regRef,{status:'cancelled',cancelledAt:FieldValue.serverTimestamp(),cancelledBy:uid,updatedAt:FieldValue.serverTimestamp()});
        tx.update(tr,{[field]:FieldValue.increment(-1),updatedAt:now});
        tx.update(pr,{[field]:FieldValue.increment(-1),updatedAt:now});
      }
      tx.create(actionRef,{action:'cancel',actorUid:uid,code,requestHash,result,createdAt:now});
      return result;
    }

    if(t.registrationEnabled!==true||pub.registrationEnabled!==true||t.visibility!=='public'||t.registrationVisibility!=='public'||pub.registrationVisibility!=='public'||!t.publishedAt)throw Error('not-enabled');
    if(now<ms(t.registrationOpenAt)||!ms(t.registrationOpenAt))throw Error('not-open-yet');
    if(now>=ms(t.registrationCloseAt))throw Error('closed');
    if(!u.realName||typeof u.phone!=='string'||!(u.profileCompleted||['staff','admin','super_admin','tester'].includes(u.role)))throw Error('profile-incomplete');
    if(existing&&existing.status!=='cancelled')throw Error('already-registered');

    const teamName=Core.normalizeTeamName(d.teamName);
    const members=Core.normalizeTeamMembers(d.members,cfg.teamSize);
    const allocation=Core.allocateTeamStatus({
      confirmedCount:t.confirmedCount,capacity:t.capacity,
      waitlistCount:t.waitlistCount,waitlistEnabled:t.waitlistEnabled,waitlistCapacity:t.waitlistCapacity
    });
    const teamId=Core.teamIdFor(code,uid);
    const teamMembers=members.map(m=>({slot:m.slot,name:m.name,playerId:Core.teamMemberPlayerId(teamId,m.slot)}));
    const preview={ok:true,status:allocation.status,teamId,teamName,teamSize:cfg.teamSize,teamMembers};
    if(d.action==='preview')return preview;

    const reg={
      uid,tournamentCode:code,registrationKind:'team',teamId,teamName,teamSize:cfg.teamSize,teamMembers,
      captainUid:uid,captainName:u.realName,captainDisplayName:u.displayName||u.nickname||u.realName,
      phone:u.phone||'',email:u.email||null,status:allocation.status,source:'player',
      displayName:teamName,publicName:teamName,
      createdAt:FieldValue.serverTimestamp(),updatedAt:FieldValue.serverTimestamp(),
      cancelledAt:null,cancelledBy:null,promotedAt:null,promotedBy:null,registrationVersion:1
    };
    tx.set(regRef,reg);
    tx.update(tr,{confirmedCount:allocation.confirmedCount,waitlistCount:allocation.waitlistCount,updatedAt:now});
    tx.update(pr,{confirmedCount:allocation.confirmedCount,waitlistCount:allocation.waitlistCount,updatedAt:now});
    const result={ok:true,status:allocation.status,teamId,teamName,teamSize:cfg.teamSize,teamMembers};
    tx.create(actionRef,{action:'join',actorUid:uid,code,requestHash,result,createdAt:now});
    return result;
  });
};}
module.exports={createTeamRegistration,teamConfig};
