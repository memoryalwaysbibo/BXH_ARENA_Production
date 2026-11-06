'use strict';
const Core = require('./team-lineup-core');
const Court = require('./court-call-core');

function createTeamLineupService(db, clock = Date.now) {
  return async req => {
    const uid = req.auth?.uid, d = req.data || {}, code = String(d.code || '').toUpperCase();
    if (!uid) throw Error('auth-required');
    if (!/^BXH-[A-Z0-9]{4,16}$/.test(code)) throw Error('invalid-code');
    if (!['view', 'submit', 'default', 'reveal', 'reset'].includes(d.action)) throw Error('invalid-action');
    if (typeof d.matchId !== 'string' || !/^[A-Za-z0-9_-]{1,100}$/.test(d.matchId)) throw Error('invalid-match');
    const roomRef = db.doc('tournaments/' + code);
    // Secret orders are deliberately kept outside tournament.data and the
    // public bracket mirror. Neither may contain an unrevealed order.
    const lineupRef = roomRef.collection('teamLineups').doc(d.matchId);
    const scoreRef = roomRef.collection('teamMatchStates').doc(d.matchId);
    return db.runTransaction(async tx => {
      const [userSnap, roomSnap, lineupSnap, scoreSnap, publicSnap] = await Promise.all([
        tx.get(db.doc('users/' + uid)), tx.get(roomRef), tx.get(lineupRef), tx.get(scoreRef), tx.get(db.doc('publicTournaments/' + code))
      ]);
      const user = userSnap.data(), room = roomSnap.data();
      if (!Court.active(user)) throw Error('account-inactive');
      if (!room) throw Error('event-not-found');
      if([room,publicSnap.data()].some(x=>x&&['scoreStorage','scoreBucketProjection','bucketMigration','deletionStatus'].some(k=>Object.prototype.hasOwnProperty.call(x,k))))throw Error('bucket-scoring-required');
      let state;
      try { state = typeof room.data === 'string' ? JSON.parse(room.data) : room.data; }
      catch { throw Error('invalid-tournament'); }
      if (state?.meta?.battleMode !== 'team') throw Error('team-mode-required');
      if (Court.tester(user) && !Court.testerSandbox(state, uid)) throw Error('permission-denied');
      const match = (state.matches || []).find(m => m.id === d.matchId);
      if (!match || match.completed || match.isBye || !Array.isArray(match.teamIds) ||
          match.teamIds.length !== 2 || new Set(match.teamIds).size !== 2) throw Error('invalid-match');
      const teams = (state.teams || []).filter(t => match.teamIds.includes(t.id));
      if (teams.length !== 2) throw Error('invalid-team-roster');
      const referee = Court.canReferee(user, uid, room, state, match.station);
      const ownTeam = teams.find(t => t.captainUid === uid);
      let record = lineupSnap.data() || {teamIds: match.teamIds.slice(), lineups: {}};
      if (!referee && !ownTeam && !(d.action === 'view' && record.lineupsRevealed)) throw Error('permission-denied');
      if (JSON.stringify(record.teamIds) !== JSON.stringify(match.teamIds)) throw Error('stale-lineup');
      if (d.action === 'submit') {
        if (!ownTeam || ownTeam.id !== d.teamId) throw Error('not-team-captain');
        if (match.startedAt || match.completedAt || scoreSnap.exists) throw Error('lineup-locked');
        record = Core.submitLineup(record, ownTeam.id, uid, d.order, teams);
        record.lineupSources = {...record.lineupSources, [ownTeam.id]: 'captain'};
        const defaultedAt = {...record.defaultedAt}, defaultedBy = {...record.defaultedBy};
        delete defaultedAt[ownTeam.id];
        delete defaultedBy[ownTeam.id];
        record.defaultedAt = defaultedAt;
        record.defaultedBy = defaultedBy;
        tx.set(lineupRef, {...record, updatedAt: clock(), updatedBy: uid});
      } else if (d.action === 'default') {
        if (!referee) throw Error('referee-required');
        if (match.startedAt || match.completedAt || scoreSnap.exists) throw Error('lineup-locked');
        const team = teams.find(t => t.id === d.teamId);
        if (!team || !match.teamIds.includes(team.id)) throw Error('invalid-team-roster');
        if (Array.isArray(record.lineups?.[team.id]) && record.lineupSources?.[team.id] !== 'referee-default')
          throw Error('lineup-already-submitted');
        record = {
          ...record,
          lineups: {...record.lineups, [team.id]: Core.defaultLineup(team)},
          lineupSources: {...record.lineupSources, [team.id]: 'referee-default'},
          defaultedAt: {...record.defaultedAt, [team.id]: clock()},
          defaultedBy: {...record.defaultedBy, [team.id]: uid}
        };
        tx.set(lineupRef, {...record, updatedAt: clock(), updatedBy: uid});
      } else if (d.action === 'reveal') {
        if (!referee) throw Error('referee-required');
        if (match.startedAt || match.completedAt || scoreSnap.exists) throw Error('lineup-locked');
        record = Core.revealLineups(record, d.peoplePresent === true, referee);
        tx.set(lineupRef, {...record, revealedAt: clock(), revealedBy: uid});
      } else if (d.action === 'reset') {
        if (!referee) throw Error('referee-required');
        if (match.startedAt || match.completedAt || scoreSnap.exists || record.lineupsRevealed) throw Error('lineup-locked');
        record = Core.resetLineups(record, referee);
        tx.set(lineupRef, {...record, revealedAt: null, revealedBy: null, resetAt: clock(), resetBy: uid});
      }
      const view = Core.publicLineupView(record);
      if (!record.lineupsRevealed) {
        if (referee) {
          view.lineups = Object.fromEntries(match.teamIds.filter(id => record.lineups[id]).map(id => [id, record.lineups[id].slice()]));
          view.defaulted = Object.fromEntries(match.teamIds.map(id => [id, record.lineupSources?.[id] === 'referee-default']));
        }
        else if (ownTeam && record.lineups[ownTeam.id]) view.ownOrder = record.lineups[ownTeam.id].slice();
      }
      return {ok: true, ...view, isReferee: referee, ownTeamId: ownTeam?.id || null, revealed: !!record.lineupsRevealed};
    });
  };
}
module.exports = {createTeamLineupService};
