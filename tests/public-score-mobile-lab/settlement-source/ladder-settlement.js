"use strict";

const V1 = require("./ladder-v1");

function timestampMillis(value) {
  if (!value) return 0;
  if (typeof value.toMillis === "function") return value.toMillis();
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function computeRoundRobinStandings(state) {
  const map = {};
  for (const player of state.players || []) {
    map[player.id] = {id: player.id, name: player.name, played: 0, wins: 0, losses: 0, scoreFor: 0, scoreAgainst: 0, diff: 0, tied: false, rank: 0};
  }
  const headToHead = {};
  for (const match of (state.matches || []).filter((item) => item.bracket === "RR" && item.completed && item.winnerId)) {
    const aId = match.a?.playerId;
    const bId = match.b?.playerId;
    const loserId = match.winnerId === aId ? bId : aId;
    const quick = match.resultMethod === "quick_decision";
    if (map[match.winnerId]) {
      map[match.winnerId].played += 1;
      map[match.winnerId].wins += 1;
      if (!quick) {
        map[match.winnerId].scoreFor += match.winnerId === aId ? Number(match.scoreA || 0) : Number(match.scoreB || 0);
        map[match.winnerId].scoreAgainst += match.winnerId === aId ? Number(match.scoreB || 0) : Number(match.scoreA || 0);
      }
    }
    if (map[loserId]) {
      map[loserId].played += 1;
      map[loserId].losses += 1;
      if (!quick) {
        map[loserId].scoreFor += loserId === aId ? Number(match.scoreA || 0) : Number(match.scoreB || 0);
        map[loserId].scoreAgainst += loserId === aId ? Number(match.scoreB || 0) : Number(match.scoreA || 0);
      }
    }
    headToHead[match.winnerId] ||= {};
    headToHead[match.winnerId][loserId] = "win";
    headToHead[loserId] ||= {};
    headToHead[loserId][match.winnerId] = "loss";
  }
  Object.values(map).forEach((player) => { player.diff = player.scoreFor - player.scoreAgainst; });
  const list = Object.values(map);
  const sameStats = (a, b) => a.wins === b.wins && a.diff === b.diff && a.scoreFor === b.scoreFor;
  list.sort((a, b) => {
    if (b.wins !== a.wins) return b.wins - a.wins;
    if (headToHead[a.id]?.[b.id]) return headToHead[a.id][b.id] === "win" ? -1 : 1;
    if (b.diff !== a.diff) return b.diff - a.diff;
    if (b.scoreFor !== a.scoreFor) return b.scoreFor - a.scoreFor;
    return 0;
  });
  let index = 0;
  while (index < list.length) {
    let end = index;
    while (end + 1 < list.length && sameStats(list[end + 1], list[index])) end += 1;
    if (end > index) {
      const group = list.slice(index, end + 1);
      group.forEach((player) => { player.subWins = 0; });
      for (const player of group) {
        for (const opponent of group) {
          if (player !== opponent && headToHead[player.id]?.[opponent.id] === "win") player.subWins += 1;
        }
      }
      group.sort((a, b) => b.subWins - a.subWins);
      group.forEach((player, offset) => { list[index + offset] = player; });
      let groupIndex = index;
      while (groupIndex <= end) {
        let groupEnd = groupIndex;
        while (groupEnd + 1 <= end && list[groupEnd + 1].subWins === list[groupIndex].subWins) groupEnd += 1;
        for (let cursor = groupIndex; cursor <= groupEnd; cursor += 1) {
          list[cursor].tied = groupEnd > groupIndex;
          list[cursor].rank = index + 1;
        }
        groupIndex = groupEnd + 1;
      }
    } else {
      list[index].rank = index + 1;
    }
    index = end + 1;
  }
  return list;
}

function deriveDoubleElimPlacements(state) {
  const elimination = [];
  const lossCounts = {};
  (state.matches || []).filter((match) => !match.isBye && match.completed && match.loserId)
    .sort((a, b) => Number(a.seq || 0) - Number(b.seq || 0))
    .forEach((match) => {
      lossCounts[match.loserId] = (lossCounts[match.loserId] || 0) + 1;
      if (lossCounts[match.loserId] >= 2) elimination.push({id: match.loserId, seq: Number(match.seq || 0)});
    });
  const rest = elimination.filter((item) => item.id !== state.runnerUpId && item.id !== state.championId)
    .sort((a, b) => b.seq - a.seq);
  return {championId: state.championId, runnerUpId: state.runnerUpId, thirdId: rest[0]?.id || null, fourthId: rest[1]?.id || null};
}

function buildLadderSettlementPayload(state) {
  let places = {championId: state.championId, runnerUpId: state.runnerUpId, thirdId: state.thirdId, fourthId: state.fourthId};
  if (state.meta?.formatType === "double") places = deriveDoubleElimPlacements(state);
  const standings = state.meta?.formatType === "roundrobin" ? computeRoundRobinStandings(state) : [];
  const scored = V1.analyze(state, places, standings);
  return {
    eventCode: state.cloudCode,
    eventName: state.meta?.name || "",
    eventDate: state.meta?.date || "",
    formatType: state.meta?.formatType || "single",
    scoringVersion: V1.version,
    effectiveCount: scored.count,
    multiplier: scored.weight,
    participants: scored.players.map(({player, placement, pointsEarned, wins, losses, scoring}) => ({
      localPlayerId: player.id,
      playerUid: player.familyPlayerId || player.registrationUid || player.accountUid || player.uid || null,
      playerName: player.name,
      source: player.familyPlayerId ? "family" : player.source || "onsite",
      participantType: player.participantType || null,
      ladderEligible: player.ladderEligible !== false,
      placement,
      pointsEarned,
      wins,
      losses,
      scoring,
    })),
  };
}

function result(ok, reason, message, extra = {}) {
  return Object.assign({ok, reason, message}, extra);
}

function createLadderSettlement({db, FieldValue, now = () => Date.now()}) {
  async function resolvePlayers(payload) {
    const resolved = [];
    const skipped = [];
    for (const item of payload.participants) {
      if (["family", "test"].includes(item.source) || item.participantType === "onsite_guest" || item.ladderEligible === false) {
        skipped.push(item.playerName);
        continue;
      }
      let uid = item.playerUid || null;
      if (!uid) {
        const matches = await db.collection("users").where("realName", "==", item.playerName).limit(2).get();
        const active = matches.docs.filter((doc) => doc.data()?.active === true && !["tester"].includes(doc.data()?.role) && doc.data()?.isTestAccount !== true);
        if (active.length === 1) uid = active[0].id;
      }
      if (!uid) {
        skipped.push(item.playerName);
        continue;
      }
      resolved.push(Object.assign({}, item, {playerUid: uid}));
    }
    return {resolved, skipped};
  }

  return async function settle({code, actor}) {
    const normalized = String(code || "").trim().toUpperCase();
    if (!/^BXH-[A-Z0-9]{5,12}$/.test(normalized)) return result(false, "invalid-code", "賽事代碼格式錯誤");
    const tournamentRef = db.doc(`tournaments/${normalized}`);
    const sourceSnapshot = await tournamentRef.get();
    if (!sourceSnapshot.exists) return result(false, "not-found", "找不到這場賽事");
    const source = sourceSnapshot.data() || {};
    if (source.ladderPointsAwarded === true) {
      return {ok: true, alreadyAwarded: true, seasonId: source.ladderSeasonId || null, results: source.ladderResults || [], skippedPlayers: source.ladderSkippedPlayers || []};
    }
    if (source.testMode === true || source.eventAuthority !== "official" || source.ladderMode !== "ranked") {
      return result(false, "not-ranked", "只有正式積分賽可以結算天梯積分");
    }
    let state;
    let payload;
    try {
      state = typeof source.data === "string" ? JSON.parse(source.data) : source.data;
      if (!state?.matches?.length || state.matches.some((match) => !match.isBye && !match.completed)) throw new Error("仍有未完成對戰，不能結算積分");
      payload = buildLadderSettlementPayload(state);
      const topCount = payload.participants.filter((item) => item.placement >= 1 && item.placement <= 4).length;
      if (topCount < Math.min(4, payload.participants.length)) throw new Error("前四名尚未完整，請先完成名次判定");
    } catch (error) {
      return result(false, "v1-invalid-results", error.message || "V1 積分資料不完整");
    }
    const sourceFingerprint = typeof source.data === "string" ? source.data : JSON.stringify(source.data);
    const {resolved, skipped} = await resolvePlayers(payload);
    const seen = new Set();
    for (const item of resolved) {
      if (seen.has(item.playerUid)) return result(false, "duplicate-player-account", "同一玩家帳號在本場名單中出現超過一次");
      seen.add(item.playerUid);
    }

    const controlRef = db.doc("ladderSystem/current");
    return db.runTransaction(async (transaction) => {
      const [tournamentSnapshot, controlSnapshot] = await Promise.all([transaction.get(tournamentRef), transaction.get(controlRef)]);
      if (!tournamentSnapshot.exists) return result(false, "not-found", "找不到這場賽事");
      const tournament = tournamentSnapshot.data() || {};
      if (tournament.ladderPointsAwarded === true) {
        return {ok: true, alreadyAwarded: true, seasonId: tournament.ladderSeasonId || null, results: tournament.ladderResults || [], skippedPlayers: tournament.ladderSkippedPlayers || []};
      }
      const currentFingerprint = typeof tournament.data === "string" ? tournament.data : JSON.stringify(tournament.data);
      if (currentFingerprint !== sourceFingerprint) return result(false, "v1-state-changed", "賽事資料已更新，請重新讀取後再結算");
      if (tournament.systemClosed === true) return result(false, "system-closed", "系統關閉的賽事不能結算積分");
      if (tournament.testMode === true || tournament.eventAuthority !== "official" || tournament.ladderMode !== "ranked") return result(false, "not-ranked", "只有正式積分賽可以結算天梯積分");
      if (!controlSnapshot.exists) return result(false, "season-not-initialized", "目前天梯賽季尚未初始化");
      const control = controlSnapshot.data() || {};
      if (control.rolloverInProgress === true) return result(false, "season-rollover-in-progress", "賽季切換進行中，請稍後再完成賽事");
      const currentTime = now();
      if (timestampMillis(control.startAt) && currentTime < timestampMillis(control.startAt)) return result(false, "season-not-started", "本季天梯尚未開始");
      if (timestampMillis(control.endAt) && currentTime > timestampMillis(control.endAt)) return result(false, "season-ended", "本季天梯已結束，請先完成新賽季切換");
      const seasonId = String(control.currentSeason || "S1");
      const trial = seasonId.toUpperCase() === "S0" || control.isTrialSeason === true;

      const playerRefs = resolved.map((item) => db.doc(`ladderPlayers/${item.playerUid}`));
      const profileRefs = resolved.map((item) => db.doc(`users/${item.playerUid}`));
      const logRefs = resolved.map((item) => db.doc(`ladderTransactions/${normalized}_${item.playerUid}`));
      const registrationRefs = resolved.map((item) => item.source === "online" ? db.doc(`tournaments/${normalized}/registrations/${item.playerUid}`) : null);
      const [playerSnapshots, profileSnapshots, logSnapshots, registrationSnapshots] = await Promise.all([
        Promise.all(playerRefs.map((ref) => transaction.get(ref))),
        Promise.all(profileRefs.map((ref) => transaction.get(ref))),
        Promise.all(logRefs.map((ref) => transaction.get(ref))),
        Promise.all(registrationRefs.map((ref) => ref ? transaction.get(ref) : null)),
      ]);
      if (logSnapshots.some((snapshot) => snapshot.exists)) return result(false, "settlement-conflict", "偵測到既有積分紀錄但賽事尚未標記完成，請由最高管理員檢查");
      const cancelled = [];
      registrationSnapshots.forEach((snapshot, index) => {
        if (registrationRefs[index] && (!snapshot?.exists || snapshot.data()?.status !== "confirmed")) cancelled.push(resolved[index].playerName);
      });
      if (cancelled.length) return result(false, "cancelled-players", `名單含已取消或非正取玩家：${cancelled.join("、")}`, {unlinkedPlayers: cancelled});
      if (playerSnapshots.some((snapshot) => snapshot.exists && snapshot.data()?.currentSeason && snapshot.data().currentSeason !== seasonId)) {
        return result(false, "player-season-mismatch", "玩家賽季資料尚未完成切換");
      }

      const results = [];
      const skippedPlayers = [...skipped];
      for (let index = 0; index < resolved.length; index += 1) {
        const item = resolved[index];
        const profile = profileSnapshots[index].exists ? profileSnapshots[index].data() : null;
        if (!profile || profile.active !== true || profile.role === "tester" || profile.isTestAccount === true) {
          if (!skippedPlayers.includes(item.playerName)) skippedPlayers.push(item.playerName);
          continue;
        }
        const old = playerSnapshots[index].exists ? playerSnapshots[index].data() : {};
        const oldSeason = Number(old.seasonPoints || 0);
        const oldCareer = Number(old.careerPoints || 0);
        const points = Number(item.pointsEarned || 0);
        const seasonPoints = oldSeason + points;
        const careerPoints = trial ? oldCareer : oldCareer + points;
        const rankTier = V1.tier(seasonPoints);
        const oldHighest = old.highestRankTier || "未定級";
        const tierIndex = (name) => Math.max(0, V1.tiers.findIndex((tier) => tier.name === name));
        const highestRankTier = trial ? oldHighest : (tierIndex(rankTier) > tierIndex(oldHighest) ? rankTier : oldHighest);
        const placement = Number(item.placement || 0) || null;
        transaction.set(playerRefs[index], {
          uid: item.playerUid,
          playerName: item.playerName || old.playerName || "",
          region: String(profile.region || "").trim(),
          seasonPoints,
          careerPoints,
          rankTier,
          currentSeason: seasonId,
          highestRankTier,
          totalEvents: Number(old.totalEvents || 0) + 1,
          championCount: Number(old.championCount || 0) + (placement === 1 ? 1 : 0),
          runnerUpCount: Number(old.runnerUpCount || 0) + (placement === 2 ? 1 : 0),
          thirdPlaceCount: Number(old.thirdPlaceCount || 0) + (placement === 3 ? 1 : 0),
          fourthPlaceCount: Number(old.fourthPlaceCount || 0) + (placement === 4 ? 1 : 0),
          rankedWins: Number(old.rankedWins || 0) + Number(item.wins || 0),
          rankedLosses: Number(old.rankedLosses || 0) + Number(item.losses || 0),
          lastPointsUpdatedAt: FieldValue.serverTimestamp(),
          seasonHistory: old.seasonHistory || {},
        }, {merge: true});
        transaction.create(logRefs[index], {
          type: "event",
          eventCode: normalized,
          eventName: payload.eventName || tournament.name || "",
          eventDate: payload.eventDate || tournament.eventDate || "",
          formatType: payload.formatType || tournament.formatType || "single",
          playerUid: item.playerUid,
          playerName: item.playerName || "",
          placement,
          wins: Number(item.wins || 0),
          losses: Number(item.losses || 0),
          pointsEarned: points,
          scoring: item.scoring,
          delta: points,
          seasonId,
          isTrialSeason: trial,
          countsTowardCareer: !trial,
          beforeSeasonPoints: oldSeason,
          afterSeasonPoints: seasonPoints,
          beforeCareerPoints: oldCareer,
          afterCareerPoints: careerPoints,
          actorUid: actor.uid,
          actorName: String(actor.name || ""),
          createdAt: FieldValue.serverTimestamp(),
        });
        results.push({playerId: item.playerUid, playerName: item.playerName || "", placement, pointsEarned: points, scoring: item.scoring});
      }
      transaction.update(tournamentRef, {
        ladderPointsAwarded: true,
        ladderSeasonId: seasonId,
        ladderTrialSeason: trial,
        ladderCountsTowardCareer: !trial,
        ladderResults: results,
        ladderSkippedPlayers: skippedPlayers,
        ladderAwardedAt: FieldValue.serverTimestamp(),
        ladderAwardedBy: actor.uid,
      });
      return {ok: true, alreadyAwarded: false, seasonId, results, skippedPlayers, awardedAt: currentTime};
    });
  };
}

module.exports = {createLadderSettlement, buildLadderSettlementPayload, computeRoundRobinStandings, deriveDoubleElimPlacements};
