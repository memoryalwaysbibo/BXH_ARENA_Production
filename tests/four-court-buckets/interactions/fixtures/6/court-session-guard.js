'use strict';
const revision = match => Number(match?.dispatchRevision || 0);
const activeCourt = (state, match) => {
 const n=Number(match?.station);
 return Number.isInteger(n)&&n>0&&!match?.forceDetached&&
  !state?.forcedCourtExits?.[n]?.closed&&
  state?.courtRetirementPlan?.courts?.[n]?.status!=='retired';
};
const current = (state, match) => activeCourt(state,match)&&
 state?.courtAssignments?.['court'+match.station]?.currentMatchId===match.id;
module.exports={revision,activeCourt,current};
