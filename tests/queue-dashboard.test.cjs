'use strict';

const assert = require('node:assert/strict');
const {test} = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const dashboard = require('../modules/main-app/queue-dashboard.js');
const modulePath = path.join(__dirname, '..', 'modules', 'main-app', 'queue-dashboard.js');

// Fixtures deliberately disagree about seq, roster order, and court order.
// Only an unambiguous public current/next assignment establishes a queue count.
function fixture() {
  return {
    meta: {stations: 2, formatType: 'single', battleMode: 'individual', bronzeMatch: false},
    bracketSize: 8,
    startedAt: 1,
    players: Array.from({length: 8}, (_, i) => ({id: `p${i + 1}`, name: `選手${i + 1}`})),
    matches: [
      match('current', 'p1', 'p2', {seq: 90, indexInRound: 0, status: 'in_progress'}),
      match('next', 'p3', 'p4', {seq: 3, indexInRound: 1}),
      match('later', 'p5', 'p6', {seq: 4, indexInRound: 2}),
      match('other-court', 'p7', 'p8', {seq: 2, indexInRound: 3, station: 2})
    ],
    courtAssignments: {
      court1: {currentMatchId: 'current', nextMatchId: 'next', status: 'active'},
      court2: {currentMatchId: 'other-court', nextMatchId: null, status: 'active'}
    }
  };
}
function match(id, a, b, overrides = {}) {
  return {id, a: {playerId: a}, b: {playerId: b}, station: 1, seq: 1,
    round: 0, indexInRound: 0, completed: false, isBye: false, status: 'ready', ...overrides};
}
function registration(id = 'p1', overrides = {}) {
  return {tournamentCode: 'QUEUE01', playerId: id, status: 'confirmed', ...overrides};
}
function info(st, overrides = {}) {
  return {parsedData: st, tournamentPhase: 'live', ...overrides};
}
function projection(st, id = 'p1', overrides = {}) {
  return dashboard.model(registration(id), info(st, overrides));
}
function assertUnknown(model, message = 'unconfirmed queue position must stay unknown') {
  assert.equal(model.ahead, null, message);
}
function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

test('exports the independent read-only queue and display helpers', () => {
  for (const name of ['findPlayerId', 'playerNumber', 'courts', 'model', 'html']) {
    assert.equal(typeof dashboard[name], 'function', `${name} must be exported`);
  }
});

test('current has exactly zero ahead and its confirmed court/opponent', () => {
  const m = projection(fixture());
  assert.equal(m.kind, 'playing');
  assert.equal(m.ahead, 0);
  assert.equal(m.station, 1);
  assert.equal(m.matchId, 'current');
  assert.equal(m.opponent.id, 'p2');
  assert.equal(m.opponent.name, '選手2');
});

test('called current counts zero even before scoring starts', () => {
  const st = fixture();
  st.matches[0].status = 'ready';
  const m = projection(st);
  assert.equal(m.kind, 'called');
  assert.equal(m.ahead, 0);
});

test('assigned next has exactly one ahead despite unrelated seq values', () => {
  const m = projection(fixture(), 'p3');
  assert.equal(m.kind, 'soon');
  assert.equal(m.ahead, 1);
  assert.equal(m.station, 1);
  assert.equal(m.matchId, 'next');
  assert.equal(m.opponent.id, 'p4');
});

test('beyond-next match does not derive queue count from seq or initial station', () => {
  const st = fixture();
  const before = projection(st, 'p5');
  assertUnknown(before);
  assert.equal(before.station, null);
  st.matches[2].seq = -10000;
  st.players.reverse();
  const after = projection(st, 'p5');
  assertUnknown(after);
  assert.equal(after.station, null);
});

test('multiple unassigned round-robin matches cannot choose an opponent by seq', () => {
  const st = fixture();
  st.meta.formatType = 'roundrobin';
  st.matches = [
    match('future-a', 'p1', 'p2', {seq: 100, station: 2}),
    match('future-b', 'p3', 'p1', {seq: -50, station: 1}),
    match('future-c', 'p1', 'p4', {seq: 2, station: 2}),
    match('current-other', 'p5', 'p6', {seq: 1})
  ];
  st.courtAssignments = {court1: {currentMatchId: 'current-other'}};
  for (let i = 0; i < st.matches.length; i++) {
    const m = projection(st);
    assert.equal(m.kind, 'pending');
    assertUnknown(m);
    assert.equal(m.opponent, null, 'no authoritative next opponent exists');
    assert.equal(m.station, null, 'initial station hints are not assignments');
    assert.equal(m.matchId ?? null, null, 'do not select an arbitrary future match');
    const html = dashboard.html(registration(), info(st), m);
    assert.doesNotMatch(html, /<span>\d+<\/span><small>場<\/small>/);
    assert.match(html, /<span>對手<\/span><strong>待定<\/strong>/);
    st.matches.unshift(st.matches.pop());
    for (const future of st.matches) future.seq *= -100;
  }
});

test('authoritative round-robin next identifies opponent despite other future matches', () => {
  const st = fixture();
  st.meta.formatType = 'roundrobin';
  st.matches.push(match('future-a', 'p3', 'p5', {seq: -100}),
    match('future-b', 'p6', 'p3', {seq: -200, station: 2}));
  const m = projection(st, 'p3');
  assert.equal(m.kind, 'soon');
  assert.equal(m.ahead, 1);
  assert.equal(m.station, 1);
  assert.equal(m.matchId, 'next');
  assert.equal(m.opponent.id, 'p4');
});

test('missing assignments never synthesize a queue from bracket order', () => {
  const st = fixture();
  delete st.courtAssignments;
  for (const id of ['p1', 'p3', 'p5']) {
    const m = projection(st, id);
    assertUnknown(m);
    assert.equal(m.station, null);
  }
});

test('missing or invalid match station never falls back to court 1', () => {
  for (const station of [undefined, null, 0, -1, 'bad']) {
    const st = fixture();
    st.matches[0].station = station;
    const m = projection(st);
    assertUnknown(m);
    assert.equal(m.station, null);
    assert.equal(dashboard.courts(st)[0].current, null);
  }
});

test('missing station metadata does not invent one physical court', () => {
  const st = fixture();
  delete st.meta.stations;
  assert.deepEqual(dashboard.courts(st), []);
  const m = projection(st);
  assertUnknown(m);
  assert.equal(m.station, null);
});

test('next with missing, unknown, or completed current is not assigned a count', () => {
  for (const scenario of ['empty', 'missing', 'completed']) {
    const st = fixture();
    if (scenario === 'empty') st.courtAssignments.court1.currentMatchId = null;
    if (scenario === 'missing') st.courtAssignments.court1.currentMatchId = 'absent';
    if (scenario === 'completed') st.matches[0].completed = true;
    assertUnknown(projection(st, 'p3'), `next count must be unknown when current is ${scenario}`);
  }
});

test('PASS next after its valid assigned current retains exactly one ahead', () => {
  const st = fixture();
  Object.assign(st.matches[1], {skippedAt: 100, skipManualOnly: false,
    skipWaitFor: ['current'], callPass: {waitFor: ['current']}});
  const m = projection(st, 'p3');
  assert.equal(m.kind, 'soon');
  assert.equal(m.ahead, 1);
  assert.equal(dashboard.courts(st)[0].next.id, 'next');
});

test('PASS with missing dependency never claims a numeric position', () => {
  const st = fixture();
  Object.assign(st.matches[1], {skippedAt: 100, callPass: {waitFor: ['missing-predecessor']}});
  assertUnknown(projection(st, 'p3'));
  assert.equal(dashboard.courts(st)[0].next, null);
});

test('PASS recognizes a uniquely status-completed earlier predecessor', () => {
  const st = fixture();
  st.matches.push(match('earlier', 'p5', 'p6', {status: 'completed'}));
  delete st.matches.at(-1).completed;
  Object.assign(st.matches[1], {skippedAt: 100,
    callPass: {waitFor: ['earlier', 'current']}});
  assert.equal(projection(st, 'p3').ahead, 1);
});

test('PASS duplicate prerequisite IDs cannot be treated as completed by first match', () => {
  for (const completedFirst of [true, false]) {
    const st = fixture();
    const earlier = [
      match('earlier', 'p5', 'p6', {completed: true}),
      match('earlier', 'p5', 'p6')
    ];
    st.matches.push(...(completedFirst ? earlier : earlier.reverse()));
    Object.assign(st.matches[1], {skippedAt: 100,
      callPass: {waitFor: ['earlier', 'current']}});
    assertUnknown(projection(st, 'p3'));
  }
});

test('PASS next with outstanding dependency on another court remains unknown', () => {
  const st = fixture();
  Object.assign(st.matches[1], {skippedAt: 100,
    callPass: {waitFor: ['current', 'other-court']}});
  assertUnknown(projection(st, 'p3'));
});

test('PASS stale current cannot announce ready or playing before predecessor', () => {
  const st = fixture();
  Object.assign(st.matches[0], {skippedAt: 100, callPass: {waitFor: ['other-court']}});
  const m = projection(st);
  assertUnknown(m);
  assert.equal(dashboard.courts(st)[0].current, null);
});

test('manual-only deferred next does not claim the next confirmed slot', () => {
  const st = fixture();
  Object.assign(st.matches[1], {skippedAt: 100, skipManualOnly: true});
  assertUnknown(projection(st, 'p3'));
  assert.equal(dashboard.courts(st)[0].next, null);
});

test('manually resumed deferred next may retain its manual-only flag until current', () => {
  const st = fixture();
  Object.assign(st.matches[1], {skippedAt: 100, skipManualOnly: true,
    resumeQueuedAt: 200, skipWaitFor: []});
  const m = projection(st, 'p3');
  assert.equal(m.kind, 'soon');
  assert.equal(m.ahead, 1);
  assert.equal(m.station, 1);
  assert.equal(dashboard.courts(st)[0].next.id, 'next');
});

test('paused current stays zero and valid next stays one with pause notice', () => {
  for (const pauseAt of ['match', 'court']) {
    const st = fixture();
    if (pauseAt === 'match') st.matches[0].status = 'paused';
    else st.courtAssignments.court1.status = 'paused';
    const current = projection(st);
    const next = projection(st, 'p3');
    assert.equal(current.kind, 'paused');
    assert.equal(current.ahead, 0);
    assert.equal(next.ahead, 1);
    assert.match(next.message, /暫停/);
  }
});

test('moved match disagrees with its stale assignment and remains unnumbered', () => {
  const st = fixture();
  st.matches[0].station = 2;
  assertUnknown(projection(st));
  assert.equal(projection(st).station, null);
  assert.equal(dashboard.courts(st)[0].current, null);
});

test('a fully reconciled moved assignment shows the new physical court', () => {
  const st = fixture();
  st.matches[0].station = 2;
  st.courtAssignments.court1.currentMatchId = null;
  st.courtAssignments.court2.currentMatchId = 'current';
  const m = projection(st);
  assert.equal(m.ahead, 0);
  assert.equal(m.station, 2);
});

test('duplicate court references never select the first apparent occurrence', () => {
  for (const duplicateAt of ['same-court', 'different-court']) {
    const st = fixture();
    if (duplicateAt === 'same-court') st.courtAssignments.court1.nextMatchId = 'current';
    else st.courtAssignments.court2.nextMatchId = 'current';
    assertUnknown(projection(st));
    assert.equal(dashboard.courts(st)[0].current, null);
  }
});

test('duplicate match IDs invalidate an assignment even when one record appears ready', () => {
  const st = fixture();
  st.matches.push({...st.matches[0], status: 'ready'});
  assertUnknown(projection(st));
  assert.equal(dashboard.courts(st)[0].current, null);
});

test('duplicate player IDs cannot resolve identity or establish opponent readiness', () => {
  const st = fixture();
  st.players.push({...st.players[0]});
  assert.equal(dashboard.findPlayerId(st, registration()), null);
  assertUnknown(projection(st));
  assert.equal(dashboard.courts(st)[0].current, null);
  const other = fixture();
  other.players.push({...other.players[1]});
  assertUnknown(projection(other));
});

test('unresolved, absent, or self opponent never yields an exact current count', () => {
  for (const opponent of [null, 'not-in-roster', 'p1']) {
    const st = fixture();
    st.matches[0].b.playerId = opponent;
    assertUnknown(projection(st));
    assert.equal(dashboard.courts(st)[0].current, null);
  }
});

test('retired and force-closed courts exclude stale current and next assignments', () => {
  for (const mode of ['retired', 'forced']) {
    const st = fixture();
    if (mode === 'retired') st.courtAssignments.court1.status = 'retired';
    else st.forcedCourtExits = {1: {closed: true}};
    const court = dashboard.courts(st)[0];
    assert.equal(court.current, null);
    assert.equal(court.next, null);
    assertUnknown(projection(st));
    assertUnknown(projection(st, 'p3'));
  }
});

test('bye is not a queued match and does not end its winner schedule', () => {
  const st = fixture();
  Object.assign(st.matches[0], {isBye: true, completed: true, winnerId: 'p1', loserId: null});
  const m = projection(st);
  assertUnknown(m);
  assert.notEqual(m.kind, 'done');
  assert.equal(dashboard.courts(st)[0].current, null);
});

test('completed scored and forfeit matches are removed from current and next', () => {
  for (const resultMethod of ['score', 'forfeit', 'quick_decision']) {
    const st = fixture();
    Object.assign(st.matches[0], {completed: true, resultMethod, winnerId: 'p2', loserId: 'p1'});
    const m = projection(st);
    assertUnknown(m);
    assert.equal(m.kind, 'done');
    assert.equal(dashboard.courts(st)[0].current, null);
    assertUnknown(projection(st, 'p3'));
  }
});

test('status-completed single-elimination loss is terminal without a bronze path', () => {
  const st = fixture();
  Object.assign(st.matches[0], {status: 'completed', winnerId: 'p2', loserId: 'p1'});
  delete st.matches[0].completed;
  const m = projection(st);
  assertUnknown(m);
  assert.equal(m.kind, 'done');
});

test('double-elimination first loss does not prematurely finish the player', () => {
  const st = fixture();
  st.meta.formatType = 'double';
  Object.assign(st.matches[0], {completed: true, winnerId: 'p2', loserId: 'p1'});
  assert.notEqual(projection(st).kind, 'done');
});

test('bronze-enabled semifinal loser remains pending before bronze is generated', () => {
  const st = fixture();
  st.meta.bronzeMatch = true;
  st.matches = [
    match('semi1', 'p1', 'p2', {round: 1, completed: true, winnerId: 'p2', loserId: 'p1'}),
    match('semi2', 'p3', 'p4', {round: 1, indexInRound: 1, station: 2}),
    match('final', 'p2', null, {round: 2})
  ];
  st.courtAssignments = {court2: {currentMatchId: 'semi2'}};
  const m = projection(st);
  assertUnknown(m);
  assert.notEqual(m.kind, 'done', 'BZ is created only after BOTH semifinals finish');
});

test('quarterfinal loser is done while other players still await bronze', () => {
  const st = fixture();
  st.meta.bronzeMatch = true;
  Object.assign(st.matches[0], {completed: true, winnerId: 'p2', loserId: 'p1'});
  st.matches.push(match('bronze', 'p5', 'p7', {bracket: 'BZ', round: 1}));
  assert.equal(projection(st).kind, 'done', 'another player bronze path cannot keep an eliminated player waiting');
});

test('scheduled bronze participant has their own exact confirmed slot', () => {
  const st = fixture();
  st.meta.bronzeMatch = true;
  Object.assign(st.matches[0], {completed: true, round: 1, winnerId: 'p2', loserId: 'p1'});
  st.matches.push(match('bronze', 'p1', 'p5', {bracket: 'BZ', round: 1}));
  st.courtAssignments.court1 = {currentMatchId: 'next', nextMatchId: 'bronze'};
  const m = projection(st);
  assert.equal(m.kind, 'soon');
  assert.equal(m.ahead, 1);
  assert.equal(m.opponent.id, 'p5');
});

test('finished tournament and archive never show stale exact queue counts', () => {
  const st = fixture();
  assert.equal(projection(st, 'p1', {tournamentPhase: 'done'}).kind, 'done');
  assertUnknown(projection(st, 'p1', {tournamentPhase: 'done'}));
  st.archiveStatus = 'completed';
  assert.equal(projection(st).kind, 'done');
  assertUnknown(projection(st));
});

test('same-name legacy identities remain ambiguous after normalization', () => {
  const st = fixture();
  st.players[0].name = 'Ａｌｉｃｅ';
  st.players[1].name = ' a l i c e ';
  assert.equal(dashboard.findPlayerId(st, {displayName: 'Alice'}), null);
  const r = registration(undefined, {playerId: undefined, displayName: 'Alice'});
  const m = dashboard.model(r, info(st));
  assertUnknown(m);
  assert.equal(m.playerId, null);
});

test('unique legacy name can identify a participant but explicit ID wins over names', () => {
  const st = fixture();
  assert.equal(dashboard.findPlayerId(st, {displayName: ' 選手3 '}), 'p3');
  assert.equal(dashboard.findPlayerId(st, registration('p1', {displayName: '選手3'})), 'p1');
  assert.equal(dashboard.findPlayerId(st, {displayName: 'absent'}, {displayName: '選手1'}), null,
    'unrelated profile names must not silently claim a match');
});

test('family participant identity never resolves to a guardian or sibling', () => {
  const st = fixture();
  st.players = [
    {id: 'guardian', name: '同名', registrationUid: 'guardian'},
    {id: 'family_child1', name: '同名', familyPlayerId: 'child1', guardianUid: 'guardian'},
    {id: 'family_child2', name: '同名', familyPlayerId: 'child2', guardianUid: 'guardian'}
  ];
  const r = {familyPlayerId: 'child1', uid: 'guardian', playerId: 'guardian', displayName: '同名'};
  assert.equal(dashboard.findPlayerId(st, r), 'family_child1');
  assert.equal(dashboard.findPlayerId(st, {...r, familyPlayerId: 'child2'}), 'family_child2');
  assert.equal(dashboard.findPlayerId(st, {...r, familyPlayerId: 'missing-child'}), null);
});

test('family identity also resolves from stable public family-prefixed ID alone', () => {
  const st = {players: [{id: 'family_child-7', name: 'Child'}, {id: 'reg_guardian', name: 'Parent'}]};
  assert.equal(dashboard.findPlayerId(st, {familyPlayerId: 'child-7', uid: 'guardian'}), 'family_child-7');
});

test('encoded registration ID resolves public mirrors without name matching', () => {
  const st = {players: [{id: 'reg_member_one_example_com', name: 'New name'}, {id: 'p-other', name: 'Old name'}]};
  const r = {registrationId: 'member.one@example.com', displayName: 'Old name'};
  assert.equal(dashboard.findPlayerId(st, r), 'reg_member_one_example_com');
});

test('registration link is usable and conflicting explicit IDs stay ambiguous', () => {
  const st = fixture();
  st.players[0].registrationId = 'registration-1';
  assert.equal(dashboard.findPlayerId(st, {registrationId: 'registration-1'}), 'p1');
  assert.equal(dashboard.findPlayerId(st, {playerId: 'p2', registrationId: 'registration-1'}), null);
});

test('bracket numbers follow actual first-round slots rather than roster order', () => {
  const st = fixture();
  st.players.reverse();
  assert.deepEqual(['p1','p2','p3','p4','p5','p6','p7','p8'].map(id => dashboard.playerNumber(st, id)),
    ['1','8','4','5','2','7','3','6']);
  assert.equal(dashboard.playerNumber(st, 'missing'), '');
  assert.equal(dashboard.playerNumber(st, null), '');
});

test('waitlist, not-started, team, missing-data, and sync-failure stay unnumbered', () => {
  const st = fixture();
  const waitlist = dashboard.model(registration('p1', {status: 'waitlist'}), info(st));
  assert.equal(waitlist.kind, 'waitlist');
  assertUnknown(waitlist);
  const notStarted = fixture();
  delete notStarted.startedAt;
  assertUnknown(projection(notStarted, 'p1', {tournamentPhase: 'registration'}));
  assertUnknown(projection(st, 'p1', {battleMode: 'team'}));
  assertUnknown(dashboard.model(registration(), {}));
  assertUnknown(dashboard.model(registration(), {parsedData: {}}));
  const stale = projection(st, 'p1', {queueSyncFailed: true});
  assertUnknown(stale);
  assert.match(stale.message, /更新暫停/);
});

test('HTML displays exact counts, all courts, both contestants, and bracket action', () => {
  const st = fixture();
  const r = registration('p3');
  const m = dashboard.model(r, info(st));
  const html = dashboard.html(r, info(st), m);
  assert.match(html, /前面還有/);
  assert.match(html, /<span>1<\/span><small>場<\/small>/);
  assert.equal((html.match(/class="queue-court-card\b/g) || []).length, 2);
  assert.match(html, /選手1/);
  assert.match(html, /選手2/);
  assert.match(html, /選手3/);
  assert.match(html, /選手4/);
  assert.match(html, /data-action="switch-to-player-watch"/);
  assert.match(html, /data-view="bracket"/);
  assert.match(html, /data-return="registered"/);
});

test('HTML never turns unknown position into a guessed numeric zero or default court', () => {
  const st = fixture();
  const r = registration('p5');
  const html = dashboard.html(r, info(st), dashboard.model(r, info(st)));
  assert.doesNotMatch(html, /<span>\d+<\/span><small>場<\/small>/);
  assert.match(html, /尚未排台/);
});

test('HTML escapes self, opponent, public court labels, and registration attributes', () => {
  const st = fixture();
  st.players[0].name = '<script>alert("self")</script>';
  st.players[1].name = '<img src=x onerror="alert(1)">&\'opponent';
  const r = registration('p1', {tournamentCode: 'CODE" onclick="evil()'});
  const html = dashboard.html(r, info(st), dashboard.model(r, info(st)));
  assert.doesNotMatch(html, /<script\b|<img\b|data-code="CODE" onclick=/i);
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /&lt;img src=x onerror=&quot;alert\(1\)&quot;&gt;&amp;&#39;opponent/);
  assert.match(html, /data-code="CODE&quot; onclick=&quot;evil\(\)"/);
});

test('pure projection and HTML preserve all caller-owned state and nested values', () => {
  const st = fixture();
  Object.assign(st.matches[1], {skippedAt: 123, callPass: {waitFor: ['current']}});
  const r = registration('p3');
  const summary = info(st);
  const profile = {displayName: 'Guardian'};
  const before = JSON.stringify({st, r, summary, profile});
  deepFreeze(st); deepFreeze(r); deepFreeze(summary); deepFreeze(profile);
  dashboard.findPlayerId(st, r, profile);
  dashboard.playerNumber(st, 'p3');
  dashboard.courts(st);
  const m = dashboard.model(r, summary, profile);
  dashboard.html(r, summary, m);
  assert.equal(JSON.stringify({st, r, summary, profile}), before);
  assert.equal(dashboard.model(r, summary).ahead, 1, 'repeated projection stays deterministic');
});

test('module has no backend, listener, storage, or polling side effects', () => {
  const source = fs.readFileSync(modulePath, 'utf8');
  assert.doesNotMatch(source,
    /\b(?:fetch|XMLHttpRequest|WebSocket|EventSource|setTimeout|setInterval|requestAnimationFrame|addEventListener|onSnapshot|httpsCallable|callEngagementFunction|cloudSync|firebase|localStorage|sessionStorage)\b/,
    'dashboard must only consume the parent-provided snapshot');
  const deny = name => () => {throw new Error(`Unexpected side effect: ${name}`);};
  const context = {module: {exports: {}}, fetch: deny('fetch'), setTimeout: deny('setTimeout'),
    setInterval: deny('setInterval'), XMLHttpRequest: deny('XMLHttpRequest'),
    WebSocket: deny('WebSocket'), EventSource: deny('EventSource')};
  vm.createContext(context);
  vm.runInContext(source, context, {filename: modulePath});
  const api = context.module.exports;
  const st = fixture();
  assert.equal(api.model(registration(), info(st)).ahead, 0);
  assert.match(api.html(registration(), info(st), api.model(registration(), info(st))), /我的候場/);
});

test('registered input binding dedupe excludes mailbox and unrelated player screens', () => {
  const core = fs.readFileSync(path.join(__dirname, '..', 'modules', 'main-app', 'core.js'), 'utf8');
  const start = core.indexOf('function shouldBindLobbyInput(');
  const end = core.indexOf('\nfunction lobbyNodeKey(', start);
  assert.ok(start >= 0 && end > start, 'input binding guard must be identifiable');
  const context = {appPhase: 'player-center', playerActiveTab: 'registered', mailboxOpen: false,
    lobbyVisible: false, lobbyInputBindings: new WeakMap()};
  context.mailboxContext = () => ({open: context.mailboxOpen});
  context.isTournamentLobbyVisible = () => context.lobbyVisible;
  vm.createContext(context);
  vm.runInContext(core.slice(start, end), context);
  const element = {};
  assert.equal(context.shouldBindLobbyInput(element, 'confirm'), true);
  assert.equal(context.shouldBindLobbyInput(element, 'confirm'), false);
  context.mailboxOpen = true;
  assert.equal(context.shouldBindLobbyInput(element, 'confirm'), true);
  assert.equal(context.shouldBindLobbyInput(element, 'confirm'), true);
  context.mailboxOpen = false;
  context.playerActiveTab = 'profile';
  assert.equal(context.shouldBindLobbyInput(element, 'confirm'), true);
  assert.equal(context.shouldBindLobbyInput(element, 'confirm'), true);
  context.lobbyVisible = true;
  assert.equal(context.shouldBindLobbyInput(element, 'join'), true);
  assert.equal(context.shouldBindLobbyInput(element, 'join'), false);
});

test('queue stable-render integration explicitly excludes an open mailbox', () => {
  const core = fs.readFileSync(path.join(__dirname, '..', 'modules', 'main-app', 'core.js'), 'utf8');
  assert.match(core,
    /if\(playerActiveTab===['"]registered['"]\s*&&\s*!mailboxContext\(\)\.open\)\s*__viewportSnapshot\.lobbyPatched=window\.BXHQueueDashboard\.renderStable\(/,
    'mailbox must retain its own rendering and viewport lifecycle');
});

// Theme regression: use the shipped palette cascade, not theme-picker swatches.
const themeRoot = path.join(__dirname, '..');
const queueCss = fs.readFileSync(path.join(themeRoot, 'modules/main-css/queue-dashboard.css'), 'utf8');
const themeIds = ['gold', 'blue', 'red', 'green', 'directive', 'three-gods', 'hunter', 'akatsuki', 'clow', 'zeon', 'gundam'];
function rootPalette(theme) {
  const files = ['modules/main-css/core-competition.css', 'client-entrance-theme.css',
    ...['three-gods', 'gundam', 'zeon', 'clow', 'akatsuki', 'hunter'].map(id => `modules/theme-${id}/styles.css`)];
  const vars = {};
  for (const file of files) {
    const css = fs.readFileSync(path.join(themeRoot, file), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    for (const block of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      if (!block[1].split(',').some(s => [':root', `:root[data-bxh-theme="${theme}"]`].includes(s.trim()))) continue;
      for (const property of block[2].matchAll(/(--[\w-]+)\s*:\s*([^;]+)(?:;|$)/g)) vars[property[1]] = property[2].trim();
    }
  }
  return vars;
}
function rgb(value) {
  if (/^#[\da-f]{6}$/i.test(value)) return [1, 3, 5].map(i => parseInt(value.slice(i, i + 2), 16)).concat(1);
  const values = value.match(/^rgba?\(([^)]+)\)$/)?.[1].split(',').map(Number);
  assert.ok(values && values.length >= 3, `Unsupported palette color: ${value}`);
  return [values[0], values[1], values[2], values[3] ?? 1];
}
function over(front, back) { return front.slice(0, 3).map((v, i) => v * front[3] + back[i] * (1 - front[3])).concat(1); }
function contrast(a, b) {
  const luminance = c => c.slice(0, 3).map(v => v / 255).map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4).reduce((sum, v, i) => sum + v * [.2126, .7152, .0722][i], 0);
  const [light, dark] = [luminance(a), luminance(b)].sort((a, b) => b - a);
  return (light + .05) / (dark + .05);
}

test('queue colors inherit shared theme tokens without a fixed blue palette', () => {
  for (const token of ['--bg', '--glass-surface-strong', '--glass-surface', '--white', '--metal', '--accent-color', '--accent-soft', '--accent-border', '--border']) {
    assert.ok(queueCss.includes(`var(${token}`), token);
  }
  assert.doesNotMatch(queueCss, /#[\da-f]{3,8}\b/i);
  assert.doesNotMatch(queueCss, /89\s*,\s*224\s*,\s*232|149\s*,\s*186\s*,\s*211/);
  assert.doesNotMatch(queueCss, /\.court-call-notify-icon[^,{]*\{/);
  assert.doesNotMatch(queueCss, /\.smart-call-switch[^,{]*\{/);
  assert.doesNotMatch(queueCss, /\.smart-call-unified-[\w-]+[^,{]*\{/);
  assert.match(queueCss, /\.queue-court-card\.is-mine\s*\{[^}]*border-color:\s*var\(--queue-accent\)/);
  assert.match(queueCss, /\.queue-court-card\.is-mine\s*\{[^}]*background:\s*var\(--queue-card\)/);
  assert.match(queueCss, /:focus-visible[\s\S]*?outline:\s*2px solid var\(--queue-accent\)/);
});

for (const theme of themeIds) test(`queue text and button contrast remain readable in ${theme}`, () => {
  const vars = rootPalette(theme);
  for (const name of ['--accent-color', '--accent-soft', '--accent-border', '--glass-surface', '--glass-surface-strong']) assert.ok(vars[name], `${theme}: ${name}`);
  const bg = rgb(vars['--bg']), card = over(rgb(vars['--glass-surface-strong']), bg);
  const court = over(rgb(vars['--glass-surface']), bg), badge = over(rgb(vars['--accent-soft']), card);
  const accent = rgb(vars['--accent-color']), white = rgb(vars['--white']), muted = rgb(vars['--metal']);
  assert.ok(contrast(accent, card) >= 4.5, `${theme}: heading contrast`);
  assert.ok(contrast(accent, badge) >= 4.5, `${theme}: badge contrast`);
  assert.ok(contrast(white, rgb(vars['--panel-2'])) >= 4.5, `${theme}: button contrast`);
  assert.ok(contrast(white, badge) >= 4.5, `${theme}: hovered button contrast`);
  for (const surface of [card, court]) assert.ok(contrast(muted, surface) >= 4.5, `${theme}: note contrast`);
});

test('queue stylesheet cache key changes without changing the queue runtime asset', () => {
  const index = fs.readFileSync(path.join(themeRoot, 'index.html'), 'utf8');
  assert.match(index, /queue-dashboard\.css\?v=20261015-theme-3/);
  assert.match(index, /queue-dashboard\.js\?v=20261015-1/);
});


test('queue focus compatibility only narrows its own ancestor filter transition', () => {
  assert.match(queueCss, /@media\s*\(prefers-reduced-motion:\s*no-preference\)\s*\{\s*html \.schedule-fold \.find-event-card:has\(\.queue-dashboard\)\s*\{\s*transition-property:\s*transform, box-shadow, background !important;/);
  assert.equal((queueCss.match(/transition-property:/g) || []).length, 1);
  assert.doesNotMatch(queueCss, /(?:^|[;{])\s*(?:-webkit-)?(?:backdrop-)?filter\s*:/m);
  assert.doesNotMatch(queueCss, /(?:^|[;{])\s*animation(?:-name)?\s*:/m);
});
