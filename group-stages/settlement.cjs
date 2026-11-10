'use strict';

const ladder = require('../ladder-v1.js');
const CODE = /^BXH-[A-Z0-9]{6}$/;
const UID = /^[A-Za-z0-9_-]{1,128}$/;

function check(condition, code) {
  if (!condition) throw Object.assign(new Error(code), { code });
}

function millis(value) {
  if (value?.toMillis) return value.toMillis();
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function participantUid(player) {
  if (player.familyPlayerId || player.source === 'test' || player.participantType === 'onsite_guest' ||
    player.ladderEligible === false) return null;
  const uid = player.registrationUid || player.accountUid || player.playerUid || player.uid;
  return UID.test(uid || '') ? uid : null;
}

function createGroupSettlement(db, coordinator, { clock = Date.now, serverTimestamp = clock } = {}) {
  return async function settle(parentCode, actorUid) {
    check(CODE.test(parentCode || ''), 'group-room-code');
    check(UID.test(actorUid || ''), 'group-auth-required');
    const parentRef = db.doc('tournaments/' + parentCode);
    const publicRef = db.doc('publicTournaments/' + parentCode);
    const planRef = db.doc('groupStagePlans/' + parentCode);
    const controlRef = db.doc('ladderSystem/current');
    return db.runTransaction(async tx => {
      const [actorSnapshot, gateSnapshot, parentSnapshot, publicSnapshot, planSnapshot, controlSnapshot] =
        await tx.getAll(db.doc('users/' + actorUid), db.doc('systemConfig/groupStages'),
          parentRef, publicRef, planRef, controlRef);
      const actor = actorSnapshot.data(), gate = gateSnapshot.data(), top = parentSnapshot.data(),
        plan = planSnapshot.data(), control = controlSnapshot.data();
      check(actor?.active === true && actor.deleted !== true && actor.isTestAccount !== true &&
        ['admin', 'super_admin'].includes(actor.role), 'group-permission-denied');
      check(gate?.enabled === true && gate.parentCodes?.includes(parentCode) &&
        !gate.rehearsalParentCodes?.includes(parentCode), 'group-room-disabled');
      check(parentSnapshot.exists && publicSnapshot.exists && planSnapshot.exists &&
        plan.rehearsal !== true, 'group-plan-required');
      check(top.eventAuthority === 'official' && top.ladderMode === 'ranked' &&
        !top.testMode && !top.systemClosed && !Object.hasOwn(top, 'scoreStorage'), 'group-parent-unavailable');
      let state;
      try { state = typeof top.data === 'string' ? JSON.parse(top.data) : top.data; }
      catch { check(false, 'group-parent-unavailable'); }
      check(state && state.id === plan.parentRoomId && !state.testMode && !state.meta?.eventCancelled &&
        !state.startedAt && !state.matches?.length, 'group-parent-unavailable');
      if (top.ladderPointsAwarded === true || state.ladderPointsAwarded === true || plan.settlement) {
        check(top.ladderPointsAwarded === true && state.ladderPointsAwarded === true &&
          top.archiveStatus === 'completed' && state.archiveStatus === 'completed' &&
          plan.settlement?.seasonId === top.ladderSeasonId, 'group-settlement-conflict');
        return { ok: true, alreadyAwarded: true, seasonId: top.ladderSeasonId,
          effectiveCount: plan.settlement.effectiveCount, creditedCount: plan.settlement.creditedCount };
      }
      check(controlSnapshot.exists && control.status === 'active' && control.rolloverInProgress !== true,
        'group-season-unavailable');
      const now = clock();
      check((!millis(control.startAt) || now >= millis(control.startAt)) &&
        (!millis(control.endAt) || now <= millis(control.endAt)), 'group-season-unavailable');
      const input = await coordinator.readSettlement(tx, parentCode);
      check(input.participants.length <= 384 && input.effectiveCount <= 384, 'group-settlement-capacity');
      const seasonId = String(control.currentSeason || 'S1');
      const trial = control.isTrialSeason === true || seasonId.toUpperCase() === 'S0';
      const career = control.countsTowardCareer === undefined ? !trial : control.countsTowardCareer === true;
      const candidates = [], skipped = [], uids = new Set();
      for (const row of input.participants) {
        const uid = participantUid(row.player);
        if (!uid) { skipped.push(row.player.name || row.player.id); continue; }
        check(!uids.has(uid), 'group-duplicate-account');
        uids.add(uid);
        candidates.push({ ...row, uid });
      }
      check(candidates.length >= 2, 'group-insufficient-eligible-players');
      const profileRefs = candidates.map(row => db.doc('users/' + row.uid));
      const playerRefs = candidates.map(row => db.doc('ladderPlayers/' + row.uid));
      const logRefs = candidates.map(row => db.doc('ladderTransactions/' + parentCode + '_' + row.uid));
      const snapshots = await tx.getAll(...profileRefs, ...playerRefs, ...logRefs);
      const n = candidates.length;
      const profiles = snapshots.slice(0, n), players = snapshots.slice(n, 2 * n), logs = snapshots.slice(2 * n);
      check(logs.every(snapshot => !snapshot.exists), 'group-settlement-conflict');
      const results = [];
      const tiers = ladder.tiers.map(tier => tier.name);
      for (let i = 0; i < n; i++) {
        const row = candidates[i], profile = profiles[i].data();
        if (!profile || profile.active !== true || profile.deleted === true || profile.isTestAccount === true ||
          profile.role === 'tester') { skipped.push(row.player.name || row.player.id); continue; }
        const old = players[i].data() || {};
        check(!old.currentSeason || old.currentSeason === seasonId, 'group-player-season-mismatch');
        const beforeSeason = Math.max(0, Number(old.seasonPoints || 0));
        const beforeCareer = Math.max(0, Number(old.careerPoints || 0));
        const points = row.pointsEarned;
        check(Number.isSafeInteger(points) && points >= 0, 'group-settlement-invalid-points');
        const afterSeason = beforeSeason + points;
        const afterCareer = career ? beforeCareer + points : beforeCareer;
        const rankTier = ladder.tier(afterSeason), previousHighest = old.highestRankTier || '未定級';
        const highestRankTier = career && tiers.indexOf(rankTier) > tiers.indexOf(previousHighest)
          ? rankTier : previousHighest;
        const playerName = typeof profile.realName === 'string' ? profile.realName.trim() || '—' : '—';
        const placement = row.placement;
        tx.set(playerRefs[i], {
          uid: row.uid, playerName, region: String(profile.region || '').trim(),
          seasonPoints: afterSeason, careerPoints: afterCareer, currentSeason: seasonId,
          rankTier, highestRankTier, totalEvents: Number(old.totalEvents || 0) + 1,
          championCount: Number(old.championCount || 0) + Number(placement === 1),
          runnerUpCount: Number(old.runnerUpCount || 0) + Number(placement === 2),
          thirdPlaceCount: Number(old.thirdPlaceCount || 0) + Number(placement === 3),
          fourthPlaceCount: Number(old.fourthPlaceCount || 0) + Number(placement === 4),
          rankedWins: Number(old.rankedWins || 0) + row.wins,
          rankedLosses: Number(old.rankedLosses || 0) + row.losses,
          lastPointsUpdatedAt: serverTimestamp(), seasonHistory: old.seasonHistory || {},
        }, { merge: true });
        const log = {
          type: 'event', eventCode: parentCode, eventName: String(state.meta?.name || top.name || ''),
          eventDate: String(state.meta?.date || top.eventDate || ''), formatType: 'single',
          playerUid: row.uid, playerName, placement, wins: row.wins, losses: row.losses,
          pointsEarned: points, delta: points, scoring: row.scoring, seasonId,
          isTrialSeason: trial, countsTowardCareer: career,
          beforeSeasonPoints: beforeSeason, afterSeasonPoints: afterSeason,
          beforeCareerPoints: beforeCareer, afterCareerPoints: afterCareer,
          actorUid, actorName: String(actor.realName || actor.displayName || actorUid),
          createdAt: serverTimestamp(),
        };
        tx.create(logRefs[i], log);
        results.push({ playerId: row.uid, playerName, placement, pointsEarned: points, scoring: row.scoring });
      }
      check(results.length >= 2, 'group-insufficient-eligible-players');
      const completed = {
        ...state, settlementRoute: 'official-ranked', settlementPhase: 'completed',
        settlementAttempt: Math.max(1, Number(state.settlementAttempt || 0) + 1),
        settlementStartedAt: state.settlementStartedAt || now, settlementCompletedAt: now,
        settlementError: null, settlementErrorCode: null, archiveStatus: 'completed',
        completedAt: state.completedAt || now, archivedAt: state.archivedAt || now,
        ladderPointsAwarded: true, ladderSeasonId: seasonId, ladderAwardedAt: now,
        ladderResults: results, ladderSkippedPlayers: skipped, updatedAt: now,
      };
      tx.set(parentRef, {
        data: JSON.stringify(completed), tournamentPhase: 'done', archiveStatus: 'completed',
        ladderPointsAwarded: true, ladderSeasonId: seasonId, ladderTrialSeason: trial,
        ladderCountsTowardCareer: career, ladderAwardedAt: serverTimestamp(),
        ladderAwardedBy: actorUid, ladderResults: results, ladderSkippedPlayers: skipped, updatedAt: now,
      }, { merge: true });
      const publicPatch = { tournamentPhase: 'done', archiveStatus: 'completed', updatedAt: now };
      if (typeof publicSnapshot.data().bracketView === 'string') {
        let view;
        try { view = JSON.parse(publicSnapshot.data().bracketView); }
        catch { check(false, 'group-public-view-invalid'); }
        check(view && typeof view === 'object' && !Array.isArray(view), 'group-public-view-invalid');
        publicPatch.bracketView = JSON.stringify({ ...view, archiveStatus: 'completed',
          completedAt: view.completedAt || now, archivedAt: view.archivedAt || now, ladderPointsAwarded: true });
      }
      tx.set(publicRef, publicPatch, { merge: true });
      tx.set(planRef, { settlement: { seasonId, effectiveCount: input.effectiveCount,
        creditedCount: results.length, awardedAt: now } }, { merge: true });
      return { ok: true, alreadyAwarded: false, seasonId,
        effectiveCount: input.effectiveCount, creditedCount: results.length, skippedCount: skipped.length };
    });
  };
}

module.exports = { createGroupSettlement };
