"use strict";
// Activation requires delete mode plus runtime/rules verification documented in README.
const {assessRoom} = require("./community-cleanup-policy");
const LEASE_MS = 15 * 60 * 1000;
async function cleanRoom(db, code, now, token) {
  if (!/^BXH-[A-Z0-9]{6}$/.test(code) || !token) throw Error("invalid-cleanup-request");
  const room = db.doc(`tournaments/${code}`), mirror = db.doc(`publicTournaments/${code}`);
  const job = db.doc(`communityCleanupJobs/${code}`), config = db.doc("systemSettings/communityCleanup");
  const activity = db.doc(`tournamentActivity/${code}`);
  const claim = await db.runTransaction(async tx => {
    const [cs, js, rs, ps, as] = await Promise.all([config, job, room, mirror, activity].map(ref => tx.get(ref)));
    if (cs.data()?.enabled !== true || cs.data()?.mode !== "delete" || cs.data()?.readinessVerified !== true) return "disabled";
    // This applies to expired leases as well as new cleanup claims. A QR room
    // keeps its receipts/audit until an explicit authorized event deletion.
    if (rs.data()?.qrCheckinManaged === true) return "qr-checkin-records-retained";
    const old = js.data() || {};
    if (old.status === "done") return "already-deleted";
    if (old.status === "deleting" && old.leaseUntil > now) return "busy";
    if (old.status !== "deleting") {
      if (!rs.exists) return "missing";
      const decision = assessRoom(rs.data(), now, {...(as.data() || {}), documentUpdatedAtMs: rs.updateTime?.toMillis()});
      if (decision.status !== "due") return decision.status;
      tx.set(job, {status: "deleting", token, leaseUntil: now + LEASE_MS, claimedAt: now, attempts: 1, expiry: decision.expiresAtMs});
      // Existing security rules and registration services recognize systemClosed.
      const patch = {systemClosed: true, deletionStatus: "deleting", deletionSource: "community-idle", eventCancelled: true, registrationEnabled: false, registrationStatus: "closed", registrationVisibility: "private", visibility: "private"};
      tx.update(room, patch);
      if (ps.exists) tx.update(mirror, patch);
    } else {
      // Never resume a job against a replaced or externally unlocked room.
      if (rs.exists && (rs.data().deletionSource !== "community-idle" || rs.data().systemClosed !== true || rs.data().deletionStatus !== "deleting")) return "conflict";
      tx.update(job, {token, leaseUntil: now + LEASE_MS, attempts: (old.attempts || 0) + 1});
    }
    return "claimed";
  });
  if (claim !== "claimed") return {status: claim};
  try {
    await db.recursiveDelete(room);
    await db.recursiveDelete(mirror);
    await db.recursiveDelete(db.doc(`courtCalls/${code}`));
    const [rs, ps] = await Promise.all([room.get(), mirror.get()]);
    if (rs.exists || ps.exists) throw Error("delete-verification-failed");
    await db.runTransaction(async tx => {
      const js = await tx.get(job);
      if (js.data()?.token !== token) throw Error("cleanup-lease-lost");
      tx.update(job, {status: "done", completedAt: Date.now(), leaseUntil: 0});
    });
    return {status: "deleted"};
  } catch (error) {
    // Keep the external job and frozen room for retry; do not reopen partial data.
    await db.runTransaction(async tx => {
      const js = await tx.get(job);
      if (js.data()?.token === token) tx.update(job, {leaseUntil: 0, lastError: "cleanup-failed", failedAt: Date.now()});
    });
    throw error;
  }
}
module.exports = {cleanRoom};
