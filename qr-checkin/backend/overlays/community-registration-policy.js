'use strict';

// Opt-in only: old community rooms and official scheduled events keep their
// existing contract. A missing marker or legacy zero never means unlimited.
function isQuickCommunity(t, pub) {
  return t?.eventAuthority === 'community' && pub?.eventAuthority === 'community'
    && t.communityQuickRegistration === true && pub.communityQuickRegistration === true;
}

function optionalTime(value) {
  if (value === null) return null;
  const number = value && typeof value.toMillis === 'function' ? value.toMillis() : value;
  if (typeof number !== 'number' || !Number.isSafeInteger(number) || number <= 0) {
    throw Error('invalid-registration-schedule');
  }
  return number;
}

function quickPolicy(t, pub) {
  const marked = t?.communityQuickRegistration === true || pub?.communityQuickRegistration === true;
  if (!marked) return null;
  if (!isQuickCommunity(t, pub) || t.battleMode === 'team' || pub.battleMode === 'team') throw Error('registration-state-conflict');
  const capacity = t.capacity;
  if (capacity !== null && (typeof capacity !== 'number' || !Number.isSafeInteger(capacity) || capacity <= 0)) {
    throw Error('invalid-registration-capacity');
  }
  if (pub.capacity !== capacity) throw Error('registration-state-conflict');
  const openAt = optionalTime(t.registrationOpenAt);
  const closeAt = optionalTime(t.registrationCloseAt);
  if (optionalTime(pub.registrationOpenAt) !== openAt || optionalTime(pub.registrationCloseAt) !== closeAt) {
    throw Error('registration-state-conflict');
  }
  if (openAt !== null && closeAt !== null && closeAt <= openAt) throw Error('invalid-registration-schedule');
  const cancellationDeadline = optionalTime(t.cancellationDeadline);
  if (optionalTime(pub.cancellationDeadline) !== cancellationDeadline) throw Error('registration-state-conflict');
  return { capacity, openAt, closeAt, cancellationDeadline };
}

function participantAliases(person, registration = false, index = 0) {
  const registrationId = String(person.registrationId || (registration ? person.uid : '') || '');
  const familyId = person.familyPlayerId || (registrationId.startsWith('family_') ? registrationId.slice(7) : '');
  // A guardian is never the identity of the child they registered.
  if (familyId) return ['family:' + familyId];
  const aliases = [];
  for (const uid of [person.accountUid, person.playerUid, person.uid, person.registrationUid, registration ? registrationId : null]) {
    if (uid) aliases.push('account:' + uid);
  }
  if (registrationId) aliases.push('registration:' + registrationId);
  if (!registration && person.id) aliases.push('player:' + person.id);
  return [...new Set(aliases.length ? aliases : ['unlinked:' + index])];
}

function quickParticipants(runtime, registrations) {
  const records = Array.isArray(registrations) ? registrations : [];
  // Registration documents own the status of online rows; a stale mirrored
  // player must not continue occupying a slot after cancellation/demotion.
  const local = (Array.isArray(runtime?.players) ? runtime.players : [])
    .filter(person => person && person.source !== 'online' && !person.registrationId);
  const entities = local.map((person, index) => participantAliases(person, false, index))
    .concat(records.filter(row => row.status === 'confirmed').map(row => participantAliases(row, true)));
  const parent = new Map();
  function find(key) {
    if (!parent.has(key)) parent.set(key, key);
    if (parent.get(key) !== key) parent.set(key, find(parent.get(key)));
    return parent.get(key);
  }
  for (const aliases of entities) {
    const root = find(aliases[0]);
    for (const alias of aliases.slice(1)) parent.set(find(alias), root);
  }
  const count = new Set(entities.map(aliases => find(aliases[0]))).size;
  return {
    count,
    contains(person) { return participantAliases(person, true).some(alias => parent.has(alias)); }
  };
}

module.exports = { isQuickCommunity, quickPolicy, participantAliases, quickParticipants };
