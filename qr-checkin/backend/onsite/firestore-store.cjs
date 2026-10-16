'use strict';

const {DrawError, MAX_REGISTRATIONS} = require('./core.cjs');
const {Timestamp}=require('firebase-admin/firestore');
const {prepare}=require('../onsite-commit.cjs');

// Dependency-injected: importing this module never initializes Firebase or makes
// a network call. Only a trusted Admin SDK instance may be supplied in production.
class FirestoreStore {
  constructor(db, FieldValue) { this.db = db; this.FieldValue = FieldValue; }
  async transact({code, uid, operationId}, callback) {
    const tr = this.db.doc('tournaments/' + code);
    const pr = this.db.doc('publicTournaments/' + code);
    const op = operationId ? tr.collection('onsiteWaitlistOperations').doc(operationId) : null;
    return this.db.runTransaction(async tx => {
      // All reads precede every write. The tournament document serializes draws,
      // onsite edits, capacity changes and existing transaction-based writers.
      const [user, tournament, publicTournament, registrations, rounds, withdrawals, replacements, operation] = await Promise.all([
        tx.get(this.db.doc('users/' + uid)), tx.get(tr), tx.get(pr),
        tx.get(tr.collection('registrations').limit(MAX_REGISTRATIONS + 1)),
        tx.get(tr.collection('onsiteWaitlistRounds').orderBy('number')),
        tx.get(tr.collection('onsiteWaitlistWithdrawals').orderBy('revision')),
        tx.get(tr.collection('onsiteWaitlistReplacements').orderBy('revision')),
        op ? tx.get(op) : Promise.resolve(null),
      ]);
      if (registrations.docs.length > MAX_REGISTRATIONS) throw new DrawError('transaction-size-limit', 409, {limit: MAX_REGISTRATIONS});
      const aggregate = {
        user: user.data(), tournament: tournament.exists ? tournament.data() : null,
        publicTournament: publicTournament.exists ? publicTournament.data() : null,
        registrations: registrations.docs.map(doc => ({...doc.data(), registrationId: doc.id})),
        rounds: rounds.docs.map(doc => doc.data()),
        withdrawals: withdrawals.docs.map(doc => doc.data()),
        replacements: replacements.docs.map(doc => doc.data()),
        operations: operation?.exists ? {[operationId]: operation.data()} : {},
      };
      const output = await callback(aggregate);
      const change = output.commit;
      const attendance=await prepare({tx,ref:tr,aggregate,output,uid,code});
      if (change) {
        for (const row of change.registrationChanges) {
          const patch = {...row.patch};
          for (const key of ['updatedAt', 'promotedAt']) if (patch[key] !== undefined && this.FieldValue?.serverTimestamp) patch[key] = this.FieldValue.serverTimestamp();
          tx.update(tr.collection('registrations').doc(row.registrationId), patch);
        }
        tx.update(tr, change.tournamentPatch);
        tx.update(pr, change.publicPatch);
        if (change.round) tx.create(tr.collection('onsiteWaitlistRounds').doc(change.round.id), change.round);
        if (change.withdrawal) tx.create(tr.collection('onsiteWaitlistWithdrawals').doc(change.withdrawal.id), change.withdrawal);
        if (change.replacement) tx.create(tr.collection('onsiteWaitlistReplacements').doc(change.replacement.id), change.replacement);
        tx.create(op, change.operation);
        if(attendance?.receipt)tx.set(attendance.receiptRef,attendance.receipt);
        if(attendance?.audit)tx.create(tr.collection('checkinAudit').doc(attendance.auditId),{...attendance.audit,code,eventName:output.result.canonicalState.meta?.name||'',at:Timestamp.fromMillis(attendance.audit.at)});
      }
      return output.result;
    });
  }
}

module.exports = {FirestoreStore};
