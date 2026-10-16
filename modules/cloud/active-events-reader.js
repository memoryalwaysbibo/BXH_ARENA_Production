(function(root){
  'use strict';
  // Read-only server adapter. It never calls the legacy all-events discovery.
  const DISPLAY_BUDGET_MS=20000;
  function create({sdk,db,session,reconstruct,monotonicNow=()=>performance.now()}){
    function assertOwner(context){
      const current=session();
      if(!context?.uid||context.uid!==current.uid||context.epoch!==current.epoch)throw Error('stale-session');
    }
    function serverSnapshot(snap){
      if(!snap||snap.metadata?.fromCache!==false||snap.metadata?.hasPendingWrites!==false)throw Error('server-snapshot-required');
      return snap;
    }
    async function get(ref,context){assertOwner(context);const snap=serverSnapshot(await sdk.getDocFromServer(ref));assertOwner(context);return snap;}
    function healthValue(data){
      const expiry=data?.leaseExpiresAt?.toMillis?.();
      if(data?.schemaVersion!==1||data.status!=='healthy'||typeof data.generation!=='string'||!data.generation||
        !Number.isSafeInteger(data.revision)||data.revision<0||!Number.isSafeInteger(data.sourceEpoch)||data.sourceEpoch<0||
        data.sourceEpoch!==data.projectedEpoch||typeof data.receiptHash!=='string'||!data.receiptHash||!Number.isFinite(expiry))throw Error('membership-health-unavailable');
      return {schemaVersion:1,status:'healthy',generation:data.generation,revision:data.revision,sourceEpoch:data.sourceEpoch,projectedEpoch:data.projectedEpoch,receiptHash:data.receiptHash,leaseExpiresAtMs:expiry};
    }
    async function readHealth(context){
      const started=monotonicNow();
      const snap=await get(sdk.doc(db,'activeTournamentMembershipHealth','current'),context);
      if(!snap.exists())throw Error('membership-health-missing');
      const health=healthValue(snap.data());
      // Candidate Rules reserve this full display budget beyond request.time.
      // Start before the request: network delay consumes, never extends, it.
      const displayDeadline=started+DISPLAY_BUDGET_MS;
      if(monotonicNow()>=displayDeadline)throw Error('membership-health-read-too-slow');
      return {health,displayDeadline};
    }
    function sameHealth(a,b){return a&&b&&['generation','revision','sourceEpoch','projectedEpoch','receiptHash','leaseExpiresAtMs'].every(k=>a[k]===b[k]);}
    async function verifyIndexHealth(index,context){
      const verified=await readHealth(context);
      if(!sameHealth(index.health,verified.health)||index.generation!==verified.health.generation||index.receiptHash!==verified.health.receiptHash||index.verifiedSourceEpoch!==verified.health.sourceEpoch)throw Error('membership-health-changed');
      return verified;
    }
    async function readIndex(context){
      assertOwner(context);
      const initialHealth=await readHealth(context);
      const stateRef=sdk.doc(db,'users',context.uid,'activeTournamentMembershipState','current');
      const beforeSnap=await get(stateRef,context);
      if(!beforeSnap.exists())return {schemaVersion:1,status:'pending'};
      const before=beforeSnap.data();
      if(before.schemaVersion!==1||before.status!=='ready')return before;
      if(typeof before.generation!=='string'||!before.generation||!Number.isSafeInteger(before.revision)||before.revision<0)throw Error('invalid-readiness');
      const query=sdk.query(sdk.collection(db,'users',context.uid,'activeTournamentMemberships'),sdk.limit(65));
      const members=serverSnapshot(await sdk.getDocsFromServer(query));assertOwner(context);
      const memberships=[];
      members.forEach(doc=>{
        const row=doc.data();
        if(row.code!==doc.id)throw Error('membership-code-mismatch');
        memberships.push(row);
      });
      if(memberships.length>64)throw Error('membership-overflow');
      const afterSnap=await get(stateRef,context),after=afterSnap.exists()?afterSnap.data():null;
      if(!after||after.schemaVersion!==1||after.status!=='ready'||before.generation!==after.generation||before.revision!==after.revision)throw Error('index-changed-during-read');
      const index={...after,memberships,health:initialHealth.health};
      await verifyIndexHealth(index,context);
      return index;
    }
    async function readRoom(code,context){
      if(typeof code!=='string'||!/^[A-Z0-9-]{4,40}$/.test(code))throw Error('invalid-room-code');
      const snap=await get(sdk.doc(db,'publicTournaments',code),context);
      if(!snap.exists())throw Error('public-room-missing');
      const data=snap.data();
      // Existing permission checks remain authoritative. Even if a privileged
      // account can read an unlisted mirror, this candidate does not expose it.
      if(data.visibility!=='public')throw Error('room-not-public');
      const parsedData=(data.bracketView||data.data)?reconstruct(code,data):null;
      assertOwner(context);
      return {...data,code,parsedData};
    }
    return {readIndex,readRoom,verifyIndexHealth};
  }
  const api={create,DISPLAY_BUDGET_MS};
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root)root.BXHActiveEventsReader=api;
})(typeof window!=='undefined'?window:null);
