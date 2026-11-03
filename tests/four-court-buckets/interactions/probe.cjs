'use strict';
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const root=__dirname,original=path.join(root,'fixtures'),specs=JSON.parse(fs.readFileSync(path.resolve(root,'../../../release/buckets/interactions/patch-manifest.json'))).patches;
const NOW=1900000000000,code='BXH-TEST01',uid='admin',clone=x=>x===undefined?undefined:JSON.parse(JSON.stringify(x));
const factories={familyRegistration:'createFamilyRegistration',teamRegistration:'createTeamRegistration',teamScoring:'createTeamScoringService',teamLineup:'createTeamLineupService',courtCallService:'createCourtCallService',enchantmentService:'createEnchantmentService'};
function memory(){
 const rows=new Map(),versions=new Map(),writes=[];let interfere;let serial=0;
 const put=(p,d)=>{rows.set(p,clone(d));versions.set(p,++serial);};
 const snapshot=p=>({id:p.split('/').at(-1),ref:ref(p),exists:rows.has(p),data:()=>clone(rows.get(p)),createTime:{seconds:10,nanoseconds:0},updateTime:{seconds:11,nanoseconds:0}});
 const ref=p=>({path:p,id:p.split('/').at(-1),collection:c=>query(p+'/'+c),get:async()=>snapshot(p)});
 function query(p){let maximum=Infinity;const filters=[];const q={query:true,path:p,doc:id=>ref(p+'/'+id),where(...f){filters.push(f);return q;},limit(n){maximum=n;return q;},orderBy(){return q;},get:async()=>{const docs=[...rows.keys()].filter(k=>k.startsWith(p+'/')&&!k.slice(p.length+1).includes('/')&&filters.every(([f,op,v])=>op==='=='&&rows.get(k)[f]===v)).slice(0,maximum).map(snapshot);return {docs,size:docs.length,empty:!docs.length};}};return q;}
 function apply(kind,p,value,options){if(kind==='create')assert(!rows.has(p));writes.push({kind,path:p,value:clone(value),options:clone(options)});if(kind==='delete'){rows.delete(p);versions.set(p,++serial);return;}const next=kind==='update'||options?.merge?{...rows.get(p)}:{};for(const [k,v]of Object.entries(value)){if(v&&v.__increment!==undefined)next[k]=Number(next[k]||0)+v.__increment;else next[k]=clone(v);}put(p,next);}
 const db={doc:ref,collection:query,runTransaction:async cb=>{for(let attempt=0;attempt<4;attempt++){
  const reads=new Map(),pending=[];const get=async r=>{assert.equal(pending.length,0,'read after write');if(r.query)return r.get();reads.set(r.path,versions.get(r.path)||0);return snapshot(r.path);};
  const tx={get,getAll:(...refs)=>Promise.all(refs.map(get)),set:(r,d,o)=>pending.push(['set',r.path,d,o]),update:(r,d)=>pending.push(['update',r.path,d]),create:(r,d)=>pending.push(['create',r.path,d]),delete:r=>pending.push(['delete',r.path])};
  const result=await cb(tx);if(interfere&&pending.length){const fn=interfere;interfere=null;fn();}
  if([...reads].some(([p,v])=>(versions.get(p)||0)!==v))continue;pending.forEach(args=>apply(...args));return result;
 }throw Error('retry exhausted');}};
 return {db,rows,put,writes,set interfere(x){interfere=x;}};
}
function load(spec,patched,m){
 const base=path.join(original,String(spec.sourceSet)),cache=new Map();class FixedDate extends Date{static now(){return NOW;}}
 const sdk={FieldValue:{serverTimestamp:()=>NOW,increment:n=>({__increment:n}),delete:()=>({__delete:true})}};
 function moduleAt(filename){if(cache.has(filename))return cache.get(filename).exports;const module={exports:{}};cache.set(filename,module);const actual=patched&&filename===path.join(base,spec.path)?path.resolve(root,'../../../release/buckets/interactions/candidate',String(spec.sourceSet),spec.path):filename;
  function req(n){if(n==='./_qr_checkin/admin-firestore.cjs'||n==='firebase-admin/firestore')return sdk;if(n==='node:crypto')return {...require(n),randomInt:()=>0,randomUUID:()=> 'synthetic-operation-id'};if(n.startsWith('.')){const p=path.resolve(path.dirname(filename),n),resolved=[p,p+'.js',p+'.cjs'].find(x=>fs.existsSync(x));if(!resolved||!resolved.startsWith(base+path.sep))throw Error('unexpected dependency '+n);return moduleAt(resolved);}return require(n);}
  vm.runInNewContext('(function(require,module,exports){'+fs.readFileSync(actual,'utf8')+'\n})',{Date:FixedDate,structuredClone,Buffer,process:{env:{GCLOUD_PROJECT:'bxh-arena'}},console},{filename:actual})(req,module,module.exports);return module.exports;
 }
 return moduleAt(path.join(base,spec.path))[factories[spec.function]](m.db,()=>NOW);
}
function fixture(spec){
 const m=memory(),players=[{id:'p1',name:'One',registrationUid:'u1'},{id:'p2',name:'Two',registrationUid:'u2'}];
 const teams=[{id:'t1',captainUid:'admin',memberPlayerIds:['a','b','c']},{id:'t2',captainUid:'u2',memberPlayerIds:['d','e','f']}];
 const match={id:'m1',a:{playerId:'p1'},b:{playerId:'p2'},teamIds:['t1','t2'],station:1,round:1,indexInRound:0,seq:1,bracket:'SE',status:'pending',completed:false,isBye:false,scoreA:0,scoreB:0,dispatchRevision:0};
 const state={id:'room',meta:{eventAuthority:'official',battleMode:'team',formatType:'single',ladderMode:'general',playMode:'enchantment',enchantmentPilot:true,bronzeMatch:false},players,teams,matches:[match],startedAt:NOW-1000,archiveStatus:'ongoing',courtAssignments:{court1:{currentMatchId:'m1',nextMatchId:null,status:'in_progress'}}};
 if(['familyRegistration','teamRegistration'].includes(spec.function)){state.startedAt=null;state.matches=[];}
 if(spec.function==='familyRegistration')state.meta.battleMode='individual';
 const t={createdBy:uid,ownerUid:uid,eventAuthority:'official',data:JSON.stringify(state),tournamentPhase:'waiting',registrationEnabled:true,registrationVisibility:'public',visibility:'public',publishedAt:NOW-10000,registrationOpenAt:NOW-10000,registrationCloseAt:NOW+100000,cancellationDeadline:NOW+100000,capacity:12,confirmedCount:0,waitlistCount:0};
 const pub={bracketView:JSON.stringify(state),registrationEnabled:true,registrationVisibility:'public',confirmedCount:0,waitlistCount:0};
 m.put('users/'+uid,{active:true,role:'super_admin',realName:'Synthetic',phone:'0900000000',profileCompleted:true});m.put('tournaments/'+code,t);m.put('publicTournaments/'+code,pub);m.put('familyPlayers/'+uid,{profiles:[]});
 let d={code,operationId:'operation-000001',action:'join'};
 if(spec.function==='teamRegistration')Object.assign(d,{teamName:'Team Synthetic',members:['One','Two','Three']});
 if(spec.function==='teamScoring'){
  Object.assign(d,{action:'score',matchId:'m1',winnerSide:0,finish:'extreme'});
  m.put('tournaments/'+code+'/teamLineups/m1',{teamIds:['t1','t2'],lineups:{t1:['a','b','c'],t2:['d','e','f']},lineupsRevealed:true});
  m.put('tournaments/'+code+'/teamMatchStates/m1',{teamIds:['t1','t2'],game:{lineups:[['a','b','c'],['d','e','f']],life:[[2,2,2],[0,0,2]],current:[0,2],winner:null,rounds:[{winnerSide:0},{winnerSide:0}]}});
 }
 if(spec.function==='teamLineup')Object.assign(d,{action:'submit',matchId:'m1',teamId:'t1',order:['a','b','c']});
 if(spec.function==='courtCallService')Object.assign(d,{action:'notify',matchId:'m1'});
 if(spec.function==='enchantmentService')Object.assign(d,{action:'start',matchId:'m1'});
 return {m,request:{auth:{uid},data:d}};
}
function view(m,result,error){return clone({result,error:error?{message:error.message,code:error.code}:null,rows:[...m.rows].sort((a,b)=>a[0].localeCompare(b[0])),writes:m.writes});}
async function outcome(spec,patched,mutate,repeat=false){const f=fixture(spec);if(mutate)mutate(f.m,f.request);let result,error;try{const handle=load(spec,patched,f.m);result=await handle(f.request);if(repeat)result=await handle(f.request);}catch(e){error=e;}return {...f,result,error,view:view(f.m,result,error)};}
module.exports={memory,load,fixture,outcome};
if(require.main===module)(async()=>{
 let checks=0;
 for(const spec of specs){
  const before=await outcome(spec,false),after=await outcome(spec,true);
  assert.equal(before.error,undefined,spec.function+': '+before.error?.message);assert(before.m.writes.length>0,spec.function+' must exercise real writes');assert.deepEqual(after.view,before.view,spec.function+' unmarked behavior changed');
  if(spec.function==='teamScoring')assert(after.m.writes.some(w=>w.path==='tournaments/'+code),'must finish match and update root');checks++;
  for(const marker of ['scoreStorage','scoreBucketProjection','bucketMigration','deletionStatus'])for(const value of [null,false,'invalid',{}, {phase:'migrating'}, {phase:'active'}, {status:'deleting'}])for(const side of ['tournaments','publicTournaments']){
   const out=await outcome(spec,true,m=>{const p=side+'/'+code;m.put(p,{...m.rows.get(p),[marker]:value});m.put('tournaments/'+code,{...m.rows.get('tournaments/'+code),data:'{invalid'});});
   assert.equal(out.error?.message,'bucket-scoring-required',spec.function+' '+side+' '+marker);assert.equal(out.m.writes.length,0);checks++;
  }
  if(spec.function==='enchantmentService'){
   const setup=(m,request)=>{request.data.action='get';const base=path.join(original,String(spec.sourceSet));const Round=require(path.join(base,'enchantment-round-core.js')),Score=require(path.join(base,'enchantment-score-core.js'));let state=Round.start(Round.create('m1','u1','u2'),true).state;const card=Object.keys(Score.CARDS)[0];for(const side of ['A','B'])state=Round.assign(state,1,side,card).state;state.revealed.A=true;state.revealDeadline=NOW-1;m.put('tournaments/'+code+'/enchantmentMatches/m1',{version:1,state,dispatchRevision:0,station:1});};
   const a=await outcome(spec,false,setup),b=await outcome(spec,true,setup);assert.equal(a.error,undefined);assert(a.m.writes.some(w=>w.path.endsWith('/enchantmentMatches/m1')));assert.deepEqual(b.view,a.view);checks++;
  }
  const denied=m=>m.put('users/'+uid,{active:false,role:'super_admin'});const a=await outcome(spec,false,denied),b=await outcome(spec,true,denied);assert(a.error);assert.deepEqual(b.view,a.view,spec.function+' denial changed');checks++;
  const race=await outcome(spec,true,m=>{m.interfere=()=>m.put('tournaments/'+code,{...m.rows.get('tournaments/'+code),bucketMigration:{status:'deleting'}});});assert.equal(race.error?.message,'bucket-scoring-required');assert.equal(race.m.writes.length,0);checks++;
  if(['familyRegistration','teamRegistration','teamScoring','courtCallService'].includes(spec.function)){
   const a=await outcome(spec,false,null,true),b=await outcome(spec,true,null,true);assert.equal(a.error,undefined,spec.function+' replay fixture');assert.deepEqual(b.view,a.view,spec.function+' unmarked replay changed');checks++;
   const f=fixture(spec),handle=load(spec,true,f.m);await handle(f.request);f.m.put('tournaments/'+code,{...f.m.rows.get('tournaments/'+code),scoreStorage:false});const committed=f.m.writes.length;await assert.rejects(handle(f.request),/bucket-scoring-required/);assert.equal(f.m.writes.length,committed);checks++;
  }
 }
 console.log(JSON.stringify({checks,functions:specs.length,productionWrites:0,deploymentPerformed:false}));
})().catch(e=>{console.error(e);process.exitCode=1;});
