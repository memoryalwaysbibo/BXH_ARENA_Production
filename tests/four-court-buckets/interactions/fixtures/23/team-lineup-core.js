'use strict';

// A lineup belongs to one match. Only participant IDs stored on the registered
// team may be submitted; names and client-provided team membership are ignored.
function validateLineup(team, submitted) {
  const members = team && team.memberPlayerIds;
  if (!Array.isArray(members) || members.length < 3 || new Set(members).size !== members.length ||
      members.some(id => typeof id !== 'string' || !id)) throw Error('invalid-team-roster');
  if (!Array.isArray(submitted) || submitted.length !== members.length ||
      submitted.some(id => typeof id !== 'string') || new Set(submitted).size !== submitted.length ||
      submitted.some(id => !members.includes(id))) throw Error('invalid-lineup');
  return submitted.slice();
}

function submitLineup(match, teamId, captainUid, submitted, teams) {
  if (!match || !Array.isArray(match.teamIds) || match.teamIds.length !== 2 ||
      new Set(match.teamIds).size !== 2 || !match.teamIds.includes(teamId)) throw Error('invalid-match');
  if (match.lineupsRevealed || match.startedAt || match.completedAt) throw Error('lineup-locked');
  const team = teams.find(t => t.id === teamId);
  if (!team || team.captainUid !== captainUid) throw Error('not-team-captain');
  const order = validateLineup(team, submitted);
  return {...match, lineups: {...match.lineups, [teamId]: order}};
}

// Referee fallback uses the roster's server-owned order. Callers cannot supply
// IDs or reorder the roster through this path.
function defaultLineup(team) {
  if (!team) throw Error('invalid-team-roster');
  return validateLineup(team, team.memberPlayerIds);
}

function publicLineupView(match) {
  if (!match || !Array.isArray(match.teamIds)) throw Error('invalid-match');
  return {
    teamIds: match.teamIds.slice(),
    submitted: Object.fromEntries(match.teamIds.map(id => [id, Array.isArray(match.lineups?.[id])])),
    ...(match.lineupsRevealed ? {
      lineups: Object.fromEntries(match.teamIds.map(id => [id, match.lineups[id].slice()])),
      defaulted: Object.fromEntries(match.teamIds.map(id => [id, match.lineupSources?.[id] === 'referee-default']))
    } : {})
  };
}

function revealLineups(match, peoplePresent, refereeAuthorized) {
  if (!refereeAuthorized) throw Error('referee-required');
  if (!peoplePresent) throw Error('people-not-present');
  if (!match || !Array.isArray(match.teamIds) || match.teamIds.length !== 2 ||
      !match.teamIds.every(id => Array.isArray(match.lineups?.[id]))) throw Error('lineups-incomplete');
  if (match.lineupsRevealed) return match;
  return {...match, lineupsRevealed: true};
}

function resetLineups(match, refereeAuthorized) {
  if (!refereeAuthorized) throw Error('referee-required');
  if (!match || !Array.isArray(match.teamIds) || match.teamIds.length !== 2) throw Error('invalid-match');
  return {...match, lineups: {}, lineupSources: {}, lineupsRevealed: false};
}

module.exports = {validateLineup, submitLineup, defaultLineup, publicLineupView, revealLineups, resetLineups};
