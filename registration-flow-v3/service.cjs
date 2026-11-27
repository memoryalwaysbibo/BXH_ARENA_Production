'use strict';
const {createHash} = require('node:crypto');
const {summarize, transition} = require('./core.cjs');
const {project} = require('./roster.cjs');
const active = user => user?.active === true && !user.deleted && !['deleted','disabled','frozen'].includes(user.accountStatus);
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const id = /^[A-Za-z0-9_-]{1,128}$/;

// Dependencies must authorize using trusted room/account state inside the
// same transaction. No fixed owner or room-code allowlist is used here.
function createService({db, authorizeJoin, authorizeReview, authorizeCancel, clock = Date.now}) {
  if (![authorizeJoin, authorizeReview, authorizeCancel].every(fn => typeof fn === 'function'))
    throw Error('registration-authorizers-required');
  return async request => {
    const uid = request.auth?.uid;
    const {code, action, operationId, registrationId = uid, expectedAttemptId} = request.data || {};
    if (typeof uid !== 'string' || !id.test(uid)) throw Error('auth-required');
    if (typeof code !== 'string' || !/^BXH-[A-Z0-9]{4,16}$/.test(code) ||
        !['join','approve','reject','cancel'].includes(action) ||
        typeof operationId !== 'string' || !/^[A-Za-z0-9_-]{8,100}$/.test(operationId) ||
        typeof registrationId !== 'string' || !id.test(registrationId)) throw Error('invalid-operation');
    const room = db.doc('tournaments/' + code);
    const mirror = db.doc('publicTournaments/' + code);
    const receipt = room.collection('registrationV3Operations').doc(hash([uid,operationId]));
    const user = db.doc('users/' + uid);
    const requestHash = hash([action,registrationId,expectedAttemptId ?? null]);
    return db.runTransaction(async tx => {
      const [rs, ps, us, op] = await tx.getAll(room,mirror,user,receipt);
      if (!active(us.data())) throw Error('auth-required');
      if (!rs.exists || !ps.exists) throw Error('not-found');
      const t = rs.data(), p = ps.data();
      if (t.registrationFlowVersion !== 3 || p.registrationFlowVersion !== 3) throw Error('registration-v3-required');
      if (op.exists) {
        if (op.data().requestHash !== requestHash) throw Error('operation-conflict');
        return {...op.data().result,replayed:true};
      }
      const now = clock();
      if (t.tournamentPhase !== 'waiting' || p.tournamentPhase !== 'waiting' ||
          t.systemClosed || p.systemClosed || t.eventCancelled || p.eventCancelled)
        throw Error('tournament-started');
      const snapshot = await tx.get(room.collection('registrations'));
      const rows = snapshot.docs.map(doc => ({...doc.data(), registrationId:doc.id}));
      const before = summarize(t.capacity,rows);
      for (const key of Object.keys(before))
        if (t[key] !== before[key] || p[key] !== before[key]) throw Error('registration-state-conflict');
      const previous = rows.find(row => row.registrationId === registrationId);
      const context = {tx,uid,user:us.data(),room:t,publicRoom:p,registrationId,previous,now,action};
      const authorizer = action === 'join' ? authorizeJoin : action === 'cancel' ? authorizeCancel : authorizeReview;
      if (await authorizer(context) !== true) throw Error('permission-denied');
      if (action !== 'join' && (!previous?.attemptId || expectedAttemptId !== previous.attemptId))
        throw Error('registration-attempt-changed');
      const next = transition({capacity:t.capacity,rows},{action,registrationId},now);
      if (action === 'join') {
        const name = String(us.data().realName || '').trim();
        if (!name || registrationId !== uid) throw Error('invalid-participant');
        Object.assign(next.row,{uid,realName:name,displayName:name,publicName:name,attemptId:hash([uid,operationId])});
      } else if (action === 'approve' || action === 'reject') {
        next.row.reviewedBy = uid;
      }
      const projection = project(t,p,next.rows,now);
      const result = {ok:true,registrationId,status:next.row.status,attemptId:next.row.attemptId,summary:next.summary};
      tx.set(room.collection('registrations').doc(registrationId),{...next.row,registrationFlowVersion:3});
      tx.update(room,{...next.summary,...projection.privatePatch,updatedAt:now});
      tx.update(mirror,{...next.summary,...projection.publicPatch,updatedAt:now});
      tx.create(receipt,{requestHash,result,actorUid:uid,createdAt:now});
      return result;
    });
  };
}
module.exports = {createService};
