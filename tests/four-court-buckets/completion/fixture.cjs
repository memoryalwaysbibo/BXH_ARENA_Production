'use strict';
const assert=require('node:assert/strict'),path=require('node:path');
const release=path.resolve(__dirname,'../../../release/buckets/completion'),NOW=1900000000000,code='BXH-TEST01',clone=x=>x===undefined?undefined:JSON.parse(JSON.stringify(x));
function memory(){
 const rows=new Map(),versions=new Map(),created=new Map(),writes=[];let interfere;let serial=0;
 const put=(p,d)=>{rows.set(p,clone(d));versions.set(p,++serial);if(!created.has(p))created.set(p,serial);};
 const snapshot=p=>{const value=clone(rows.get(p)),exists=rows.has(p),born=created.get(p),version=versions.get(p)||0;return {id:p.split('/').at(-1),ref:ref(p),exists,data:()=>clone(value),createTime:exists?{seconds:born,nanoseconds:0}:undefined,updateTime:{seconds:version,nanoseconds:0,toMillis:()=>version*1000}};};
 const ref=p=>({path:p,id:p.split('/').at(-1),collection:c=>query(p+'/'+c),get:async()=>snapshot(p)});
 function query(p){let maximum=Infinity;const filters=[];const q={query:true,path:p,doc:id=>ref(p+'/'+id),where(...f){filters.push(f);return q;},limit(n){maximum=n;return q;},orderBy(){return q;},get:async()=>{const docs=[...rows.keys()].filter(k=>k.startsWith(p+'/')&&!k.slice(p.length+1).includes('/')&&filters.every(([f,op,v])=>op==='=='&&rows.get(k)[f]===v)).slice(0,maximum).map(snapshot);return {docs,size:docs.length,empty:!docs.length};}};return q;}
 function apply(kind,p,value,options){if(kind==='create')assert(!rows.has(p));writes.push({kind,path:p,value:clone(value),options:clone(options)});if(kind==='delete'){rows.delete(p);created.delete(p);versions.set(p,++serial);return;}const next=kind==='update'||options?.merge?{...rows.get(p)}:{};for(const [k,v]of Object.entries(value)){if(v&&v.__increment!==undefined)next[k]=Number(next[k]||0)+v.__increment;else if(v&&v.__arrayUnion){next[k]=[...(next[k]||[])];for(const item of v.__arrayUnion)if(!next[k].some(old=>JSON.stringify(old)===JSON.stringify(item)))next[k].push(clone(item));}else next[k]=clone(v);}put(p,next);}
 const db={projectId:'demo-bxh-four-court-buckets',doc:ref,collection:query,getAll:async(...refs)=>Promise.all(refs.map(r=>r.get())),runTransaction:async cb=>{for(let attempt=0;attempt<4;attempt++){
  const reads=new Map(),pending=[];const get=async r=>{assert.equal(pending.length,0,'read after write');if(r.query)return r.get();reads.set(r.path,versions.get(r.path)||0);return snapshot(r.path);};
  const tx={get,getAll:(...refs)=>Promise.all(refs.map(get)),set:(r,d,o)=>pending.push(['set',r.path,d,o]),update:(r,d)=>pending.push(['update',r.path,d]),create:(r,d)=>pending.push(['create',r.path,d]),delete:r=>pending.push(['delete',r.path])};
  const result=await cb(tx);if(interfere&&pending.length){const fn=interfere;interfere=null;fn();}
  if([...reads].some(([p,v])=>(versions.get(p)||0)!==v))continue;pending.forEach(args=>apply(...args));return result;
 }throw Error('retry exhausted');}};
 return {db,rows,put,writes,snapshot,remove:p=>{rows.delete(p);created.delete(p);versions.set(p,++serial);},set interfere(x){interfere=x;}};
}
function fixture({bucket=true,qr=false,courts=6}={}){
 const m=memory(),B=require(path.join(release,'protocol/state.cjs'));
 const players=Array.from({length:4},(_,i)=>({id:'p'+(i+1),name:'Player '+(i+1),registrationUid:'u'+(i+1),source:'online',checkedIn:true}));
 const match=(id,a,b,winner,round,station,bracket='SE')=>({id,a:{playerId:a},b:{playerId:b},winnerId:winner,loserId:winner===a?b:a,scoreA:4,scoreB:1,completed:true,status:'completed',round,indexInRound:id==='semi2'?1:0,seq:id==='final'?3:id==='bronze'?2.5:id==='semi1'?1:2,station,bracket,isBye:false,refereeSeatScoreRevision:2,dispatchRevision:0,log:[],confirmedByUid:'PRIVATE_UID'});
 const state={id:'room-1',cloudCode:code,meta:{name:'Synthetic',eventAuthority:'official',ladderMode:'general',formatType:'single',scoringMode:'standard',battleMode:'individual',playMode:'standard',stations:courts,bronzeMatch:true,date:'2026-11-03'},players,matches:[match('semi1','p1','p2','p1',0,1),match('semi2','p3','p4','p3',0,Math.min(5,courts)),match('bronze','p2','p4','p2',0,Math.min(5,courts),'BZ'),match('final','p1','p3','p1',1,1)],championId:'p1',runnerUpId:'p3',thirdId:'p2',fourthId:'p4',bronzeMatchId:'bronze',archiveStatus:'ongoing',startedAt:NOW-1000,updatedAt:1};
 if(qr){state.qrCheckinManaged=true;state.qrCheckinRevision=1;}
 const top={eventAuthority:'official',createdBy:'admin',ladderMode:'general',archiveStatus:'ongoing',tournamentPhase:'live',refereeSeatsV1:{version:1},data:JSON.stringify(state)};
 const pub={bracketView:JSON.stringify({meta:{stations:courts},players:players.map(p=>({id:p.id,name:p.name,checkedIn:true})),matches:[],championId:null}),archiveStatus:'ongoing'};
 m.put('users/admin',{active:true,role:'super_admin'});
 for(const p of players){m.put('users/'+p.registrationUid,{active:true,role:'player',realName:p.name});m.put('ladderPlayers/'+p.registrationUid,{uid:p.registrationUid,currentSeason:'S1',seasonPoints:5,careerPoints:10,totalEvents:0});}
 if(qr){Object.assign(top,{qrCheckinManaged:true,qrCheckinRevision:1,qrCheckin:{version:1}});Object.assign(pub,{qrCheckinManaged:true,qrCheckinRevision:1});}
 let manifest,buckets;
 if(bucket){manifest=B.makeManifest(state,'epoch-1');top.scoreStorage=manifest;buckets=B.encode(state,manifest).map(b=>({...b,revision:7}));pub.scoreBucketProjection={epoch:'epoch-1',versions:Object.fromEntries(buckets.map(b=>[b.bucketId,0]))};
  const stale=clone(state);stale.championId='p4';stale.runnerUpId='p2';stale.thirdId='p1';stale.fourthId='p3';stale.matches.forEach(x=>{x.scoreA=0;x.scoreB=0;});top.data=JSON.stringify(stale);
 }
 m.put('tournaments/'+code,top);m.put('publicTournaments/'+code,pub);m.put('ladderSystem/current',{status:'active',currentSeason:'S1'});
 m.put('systemConfig/fourCourtScoreBuckets',{enabled:true,completionEnabled:true});
 for(const p of players)m.put('tournaments/'+code+'/registrations/'+p.registrationUid,{uid:p.registrationUid,status:'confirmed'});
 if(bucket)for(const b of buckets)m.put('tournaments/'+code+'/matchBuckets/'+b.bucketId,b);
 return {m,state,top,pub,buckets,manifest};
}
function bracket(count){
 const size=2**Math.ceil(Math.log2(count)),half=size/2,players=Array.from({length:count},(_,i)=>({id:'p'+i,name:'P'+i,registrationUid:'u'+i,source:'online'}));let slots=[];
 for(let i=0;i<half;i++)slots.push(players[i].id,players[half+i]?.id||null);
 const matches=[];let round=0;
 while(slots.length>1){const next=[];for(let j=0;j<slots.length;j+=2){const a=slots[j],b=slots[j+1],isBye=!a||!b,winnerId=a||b||null;matches.push({id:'m'+round+'-'+j,a:a?{playerId:a}:null,b:b?{playerId:b}:null,round,indexInRound:j/2,seq:matches.length,bracket:'SE',station:j/2%6+1,isBye,completed:true,winnerId,loserId:isBye?null:b,scoreA:4,scoreB:1});next.push(winnerId);}slots=next;round++;}
 const state={id:'generated',cloudCode:code,meta:{eventAuthority:'official',ladderMode:'general',formatType:'single',stations:6,bronzeMatch:count>=4},players,matches};
 if(count>=4){const semi=matches.filter(m=>m.round===round-2);state.bronzeMatchId='bronze';matches.push({id:'bronze',a:{playerId:semi[0].loserId},b:{playerId:semi[1].loserId},winnerId:semi[0].loserId,loserId:semi[1].loserId,round:round-2,indexInRound:0,seq:matches.length,bracket:'BZ',station:5,isBye:false,completed:true,scoreA:4,scoreB:1});}
 return state;
}
function largeFixture(count=160){
 const f=fixture(),A=require(path.join(release,'protocol/results.cjs')),B=require(path.join(release,'protocol/state.cjs')),state=A.validateResults(bracket(count));state.startedAt=NOW-1000;
 for(const p of [...f.m.rows.keys()])if((p.startsWith('users/')&&p!=='users/admin')||p.startsWith('ladderPlayers/')||p.includes('/registrations/')||p.includes('/matchBuckets/'))f.m.remove(p);
 for(let i=0;i<count;i++){f.m.put('users/u'+i,{active:true,role:'player',realName:'P'+i});f.m.put('ladderPlayers/u'+i,{currentSeason:'S1',seasonPoints:0,careerPoints:0});f.m.put('tournaments/'+code+'/registrations/u'+i,{status:'confirmed'});}
 const manifest=B.makeManifest(state,'epoch-1'),buckets=B.encode(state,manifest).map(b=>({...b,revision:7}));
 f.m.put('tournaments/'+code,{...f.m.rows.get('tournaments/'+code),scoreStorage:manifest,data:JSON.stringify(state)});
 f.m.put('publicTournaments/'+code,{bracketView:JSON.stringify({meta:{stations:6},players:state.players.map(p=>({id:p.id,name:p.name})),matches:[]}),scoreBucketProjection:{epoch:'epoch-1',versions:Object.fromEntries(buckets.map(b=>[b.bucketId,0]))}});
 for(const b of buckets)f.m.put('tournaments/'+code+'/matchBuckets/'+b.bucketId,b);
 return {...f,state,manifest,buckets};
}
module.exports={memory,fixture,largeFixture,NOW,code};
