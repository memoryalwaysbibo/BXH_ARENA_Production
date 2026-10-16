"use strict";
const HOUR = 60 * 60 * 1000;
function millis(value) {
  if (value && typeof value.toMillis === "function") value = value.toMillis();
  if (value instanceof Date) value = value.getTime();
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
}
function assessRoom(doc, now, tracker = {}) {
  if (doc.eventAuthority !== "community" || doc.testMode === true) return {status: "excluded"};
  if (doc.qrCheckinManaged === true) return {status: "qr-checkin-records-retained"};
  let state;
  try { state = typeof doc.data === "string" ? JSON.parse(doc.data) : doc.data; }
  catch (_) { return {status: "invalid-state"}; }
  if (!state || typeof state !== "object" || Array.isArray(state) || state.meta?.eventAuthority !== "community") return {status: "invalid-state"};
  if ([doc.archiveStatus, state.archiveStatus].includes("completed") || [doc.tournamentPhase, state.tournamentPhase].some(p => ["done", "completed"].includes(p))) return {status: "completed"};
  if (doc.deletionStatus) return {status: "deletion-in-progress"};
  if (doc.systemClosed === true) return {status: "system-closed"};
  // Multi-transaction lottery workflows need their own lease integration.
  if (doc.registrationSelection || state.entrySelection) return {status: "entry-selection-managed"};
  if (!Array.isArray(state.players) || (state.matches != null && !Array.isArray(state.matches))) return {status: "invalid-state"};
  const realMatches = (state.matches || []).filter(m => m && !m.isBye);
  if (realMatches.length && realMatches.every(m => m.completed === true)) return {status: "awaiting-settlement"};
  const times = [doc.lastActivityAt, state.lastActivityAt, doc.updatedAt, state.updatedAt, tracker.lastAt, tracker.observedAt, tracker.restoredAt, tracker.documentUpdatedAtMs].map(millis).filter(Boolean);
  const created = [doc.createdAt, state.createdAt].map(millis).filter(Boolean);
  const lastActivityAt = Math.max(...(times.length ? times : created));
  if (!Number.isFinite(lastActivityAt) || lastActivityAt > now) return {status: "invalid-activity"};
  const started = !!(state.startedAt || doc.startedAt);
  // Cloud registration counters may be newer than the serialized roster.
  const structured = started || state.players.some(p => p && p.isRoomOwner !== true) || (state.matches || []).length > 0 || !!state.bracketSize || Number(doc.communityParticipantCount) > 0;
  let expiresAtMs = lastActivityAt + (structured ? 24 : 6) * HOUR;
  let rule = structured ? "active-24h" : "empty-6h";
  const dates = [state.meta.date, doc.eventDate].filter(Boolean);
  if (!started && structured && dates.length) {
    if (dates.some(d => typeof d !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(d))) return {status: "invalid-date"};
    const ends = dates.map(d => Date.parse(d + "T23:59:59+08:00"));
    if (ends.some(t => !Number.isFinite(t))) return {status: "invalid-date"};
    if (ends.some((t, i) => new Date(t + 8 * HOUR).toISOString().slice(0, 10) !== dates[i])) return {status: "invalid-date"};
    const dateExpiry = Math.max(...ends) + 14 * 24 * HOUR;
    if (dateExpiry > expiresAtMs) { expiresAtMs = dateExpiry; rule = "event-plus-14d"; }
  }
  return {status: expiresAtMs <= now ? "due" : "retained", rule, lastActivityAt, expiresAtMs, storedExpiresAtMs: millis(doc.expiresAt)};
}
async function auditRooms(db, now, emit, {pageSize = 200, maxPages = 20} = {}) {
  let cursor, scanned = 0;
  const counts = {};
  for (let page = 0; page < maxPages; page++) {
    let query = db.collection("tournaments").where("eventAuthority", "==", "community").orderBy("__name__").limit(pageSize);
    if (cursor) query = query.startAfter(cursor);
    const snap = await query.get();
    for (const room of snap.docs) {
      const activity = await db.doc(`tournamentActivity/${room.id}`).get();
      const result = assessRoom(room.data(), now, {...(activity.exists ? activity.data() : {}), documentUpdatedAtMs: millis(room.updateTime)});
      counts[result.status] = (counts[result.status] || 0) + 1;
      scanned++;
      // No names, roster, owner UID, or serialized state in logs.
      if (result.status === "due" || result.status.startsWith("invalid")) emit({code: room.id, ...result, mode: "dry-run"});
    }
    if (snap.docs.length < pageSize) return {mode: "dry-run", scanned, counts, complete: true};
    cursor = snap.docs[snap.docs.length - 1];
  }
  return {mode: "dry-run", scanned, counts, complete: false};
}
module.exports = {assessRoom, auditRooms};
