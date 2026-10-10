// Presentation receipts only: never used to grant badges, XP, or ledger eligibility.
export function createAchievementFeedback({unlocks=()=>[],storage=null}={}){
 const receipts=new Map();let pending=null;
 const key=uid=>'arena-pk:achievement-notices:v1:'+uid;
 function seen(uid){
  if(!receipts.has(uid)){
   let ids=[];try{const saved=JSON.parse(storage?.getItem(key(uid))||'[]');if(Array.isArray(saved))ids=saved.filter(id=>typeof id==='string');}catch{}
   receipts.set(uid,new Set(ids));
  }
  return receipts.get(uid);
 }
 return {
  arm(uid,challengeId){pending={uid,challengeId};},
  reset(){pending=null;},
  settle(uid,challengeId,records){
   if(!pending||pending.uid!==uid||pending.challengeId!==challengeId)return [];
   // A refresh that started before settlement may still be stale. Keep the pending notice for retry.
   if(!records.some(r=>r.completed&&!r.tombstone&&r.eventCode==='pk:arena-internal:'+challengeId))return [];
   const known=seen(uid),badges=unlocks(records,challengeId).filter(b=>!known.has(b.id));
   pending=null;
   for(const badge of badges)known.add(badge.id);
   try{storage?.setItem(key(uid),JSON.stringify([...known]));}catch{}
   return badges;
  }
 };
}
