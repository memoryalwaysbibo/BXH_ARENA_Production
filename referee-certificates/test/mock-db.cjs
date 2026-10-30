'use strict';
const clone=value=>value==null?value:structuredClone(value);
class Snapshot {
  constructor(path,value){this.id=path.split('/').at(-1);this.exists=value!==undefined;this.value=clone(value);}
  data(){return clone(this.value);}
}
class Query {
  constructor(db,path,filters=[],maximum=Infinity,sort=null){Object.assign(this,{db,path,filters,maximum,sort,query:true});}
  where(field,op,value){return new Query(this.db,this.path,this.filters.concat({field,op,value}),this.maximum,this.sort);}
  orderBy(field,direction='asc'){return new Query(this.db,this.path,this.filters,this.maximum,{field,direction});}
  limit(maximum){return new Query(this.db,this.path,this.filters,maximum,this.sort);}
  doc(id){return this.db.doc(this.path+'/'+id);}
}
class Reference {
  constructor(db,path){Object.assign(this,{db,path,id:path.split('/').at(-1)});}
  collection(name){return this.db.collection(this.path+'/'+name);}
}
class MockDB {
  constructor(seed={}){this.rows=new Map();this.versions=new Map();this.collections=new Map();this.commits=0;this.attempts=0;this.beforeCommit=null;for(const [key,value] of Object.entries(seed))this.put(key,value);}
  doc(path){return new Reference(this,path);}
  collection(path){return new Query(this,path);}
  read(path){return clone(this.rows.get(path));}
  put(path,value){this.rows.set(path,clone(value));this.versions.set(path,(this.versions.get(path)||0)+1);const parent=path.split('/').slice(0,-1).join('/');this.collections.set(parent,(this.collections.get(parent)||0)+1);}
  list(path){return [...this.rows].filter(([key])=>key.split('/').slice(0,-1).join('/')===path);}
  async runTransaction(callback){
    for(let attempt=0;attempt<10;attempt++){
      this.attempts++;
      const reads=new Map(),queries=new Map(),writes=[];
      const tx={
        get:async ref=>{
          if(writes.length)throw Error('read-after-write');
          if(ref.query){
            queries.set(ref.path,this.collections.get(ref.path)||0);
            let rows=this.list(ref.path).sort(([a],[b])=>a.localeCompare(b));
            rows=rows.filter(([,value])=>ref.filters.every(f=>{
              const v=value[f.field];if(v===undefined)return false;
              if(f.op==='==')return v===f.value;
              if(f.op==='>=')return v>=f.value;
              if(f.op==='<=')return v<=f.value;
              throw Error('unsupported-query');
            }));
            if(ref.sort) {
              const {field,direction}=ref.sort;
              rows=rows.filter(([,value])=>value[field]!==undefined).sort(([ap,a],[bp,b])=>{
                const cmp=a[field]<b[field]?-1:a[field]>b[field]?1:ap.localeCompare(bp);
                return direction==='desc'?-cmp:cmp;
              });
            }
            return {docs:rows.slice(0,ref.maximum).map(([path,value])=>new Snapshot(path,value))};
          }
          reads.set(ref.path,this.versions.get(ref.path)||0);
          return new Snapshot(ref.path,this.rows.get(ref.path));
        },
        set:(ref,value)=>writes.push({kind:'set',path:ref.path,value:clone(value)}),
        create:(ref,value)=>writes.push({kind:'create',path:ref.path,value:clone(value)})
      };
      const result=await callback(tx);
      if(this.beforeCommit)await this.beforeCommit({db:this,reads,queries,writes,attempt});
      if([...reads].some(([p,v])=>(this.versions.get(p)||0)!==v)||[...queries].some(([p,v])=>(this.collections.get(p)||0)!==v))continue;
      for(const write of writes)if(write.kind==='create'&&this.rows.has(write.path))throw Error('create-already-exists');
      for(const write of writes)this.put(write.path,write.value);
      if(writes.length)this.commits++;
      return result;
    }
    throw Error('transaction-retries-exhausted');
  }
}
function user(role='player',extra={}){return {role,active:true,realName:'測試裁判',nickname:'裁判測試',...extra};}
function fixture({uid='alice',code='BXH-AAAA',size=4,decisions=1,archived=true,confirmedUid=uid,roomExtra={},stateExtra={}}={}){
  const players=Array.from({length:size},(_,i)=>({id:'p'+i,checkedIn:true,name:'參賽者'+i}));
  const matches=[];
  for(let i=0;i<Math.max(decisions,Math.ceil(size/2));i++){
    const a='p'+((i*2)%size),b='p'+((i*2+1)%size);
    matches.push({id:'m'+i,a:{playerId:a},b:{playerId:b},winnerId:a,completed:true,isBye:false,confirmedByUid:confirmedUid,confirmedAt:1000+i,completedAt:1000+i,station:1,refereeSeatScoreRevision:1});
  }
  const state={meta:{eventAuthority:'official',checkinRequired:true,name:'開發測試賽事'},players,matches,startedAt:500,archiveStatus:archived?'completed':'ongoing',...stateExtra};
  const seed={'systemConfig/refereeCertificatesV1':{enabled:true},'users/admin':user('super_admin'),['users/'+uid]:user(),
    ['tournaments/'+code]:{eventAuthority:'official',data:JSON.stringify(state),...roomExtra}};
  for(let i=0;i<decisions;i++)seed['staffActivityLogs/'+uid+'/matches/'+code+'_m'+i]={uid,tournamentCode:code,matchId:'m'+i,confirmedAt:1000+i,eventAuthority:'official'};
  return seed;
}
module.exports={MockDB,user,fixture};
