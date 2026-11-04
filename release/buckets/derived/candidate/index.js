"use strict";
const {countOfficialMatches}=require("./official-match-titles-core.cjs");
const {randomUUID} = require('node:crypto');

const {onCall, HttpsError} = require("firebase-functions/v2/https");
const {onSchedule} = require("firebase-functions/v2/scheduler");
const {onDocumentCreated, onDocumentWritten} = require("firebase-functions/v2/firestore");
const {setGlobalOptions} = require("firebase-functions/v2");
const {initializeApp} = require("firebase-admin/app");
const {getFirestore, FieldValue, FieldPath, Timestamp} = require("firebase-admin/firestore");

initializeApp();
const db = getFirestore();
const seasonVenueTitles = require("./season-venue-service.cjs").createSeasonVenueService({db, FieldValue});
const titleBatch1 = require("./title-batch1-service.cjs").createTitleBatch1Service({db, FieldValue});
const placementTitles = require("./placement-service.cjs").createPlacementService({db, FieldValue});
const REGION = "asia-east1";
setGlobalOptions({region: REGION, maxInstances: 5});
const TAIPEI_OFFSET_MS = 8 * 60 * 60 * 1000;
const ALLOWED_TITLE_FORMATS = new Set([
  "realname_nickname_title",
  "realname_dash_nickname_title",
  "realname_title",
  "nickname_title",
]);
const DEFAULT_SETTINGS = Object.freeze({
  titlesEnabled: false,
  automaticTitleAwardsEnabled: false,
  dailyCheckInEnabled: false,
  checkInTitleAwardsEnabled: false,
  timezone: "Asia/Taipei",
  launchAt: null,
});

function isTestProfile(profile) {
  return !!profile && (profile.role === "tester" || profile.isTestAccount === true);
}
function isActiveStaffProfile(profile) {
  return !!profile && profile.active === true && !isTestProfile(profile) && ["staff", "admin", "super_admin"].includes(profile.role);
}
// Derive award progress from immutable check-in records, never the mixed display counters.
function officialCheckInProgress(records, today) {
  const dates = [...new Set(records.filter(r => r.isTestData !== true && /^\d{4}-\d{2}-\d{2}$/.test(r.checkInDate || "") && r.checkInDate <= today).map(r => r.checkInDate))].sort();
  const keys = new Set(dates);
  let cursor = keys.has(today) ? today : previousDateKey(today), streak = 0;
  while (keys.has(cursor)) { streak++; cursor = previousDateKey(cursor); }
  return {totalCheckInDays: dates.length, currentCheckInStreak: streak};
}

function taipeiDateKey(date = new Date()) {
  return new Date(date.getTime() + TAIPEI_OFFSET_MS).toISOString().slice(0, 10);
}
function previousDateKey(key) {
  return new Date(Date.parse(`${key}T00:00:00Z`) - 86400000).toISOString().slice(0, 10);
}
function monthKey(key) {
  return String(key || "").slice(0, 7);
}
function currentCheckInStats(stats, today) {
  return Object.assign({}, stats, {
    monthlyCheckInDays: monthKey(stats.lastCheckInDate) === monthKey(today) ? Number(stats.monthlyCheckInDays || 0) : 0,
    currentCheckInStreak: [today, previousDateKey(today)].includes(stats.lastCheckInDate) ? Number(stats.currentCheckInStreak || 0) : 0,
  });
}
function dateKeysThroughToday(days, today = taipeiDateKey()) {
  const keys = [];
  let cursor = today;
  for (let i = 0; i < days; i += 1) {
    keys.unshift(cursor);
    cursor = previousDateKey(cursor);
  }
  return keys;
}
function safeId(value) {
  return String(value || "unknown").replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 120);
}
function validDocumentId(value) {
  return typeof value === "string" && /^[A-Za-z0-9_-]{1,120}$/.test(value);
}
function timestampMillis(value) {
  if (!value) return 0;
  if (typeof value.toMillis === "function") return value.toMillis();
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}
function serializeValue(value) {
  if (value && typeof value.toMillis === "function") return value.toMillis();
  if (Array.isArray(value)) return value.map(serializeValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, serializeValue(v)]));
  }
  return value;
}
async function settings() {
  const snap = await db.doc("systemSettings/engagement").get();
  return Object.assign({}, DEFAULT_SETTINGS, snap.exists ? snap.data() : {});
}
async function requireActiveUser(request) {
  if (!request.auth || !request.auth.uid) throw new HttpsError("unauthenticated", "auth-required");
  const ref = db.doc(`users/${request.auth.uid}`);
  const snap = await ref.get();
  if (!snap.exists || snap.data().active !== true) throw new HttpsError("permission-denied", "inactive-account");
  return {uid: request.auth.uid, ref, data: snap.data()};
}
async function requireSuperAdmin(request) {
  const actor = await requireActiveUser(request);
  if (actor.data.role !== "super_admin" || isTestProfile(actor.data)) throw new HttpsError("permission-denied", "super-admin-required");
  return actor;
}
function activeWindow(definition, now = Date.now()) {
  const from = timestampMillis(definition.availableFrom);
  const until = timestampMillis(definition.availableUntil);
  return (!from || now >= from) && (!until || now <= until);
}
function publicDefinition(id, definition) {
  const hidden = definition.isHidden === true;
  return {
    id,
    code: hidden ? "hidden" : String(definition.code || id),
    name: hidden ? "？？？" : String(definition.name || id),
    description: hidden ? "達成特殊條件後解鎖" : String(definition.description || ""),
    hint: String(definition.hint || ""),
    source: definition.conditionType === "manual" ? "專屬授予" : String(definition.source||""),
    category: String(definition.category || "achievement"),
    rarity: String(definition.rarity || "common"),
    targetValue: Math.max(1, Number(definition.targetValue || 1)),
    isPublic: definition.isPublic !== false,
    isHidden: hidden,
    isLimited: definition.isLimited === true,
    isPermanent: definition.isPermanent !== false,
    isActive: definition.isActive === true,
    isArchived: definition.isArchived === true,
    availableFrom: definition.availableFrom || null,
    availableUntil: definition.availableUntil || null,
    updatedAt: FieldValue.serverTimestamp(),
  };
}

function conditionProgress(definition, stats) {
  switch (definition.conditionType) {
    case "hosted_tournaments": return Number(stats.completedHostedCount || 0);
    case "official_matches": return Number(stats.officialMatchCount || 0);
    case "completed_tournaments": return Number(stats.completedTournamentCount || 0);
    case "championships": return Number(stats.championshipCount || 0);
    case "best_placement": {
      const best = Number(stats.bestPlacement || 0);
      const target = Number(definition.targetValue || 1);
      return best > 0 && best <= target ? target : 0;
    }
    case "total_online_minutes": {
      const ms = stats.officialOnlineTimeMs;
      return Number.isSafeInteger(ms) && ms >= 0 ? Math.floor(ms / 60000) : 0;
    }
    case "total_checkins": return Number(stats.totalCheckInDays || 0);
    case "checkin_streak": return Number(stats.currentCheckInStreak || 0);
    default: return 0;
  }
}

async function awardTitle({uid, titleId, sourceType, sourceId, seasonId = null, grantedBy = "system", grantReason = ""}) {
  if (!validDocumentId(uid) || !validDocumentId(titleId)) return {awarded: false, reason: "invalid-target"};
  const defRef = db.doc(`titleDefinitions/${titleId}`);
  const earnedRef = db.doc(`users/${uid}/earnedTitles/${titleId}`);
  const targetUserRef = db.doc(`users/${uid}`);
  const counterRef = db.doc(`titleCounters/${titleId}`);
  const operationId = safeId(`${uid}_${titleId}_${sourceType}_${sourceId || "none"}`);
  const auditRef = db.doc(`titleAuditLogs/${operationId}`);
  return db.runTransaction(async (tx) => {
    const [defSnap, earnedSnap, targetUserSnap] = await Promise.all([
      tx.get(defRef), tx.get(earnedRef), tx.get(targetUserRef),
    ]);
    if (!defSnap.exists) return {awarded: false, reason: "definition-missing"};
    const def = defSnap.data();
    if (def.isActive !== true || !activeWindow(def)) return {awarded: false, reason: "inactive"};
    if (!targetUserSnap.exists || targetUserSnap.data().active !== true) return {awarded: false, reason: "target-inactive"};
    if (earnedSnap.exists) return {awarded: false, reason: "already-earned"};
    const isTestData = isTestProfile(targetUserSnap.data());
    if (isTestData && (grantedBy === "system" || titleId === "pioneer")) return {awarded: false, reason: "test-account"};
    const maxRecipients = titleId === "pioneer" ? 100 : Math.max(0, Number(def.maxRecipients || 0));
    let recipientNumber = null;
    if (!isTestData && maxRecipients > 0) {
      const counterSnap = await tx.get(counterRef);
      const count = counterSnap.exists ? Number(counterSnap.data().recipientCount || 0) : 0;
      if (count >= maxRecipients) return {awarded: false, reason: "quota-full"};
      recipientNumber = count + 1;
      tx.set(counterRef, {recipientCount: recipientNumber, maxRecipients, updatedAt: FieldValue.serverTimestamp()}, {merge: true});
    }
    tx.create(earnedRef, {
      titleId,
      status: "active",
      earnedAt: FieldValue.serverTimestamp(),
      sourceType,
      sourceId: sourceId || null,
      seasonId,
      progressAtUnlock: Number(def.targetValue || 1),
      grantedBy,
      grantReason: grantReason || null,
      recipientNumber,
      definitionVersionAtUnlock: Number(def.version || 1),
      isTestData,
    });
    tx.set(auditRef, {
      action: "grant",
      operationId,
      titleId,
      targetUid: uid,
      operatorUid: grantedBy,
      sourceType,
      sourceId: sourceId || null,
      reason: grantReason || null,
      isTestData,
      createdAt: FieldValue.serverTimestamp(),
    });
    if (!isTestData) tx.set(defRef, {recipientCount: FieldValue.increment(1), updatedAt: FieldValue.serverTimestamp()}, {merge: true});
    if(titleId==='pioneer'&&recipientNumber===100){
      tx.set(defRef,{isActive:false,quotaClosed:true},{merge:true});
      tx.set(db.doc('publicTitleCatalog/pioneer'),{isActive:false},{merge:true});
    }
    return {awarded: true, recipientNumber};
  });
}

async function ensureStaffTitle(uid, profile, sourceType = "staff_role_detection") {
  if (!isActiveStaffProfile(profile)) return {awarded: false, reason: "not-active-staff"};
  return awardTitle({
    uid,
    titleId: "bxh_staff",
    sourceType,
    sourceId: `${uid}_${profile.role}`,
    grantedBy: "system",
    grantReason: "系統偵測到在職 BXH 工作人員身分，自動授予",
  });
}

async function evaluateTitles(uid, sourceType, sourceId) {
  if(sourceType==='hosting_completed'){
    await db.runTransaction(async tx=>{
      const marker=db.doc('systemSettings/hostingTitleInitialization'),done=await tx.get(marker);if(done.exists)return;
      const defs=INITIAL_TITLES.filter(d=>d.conditionType==='hosted_tournaments');
      const existing=await Promise.all(defs.map(def=>tx.get(db.doc(`titleDefinitions/${def.id}`))));
      defs.forEach((def,i)=>{if(!existing[i].exists){tx.create(existing[i].ref,{...def,version:1,recipientCount:0,createdAt:FieldValue.serverTimestamp()});tx.set(db.doc(`publicTitleCatalog/${def.id}`),publicDefinition(def.id,def));}});
      tx.create(marker,{initializedAt:FieldValue.serverTimestamp()});
    });
  }
  const cfg = await settings();
  if (cfg.titlesEnabled !== true) return [];
  if (sourceType !== "historical_backfill" && cfg.automaticTitleAwardsEnabled !== true) return [];
  const statsSnap = await db.doc(`playerStats/${uid}`).get();
  const stats = statsSnap.exists ? statsSnap.data() : {};
  const hostStats=await db.doc(`hostStats/${uid}`).get();stats.completedHostedCount=Number(hostStats.data()?.completedHostedCount||0);
  const profileSnap = await db.doc(`users/${uid}`).get();
  if (!profileSnap.exists || profileSnap.data().active !== true || isTestProfile(profileSnap.data())) return [];
  const checkIns = await db.collection(`users/${uid}/dailyCheckIns`).get();
  Object.assign(stats, officialCheckInProgress(checkIns.docs.map(d => ({...d.data(), checkInDate: d.id})), taipeiDateKey()));
  await seasonVenueTitles.reconcile(uid, sourceType);
  await titleBatch1.reconcile(uid, sourceType);
  await placementTitles.reconcile(uid, sourceType);
  const defs = await db.collection("titleDefinitions").where("isActive", "==", true).get();
  const results = [];
  for (const doc of defs.docs) {
    try {
      const def = doc.data();
      if (def.conditionType === "total_online_minutes") continue;
      if (["verified_top8_debut","verified_top16_debut","verified_top8_exit_count","season_completed_tournaments", "unique_venues", "event_opening_win_streak", "double_elimination_zero_loss_champion", "s1_final_rank"].includes(def.conditionType)) continue; // Owned by verified season/venue history.
      if (def.conditionType === "first_match_exit_streak") continue; // Owned by the authoritative first-exit transaction.
      if (sourceType === "historical_backfill" && def.retroactiveEnabled !== true) continue;
      const isCheckIn = ["total_checkins", "checkin_streak"].includes(def.conditionType);
      if (isCheckIn && cfg.checkInTitleAwardsEnabled !== true) continue;
      const currentValue = conditionProgress(def, stats);
      const targetValue = Math.max(1, Number(def.targetValue || 1));
      await db.doc(`users/${uid}/titleProgress/${doc.id}`).set({
        titleId: doc.id,
        currentValue,
        targetValue,
        completed: currentValue >= targetValue,
        updatedAt: FieldValue.serverTimestamp(),
      }, {merge: true});
      if (currentValue >= targetValue) {
        results.push(Object.assign({titleId: doc.id}, await awardTitle({uid, titleId: doc.id, sourceType, sourceId, grantedBy: "system"})));
      }
    } catch (error) {
      console.error("BXH title evaluation failed", {uid, titleId: doc.id, sourceType, code: error && error.code, message: error && error.message});
      results.push({titleId: doc.id, awarded: false, reason: "evaluation-error"});
    }
  }
  return results;
}

exports.getEngagementSnapshot = onCall({region: REGION, cors: true}, async (request) => {
  const actor = await requireActiveUser(request);
  // Login/snapshot fallback backfills existing staff accounts safely and
  // idempotently, including accounts created before the role trigger existed.
  await ensureStaffTitle(actor.uid, actor.data, "staff_snapshot_backfill");
  const cfg = await settings();
  const today = taipeiDateKey();
  const [catalogSnap, earnedSnap, progressSnap, statsSnap, todaySnap, freshProfile, monthSnap] = await Promise.all([
    db.collection("publicTitleCatalog").where("isPublic", "==", true).get(),
    db.collection(`users/${actor.uid}/earnedTitles`).get(),
    db.collection(`users/${actor.uid}/titleProgress`).get(),
    db.doc(`playerStats/${actor.uid}`).get(),
    db.doc(`users/${actor.uid}/dailyCheckIns/${today}`).get(),
    actor.ref.get(),
    db.collection(`users/${actor.uid}/dailyCheckIns`).orderBy(FieldPath.documentId()).startAt(`${monthKey(today)}-01`).endAt(today).limit(31).get(),
  ]);
  const earned = earnedSnap.docs.filter((d) => d.data().status !== "revoked").map((d) => serializeValue(Object.assign({titleId: d.id}, d.data())));
  const earnedIds = new Set(earned.map((item) => item.titleId));
  const privateEarnedDefinitions = new Map();
  await Promise.all([...earnedIds].map(async (titleId) => {
    const snap = await db.doc(`titleDefinitions/${titleId}`).get();
    if (snap.exists) privateEarnedDefinitions.set(titleId, serializeValue(snap.data()));
  }));
  const progress = new Map(progressSnap.docs.map((d) => [d.id, serializeValue(d.data())]));
  const catalog = catalogSnap.docs.map((d) => {
    const safe = serializeValue(d.data());
    let visible = safe;
    if (earnedIds.has(d.id) && privateEarnedDefinitions.has(d.id)) {
      const full = privateEarnedDefinitions.get(d.id);
      visible = Object.assign({}, safe, {code: full.code, name: full.name, description: full.description, hint: full.hint});
    }
    return Object.assign({id: d.id, progress: progress.get(d.id) || null}, visible);
  });
  const profile = freshProfile.data() || {};
  return {
    ok: true,
    settings: {
      titlesEnabled: cfg.titlesEnabled === true,
      automaticTitleAwardsEnabled: cfg.automaticTitleAwardsEnabled === true,
      dailyCheckInEnabled: cfg.dailyCheckInEnabled === true,
      checkInTitleAwardsEnabled: cfg.checkInTitleAwardsEnabled === true,
      timezone: "Asia/Taipei",
    },
    catalog,
    earned,
    stats: serializeValue(currentCheckInStats(statsSnap.exists ? statsSnap.data() : {}, today)),
    checkIn: {today, checkedIn: todaySnap.exists, month: monthKey(today), dates: monthSnap.docs.map(doc => doc.id)},
    serverTime: Date.now(),
    serviceVersion: "13.29.9",
    profilePatch: {
      equippedTitleId: profile.equippedTitleId || "",
      titleDisplayEnabled: profile.titleDisplayEnabled !== false,
      titleDisplayFormat: profile.titleDisplayFormat || "realname_nickname_title",
    },
  };
});

exports.autoAwardStaffTitle = onDocumentWritten({document: "users/{uid}", region: REGION, retry: true}, async (event) => {
  const profile = event.data && event.data.after.exists ? event.data.after.data() : null;
  if (!isActiveStaffProfile(profile)) return null;
  return ensureStaffTitle(event.params.uid, profile, "staff_role_change");
});

exports.dailyCheckIn = onCall({region: REGION, cors: true}, async (request) => {
  const actor = await requireActiveUser(request);
  const cfg = await settings();
  if (cfg.dailyCheckInEnabled !== true) throw new HttpsError("failed-precondition", "feature-disabled");
  const today = taipeiDateKey();
  const yesterday = previousDateKey(today);
  const checkInRef = db.doc(`users/${actor.uid}/dailyCheckIns/${today}`);
  const statsRef = db.doc(`playerStats/${actor.uid}`);
  const dailyStatsRef = db.doc(`engagementDailyStats/${today}`);
  const result = await db.runTransaction(async (tx) => {
    const [checkInSnap, statsSnap, dailyStatsSnap, profileSnap] = await Promise.all([tx.get(checkInRef), tx.get(statsRef), tx.get(dailyStatsRef), tx.get(actor.ref)]);
    if (!profileSnap.exists || profileSnap.data().active !== true) throw new HttpsError("permission-denied", "inactive-account");
    const isTestData = isTestProfile(profileSnap.data());
    if (checkInSnap.exists) return {alreadyCheckedIn: true, stats: statsSnap.exists ? statsSnap.data() : {}};
    const old = statsSnap.exists ? statsSnap.data() : {};
    const consecutive = old.lastCheckInDate === yesterday ? Number(old.currentCheckInStreak || 0) + 1 : 1;
    const total = Number(old.totalCheckInDays || 0) + 1;
    const monthly = monthKey(old.lastCheckInDate) === monthKey(today) ? Number(old.monthlyCheckInDays || 0) + 1 : 1;
    const next = {
      uid: actor.uid,
      totalCheckInDays: total,
      currentCheckInStreak: consecutive,
      highestCheckInStreak: Math.max(Number(old.highestCheckInStreak || 0), consecutive),
      monthlyCheckInDays: monthly,
      lastCheckInDate: today,
      updatedAt: FieldValue.serverTimestamp(),
    };
    tx.create(checkInRef, {
      checkInDate: today,
      checkInAt: FieldValue.serverTimestamp(),
      timezone: "Asia/Taipei",
      source: "player_action",
      operationId: `${actor.uid}_${today}`,
      isTestData,
    });
    tx.set(statsRef, next, {merge: true});
    const daily = dailyStatsSnap.exists ? dailyStatsSnap.data() : {};
    tx.set(dailyStatsRef, {
      dateKey: today,
      totalCount: Number(daily.totalCount || 0) + 1,
      officialCount: Number(daily.officialCount || 0) + (isTestData ? 0 : 1),
      testCount: Number(daily.testCount || 0) + (isTestData ? 1 : 0),
      updatedAt: FieldValue.serverTimestamp(),
    }, {merge: true});
    return {alreadyCheckedIn: false, stats: next};
  });
  let titleEvaluationWarning = false;
  if (!isTestProfile(actor.data)) {
    try {
      const titleResults = await evaluateTitles(actor.uid, "daily_checkin", today);
      titleEvaluationWarning = titleResults.some((item) => item && item.reason === "evaluation-error");
    } catch (error) {
      console.error("checkin-award-pending", {uid: actor.uid, code: error.code});
      titleEvaluationWarning = true;
    }
  }
  // 簽到交易一旦成功就必須回報成功；個別稱號判定異常不可讓玩家誤以為
  // 簽到失敗而重複操作。警示交由前端提示稍後補發。
  return {ok: true, alreadyCheckedIn: result.alreadyCheckedIn, today, stats: serializeValue(result.stats), titleEvaluationWarning};
});

exports.setTitlePreferences = onCall({region: REGION, cors: true}, async (request) => {
  const actor = await requireActiveUser(request);
  const cfg = await settings();
  if (cfg.titlesEnabled !== true) throw new HttpsError("failed-precondition", "feature-disabled");
  const data = request.data || {};
  const titleId = String(data.equippedTitleId || "").trim();
  const enabled = data.titleDisplayEnabled === true;
  const format = ALLOWED_TITLE_FORMATS.has(data.titleDisplayFormat) ? data.titleDisplayFormat : "realname_nickname_title";
  if (titleId && !validDocumentId(titleId)) throw new HttpsError("invalid-argument", "invalid-title-id");
  if (titleId) {
    const [earned, definition] = await Promise.all([
      db.doc(`users/${actor.uid}/earnedTitles/${titleId}`).get(),
      db.doc(`titleDefinitions/${titleId}`).get(),
    ]);
    if (!earned.exists || earned.data().status === "revoked") throw new HttpsError("permission-denied", "title-not-earned");
    // isActive/isArchived control future awards only. An already-earned title
    // remains equipable unless its earned record is explicitly revoked.
    if (!definition.exists) throw new HttpsError("failed-precondition", "title-definition-missing");
  }
  const now = FieldValue.serverTimestamp();
  const batch = db.batch();
  batch.set(actor.ref, {equippedTitleId: titleId || null, titleDisplayEnabled: enabled, titleDisplayFormat: format, updatedAt: now}, {merge: true});
  batch.set(db.doc(`publicPlayers/${actor.uid}`), {
    publicName: String(actor.data.gameId || actor.data.nickname || actor.data.displayName || actor.data.realName || ""),
    avatarUrl: actor.data.avatarUrl || null,
    equippedTitleId: enabled && titleId ? titleId : null,
    titleDisplayEnabled: enabled,
    titleDisplayFormat: format,
    updatedAt: Date.now(),
  }, {merge: true});
  await batch.commit();
  return {ok: true, equippedTitleId: titleId, titleDisplayEnabled: enabled, titleDisplayFormat: format};
});

function tournamentState(t){try{return typeof t?.data==="string"?JSON.parse(t.data):t?.data||{};}catch{return {};}}

async function processOfficialEventLog(log, sourceLogId, sourceType = "official_tournament", dryRun = false) {
  if (!log || log.isTestData === true || log.testMode === true || log.type !== "event" || !log.playerUid || !log.eventCode) return {status: "skipped", reason: "not-event"};
  const tourSnap = await db.doc(`tournaments/${String(log.eventCode).toUpperCase()}`).get();
  if (!tourSnap.exists) return {status: "skipped", reason: "tournament-missing"};
  const tour = tourSnap.data();
  if (tour.eventAuthority !== "official" || tour.ladderMode !== "ranked" || tour.testMode === true || tour.eventCancelled === true || tour.ladderPointsAwarded !== true) return {status: "skipped", reason: "not-eligible-official-event"};
  const state = tournamentState(tour);
  if (["scoreStorage", "scoreBucketProjection", "bucketMigration", "deletionStatus"].some(key => Object.prototype.hasOwnProperty.call(tour, key))) {
    const receipt = tour.bucketSettlement;
    const createdAt = tourSnap.createTime;
    const sourceCreatedAt = Number.isSafeInteger(createdAt?.seconds) && Number.isSafeInteger(createdAt?.nanoseconds) ? `${createdAt.seconds}:${createdAt.nanoseconds}` : null;
    if (Object.prototype.hasOwnProperty.call(tour, "bucketMigration") || Object.prototype.hasOwnProperty.call(tour, "deletionStatus") || !Object.prototype.hasOwnProperty.call(tour, "scoreStorage") || receipt?.version !== 1 || receipt.status !== "completed" || receipt.epoch !== log.bucketEpoch || !sourceCreatedAt || log.sourceCreatedAt !== sourceCreatedAt || state.archiveStatus !== "completed") {
      return {status: "skipped", reason: "bucket-settlement-source-mismatch"};
    }
  }
  const uid = String(log.playerUid);
  if (!validDocumentId(uid)) return {status: "skipped", reason: "invalid-player-uid"};
  const registrationSnap=await db.doc(`tournaments/${String(log.eventCode).toUpperCase()}/registrations/${uid}`).get();
  const officialMatchCount=countOfficialMatches({uid,state,registration:registrationSnap.data()});
  const playerSnap = await db.doc(`users/${uid}`).get();
  if (!playerSnap.exists) return {status: "skipped", reason: "player-missing"};
  if (isTestProfile(playerSnap.data())) return {status: "skipped", reason: "tester-account"};
  const eventCode = String(log.eventCode).toUpperCase();
  const resultRef = db.doc(`playerEventResults/${safeId(`${eventCode}_${uid}`)}`);
  const statsRef = db.doc(`playerStats/${uid}`);
  if (dryRun) {
    const exists = await resultRef.get();
    return {status: "eligible", reason: exists.exists ? "titles-only-reevaluation" : null, alreadyProcessed: exists.exists, uid, eventCode};
  }
  const created = await db.runTransaction(async (tx) => {
    const [resultSnap, statsSnap, freshPlayer] = await Promise.all([tx.get(resultRef), tx.get(statsRef), tx.get(db.doc(`users/${uid}`))]);
    if (!freshPlayer.exists || isTestProfile(freshPlayer.data())) return false;
    if (resultSnap.exists) return false;
    const old = statsSnap.exists ? statsSnap.data() : {};
    const placement = Number(log.placement || 0) || null;
    const championships = Number(old.championshipCount || 0) + (placement === 1 ? 1 : 0);
    const oldBest = Number(old.bestPlacement || 0);
    const bestPlacement = placement ? (oldBest ? Math.min(oldBest, placement) : placement) : oldBest || null;
    tx.create(resultRef, {
      eventCode,
      playerUid: uid,
      playerName: String(log.playerName || ""),
      seasonId: log.seasonId || null,
      venueId: tour.venueId || null,
      placement,
      stageReached: placement && placement <= 4 ? "top4" : null,
      wins: Number.isFinite(Number(log.wins)) ? Number(log.wins) : null,
      losses: Number.isFinite(Number(log.losses)) ? Number(log.losses) : null,
      participated: true,
      officialMatchCount,
      authority: "official",
      ladderMode: "ranked",
      completedAt: tour.completedAt || tour.ladderAwardedAt || FieldValue.serverTimestamp(),
      sourceLogId,
      createdAt: FieldValue.serverTimestamp(),
    });
    tx.set(statsRef, {
      uid,
      completedTournamentCount: Number(old.completedTournamentCount || 0) + 1,
      officialMatchCount: Number(old.officialMatchCount || 0) + officialMatchCount,
      championshipCount: championships,
      bestPlacement,
      updatedAt: FieldValue.serverTimestamp(),
    }, {merge: true});
    return true;
  });
  // 即使前一次觸發已完成統計、但稱號判定暫時失敗，重試時仍會再次執行
  // 冪等的稱號判定；不可因 result 文件已存在就永遠跳過補發。
  const awards = await evaluateTitles(uid, sourceType, eventCode);
  let octoberCardReward={issued:false,reason:"not-attempted"};
  try {
    const completedAtMs=timestampMillis(tour.completedAt || tour.ladderAwardedAt) || Date.now();
    octoberCardReward=await issueOctoberCompletionCard({uid,eventCode,completedAtMs});
  } catch(error) {
    console.error("BXH October completion card issue failed",{uid,eventCode,message:error&&error.message});
    octoberCardReward={issued:false,reason:"issue-error"};
  }
  return {status: created ? "created" : "processed", uid, eventCode, officialMatchCount,
    awarded: awards.filter(item => item.awarded).length,
    awardErrors: awards.filter(item => item.reason === "evaluation-error").length,
    octoberCardReward};
}

const OCT_CARD_CAMPAIGN = Object.freeze({
  id: "2026-10-completion-card",
  startMs: Date.parse("2026-09-30T16:00:00.000Z"),
  endMs: Date.parse("2026-10-31T15:59:59.999Z"),
  setId: "gods",
});
const OCT_CARD_IDS = Object.freeze([
  "double_extreme","double_knockout","double_burst","double_spin",
  "boost_extreme","boost_knockout","boost_burst",
  "weaken_extreme","weaken_knockout","weaken_burst","weaken_spin","seal",
]);
function octoberCardCampaignActive(ms) {
  return Number.isFinite(Number(ms)) && Number(ms) >= OCT_CARD_CAMPAIGN.startMs && Number(ms) <= OCT_CARD_CAMPAIGN.endMs;
}
function deterministicOctoberCardId(uid,eventCode) {
  const seed=String(uid)+"|"+String(eventCode).toUpperCase()+"|"+OCT_CARD_CAMPAIGN.id;
  let hash=2166136261;
  for(let i=0;i<seed.length;i++){hash^=seed.charCodeAt(i);hash=Math.imul(hash,16777619)>>>0;}
  return OCT_CARD_IDS[hash%OCT_CARD_IDS.length];
}
async function issueOctoberCompletionCard({uid,eventCode,completedAtMs,allowOutsideCampaign=false}) {
  // Archived: cardAlbumEventAward is the single completion reward owner.
  // Keep historical claim/audit code and records; no automatic/test/backfill issuance.
  return {issued:false,reason:"pipeline-archived"};
  if(!validDocumentId(uid)||!eventCode) return {issued:false,reason:"invalid-source"};
  if(!allowOutsideCampaign&&!octoberCardCampaignActive(completedAtMs)) return {issued:false,reason:"outside-campaign"};
  const normalizedEvent=String(eventCode).toUpperCase();
  const rewardId=safeId("oct26_"+normalizedEvent+"_"+uid);
  const messageRef=db.doc(`userMail/${uid}/messages/${rewardId}`);
  const statsRef=db.doc(`mailboxStats/${uid}`);
  const cardId=deterministicOctoberCardId(uid,normalizedEvent);
  return db.runTransaction(async tx=>{
    const [messageSnap,statsSnap,userSnap]=await Promise.all([tx.get(messageRef),tx.get(statsRef),tx.get(db.doc(`users/${uid}`))]);
    if(!userSnap.exists||userSnap.data().active!==true||isTestProfile(userSnap.data())) return {issued:false,reason:"ineligible-player"};
    if(messageSnap.exists) return {issued:false,reason:"already-issued",messageId:rewardId};
    const now=Date.now();
    tx.create(messageRef,{
      subject:"🎴 10月完賽卡牌已送達",
      body:"你已完成一場有效 BXH 賽事。\n\n本封站內信附有 1 張活動卡牌，點擊「領取卡牌」即可揭曉並收入我的卡冊。",
      type:"card_reward",senderName:"BXH ARENA",senderUid:"system",targetUid:uid,
      createdAt:now,updatedAt:now,readAt:null,operationId:rewardId,eventCode:normalizedEvent,
      reward:{kind:"card",campaignId:OCT_CARD_CAMPAIGN.id,setId:OCT_CARD_CAMPAIGN.setId,cardId,status:"unclaimed",claimedAt:null,sourceType:"tournament_completed",sourceId:normalizedEvent}
    });
    tx.set(statsRef,{unreadCount:Math.max(0,Number(statsSnap.data()?.unreadCount||0))+1,updatedAt:now},{merge:true});
    return {issued:true,messageId:rewardId};
  });
}

exports.issueSelfCardRewardE2ETest = onCall({region: REGION, cors: true}, async request=>{
  const actor=await requireActiveUser(request);
  if(actor.data?.role!=="super_admin") throw new HttpsError("permission-denied","super-admin-only");
  if(process.env.GCLOUD_PROJECT!=="bxh-arena") throw new HttpsError("failed-precondition","production-only");
  const testId="E2E"+new Date().toISOString().slice(0,10).replace(/-/g,"");
  const eventCode="BXH-"+testId.slice(-6);
  const marker=db.doc(`cardRewardE2ETests/${actor.uid}_${testId}`);
  const prior=await marker.get();
  if(prior.exists) return {ok:true,replayed:true,messageId:prior.data().messageId||null};
  const result=await issueOctoberCompletionCard({uid:actor.uid,eventCode,completedAtMs:Date.now(),allowOutsideCampaign:true});
  if(!result.issued&&result.reason!=="already-issued") throw new HttpsError("failed-precondition",result.reason||"test-issue-failed");
  await marker.create({uid:actor.uid,testId,eventCode,messageId:result.messageId||null,createdAt:Date.now()});
  return {ok:true,replayed:false,messageId:result.messageId||null};
});

exports.getCardRewardMessage = onCall({region: REGION, cors: true}, async request=>{
  const actor=await requireActiveUser(request);
  const messageId=String((request.data&&request.data.messageId)||"").trim();
  if(!validDocumentId(messageId)) throw new HttpsError("invalid-argument","invalid-card-reward-message");
  const snap=await db.doc(`userMail/${actor.uid}/messages/${messageId}`).get();
  if(!snap.exists) throw new HttpsError("not-found","mail-not-found");
  const message=snap.data()||{},reward=message.reward||null;
  if(message.targetUid!==actor.uid||message.type!=="card_reward"||!reward||reward.kind!=="card") throw new HttpsError("failed-precondition","not-card-reward");
  return {ok:true,message:{id:snap.id,type:message.type,eventCode:message.eventCode||null,reward}};
});

const claimOctoberCardReward = require("./card-reward-claim")({
  db, HttpsError, requireActiveUser, validDocumentId, safeId,
  cardIds:OCT_CARD_IDS, campaignId:OCT_CARD_CAMPAIGN.id,
});
exports.backfillOctoberCardReward = require("./oct-card-reward-backfill")({onCall,HttpsError,db,requireSuperAdmin,validDocumentId,issueOctoberCompletionCard});

exports.reconcileOctoberCardRewards = require("./oct-card-reward-reconciliation")({onSchedule,db,validDocumentId,issueOctoberCompletionCard});

exports.claimCardReward = onCall({region: REGION, cors: true}, async request=>{
  return claimOctoberCardReward(request);
});

exports.onLadderTransactionCreated = onDocumentCreated({document: "ladderTransactions/{logId}", region: REGION}, async (event) => {
  const log = event.data && event.data.data();
  await processOfficialEventLog(log, event.params.logId, "official_tournament", false);
});

exports.getEngagementAdminOverview = onCall({region: REGION, cors: true}, async (request) => {
  await requireSuperAdmin(request);
  const today = taipeiDateKey();
  const keys = dateKeysThroughToday(31, today);
  const [dailySnaps, topStats, statsSample, runSnaps, definitions] = await Promise.all([
    db.getAll(...keys.map((key) => db.doc(`engagementDailyStats/${key}`))),
    db.collection("playerStats").orderBy("highestCheckInStreak", "desc").limit(10).get(),
    db.collection("playerStats").limit(250).get(),
    db.collection("titleBackfillRuns").orderBy("createdAt", "desc").limit(10).get(),
    db.collection("titleDefinitions").get(),
  ]);
  const daily = dailySnaps.map((snap, index) => Object.assign({dateKey: keys[index], totalCount: 0, officialCount: 0, testCount: 0}, snap.exists ? serializeValue(snap.data()) : {}));
  const weekKeys = new Set(keys.slice(-7));
  const month = monthKey(today);
  const sum = (rows) => rows.reduce((acc, row) => ({
    totalCount: acc.totalCount + Number(row.totalCount || 0),
    officialCount: acc.officialCount + Number(row.officialCount || 0),
    testCount: acc.testCount + Number(row.testCount || 0),
  }), {totalCount: 0, officialCount: 0, testCount: 0});
  const anomalies = [];
  for (const doc of statsSample.docs) {
    const value = doc.data();
    const reasons = [];
    const total = Number(value.totalCheckInDays || 0);
    const current = Number(value.currentCheckInStreak || 0);
    const highest = Number(value.highestCheckInStreak || 0);
    const monthly = Number(value.monthlyCheckInDays || 0);
    if ([total, current, highest, monthly].some((n) => !Number.isFinite(n) || n < 0)) reasons.push("invalid-count");
    if (current > highest) reasons.push("current-over-highest");
    if (monthly > total) reasons.push("monthly-over-total");
    if (value.lastCheckInDate && !/^\d{4}-\d{2}-\d{2}$/.test(String(value.lastCheckInDate))) reasons.push("invalid-last-date");
    if (reasons.length) anomalies.push({uid: doc.id, reasons});
  }
  const topUsers = topStats.empty ? [] : await db.getAll(...topStats.docs.map((doc) => db.doc(`users/${doc.id}`)));
  return {
    ok: true,
    today,
    daily,
    todaySummary: daily[daily.length - 1],
    weekSummary: sum(daily.filter((row) => weekKeys.has(row.dateKey))),
    monthSummary: sum(daily.filter((row) => monthKey(row.dateKey) === month)),
    topStreaks: topStats.docs.map((doc, index) => ({uid: doc.id, isTestData: isTestProfile(topUsers[index].data()), name: String((topUsers[index].data() || {}).realName || (topUsers[index].data() || {}).displayName || doc.id), stats: serializeValue(currentCheckInStats(doc.data(), today))})),
    anomalySummary: {scanned: statsSample.size, count: anomalies.length, sample: anomalies.slice(0, 20)},
    backfillRuns: runSnaps.docs.map((doc) => serializeValue(Object.assign({id: doc.id}, doc.data()))),
    definitions: definitions.docs.map((doc) => serializeValue(Object.assign({id: doc.id}, doc.data()))),
  };
});

exports.getEngagementHealth = onCall({region: REGION, cors: true}, async (request) => {
  await requireSuperAdmin(request);
  const cfg = await settings();
  return {ok: true, serviceVersion: "13.29.9", region: REGION,
    projectId: process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT || "unknown",
    serverTime: Date.now(), firestoreRead: true,
    titlesEnabled: cfg.titlesEnabled === true, dailyCheckInEnabled: cfg.dailyCheckInEnabled === true};
});

exports.runTitleBackfill = onCall({region: REGION, cors: true, timeoutSeconds: 120}, async (request) => {
  const actor = await requireSuperAdmin(request);
  const data = request.data || {};
  const execute = data.execute === true;
  const requestedLimit = Number(data.limit || 25);
  if (!Number.isInteger(requestedLimit)) throw new HttpsError("invalid-argument", "invalid-limit");
  const limit = Math.min(100, Math.max(1, requestedLimit));
  const cursor = String(data.cursor || "").trim();
  if (cursor && !validDocumentId(cursor)) throw new HttpsError("invalid-argument", "invalid-cursor");
  let query = db.collection("ladderTransactions").orderBy(FieldPath.documentId()).limit(limit);
  if (cursor) query = query.startAfter(cursor);
  const snapshot = await query.get();
  if (execute && (await settings()).titlesEnabled !== true) throw new HttpsError("failed-precondition", "feature-disabled");
  const summary = {scanned: snapshot.size, eligible: 0, created: 0, processed: 0, awarded: 0, skipped: 0, failed: 0};
  const errors = [];
  for (const doc of snapshot.docs) {
    try {
      const result = await processOfficialEventLog(doc.data(), doc.id, "historical_backfill", !execute);
      if (result.status === "eligible") summary.eligible += 1;
      else if (result.status === "created") summary.created += 1;
      else if (result.status === "processed") summary.processed += 1;
      else summary.skipped += 1;
      summary.awarded += result.awarded || 0;
      if (result.awardErrors) { summary.failed += 1; errors.push({logId: doc.id, code: "award-evaluation-failed"}); }
    } catch (error) {
      summary.failed += 1;
      errors.push({logId: doc.id, code: String(error && error.code || "unknown")});
    }
  }
  const retryRequired = summary.failed > 0;
  const nextCursor = retryRequired || snapshot.empty ? cursor : snapshot.docs[snapshot.docs.length - 1].id;
  const done = !retryRequired && snapshot.size < limit;
  const runId = randomUUID();
  await db.doc(`titleBackfillRuns/${runId}`).create({
    mode: execute ? "execute" : "preview",
    cursor: cursor || null,
    nextCursor: done ? null : nextCursor,
    done,
    summary,
    errors: errors.slice(0, 20),
    createdBy: actor.uid,
    createdAt: FieldValue.serverTimestamp(),
  });
  return {ok: true, runId, mode: execute ? "execute" : "preview", retryRequired, nextCursor: done ? null : nextCursor, done, summary, errors: errors.slice(0, 20)};
});

const EXECUTABLE_TITLE_CONDITIONS = new Set(["manual","pioneer_quota","hosted_tournaments","completed_tournaments","championships","best_placement","total_checkins","checkin_streak"]);
const TITLE_RARITIES = new Set(["common","rare","epic","legendary","limited","eternal"]);
function validateTitleFields(data) {
  const name=typeof data.name==="string"?data.name.trim():"";
  if(!name||name.length>60)throw new HttpsError("invalid-argument","invalid-title-name");
  if(!EXECUTABLE_TITLE_CONDITIONS.has(data.conditionType))throw new HttpsError("invalid-argument","unsupported-title-condition");
  const rarity=String(data.rarity||"common").trim();
  if(!TITLE_RARITIES.has(rarity))throw new HttpsError("invalid-argument","invalid-title-rarity");
  const target=data.targetValue;
  if(!Number.isSafeInteger(target)||target<1||target>100000)throw new HttpsError("invalid-argument","invalid-title-target");
  if(typeof data.description!=="string"||data.description.length>500)throw new HttpsError("invalid-argument","invalid-title-description");
  return {name,rarity,conditionType:data.conditionType,targetValue:target,description:data.description.trim()};
}
exports.updateTitleDefinition = onCall({region: REGION, cors: true}, async (request) => {
  const actor = await requireSuperAdmin(request), data=request.data||{}, titleId=String(data.titleId||"").trim();
  if(!validDocumentId(titleId))throw new HttpsError("invalid-argument","invalid-title-id");
  const fields=data.name!==undefined?validateTitleFields(data):null;
  if(data.create===true&&!fields)throw new HttpsError("invalid-argument","title-fields-required");
  const ref=db.doc(`titleDefinitions/${titleId}`), publicRef=db.doc(`publicTitleCatalog/${titleId}`);
  await db.runTransaction(async tx=>{
    const [snap,freshActor,quota]=await Promise.all([tx.get(ref),tx.get(actor.ref),tx.get(db.doc(`titleCounters/${titleId}`))]);
    if(!freshActor.exists||freshActor.data().active!==true||freshActor.data().role!=="super_admin"||isTestProfile(freshActor.data()))throw new HttpsError("permission-denied","super-admin-required");
    if(!snap.exists&&data.create!==true)throw new HttpsError("not-found","definition-missing");
    if(snap.exists&&data.create===true)throw new HttpsError("already-exists","title-id-exists");
    const old=snap.exists?snap.data():{code:titleId,category:"achievement",rarity:"common",isPublic:true,isPermanent:true,isLimited:false,retroactiveEnabled:true,recipientCount:0,createdBy:actor.uid,createdAt:FieldValue.serverTimestamp()};
    if(fields&&snap.exists&&Number(data.expectedVersion)!==Number(old.version||1))throw new HttpsError("failed-precondition","title-version-changed");
    if(fields&&fields.conditionType==='pioneer_quota'&&titleId!=='pioneer')throw new HttpsError("invalid-argument","pioneer-reserved");
    if(titleId==='pioneer'&&fields&&fields.conditionType!=='pioneer_quota')throw new HttpsError("invalid-argument","pioneer-condition-fixed");
    const next={...old,...fields,isActive:data.isActive===true,isHidden:data.isHidden===true,isArchived:data.isArchived===true,version:Number(old.version||0)+1,updatedAt:FieldValue.serverTimestamp(),updatedBy:actor.uid};
    if(next.isArchived)next.isActive=false;
    if(next.isActive&&!EXECUTABLE_TITLE_CONDITIONS.has(next.conditionType))throw new HttpsError("failed-precondition","unsupported-title-condition");
    if(titleId==='pioneer'){next.maxRecipients=100;next.isLimited=true;if(Number(quota.data()?.recipientCount||0)>=100){next.isActive=false;next.quotaClosed=true;}}
    tx.set(ref,next);tx.set(publicRef,publicDefinition(titleId,next));
    tx.create(db.doc(`titleAuditLogs/${randomUUID()}`),{action:snap.exists?'update-definition':'create-definition',titleId,operatorUid:actor.uid,beforeVersion:old.version||0,afterVersion:next.version,changes:serializeValue({...fields,isActive:next.isActive,isHidden:next.isHidden,isArchived:next.isArchived}),createdAt:FieldValue.serverTimestamp()});
  });
  return {ok:true,titleId};
});

exports.deleteTitleDefinition = onCall({region:REGION,cors:true},async request=>{
  const actor=await requireSuperAdmin(request),titleId=request.data?.titleId;
  if(!validDocumentId(titleId))throw new HttpsError('invalid-argument','invalid-title-id');
  const result=await db.runTransaction(async tx=>{
    const ref=db.doc(`titleDefinitions/${titleId}`),pub=db.doc(`publicTitleCatalog/${titleId}`);
    const [def,user,history,counter]=await Promise.all([tx.get(ref),tx.get(actor.ref),tx.get(db.collection('titleAuditLogs').where('titleId','==',titleId).where('action','==','grant').limit(1)),tx.get(db.doc(`titleCounters/${titleId}`))]);
    if(!user.exists||user.data().active!==true||user.data().role!=='super_admin'||isTestProfile(user.data()))throw new HttpsError('permission-denied','super-admin-required');
    if(!def.exists)return {deleted:true,alreadyMissing:true};
    const retained=!history.empty||Number(counter.data()?.recipientCount||0)>0||Number(def.data().recipientCount||0)>0;
    if(retained){tx.set(ref,{isActive:false,isArchived:true,updatedBy:actor.uid,updatedAt:FieldValue.serverTimestamp()},{merge:true});tx.set(pub,{isActive:false,isArchived:true},{merge:true});}
    else {tx.delete(ref);tx.delete(pub);}
    tx.create(db.doc(`titleAuditLogs/${randomUUID()}`),{action:retained?'archive-definition':'delete-definition',titleId,operatorUid:actor.uid,createdAt:FieldValue.serverTimestamp()});
    return {deleted:!retained,archived:retained};
  });return {ok:true,...result};
});

exports.previewPioneerAwards = onCall({region:REGION,cors:true,timeoutSeconds:120},async request=>{
  const actor=await requireSuperAdmin(request);
  const [def,counter]=await Promise.all([db.doc('titleDefinitions/pioneer').get(),db.doc('titleCounters/pioneer').get()]);
  if(!def.exists||def.data().isActive!==true)throw new HttpsError('failed-precondition','pioneer-not-enabled');
  const remaining=Math.max(0,100-Number(counter.data()?.recipientCount||0));
  const candidates=[];let cursor='',scanned=0,done=false;
  while(candidates.length<remaining&&scanned<1000&&!done){
    let q=db.collection('users').orderBy(FieldPath.documentId()).limit(200);if(cursor)q=q.startAfter(cursor);
    const users=await q.get();done=users.size<200;if(users.empty)break;
    const earned=await db.getAll(...users.docs.map(u=>db.doc(`users/${u.id}/earnedTitles/pioneer`)));
    for(let i=0;i<users.docs.length;i++){const u=users.docs[i],d=u.data();scanned++;cursor=u.id;
      if(d.active===true&&!isTestProfile(d)&&!earned[i].exists)candidates.push({uid:u.id,name:String(d.realName||d.displayName||u.id).slice(0,100)});
      if(candidates.length>=remaining)break;
    }
  }
  const previewId=randomUUID(),expiresAt=Date.now()+600000;
  await db.doc(`pioneerAwardRuns/${previewId}`).create({actorUid:actor.uid,candidates,expiresAt,createdAt:Date.now(),status:'preview'});
  return {ok:true,previewId,expiresAt,candidates,remaining,scanned,scanLimitReached:!done&&scanned>=1000,order:'uid-ascending'};
});
exports.executePioneerAwards = onCall({region:REGION,cors:true,timeoutSeconds:120},async request=>{
  const actor=await requireSuperAdmin(request),id=request.data?.previewId;
  if(!validDocumentId(id))throw new HttpsError('invalid-argument','invalid-preview');
  const ref=db.doc(`pioneerAwardRuns/${id}`),snap=await ref.get(),run=snap.data();
  if(!run||run.actorUid!==actor.uid)throw new HttpsError('permission-denied','preview-owner-required');
  if(run.status==='completed')return {ok:true,results:run.results};
  if(run.expiresAt<Date.now())throw new HttpsError('failed-precondition','preview-expired');
  const results=[];
  for(const candidate of run.candidates){
    const fresh=await actor.ref.get();if(!fresh.exists||fresh.data().active!==true||fresh.data().role!=='super_admin'||isTestProfile(fresh.data()))throw new HttpsError('permission-denied','super-admin-required');
    const result=await awardTitle({uid:candidate.uid,titleId:'pioneer',sourceType:'pioneer_batch',sourceId:id,grantedBy:actor.uid,grantReason:'既有帳號開拓者名额發放'});
    results.push({uid:candidate.uid,...result});
  }
  await ref.set({status:'completed',results,completedAt:Date.now()},{merge:true});
  return {ok:true,results};
});

exports.seedInitialTitles = onCall({region: REGION, cors: true}, async (request) => {
  const actor = await requireSuperAdmin(request);
  const definitions = INITIAL_TITLES;
  await db.runTransaction(async (tx) => {
  const refs = definitions.map(item => db.doc(`titleDefinitions/${item.id}`));
  const existing = await Promise.all(refs.map(ref => tx.get(ref)));
  for (const [index, item] of definitions.entries()) {
    const definition = Object.assign({}, item, {
      version: 1,
      isPublic: true,
      isPermanent: true,
      retroactiveEnabled: item.retroactiveEnabled === true,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
      createdBy: actor.uid,
    });
    const effective = existing[index].exists ? existing[index].data() : definition;
    if (!existing[index].exists) tx.create(refs[index], definition);
    tx.set(db.doc(`publicTitleCatalog/${item.id}`), publicDefinition(item.id, effective));
  }
  });
  return {ok: true, count: definitions.length};
});

exports.saveEngagementSettings = onCall({region: REGION, cors: true}, async (request) => {
  const actor = await requireSuperAdmin(request);
  const data = request.data || {};
  const payload = {
    titlesEnabled: data.titlesEnabled === true,
    automaticTitleAwardsEnabled: data.automaticTitleAwardsEnabled === true,
    dailyCheckInEnabled: data.dailyCheckInEnabled === true,
    checkInTitleAwardsEnabled: data.checkInTitleAwardsEnabled === true,
    timezone: "Asia/Taipei",
    updatedAt: FieldValue.serverTimestamp(),
    updatedBy: actor.uid,
  };
  await db.doc("systemSettings/engagement").set(payload, {merge: true});
  return {ok: true};
});

exports.grantTitle = onCall({region: REGION, cors: true}, async (request) => {
  const actor = await requireSuperAdmin(request);
  const data = request.data || {};
  const uid = String(data.targetUid || "").trim();
  const titleId = String(data.titleId || "").trim();
  const reason = String(data.reason || "").trim();
  if (!validDocumentId(uid) || !validDocumentId(titleId) || reason.length < 2) throw new HttpsError("invalid-argument", "target-title-reason-required");
  const result = await awardTitle({uid, titleId, sourceType: "manual", sourceId: safeId(data.operationId || Date.now()), grantedBy: actor.uid, grantReason: reason});
  if (result.awarded === true) {
    try {
      const defSnap = await db.doc(`titleDefinitions/${titleId}`).get();
      const def = defSnap.exists ? defSnap.data() : {};
      const titleName = String(def.name || titleId);
      const artworkByName = {"S2總冠軍":"assets/title-limited-s2-champion.webp","S3總冠軍":"assets/title-limited-s3-champion.webp"};
      const rewardId = safeId(`${uid}_${titleId}_title_reward`);
      const messageRef = db.doc(`userMail/${uid}/messages/${rewardId}`);
      const statsRef = db.doc(`mailboxStats/${uid}`);
      await db.runTransaction(async tx => {
        const [messageSnap, statsSnap] = await Promise.all([tx.get(messageRef), tx.get(statsRef)]);
        if (messageSnap.exists) return;
        tx.create(messageRef, {
          subject: `👑 恭喜獲得稱號「${titleName}」`,
          body: `一份屬於你的榮耀已送達。\n\n${reason}\n\n開啟稱號附件，完成 BXH ARENA 授勳儀式。`,
          type: "title_reward", senderName: "BXH ARENA", senderUid: actor.uid, targetUid: uid,
          createdAt: Date.now(), updatedAt: Date.now(), readAt: null, operationId: rewardId,
          reward: {kind:"title", titleId, titleName, rarityTier:String(def.rarityTier || def.rarity || "common"), limitedType:String(def.limitedType || "none"), artwork:String(def.artwork || artworkByName[titleName] || ""), status:"unopened", openedAt:null, ceremonyViewedAt:null, replayCount:0, recipientNumber:result.recipientNumber || null}
        });
        tx.set(statsRef, {unreadCount:Math.max(0,Number(statsSnap.data()?.unreadCount || 0))+1, updatedAt:Date.now()}, {merge:true});
      });
    } catch (error) {
      console.error("BXH title reward mail creation failed", {uid, titleId, message:error && error.message});
    }
  }
  return Object.assign({ok: true}, result);
});

exports.claimTitleReward = onCall({region: REGION, cors: true}, async (request) => {
  const actor = await requireActiveUser(request);
  const data = request.data || {};
  const messageId = String(data.messageId || "").trim();
  const action = String(data.action || "open").trim();
  if (!validDocumentId(messageId) || !["open","replay"].includes(action)) throw new HttpsError("invalid-argument", "invalid-title-reward-request");
  const messageRef = db.doc(`userMail/${actor.uid}/messages/${messageId}`);
  return db.runTransaction(async tx => {
    const messageSnap = await tx.get(messageRef);
    if (!messageSnap.exists) throw new HttpsError("not-found", "mail-not-found");
    const message = messageSnap.data(); const reward = message.reward || {};
    if (message.type !== "title_reward" || reward.kind !== "title" || !validDocumentId(String(reward.titleId || ""))) throw new HttpsError("failed-precondition", "not-title-reward");
    const earnedSnap = await tx.get(db.doc(`users/${actor.uid}/earnedTitles/${reward.titleId}`));
    if (!earnedSnap.exists || earnedSnap.data().status === "revoked") throw new HttpsError("permission-denied", "title-not-earned");
    const now = Date.now(), wasOpened = reward.openedAt != null;
    const patch = {"reward.status":"opened", "reward.ceremonyViewedAt":now, "reward.replayCount":Math.max(0,Number(reward.replayCount || 0)) + (wasOpened || action === "replay" ? 1 : 0), updatedAt:now};
    if (!wasOpened) patch["reward.openedAt"] = now;
    tx.update(messageRef, patch);
    return {ok:true, firstOpen:!wasOpened, title:{id:reward.titleId,name:reward.titleName || reward.titleId,rarityTier:reward.rarityTier || "common",limitedType:reward.limitedType || "none",artwork:reward.artwork || ""}};
  });
});

exports.revokeTitle = onCall({region: REGION, cors: true}, async (request) => {
  const actor = await requireSuperAdmin(request);
  const data = request.data || {};
  const uid = String(data.targetUid || "").trim();
  const titleId = String(data.titleId || "").trim();
  const reason = String(data.reason || "").trim();
  if (!validDocumentId(uid) || !validDocumentId(titleId) || reason.length < 2) throw new HttpsError("invalid-argument", "target-title-reason-required");
  const earnedRef = db.doc(`users/${uid}/earnedTitles/${titleId}`);
  const userRef = db.doc(`users/${uid}`);
  const definitionRef = db.doc(`titleDefinitions/${titleId}`);
  const auditRef = db.doc(`titleAuditLogs/${safeId(`${uid}_${titleId}_revoke_${data.operationId || Date.now()}`)}`);
  const result = await db.runTransaction(async (tx) => {
    const [earned, user, definition] = await Promise.all([tx.get(earnedRef), tx.get(userRef), tx.get(definitionRef)]);
    if (!earned.exists || earned.data().status === "revoked") return {revoked: false, reason: "not-active"};
    tx.set(earnedRef, {status: "revoked", revokedAt: FieldValue.serverTimestamp(), revokedBy: actor.uid, revokeReason: reason}, {merge: true});
    if (user.exists && user.data().equippedTitleId === titleId) {
      tx.set(userRef, {equippedTitleId: null, titleDisplayEnabled: false, updatedAt: FieldValue.serverTimestamp()}, {merge: true});
      tx.set(db.doc(`publicPlayers/${uid}`), {equippedTitleId: null, titleDisplayEnabled: false, updatedAt: Date.now()}, {merge: true});
    }
    tx.create(auditRef, {action: "revoke", titleId, targetUid: uid, operatorUid: actor.uid, reason, isTestData: earned.data().isTestData === true, createdAt: FieldValue.serverTimestamp()});
    if (definition.exists && earned.data().isTestData !== true) {
      tx.set(definitionRef, {recipientCount: Math.max(0, Number(definition.data().recipientCount || 0) - 1), updatedAt: FieldValue.serverTimestamp()}, {merge: true});
    }
    return {revoked: true};
  });
  return Object.assign({ok: true}, result);
});

const INITIAL_TITLES = [
  {id:"co_leader",code:"CO_LEADER",name:"二當家",description:"BXH 核心工作夥伴；由最高管理員指定。",hint:"身分頭銜不附加系統權限。",category:"identity",rarity:"limited",conditionType:"manual",targetValue:1,isActive:true,retroactiveEnabled:false},
  {id:"third_leader",code:"THIRD_LEADER",name:"三當家",description:"BXH 核心工作夥伴；由最高管理員指定。",hint:"身分頭銜不附加系統權限。",category:"identity",rarity:"limited",conditionType:"manual",targetValue:1,isActive:true,retroactiveEnabled:false},
  {id:"bxh_staff",code:"BXH_STAFF",name:"BXH 工作人員",description:"BXH 專屬工作人員身分頭銜。",hint:"身分頭銜不附加系統權限。",category:"identity",rarity:"limited",conditionType:"manual",targetValue:1,isActive:true,retroactiveEnabled:false},
  {id:"closed_beta",code:"CLOSED_BETA",name:"封測先鋒",description:"參與 BXH 封閉測試的夥伴。",hint:"身分頭銜不附加系統權限。",category:"identity",rarity:"limited",conditionType:"manual",targetValue:1,isActive:true,retroactiveEnabled:false},
  {id:"pioneer",code:"PIONEER",name:"開拓者",description:"正式開放後前100名完成玩家資料建檔的正式玩家。",hint:"在 BXH ARENA 正式開放初期完成玩家資料。",category:"launch",rarity:"limited",conditionType:"pioneer_quota",targetValue:1,maxRecipients:100,isLimited:true,isHidden:false,isActive:false,retroactiveEnabled:false},
  {id:"first_generation_warrior",code:"FIRST_GENERATION",name:"初代戰士",description:"第一賽季完成至少一場正式賽事。",hint:"參與第一賽季正式賽事。",category:"launch",rarity:"limited",conditionType:"season_completed_tournaments",targetValue:1,seasonId:"S1",isLimited:true,isHidden:false,isActive:false,retroactiveEnabled:true},
  {id:"host_1",code:"HOST_1",name:"初次開局",description:"成功完成主辦 1 場賽事。",hint:"正常完成有實際對戰的一般或正式賽事；測試賽事不計入。",category:"hosting",rarity:"rare",conditionType:"hosted_tournaments",targetValue:1,isActive:true,retroactiveEnabled:true},
  {id:"host_3",code:"HOST_3",name:"對戰召集人",description:"成功完成主辦 3 場賽事。",hint:"正常完成有實際對戰的一般或正式賽事；測試賽事不計入。",category:"hosting",rarity:"rare",conditionType:"hosted_tournaments",targetValue:3,isActive:true,retroactiveEnabled:true},
  {id:"host_10",code:"HOST_10",name:"賽事推手",description:"成功完成主辦 10 場賽事。",hint:"正常完成有實際對戰的一般或正式賽事；測試賽事不計入。",category:"hosting",rarity:"rare",conditionType:"hosted_tournaments",targetValue:10,isActive:true,retroactiveEnabled:true},
  {id:"host_20",code:"HOST_20",name:"資深主辦",description:"成功完成主辦 20 場賽事。",hint:"正常完成有實際對戰的一般或正式賽事；測試賽事不計入。",category:"hosting",rarity:"rare",conditionType:"hosted_tournaments",targetValue:20,isActive:true,retroactiveEnabled:true},
  {id:"host_30",code:"HOST_30",name:"競技場主",description:"成功完成主辦 30 場賽事。",hint:"正常完成有實際對戰的一般或正式賽事；測試賽事不計入。",category:"hosting",rarity:"rare",conditionType:"hosted_tournaments",targetValue:30,isActive:true,retroactiveEnabled:true},
  {id:"first_battle",code:"FIRST_BATTLE",name:"初次上陣",description:"完成第一場正式賽事。",hint:"完成正式積分賽事。",category:"participation",rarity:"common",conditionType:"completed_tournaments",targetValue:1,isActive:true,retroactiveEnabled:true},
  {id:"rookie_hunter",code:"ROOKIE_HUNTER",name:"新銳獵人",description:"累積完成3場正式賽事。",hint:"持續參加正式賽事。",category:"participation",rarity:"common",conditionType:"completed_tournaments",targetValue:3,isActive:true,retroactiveEnabled:true},
  {id:"familiar_face",code:"FAMILIAR_FACE",name:"戰場熟面孔",description:"累積完成10場正式賽事。",hint:"持續參加正式賽事。",category:"participation",rarity:"rare",conditionType:"completed_tournaments",targetValue:10,isActive:true,retroactiveEnabled:true},
  {"id":"hundred_battles","code":"HUNDRED_BATTLES","name":"百戰磨練","targetValue":100,"conditionType":"official_matches","description":"累積完成100場 BXH 官方積分賽對戰。每次與對手完成一場對局計1場。","hint":"僅計入可核對帳號的已完成正式對戰；輪空、取消、未到、測試對戰不計。","category":"participation","rarity":"epic","rarityTier":"epic","limitedType":"none","isLimited":false,"isPermanent":true,"isActive":true,"isPublic":true,"isHidden":false,"isArchived":false,"retroactiveEnabled":true,"maxRecipients":0,"seriesId":"official_match_milestones","sortOrder":2100},
  {"id":"battles_200","code":"BATTLES_200","name":"雙生修羅","targetValue":200,"conditionType":"official_matches","description":"累積完成200場 BXH 官方積分賽對戰。每次與對手完成一場對局計1場。","hint":"僅計入可核對帳號的已完成正式對戰；輪空、取消、未到、測試對戰不計。","category":"participation","rarity":"epic","rarityTier":"epic","limitedType":"none","isLimited":false,"isPermanent":true,"isActive":true,"isPublic":true,"isHidden":false,"isArchived":false,"retroactiveEnabled":true,"maxRecipients":0,"seriesId":"official_match_milestones","sortOrder":2101},
  {"id":"battles_300","code":"BATTLES_300","name":"三途橫渡","targetValue":300,"conditionType":"official_matches","description":"累積完成300場 BXH 官方積分賽對戰。每次與對手完成一場對局計1場。","hint":"僅計入可核對帳號的已完成正式對戰；輪空、取消、未到、測試對戰不計。","category":"participation","rarity":"epic","rarityTier":"epic","limitedType":"none","isLimited":false,"isPermanent":true,"isActive":true,"isPublic":true,"isHidden":false,"isArchived":false,"retroactiveEnabled":true,"maxRecipients":0,"seriesId":"official_match_milestones","sortOrder":2102},
  {"id":"battles_400","code":"BATTLES_400","name":"四神俱滅","targetValue":400,"conditionType":"official_matches","description":"累積完成400場 BXH 官方積分賽對戰。每次與對手完成一場對局計1場。","hint":"僅計入可核對帳號的已完成正式對戰；輪空、取消、未到、測試對戰不計。","category":"participation","rarity":"epic","rarityTier":"epic","limitedType":"none","isLimited":false,"isPermanent":true,"isActive":true,"isPublic":true,"isHidden":false,"isArchived":false,"retroactiveEnabled":true,"maxRecipients":0,"seriesId":"official_match_milestones","sortOrder":2103},
  {"id":"battles_500","code":"BATTLES_500","name":"五嶽崩摧","targetValue":500,"conditionType":"official_matches","description":"累積完成500場 BXH 官方積分賽對戰。每次與對手完成一場對局計1場。","hint":"僅計入可核對帳號的已完成正式對戰；輪空、取消、未到、測試對戰不計。","category":"participation","rarity":"epic","rarityTier":"epic","limitedType":"none","isLimited":false,"isPermanent":true,"isActive":true,"isPublic":true,"isHidden":false,"isArchived":false,"retroactiveEnabled":true,"maxRecipients":0,"seriesId":"official_match_milestones","sortOrder":2104},
  {"id":"battles_600","code":"BATTLES_600","name":"六道輪迴","targetValue":600,"conditionType":"official_matches","description":"累積完成600場 BXH 官方積分賽對戰。每次與對手完成一場對局計1場。","hint":"僅計入可核對帳號的已完成正式對戰；輪空、取消、未到、測試對戰不計。","category":"participation","rarity":"epic","rarityTier":"epic","limitedType":"none","isLimited":false,"isPermanent":true,"isActive":true,"isPublic":true,"isHidden":false,"isArchived":false,"retroactiveEnabled":true,"maxRecipients":0,"seriesId":"official_match_milestones","sortOrder":2105},
  {"id":"battles_700","code":"BATTLES_700","name":"七星隕落","targetValue":700,"conditionType":"official_matches","description":"累積完成700場 BXH 官方積分賽對戰。每次與對手完成一場對局計1場。","hint":"僅計入可核對帳號的已完成正式對戰；輪空、取消、未到、測試對戰不計。","category":"participation","rarity":"epic","rarityTier":"epic","limitedType":"none","isLimited":false,"isPermanent":true,"isActive":true,"isPublic":true,"isHidden":false,"isArchived":false,"retroactiveEnabled":true,"maxRecipients":0,"seriesId":"official_match_milestones","sortOrder":2106},
  {"id":"battles_800","code":"BATTLES_800","name":"八荒血帝","targetValue":800,"conditionType":"official_matches","description":"累積完成800場 BXH 官方積分賽對戰。每次與對手完成一場對局計1場。","hint":"僅計入可核對帳號的已完成正式對戰；輪空、取消、未到、測試對戰不計。","category":"participation","rarity":"epic","rarityTier":"epic","limitedType":"none","isLimited":false,"isPermanent":true,"isActive":true,"isPublic":true,"isHidden":false,"isArchived":false,"retroactiveEnabled":true,"maxRecipients":0,"seriesId":"official_match_milestones","sortOrder":2107},
  {"id":"battles_900","code":"BATTLES_900","name":"九天終焉","targetValue":900,"conditionType":"official_matches","description":"累積完成900場 BXH 官方積分賽對戰。每次與對手完成一場對局計1場。","hint":"僅計入可核對帳號的已完成正式對戰；輪空、取消、未到、測試對戰不計。","category":"participation","rarity":"epic","rarityTier":"epic","limitedType":"none","isLimited":false,"isPermanent":true,"isActive":true,"isPublic":true,"isHidden":false,"isArchived":false,"retroactiveEnabled":true,"maxRecipients":0,"seriesId":"official_match_milestones","sortOrder":2108},
  {"id":"battles_1000","code":"BATTLES_1000","name":"千古不滅","targetValue":1000,"conditionType":"official_matches","description":"累積完成1000場 BXH 官方積分賽對戰。每次與對手完成一場對局計1場。","hint":"僅計入可核對帳號的已完成正式對戰；輪空、取消、未到、測試對戰不計。","category":"participation","rarity":"epic","rarityTier":"epic","limitedType":"none","isLimited":false,"isPermanent":true,"isActive":true,"isPublic":true,"isHidden":false,"isArchived":false,"retroactiveEnabled":true,"maxRecipients":0,"seriesId":"official_match_milestones","sortOrder":2109},
  {id:"top16_debut",code:"TOP16_DEBUT",name:"初露鋒芒",description:"首次晉級正式賽事16強。",hint:"在正式賽事突破初期階段。",category:"placement",rarity:"rare",conditionType:"stage_reached",targetValue:16,isActive:false,retroactiveEnabled:false},
  {id:"top8_wall",code:"TOP8_WALL",name:"八強之壁",description:"首次晉級正式賽事8強。",hint:"在正式賽事挺進後段。",category:"placement",rarity:"rare",conditionType:"stage_reached",targetValue:8,isActive:false,retroactiveEnabled:false},
  {id:"semifinal_overlord",code:"TOP4_OVERLORD",name:"四強霸主",description:"首次晉級正式賽事4強。",hint:"在正式賽事挺進四強。",category:"placement",rarity:"epic",conditionType:"best_placement",targetValue:4,isActive:true,retroactiveEnabled:true},
  {id:"champion_hunter",code:"CHAMPION_HUNTER",name:"冠軍獵人",description:"首次獲得正式賽事冠軍。",hint:"贏得正式賽事冠軍。",category:"champion",rarity:"epic",conditionType:"championships",targetValue:1,isActive:true,retroactiveEnabled:true},
  {id:"triple_crown",code:"TRIPLE_CROWN",name:"三冠王",description:"累積獲得3次正式賽事冠軍。",hint:"持續挑戰正式賽事冠軍。",category:"champion",rarity:"legendary",conditionType:"championships",targetValue:3,isActive:true,retroactiveEnabled:true},
  {id:"winning_blade",code:"WINNING_BLADE",name:"連勝之刃",description:"正式對戰連續取得5勝。",hint:"保持正式對戰連勝。",category:"battle",rarity:"epic",conditionType:"win_streak",targetValue:5,isActive:false,retroactiveEnabled:false},
  {id:"undefeated_legend",code:"UNDEFEATED_LEGEND",name:"不敗傳說",description:"單場正式賽事全勝奪冠。",hint:"以不敗戰績完成正式賽事。",category:"battle",rarity:"legendary",conditionType:"undefeated_champion",targetValue:1,isActive:false,retroactiveEnabled:false},
  {id:"four_venues",code:"FOUR_VENUES",name:"四方征戰",description:"在4個不同正式場地完成參賽。",hint:"前往不同正式場地參賽。",category:"exploration",rarity:"epic",conditionType:"unique_venues",targetValue:4,isActive:false,retroactiveEnabled:false},
  {id:"season_king",code:"SEASON_KING",name:"賽季王者",description:"賽季結算時排名第1名。",hint:"登上賽季最終排名第一。",category:"season",rarity:"legendary",conditionType:"season_rank",targetValue:1,isActive:false,retroactiveEnabled:true},
  {id:"first_checkin",code:"FIRST_CHECKIN",name:"初來乍到",description:"首次完成每日簽到。",hint:"在玩家中心完成每日簽到。",category:"checkin",rarity:"common",conditionType:"total_checkins",targetValue:1,isActive:true,retroactiveEnabled:false},
  {id:"seven_day_guest",code:"SEVEN_DAY_GUEST",name:"七日常客",description:"累積完成7天每日簽到。",hint:"累積完成每日簽到。",category:"checkin",rarity:"common",conditionType:"total_checkins",targetValue:7,isActive:true,retroactiveEnabled:false},
  {id:"monthly_hunter",code:"MONTHLY_HUNTER",name:"月度獵人",description:"累積完成30天每日簽到。",hint:"累積完成每日簽到。",category:"checkin",rarity:"rare",conditionType:"total_checkins",targetValue:30,isActive:true,retroactiveEnabled:false},
  {id:"hundred_day_warrior",code:"HUNDRED_DAY_WARRIOR",name:"百日戰士",description:"累積完成100天每日簽到。",hint:"長期持續每日簽到。",category:"checkin",rarity:"epic",conditionType:"total_checkins",targetValue:100,isActive:true,retroactiveEnabled:false}
];

// v13.29.9 tournament lifecycle and prize raffles.
Object.assign(exports, require("./operations"));

Object.assign(exports, require('./accounts'));

Object.assign(exports, require('./entry-selection'));

Object.assign(exports,require('./hosting'));
exports.awardHostingTitles=onDocumentWritten({document:'hostAwardQueue/{uid}',region:REGION,retry:true},async e=>{if(e.data?.after.exists)await evaluateTitles(e.params.uid,'hosting_completed',e.params.uid);});

Object.assign(exports,require('./registration-selection'));

const cards=require("./player-cards");exports.playerCardService=cards.playerCardService;exports.syncPlayerDirectory=cards.syncPlayerDirectory;

Object.assign(exports, require('./tournament-deletion'));

// P6.7: server-authoritative, idempotent Hunter achievement awards.
const {syncHunterAchievements, resetHunterPrelaunchData} = require("./hunter-achievements").createHunterAchievementFunctions({
  db,
  onCall,
  HttpsError,
  FieldValue,
  region: REGION,
});
exports.syncHunterAchievements = syncHunterAchievements;
exports.resetHunterPrelaunchData = resetHunterPrelaunchData;

// One-time Production cutover: freeze S0, preserve its final results, and start S1 from zero.
const {prepareLadderS1Cutover, activateLadderS1} = require("./ladder-season-cutover").createLadderSeasonCutoverFunctions({
  db,
  FieldValue,
  region: REGION,
});
exports.prepareLadderS1Cutover = prepareLadderS1Cutover;
exports.activateLadderS1 = activateLadderS1;

// P7.6: AI-assisted tournament creation parser boundary.
// The provider is intentionally null in P7.6. The callable is deployable but
// remains fail-closed until P7.7 installs a server-side provider adapter.
const {createAiCreateParserFunction} = require("./ai-create-parser");
const parseTournamentAnnouncementV1 = createAiCreateParserFunction({
  db,
  onCall,
  HttpsError,
  region: REGION,
  provider: null,
});
exports.parseTournamentAnnouncementV1 = parseTournamentAnnouncementV1;
