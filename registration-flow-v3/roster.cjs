'use strict';
const {projectRoster, publicPlayers} = require('../qr-checkin/backend/overlays/registration-roster-core.js');
function readRuntime(value) {
  let state;
  try { state = JSON.parse(value); } catch { throw Error('corrupt-state'); }
  if (!state?.meta || !Array.isArray(state.players) || !Array.isArray(state.matches)) throw Error('corrupt-state');
  return state;
}
function project(room, publicRoom, rows, now) {
  const state = readRuntime(room.data);
  const mirror = readRuntime(publicRoom.bracketView);
  if (state.startedAt || state.bracketSize || state.matches.length || mirror.matches.length ||
      state.meta.eventCancelled || ['completed','archived'].includes(state.archiveStatus)) throw Error('bracket-locked');
  // V3's current candidate handles online individual registrations only.
  // Do not silently overwrite or fail to count existing manual/team entries.
  if ([room.battleMode, publicRoom.battleMode, state.meta.battleMode].includes('team') ||
      state.players.some(p => p.source !== 'online') || state.waitlistPlayers?.length ||
      room.waitlistEnabled || room.registrationSelection || publicRoom.registrationSelection)
    throw Error('registration-mode-not-supported');
  const players = projectRoster(state.players, rows, state.meta.checkinRequired === true);
  const revision = Number(state.registrationRosterRevision || 0) + 1;
  if (!Number.isSafeInteger(revision)) throw Error('revision-exhausted');
  return {
    privatePatch: {data: JSON.stringify({...state, players, registrationRosterRevision:revision, updatedAt:now})},
    publicPatch: {bracketView: JSON.stringify({...mirror, players:publicPlayers(players), registrationRosterRevision:revision, updatedAt:now})}
  };
}
module.exports = {project};
