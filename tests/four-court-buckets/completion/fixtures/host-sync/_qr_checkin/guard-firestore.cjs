'use strict';
const {advance}=require('./qr-checkin-fence.cjs');
const mark=Symbol('qr-checkin-guarded-db');
const fail=message=>{throw Error(message);};
const roomPath=ref=>typeof ref?.path==='string'&&/^(tournaments|publicTournaments)\/[^/]+$/.test(ref.path)?ref.path:null;
function parse(value){try{return typeof value==='string'?JSON.parse(value):value;}catch{fail('qr-checkin-state-corrupt');}}
function guardFirestore(db){
 if(db[mark])return db;
 return new Proxy(db,{get(target,key){
  if(key===mark)return true;
  if(key!=='runTransaction'){const value=Reflect.get(target,key,target);return typeof value==='function'?value.bind(target):value;}
  return (callback,...options)=>target.runTransaction(async native=>{
   const snapshots=new Map(),plans=new Map();let tx;
   const remember=snap=>{if(snap?.ref?.path&&typeof snap.data==='function')snapshots.set(snap.ref.path,snap);};
   function transform(method,args){
    const [ref,patch]=args,path=roomPath(ref);
    if(!path||!patch||typeof patch!=='object')return args;
    const [collection,code]=path.split('/');
    if(collection==='tournaments'&&typeof patch.data==='string'){
     const snapshot=snapshots.get(path);
     if(!snapshot)fail('qr-checkin-transaction-read-required');
     const before=snapshot.data()||{};
     if(before.qrCheckinManaged!==true)return args;
     const peer=snapshots.get('publicTournaments/'+code)?.data();
     if(!peer||peer.qrCheckinManaged!==true||peer.qrCheckinRevision!==before.qrCheckinRevision)fail('qr-checkin-mirror-stale');
     const next=parse(patch.data);next.qrCheckinManaged=true;
     const fields=advance(before,next,before.qrCheckinRevision);
     plans.set(code,{before,peer,next,fields,mirrored:false});
     return [ref,{...patch,...fields,qrCheckin:before.qrCheckin,data:JSON.stringify(next)},...args.slice(2)];
    }
    if(collection==='publicTournaments'&&plans.has(code)){
     const plan=plans.get(code),view=parse(patch.bracketView===undefined?plan.peer.bracketView:patch.bracketView);
     if(!view||typeof view!=='object'||Array.isArray(view))fail('qr-checkin-mirror-corrupt');
     view.players=plan.next.players.map(p=>({id:p.id,name:p.name||'',checkedIn:p.checkedIn===true}));
     plan.mirrored=true;
     return [ref,{...patch,...plan.fields,bracketView:JSON.stringify(view)},...args.slice(2)];
    }
    // A public-only projection must not silently erase server attendance.
    // Metadata-only writes remain compatible with existing services.
    if(collection==='publicTournaments'&&typeof patch.bracketView==='string'){
     const snapshot=snapshots.get(path);
     if(!snapshot)fail('qr-checkin-transaction-read-required');
     if(snapshot.data()?.qrCheckinManaged===true)fail('qr-checkin-paired-write-required');
    }
    return args;
   }
   tx=new Proxy(native,{get(transaction,method){
    if(method==='get')return async(...args)=>{const result=await transaction.get(...args);remember(result);return result;};
    if(method==='getAll')return async(...args)=>{const result=await transaction.getAll(...args);result.forEach(remember);return result;};
    if(method==='delete')return(ref,...args)=>{
     const path=roomPath(ref);
     if(path){
      const snapshot=snapshots.get(path);
      if(!snapshot)fail('qr-checkin-transaction-read-required');
      if(snapshot.data()?.qrCheckinManaged===true)fail('qr-checkin-audited-delete-required');
     }
     transaction.delete(ref,...args);return tx;
    };
    if(['update','set','create'].includes(method))return(...args)=>{transaction[method](...transform(method,args));return tx;};
    const value=Reflect.get(transaction,method,transaction);return typeof value==='function'?value.bind(transaction):value;
   }});
   const result=await callback(tx);
   for(const plan of plans.values()){
    if(!plan.mirrored)fail('qr-checkin-paired-write-required');
    // Responses retain their existing shape; never add private fields to a
    // public result. Only refresh the attendance/revision fields already owned
    // by this transaction in returned full roster snapshots.
    for(const value of [result?.state,result?.canonicalState])if(Array.isArray(value?.players)){
     value.qrCheckinManaged=true;value.qrCheckinRevision=plan.next.qrCheckinRevision;
     const byId=new Map(plan.next.players.map(p=>[p.id,p]));
     for(const p of value.players){const canonical=byId.get(p.id);if(!canonical)continue;
      p.checkedIn=canonical.checkedIn;
      for(const name of ['checkinAt','checkinFirstAt','checkinMethod'])if(Object.prototype.hasOwnProperty.call(canonical,name))p[name]=canonical[name];else delete p[name];
     }
    }
   }
   return result;
  },...options);
 }});
}
module.exports={guardFirestore};
