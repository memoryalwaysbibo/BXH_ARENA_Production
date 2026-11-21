'use strict';

// Any legacy or partial marker suppresses every legacy admission/roster writer.
// Use ONLY on documents read inside the same transaction as the proposed write.
function onsiteWaitlistOwned(tournament, publicTournament, state) {
  return [tournament, publicTournament, state].some(d => d?.onsiteWaitlistServerOwned === true ||
    d?.onsiteWaitlistDrawEnabled === true || d?.onsiteWaitlistDraw?.enabled === true ||
    d?.meta?.registrationOnsiteWaitlistEnabled === true);
}
function assertLegacyRosterWritable(tournament, publicTournament, state) {
  if (onsiteWaitlistOwned(tournament, publicTournament, state)) throw new Error('onsite-waitlist-managed');
}
module.exports = {onsiteWaitlistOwned, assertLegacyRosterWritable};
