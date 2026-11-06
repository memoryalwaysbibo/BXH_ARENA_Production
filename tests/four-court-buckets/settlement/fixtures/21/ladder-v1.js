"use strict";

// Keep this deterministic scoring module byte-for-byte compatible in behaviour
// with the browser's ladder-v1.js. It performs no database access.
const version = "BXH-LADDER-V1-LINEAR";
const tiers = Object.freeze([
  {name: "未定級", min: 0}, {name: "青銅", min: 1}, {name: "白銀", min: 100},
  {name: "黃金", min: 300}, {name: "白金", min: 600}, {name: "鑽石", min: 1100},
  {name: "大師", min: 1800}, {name: "宗師", min: 2800},
].map(Object.freeze));
const anchors = Object.freeze([16, 32, 64, 128, 256, 512]);

function multiplier(count) {
  if (!Number.isInteger(count) || count < 1 || count > 512) {
    throw new Error("V1 積分僅支援 1～512 位有效參賽者");
  }
  if (count <= 16) return 1;
  const i = anchors.findIndex((n) => count <= n);
  return 1 + (i - 1) * 0.5 + (count - anchors[i - 1]) / (anchors[i] - anchors[i - 1]) * 0.5;
}

function tier(points) {
  const p = Math.max(0, Number(points) || 0);
  return tiers.reduce((name, item) => p >= item.min ? item.name : name, "未定級");
}

function bonus(place, count, wins) {
  if (!(wins > 0) || !Number.isInteger(place) || place < 1) return 0;
  if (place <= 4) return [90, 60, 40, 30][place - 1];
  if (place <= 8) return 20;
  if (place <= 16) return 10;
  if (place <= 32) return count > 64 ? 8 : 0;
  if (place <= 64) return count > 96 ? 6 : 0;
  if (place <= 96) return count > 128 ? 4 : 0;
  if (place <= 128) return count > 160 ? 2 : 0;
  return 0;
}

function isPlayed(match) {
  const a = match.a?.playerId;
  const b = match.b?.playerId;
  return !!(match.completed && !match.isBye && a && b && a !== b &&
    (match.winnerId === a || match.winnerId === b) && !match.forfeit && !match.isForfeit &&
    !["forfeit", "walkover", "no_show"].includes(match.resultMethod));
}

function analyze(state, places, standings) {
  const matches = state.matches || [];
  const format = state.meta?.formatType || "single";
  if (!["single", "double", "round", "roundrobin"].includes(format)) {
    throw new Error("此賽制尚未支援 V1 積分");
  }
  const official = state.testMode !== true && state.meta?.eventAuthority !== "test";
  const roster = (state.players || []).filter((player) => !official ||
    (player.source !== "test" && player.isTestData !== true && !player.testPlayerKey));
  const validIds = new Set(roster.map((player) => player.id));
  const wins = {};
  const losses = {};
  const actual = new Set();
  const ranks = {};
  for (const match of matches.filter(isPlayed)) {
    const a = match.a.playerId;
    const b = match.b.playerId;
    const loser = match.winnerId === a ? b : a;
    if (!validIds.has(a) || !validIds.has(b)) continue;
    actual.add(a);
    actual.add(b);
    wins[match.winnerId] = (wins[match.winnerId] || 0) + 1;
    losses[loser] = (losses[loser] || 0) + 1;
  }
  const players = roster.filter((player) => actual.has(player.id));
  if (new Set(players.map((player) => player.id)).size !== players.length) {
    throw new Error("參賽名單含重複選手");
  }
  const count = players.length;
  if (count < 2) throw new Error("至少需要兩位有效參賽者才能結算積分");
  const weight = multiplier(count);
  if (format === "single") {
    const rounds = matches.filter((match) => match.bracket === "SE").map((match) => Number(match.round));
    const size = 2 ** (Math.max(...rounds) + 1);
    for (const match of matches) {
      if (match.bracket !== "SE" || !match.completed || !match.winnerId) continue;
      const loser = match.loserId || (match.winnerId === match.a?.playerId ? match.b?.playerId : match.a?.playerId);
      if (loser) ranks[loser] = size / 2 ** (Number(match.round) + 1) + 1;
    }
  } else if (format === "double") {
    const groups = new Map();
    for (const match of matches) {
      if (match.bracket !== "LB" || !match.completed || !match.winnerId) continue;
      const loser = match.loserId || (match.winnerId === match.a?.playerId ? match.b?.playerId : match.a?.playerId);
      if (!loser) continue;
      const round = Number(match.round);
      if (!groups.has(round)) groups.set(round, new Set());
      groups.get(round).add(loser);
    }
    let next = 3;
    for (const round of [...groups.keys()].sort((a, b) => b - a)) {
      for (const id of groups.get(round)) ranks[id] = next;
      next += groups.get(round).size;
    }
  } else {
    for (const player of standings || []) ranks[player.id] = player.rank;
  }
  ["championId", "runnerUpId", "thirdId", "fourthId"].forEach((key, index) => {
    if (places[key]) ranks[places[key]] = index + 1;
  });
  return {
    count,
    weight,
    players: players.map((player) => {
      const placement = ranks[player.id] || null;
      const placementBonus = bonus(placement, count, wins[player.id] || 0);
      return {
        player,
        placement,
        wins: wins[player.id] || 0,
        losses: losses[player.id] || 0,
        pointsEarned: 10 + Math.round(placementBonus * weight),
        scoring: {
          version,
          effectiveCount: count,
          multiplier: weight,
          basePoints: 10,
          placementBonus,
          weightedBonus: Math.round(placementBonus * weight),
          placementBasis: placement,
        },
      };
    }),
  };
}

module.exports = Object.freeze({version, tiers, anchors, multiplier, tier, bonus, isPlayed, analyze});
