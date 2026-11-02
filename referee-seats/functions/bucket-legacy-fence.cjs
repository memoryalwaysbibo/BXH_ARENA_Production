'use strict';

// The old callable uses Admin SDK, which bypasses Firestore Security Rules.
// Reject every legacy scoring command once a room has any bucket manifest.
// A malformed or partially migrated manifest must fail closed as well.
function assertLegacyScoringWritable(room) {
  if (room && Object.prototype.hasOwnProperty.call(room, 'scoreStorage')) {
    throw Error('bucket-scoring-required');
  }
}

module.exports = {assertLegacyScoringWritable};
