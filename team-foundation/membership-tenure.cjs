'use strict';
// Pure resolver for trusted, server-maintained membership intervals.
// `leftAt` is exclusive: departure at the exact archive millisecond means
// the player was no longer a member. Ambiguous/invalid history fails closed.
const validId=s=>typeof s==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(s);
function resolveTenure({uid,archivedAt,tenures}){
 if(!validId(uid)||!Number.isSafeInteger(archivedAt)||archivedAt<0||!Array.isArray(tenures))throw Error('invalid-tenure-input');
 let match=null;
 for(const t of tenures){
  if(!t||t.uid!==uid||!validId(t.teamId)||!validId(t.tenureId)||!Number.isSafeInteger(t.joinedAt)||t.joinedAt<0||!(t.leftAt===null||(Number.isSafeInteger(t.leftAt)&&t.leftAt>=t.joinedAt)))throw Error('invalid-tenure');
  if(t.joinedAt<=archivedAt&&(t.leftAt===null||archivedAt<t.leftAt)){
   if(match)throw Error('ambiguous-tenure');
   match=t;
  }
 }
 return match?{teamId:match.teamId,tenureId:match.tenureId,joinedAt:match.joinedAt}:null;
}
module.exports={resolveTenure};
