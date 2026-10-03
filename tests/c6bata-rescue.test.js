const assert = require("node:assert/strict");
global.window = {};
global.document = undefined;
const { computePlan } = require("../modules/main-app/c6bata-rescue.js");

function completed(id, bracket, winnerId, loserId, isBye = false) {
  return { id, bracket, round: 0, indexInRound: 0, a: null, b: null, isBye, completed: true, winnerId, loserId, scoreA: 4, scoreB: 0, log: [], faultActions: [] };
}
function lb(id, round, source, a = null, b = null, isDone = false, winnerId = null, loserId = null) {
  return { id, bracket: "LB", round, indexInRound: 0, lbSrc: source, a: a ? { type: "player", playerId: a } : null, b: b ? { type: "player", playerId: b } : null, isBye: false, completed: isDone, winnerId, loserId, scoreA: 0, scoreB: 0, log: [], faultActions: [] };
}
function fixture() {
  const matches = [];
  for (let i = 1; i <= 3; i++) {
    const byeA = completed(`bye-a-${i}`, "WB", `advance-a-${i}`, null, true);
    const byeB = completed(`bye-b-${i}`, "WB", `advance-b-${i}`, null, true);
    const dead = lb(`dead-${i}`, 0, { type: "first", srcAId: byeA.id, srcBId: byeB.id });
    const prior = lb(`prior-${i}`, 0, { type: "first", srcAId: byeA.id, srcBId: byeB.id }, `p${i}`, `loser${i}`, true, `p${i}`, `loser${i}`);
    const opponent = lb(`opponent-${i}`, 1, { type: "merge", survivorMatchId: prior.id, dropperMatchId: prior.id }, `q${i}`, `r${i}`, true, `q${i}`, `r${i}`);
    const candidate = lb(`candidate-${i}`, 1, { type: "merge", survivorMatchId: prior.id, dropperMatchId: dead.id }, `p${i}`);
    const target = lb(`target-${i}`, 2, { type: "merge", survivorMatchId: candidate.id, dropperMatchId: opponent.id }, null, `r${i}`);
    matches.push(byeA, byeB, dead, prior, opponent, candidate, target);
  }
  return { cloudCode: "BXH-C6BATA", meta: { formatType: "double" }, players: [], matches };
}

const state = fixture();
const before = JSON.stringify(state);
const plan = computePlan(state);
assert.equal(plan.ok, true, plan.errors.join(", "));
assert.equal(plan.deadMatches.length, 3);
assert.equal(plan.operations.length, 3);
assert.equal(plan.stopMatches.length, 3);
assert.equal(plan.waiting.length, 0);
assert.ok(plan.operations.every(x => x.stopForManualScore && x.otherPlayerId));
assert.deepEqual(plan.operations.map(x => x.targetSlot), ["a", "a", "a"]);
assert.deepEqual(plan.protected, { completedMatchesModified: 0, scoresModified: 0, winnerLoserModified: 0 });
assert.equal(JSON.stringify(state), before, "Dry Run must not mutate source state");

assert.equal(computePlan({ ...fixture(), cloudCode: "OTHER-ROOM" }).ok, false);
assert.equal(computePlan({ ...fixture(), meta: { formatType: "single" } }).ok, false);
console.log("C6BATA rescue source-graph tests passed");
