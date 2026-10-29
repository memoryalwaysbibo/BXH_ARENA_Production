(function(root){
  'use strict';
  function createJournal(storage,uuid){
    const memory=new Map(),prefix='bxh-roster-intent-v1:';
    const key=c=>prefix+JSON.stringify([c.uid,c.code,c.registrationId,c.expandBy||0]);
    function begin(c){
      const k=key(c);let entry=memory.get(k);
      if(!entry)try{entry=JSON.parse(storage?.getItem(k)||'null');}catch{}
      if(!entry||!/^[-A-Za-z0-9]{16,80}$/.test(entry.operationId||''))entry={operationId:uuid()};
      memory.set(k,entry);try{storage?.setItem(k,JSON.stringify(entry));}catch{}
      return entry.operationId;
    }
    function finish(c,id){
      const k=key(c);let entry=memory.get(k);
      if(!entry)try{entry=JSON.parse(storage?.getItem(k)||'null');}catch{}
      if(entry?.operationId!==id)return;
      memory.delete(k);try{storage?.removeItem(k);}catch{}
    }
    return {begin,finish};
  }
  if(typeof module==='object'&&module.exports)module.exports={createJournal};
  if(root){let storage;try{storage=root.sessionStorage;}catch{}root.BXHRosterRecovery=createJournal(storage,()=>root.crypto.randomUUID());}
})(typeof window==='object'?window:null);
