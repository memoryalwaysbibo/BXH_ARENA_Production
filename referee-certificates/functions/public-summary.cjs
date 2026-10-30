'use strict';
const D=require('./domain.cjs'),S=require('./sources.cjs'),R=require('./recognition.cjs');
// Separate read-only boundary. Never return private snapshots or persist a stale projection.
function createPublicSummary(db,{clock=Date.now,limits=D.LIMITS}={}){
  return async request=>{
    const targetUid=D.uid(request.data?.targetUid);
    return db.runTransaction(async tx=>{
      const [config,cert,user]=await Promise.all([tx.get(db.doc('systemConfig/refereeCertificatesV1')),tx.get(db.doc('refereeCertificates/'+targetUid)),tx.get(db.doc('users/'+targetUid))]);
      if(config.data()?.enabled!==true||config.data()?.publicSummaryEnabled!==true)D.fail('failed-precondition','public-summary-disabled');
      const p=cert.data();
      if(!/^R[0-9]{6,}$/.test(p?.number||'')||!D.RANKS.some(r=>r.level===p.awardedLevel)||!p.approvedBy||!p.personId)return {ok:true,summary:null};
      const status=p.qualificationStatus==='disabled'?'disabled':p.qualificationStatus==='active'?(p.expiresAt&&p.expiresAt<=clock()?'expired':'active'):'unverified';
      const source=await S.readSystemSources(tx,db,targetUid,limits);
      const ledger=await tx.get(db.collection('refereeCertificates/'+targetUid+'/records').limit(limits.backfills+1));
      const entries=ledger.docs.slice(0,limits.backfills).map(d=>({...d.data(),id:d.id}));
      await R.resolve(tx,db,targetUid,entries);
      const stats=D.aggregate(source,entries),partial=source.incomplete||ledger.docs.length>limits.backfills||entries.some(e=>e.recognitionReason==='recognition-room-limit');
      const experience=partial?null:{decisions:stats.decisions,eventCount:stats.eventCount,scales:stats.scales,milestones:stats.milestones,auxiliaryCount:stats.auxiliaryCount};
      return {ok:true,summary:{name:String(user.data()?.realName||'').slice(0,120),number:p.number,level:p.awardedLevel,status,experience}};
    });
  };
}
module.exports={createPublicSummary};
