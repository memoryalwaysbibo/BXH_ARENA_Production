(function(root){
  'use strict';
  function fail(reason){throw Object.assign(new Error(reason),{code:reason});}
  function advance(doc,next,expected=next?.qrCheckinRevision){
    if(doc?.qrCheckinManaged!==true)return {};
    const revision=doc.qrCheckinRevision;
    if(!Number.isSafeInteger(revision)||revision<1||!next||next.qrCheckinManaged!==true||expected!==revision)fail('qr-checkin-state-stale');
    let current;try{current=typeof doc.data==='string'?JSON.parse(doc.data):doc.data;}catch{fail('qr-checkin-state-corrupt');}
    if(!Array.isArray(current?.players)||!Array.isArray(next.players))fail('qr-checkin-state-corrupt');
    const byId=new Map(current.players.map(p=>[p.id,p]));
    for(const p of next.players){
      const old=byId.get(p.id);
      // Staff changes go through the audited callable, not a full-state save.
      p.checkedIn=old?.checkedIn===true;
      for(const field of ['checkinFirstAt','checkinAt','checkinMethod']){
        if(old&&Object.prototype.hasOwnProperty.call(old,field))p[field]=old[field];else delete p[field];
      }
    }
    next.qrCheckinManaged=true;next.qrCheckinRevision=revision+1;
    return {qrCheckinManaged:true,qrCheckinRevision:revision+1};
  }
  const api={advance};
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.BXHQrCheckinFence=api;
})(typeof window==='object'?window:globalThis);
