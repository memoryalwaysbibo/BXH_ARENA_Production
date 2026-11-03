'use strict';
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const root=__dirname,original=path.join(root,'fixtures'),manifest=[];
const NOW=Date.parse('2026-11-03T00:00:00Z'),DAY=86400000,code='BXH-TEST01',uid='admin';
const clone=v=>v===undefined?undefined:JSON.parse(JSON.stringify(v));
function memory(){
 const s={id:'room',meta:{eventAuthority:'community',date:'2020-01-01',startTime:'12:00',checkinRequired:true,registrationStatus:'open'},players:[],matches:[],archiveStatus:'ongoing'};
 const t={eventAuthority:'community',createdBy:'host',tournamentPhase:'waiting',registrationEnabled:true,registrationStatus:'open',roomAccessMode:'public',roomAccessVersion:0,data:JSON.stringify(s)};
 const pub={eventAuthority:'community',tournamentPhase:'waiting',registrationEnabled:true,registrationRosterSyncBackendEnabled:true,bracketView:JSON.stringify(s)};
 const rows=new Map([['tournaments/'+code,t],['publicTournaments/'+code,pub],['users/'+uid,{active:true,role:'super_admin'}],['systemConfig/registrationRosterSync',{enabled:true,roomCodes:[code]}],['systemSettings/tournamentOperations',{enabled:true,enabledAt:NOW-3*DAY}],['systemSettings/releaseControls',{backgroundJobsEnabled:true}],['tournaments/'+code+'/registrations/r1',{uid:'u1',status:'confirmed',displayName:'Synthetic'}]]);
 let writes=0,roomWrites=0,registrationReads=0;const errors=[];
 function write(kind,p,data){writes++;if(/^(tournaments|publicTournaments)\/[^/]+$/.test(p))roomWrites++;if(kind==='delete')rows.delete(p);else rows.set(p,kind==='update'||kind==='merge'?{...rows.get(p),...clone(data)}:clone(data));}
 const ref=p=>({path:p,id:p.split('/').at(-1),get:async()=>snap(p),set:async(d,o)=>write(o?.merge?'merge':'set',p,d),collection:c=>query(p+'/'+c),delete:async()=>write('delete',p)});
 const snap=p=>({id:p.split('/').at(-1),ref:ref(p),exists:rows.has(p),data:()=>clone(rows.get(p)),updateTime:{toMillis:()=>NOW}});
 function query(p){let limit=Infinity,cursor='';const q={path:p,query:true,doc:d=>ref(p+'/'+d),limit(n){limit=n;return q;},orderBy(){return q;},startAfter(s){cursor=typeof s==='string'?s:s.id;return q;},get:async()=>{if(p.endsWith('/registrations'))registrationReads++;const docs=[...rows.keys()].filter(k=>k.startsWith(p+'/')&&!k.slice(p.length+1).includes('/')&&k.split('/').at(-1)>cursor).sort().slice(0,limit).map(snap);return {docs,size:docs.length};}};return q;}
 const db={doc:ref,collection:query,runTransaction:async cb=>{
  const pending=[];
  const tx={get:async r=>r.query?r.get():snap(r.path),update:(r,d)=>pending.push(['update',r.path,d]),set:(r,d,o)=>pending.push([o?.merge?'merge':'set',r.path,d]),create:(r,d)=>pending.push(['create',r.path,d]),delete:r=>pending.push(['delete',r.path])};
  const result=await cb(tx);for(const args of pending)write(...args);return result;
 }};
 return {db,rows,errors,get writes(){return writes;},get roomWrites(){return roomWrites;},get registrationReads(){return registrationReads;}};
}
function load(spec,patched,m,override){
 const base=path.join(original,'restore'),cache=new Map();let serial=0;
 class HttpsError extends Error{constructor(code,message){super(message);this.code=code;}}
 class FixedDate extends Date{static now(){return NOW;}}
 const sdk={getFirestore:()=>m.db,FieldValue:{delete:()=>({_delete:true}),serverTimestamp:()=>NOW},FieldPath:{documentId:()=> '__name__'}};
 function moduleAt(filename){
  if(cache.has(filename))return cache.get(filename).exports;
  const module={exports:{}};cache.set(filename,module);
  let actual=filename;
  if(patched&&filename===path.join(base,spec.path))actual=override||path.join(root,'candidate','restore',spec.path);
  function req(name){
   if(name==='firebase-admin/firestore'||name.endsWith('/_qr_checkin/admin-firestore.cjs')||name==='./_qr_checkin/admin-firestore.cjs')return sdk;
   if(name==='firebase-functions/v2/https')return {onCall:(_o,fn)=>fn,HttpsError};
   if(name==='firebase-functions/v2/firestore')return {onDocumentWritten:(_o,fn)=>fn};
   if(name==='firebase-functions/v2/scheduler')return {onSchedule:(_o,fn)=>fn};
   if(name==='node:crypto')return {...require(name),randomUUID:()=> 'test-uuid-'+(++serial)};
   if(name.startsWith('.')){
    const p=path.resolve(path.dirname(filename),name),resolved=[p,p+'.js',p+'.cjs'].find(p=>fs.existsSync(p)&&fs.statSync(p).isFile());
    if(!resolved||!resolved.startsWith(base+path.sep))throw Error('unexpected dependency '+name);
    return moduleAt(resolved);
   }
   return require(name);
  }
  const context={Date:FixedDate,Buffer,process:{env:{}},console:{log(){},warn:(...a)=>m.errors.push(a),error:(...a)=>m.errors.push(a)},setTimeout,clearTimeout};
  vm.runInNewContext('(function(require,module,exports){'+fs.readFileSync(actual,'utf8')+'\n})',context,{filename:actual})(req,module,module.exports);
  return module.exports;
 }
 return moduleAt(path.join(base,spec.path));
}
const request=data=>({auth:{uid},data:{code,...data}});
async function call(spec,mod,m,action){
 switch(spec.function){
  case 'roomAccess':return mod.createRoomAccessService(m.db,()=>NOW)(request({action:action||'configure',operationId:'operation-000001',mode:'public',password:'test-password'}));
  case 'syncRegistrationRoster':return mod.syncRegistrationRoster({data:{after:{}},params:{code}});
  case 'backfillRegistrationRoster':return mod.backfillRegistrationRoster(request({}));
  case 'closeIdleTournaments':return mod.closeIdleTournaments();
  case 'restoreIdleTournament':return mod.restoreIdleTournament(request({reason:'test reason'}));
 }
}
function restoration(m){
 const t=m.rows.get('tournaments/'+code),p=m.rows.get('publicTournaments/'+code),s=JSON.parse(t.data);
 Object.assign(t,{systemClosed:true,systemClosure:{reason:'idle-24h',label:'closed',closedAt:NOW-DAY,lastActivityAt:NOW-2*DAY}});
 p.systemClosed=true;s.archiveStatus='completed';t.data=JSON.stringify(s);p.bracketView=JSON.stringify(s);
 m.rows.set('tournamentActivity/'+code,{previous:{archiveStatus:'ongoing',completedAt:null,archivedAt:null,metaRegistrationStatus:'open',topPhase:'waiting',topRegistrationStatus:'open',publicRegistrationStatus:'open'}});
}
function closing(m,spec){
 const C=require(path.join(original,'restore','operations-core.js'));
 m.rows.set('tournamentActivity/'+code,{observedAt:NOW-3*DAY,lastAt:NOW-3*DAY,fingerprint:C.fingerprint(m.rows.get('tournaments/'+code))});
}
async function outcome(spec,patched,setup,action){
 const m=memory();if(spec.function==='restoreIdleTournament')restoration(m);if(spec.function==='closeIdleTournaments')closing(m,spec);
 if(setup)setup(m);
 let result,error;const mod=load(spec,patched,m);
 try{result=await call(spec,mod,m,action);}catch(e){error={message:e.message,code:e.code};}
 return {result:clone(result),error,writes:m.writes,roomWrites:m.roomWrites,registrationReads:m.registrationReads,errors:clone(m.errors),rows:clone([...m.rows].sort((a,b)=>a[0].localeCompare(b[0])))};
}
module.exports={load,memory,restoration,request};
