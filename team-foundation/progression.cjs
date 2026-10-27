'use strict';
// Candidate rules; integration with authoritative archive and score sources is pending.
const THRESHOLDS = Object.freeze([3,4,5,6,7,8,9,10,11]);
function progression(totalXp) {
  if (!Number.isSafeInteger(totalXp) || totalXp < 0) throw new TypeError('invalid experience');
  let remaining = totalXp, level = 1;
  for (const required of THRESHOLDS) {
    if (remaining < required) break;
    remaining -= required; level++;
  }
  const max = level === 10;
  return {level, capacity: max ? 20 : 9 + level, unlockedFrames: [4,7,10].filter(x => x <= level), currentXp: max ? null : remaining, nextXp: max ? null : THRESHOLDS[level-1], totalXp};
}
function teamStrength(scores) {
  if (!Array.isArray(scores) || scores.some(x => !Number.isFinite(x))) throw new TypeError('invalid scores');
  return scores.reduce((a,b) => a+b,0);
}
module.exports = {THRESHOLDS, progression, teamStrength};
