(function(root){
'use strict';
function haveXp(p){return p==null||p.version==='arena-practice-xp-v1'&&typeof p.enabled==='boolean'&&Number.isSafeInteger(p.totalXp*2)&&p.totalXp>=0&&Number.isSafeInteger(p.todayXp*2)&&p.todayXp>=0&&Number.isSafeInteger(p.completedToday)&&p.completedToday>=0&&Number.isSafeInteger(p.remainingGames)&&p.remainingGames===Math.max(0,10-p.completedToday)&&/^\d{4}-\d{2}-\d{2}$/.test(p.day);}
function createHistory({transport,changed=()=>{}}){
 let uid='',epoch=0,pending=null;let state={status:'unconnected',records:[],total:null,excluded:0};
 const snapshot=()=>({...state,records:state.records.slice()});
 function session(next){next=next||'';if(uid===next)return;uid=next;epoch++;pending=null;state={status:'unconnected',records:[],total:null,excluded:0};changed();}
 async function load(force=false){
  if(!uid)return snapshot();if(pending)return pending;if(!force&&['ready','empty'].includes(state.status))return snapshot();
  const owner=uid,stamp=epoch;state={...state,status:'loading'};changed();
  const work=(async()=>{let rows=[],cursor=null,generation=null,meta=null,seen=new Set();try{
   do{const result=await transport('getMyHistory',{limit:50,...(cursor?{cursor,generation}:{})},{uid:owner});if(stamp!==epoch||uid!==owner)return null;
    const h=result?.history;if(!h||h.uid!==owner||h.environment!==root.BXHArenaPKAdapter.ENV||!Array.isArray(h.rows)||!Number.isSafeInteger(h.generation)||!Number.isSafeInteger(h.total)||h.total<0)throw Error('history-invalid');
    if(generation!==null&&generation!==h.generation)throw Error('history-changed');generation=h.generation;meta=h;rows.push(...h.rows);cursor=h.nextCursor;
    if(cursor!=null&&(typeof cursor!=='string'||seen.has(cursor)))throw Error('history-invalid');if(cursor)seen.add(cursor);
    // In-progress pages are deliberately not published as a complete lifetime denominator.
   }while(cursor);
   const records=root.BXHArenaPKAdapter.adapt(rows,owner);if(records.length!==meta.total)throw Error('history-count-mismatch');
   if(haveXp(meta.practiceXp)===false)throw Error('history-xp-invalid');
   if(meta.practiceXp&&records.reduce((sum,r)=>sum+(r.practiceXp?.units||0),0)!==meta.practiceXp.totalXp*2)throw Error('history-xp-count-mismatch');
   state={status:records.length?'ready':'empty',practiceXp:meta.practiceXp||null,records,total:meta.total,excluded:records.filter(r=>!r.analyzable).length,generation,loadedAt:Date.now()};
  }catch(error){if(stamp!==epoch||uid!==owner)return null;
    let records=state.records;try{if(rows.length)records=root.BXHArenaPKAdapter.adapt(rows,owner);}catch{}
    const unavailable=['closed','account-unavailable'].includes(error.message)||String(error.code).includes('not-found');
    state={...state,status:unavailable?'unconnected':rows.length?'partial':'error',records,error:error.message};
  }finally{if(stamp===epoch&&uid===owner)changed();}return snapshot();})();
  pending=work;try{return await work;}finally{if(pending===work)pending=null;}
 }
 return {session,load,snapshot};
}
root.BXHArenaPKHistory={createHistory};
if(typeof module==='object'&&module.exports)module.exports={createHistory};
})(globalThis);
