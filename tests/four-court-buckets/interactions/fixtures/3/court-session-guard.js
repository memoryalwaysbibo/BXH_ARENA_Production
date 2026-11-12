'use strict';

const revision = match => Number(match?.dispatchRevision || 0);
const activeCourt = (state, match) => {
  const station = Number(match?.station);
  if (!Number.isInteger(station) || station < 1 || match?.forceDetached) return false;
  if (state?.forcedCourtExits?.[station]?.closed) return false;
  if (state?.courtRetirementPlan?.courts?.[station]?.status === 'retired') return false;
  return true;
};
const current = (state, match) => activeCourt(state, match) &&
  state?.courtAssignments?.['court' + match.station]?.currentMatchId === match.id;
const next = (state, match) => activeCourt(state, match) &&
  (!state?.courtRetirementPlan || Number(match.station) <= Number(state.courtRetirementPlan.targetCount)) &&
  state?.courtAssignments?.['court' + match.station]?.nextMatchId === match.id;
const bound = (state, match, record) => !!record && activeCourt(state, match) &&
  Number(record?.dispatchRevision || 0) === revision(match) &&
  Number(record?.station || match.station) === Number(match.station);

module.exports = {revision, activeCourt, current, next, bound};
