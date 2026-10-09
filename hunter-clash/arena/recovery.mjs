// Account-scoped hints only. Scores and confirmations always come from the server.
export const terminalStatus=status=>['completed','revoked','disputed','cancelled','expired','rejected'].includes(status);
export function createRecoveryStore({session,persistent}={}){
 const key=uid=>'arena-pk:mobile:last:'+uid;
 const read=(store,uid)=>{try{const id=store?.getItem(key(uid));return typeof id==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(id)?id:null;}catch{return null;}};
 const write=(store,uid,id)=>{try{if(id)store?.setItem(key(uid),id);else store?.removeItem(key(uid));}catch{}};
 return Object.freeze({
  dismissed:uid=>uid?read(session,uid+':dismissed')==='yes':false,
  dismiss(uid){if(uid)write(session,uid+':dismissed','yes');},
  id:uid=>uid?(read(persistent,uid)||read(session,uid)):null,
  remember(uid,c){if(!uid||!c?.challengeId)return;write(session,uid+':dismissed',null);const id=terminalStatus(c.status)?null:c.challengeId;write(session,uid,id);write(persistent,uid,id);},
  clearUnavailable(uid,error,{pending=false}={}){if(!uid||pending||error?.definitive!==true||!/(?:^|\s)(?:challenge-unavailable|participant-required)(?:\s|$)/.test(String(error.message||'')))return false;write(session,uid,null);write(persistent,uid,null);return true;},
  clear(uid){if(uid){write(session,uid+':dismissed',null);write(session,uid,null);write(persistent,uid,null);}}
 });
}
