(function(root){
  'use strict';
  // Read-only server adapter. It never calls the legacy all-events discovery.
  function create({sdk,db,session,reconstruct}){
    function assertOwner(context){
      const current=session();
      if(!context?.uid||context.uid!==current.uid||context.epoch!==current.epoch)throw Error('stale-session');
    }
    function serverSnapshot(snap){
      if(!snap||snap.metadata?.fromCache!==false||snap.metadata?.hasPendingWrites!==false)throw Error('server-snapshot-required');
      return snap;
    }
    async function get(ref,context){assertOwner(context);const snap=serverSnapshot(await sdk.getDocFromServer(ref));assertOwner(context);return snap;}
    async function readIndex(context){
      assertOwner(context);
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
      return {...after,memberships};
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
    return {readIndex,readRoom};
  }
  const api={create};
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root)root.BXHActiveEventsReader=api;
})(typeof window!=='undefined'?window:null);
