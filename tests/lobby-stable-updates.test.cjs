'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const core = fs.readFileSync(path.join(root, 'modules/main-app/core.js'), 'utf8');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const clone = value => JSON.parse(JSON.stringify(value));
const microtasks = () => new Promise(resolve => setImmediate(resolve));

function between(source, start, end) {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from + start.length);
  assert(from >= 0 && to > from, 'Production seam is missing: ' + start);
  return source.slice(from, to);
}

function row(overrides = {}) {
  return {
    code: 'BXH-FIXTURE-A', name: 'Synthetic event', visibility: 'public', publishedAt: 1,
    eventAuthority: 'official', hostName: 'Synthetic host', eventDate: '2099-06-01', startAt: '12:00',
    tournamentPhase: 'waiting', registrationStatus: 'open', registrationEnabled: true,
    registrationOpenAt: 1700000000000, registrationCloseAt: 1900000000000,
    cancellationDeadline: 1900000000000, capacity: 32, confirmedCount: 2,
    waitlistEnabled: true, waitlistCapacity: 4, waitlistCount: 0, updatedAt: 1,
    fee: 100, location: 'Fixture hall', formatType: 'single', eventDescription: 'Fixture introduction',
    parsedData: { meta: {}, players: [{ id: 'p1', name: 'Synthetic participant', checkedIn: false }], matches: [] },
    bracketView: JSON.stringify({ matches: [] }), ...overrides,
  };
}

function fresh(items, metadata = {}) {
  return { ok: true, items, fromCache: false, hasPendingWrites: false, excluded: [], ...metadata };
}

// This VM executes production coordinator/projection/status functions, not a
// reimplementation. DOM identity is tested separately in the full-runtime
// browser suite. RAF, time, auth and cloud responses are deterministic here.
function harness() {
  const frames = new Map(), timers = new Map(), subscriptions = [], queries = [], registrationQueries = [], writes = [];
  let nextId = 0, renders = 0, now = 1800000000000;
  const document = { hidden: false, addEventListener() {}, querySelectorAll: () => [] };
  const window = {
    addEventListener() {},
    requestAnimationFrame: callback => { const id = ++nextId; frames.set(id, callback); return id; },
    cancelAnimationFrame: id => frames.delete(id),
    BXHLobbyFastCache: { write: items => writes.push(items) },
    cloudSync: {
      connect: async () => true,
      queryPublicTournaments: () => new Promise((resolve, reject) => queries.push({ resolve, reject })),
      queryMyRegistrations: () => new Promise((resolve, reject) => registrationQueries.push({ resolve, reject })),
      getPublicTournamentSummary: async code => row({ code }),
      subscribePublicTournaments: callback => {
        const subscription = { callback, stopped: false }; subscriptions.push(subscription);
        return () => { subscription.stopped = true; };
      },
    },
  };
  class FixtureDate extends Date { static now() { return now; } }
  const context = {
    window, document, console, Date: FixtureDate,
    setTimeout: callback => { const id = ++nextId; timers.set(id, callback); return id; },
    clearTimeout: id => timers.delete(id),
    setInterval() {}, clearInterval() {},
    appPhase: 'player-center', playerActiveTab: 'home', guestActiveTab: 'events', currentRole: 'player',
    firebaseUser: { uid: 'fixture-player' }, userProfile: { role: 'player', active: true },
    publicTournamentsCache: null, publicTournamentsError: null,
    myRegistrationsCache: [], myRegistrationsLoading: false, myRegistrationsError: null, myRegistrationsTournamentInfo: {},
    findEventsFilters: { keyword: '', date: '', region: '', format: 'all' }, findEventsFiltersOpen: false,
    lobbySectionExpanded: { live: true, registration: true, waiting: true, settling: true, ended: true },
    PUBLIC_TOURNAMENTS_ERROR_MESSAGES: { network: 'Fixture network failure' },
    FORMAT_LABELS: { single: 'Single elimination', double: 'Double elimination' },
    esc: value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]),
    mailboxContext: () => ({ open: false }), cloudAvailable: () => true,
    currentAuthUid: () => context.firebaseUser?.uid || '',
    render: () => { renders++; },
    roomStatusHtml: phase => '<span>' + phase + '</span>',
    renderRegistrationCountdown: () => '<span data-registration-countdown="1">countdown</span>',
    mapRegistrationError: error => String(error.message || error),
  };
  vm.createContext(context);
  vm.runInContext(read('modules/main-app/domain-utils.js'), context);
  vm.runInContext(read('modules/main-app/registration-utils.js'), context);
  Object.assign(context, window.BXHDomainUtils, window.BXHRegistrationUtils);
  vm.runInContext(between(core, 'let publicTournamentsLoading = false;', 'let findEventsFilters = '), context);
  vm.runInContext(between(core, 'function getEffectiveRegistrationStatus(', '\nfunction findEventsSummaryLine('), context);
  vm.runInContext(between(core, 'function lobbyEventStartMs(', '\nlet guestActiveTab = '), context);
  vm.runInContext(between(core, 'function tickRegistrationCountdowns(){', '\nsetInterval(tickRegistrationCountdowns,1000);'), context);
  vm.runInContext('function handleAction(action,target){' +
    between(core, '  if(action==="load-my-registrations"){', '\n  if(action==="apply-find-events-filter"){') + '}', context);
  vm.runInContext('captureLobbyContext(); myRegistrationsCache=[];', context);
  const api = vm.runInContext(`({
    apply: applyPublicTournamentItems, signature: publicTournamentListSignature, summary: lobbySummary,
    actions: lobbyRegistrationButtons, capture: captureLobbyContext, current: lobbyContextIsCurrent,
    request: requestLobbyRender, reconcile: reconcileLobbyContext, refresh: reconcilePublicTournamentsNow,
    subscribe: startPublicTournamentsRealtime, stop: stopPublicTournamentsRealtime,
    handle: handleAction, remember: rememberLobbyTemplate, patchChildren: patchLobbyChildren,
    invalidateRegistrations: invalidateMyRegistrationsCache,
    tick: tickRegistrationCountdowns, visible: isTournamentLobbyVisible,
    state: () => ({ cache: publicTournamentsCache, freshness: publicTournamentsFreshness,
      loading: publicTournamentsLoading, generation: lobbyGeneration })
  })`, context);
  return { ...api, context, document, window, frames, timers, queries, registrationQueries, subscriptions, writes,
    advance: milliseconds => { now += milliseconds; },
    renders: () => renders,
    frame() { const pending = [...frames.values()]; frames.clear(); for (const callback of pending) callback(); },
    run: source => vm.runInContext(source, context),
  };
}

test('presentation signature ignores raw match bookkeeping but retains the newest raw cache', () => {
  const h = harness(), first = [row()];
  h.apply(first, { source: fresh(first) }); h.frame();
  const next = clone(first);
  next[0].updatedAt++;
  next[0].bracketView = JSON.stringify({ matches: [{ scoreA: 4, scoreB: 2 }], revision: 9 });
  next[0].parsedData.matches = [{ scoreA: 4, scoreB: 2 }];
  assert.equal(h.signature(first), h.signature(next));
  assert.equal(h.apply(next, { source: fresh(next) }), false);
  assert.equal(h.state().cache, next, 'Cache must not be skipped just because UI is unchanged');
  assert.equal(h.state().cache[0].parsedData.matches[0].scoreA, 4);
  assert.equal(h.frames.size, 0);
  assert.equal(h.writes.at(-1), next);
});

test('presentation signature includes user-visible metadata without relying on updatedAt', () => {
  const h = harness(), baseline = row();
  const variants = {
    name: item => { item.name = 'Changed title'; },
    host: item => { item.hostName = 'Changed host'; },
    nestedName: item => { item.parsedData.meta.name = 'Changed nested title'; },
    date: item => { item.eventDate = '2099-06-02'; },
    location: item => { item.location = 'Changed hall'; },
    capacity: item => { item.capacity++; },
    confirmed: item => { item.confirmedCount++; },
    waitlistCount: item => { item.waitlistCount++; },
    waitlistEnabled: item => { item.waitlistEnabled = false; },
    waitlistCapacity: item => { item.waitlistCapacity++; },
    openAt: item => { item.registrationOpenAt++; },
    closeAt: item => { item.registrationCloseAt++; },
    cancelDeadline: item => { item.cancellationDeadline++; },
    fee: item => { item.fee++; },
    description: item => { item.eventDescription = 'Changed introduction'; },
    poster: item => { item.posterUrl = 'https://example.invalid/synthetic.png'; },
    rosterName: item => { item.parsedData.players[0].name = 'Changed public name'; },
    checkIn: item => { item.parsedData.players[0].checkedIn = true; },
    visibility: item => { item.visibility = 'private'; },
    cancelled: item => { item.eventCancelled = true; },
  };
  for (const [label, mutate] of Object.entries(variants)) {
    const changed = clone(baseline); mutate(changed);
    assert.notEqual(h.signature([baseline]), h.signature([changed]), label);
    assert.equal(changed.updatedAt, baseline.updatedAt, 'Fixture must preserve updatedAt');
  }
});

test('bursts share one animation frame and render only the latest complete cache', () => {
  const h = harness();
  for (let count = 2; count < 12; count++) {
    const items = [row({ confirmedCount: count })];
    h.apply(items, { source: fresh(items) });
  }
  assert.equal(h.frames.size, 1);
  assert.equal(h.renders(), 0);
  assert.equal(h.state().cache[0].confirmedCount, 11);
  h.frame();
  assert.equal(h.renders(), 1);
  assert.equal(h.frames.size, 0);
});

test('metadata-only server/cache/pending transitions change eligibility and schedule a refresh', () => {
  const h = harness(), items = [row()];
  const actions = () => h.actions(h.summary(items[0]), true);
  h.apply(items, { source: fresh(items, { fromCache: true }) }); h.frame();
  assert.doesNotMatch(actions(), />查看與報名</);
  assert.match(actions(), />查看資訊（報名狀態待確認）</);
  assert.equal(h.apply(items, { source: fresh(items) }), true);
  assert.equal(h.frames.size, 1); h.frame();
  assert.match(actions(), />查看與報名</);
  assert.equal(h.apply(items, { source: fresh(items, { hasPendingWrites: true }) }), true); h.frame();
  assert.doesNotMatch(actions(), />查看與報名</);
  assert.equal(h.state().freshness, 'unknown');
  h.apply(items, { source: fresh(items) }); h.frame();
  h.apply(items, { source: fresh(items, { fromCache: true }) }); h.frame();
  assert.doesNotMatch(actions(), />查看與報名</);
});

test('missing eligibility fields and omitted rooms never preserve a false signup claim', () => {
  const h = harness();
  const missing = row({ registrationEnabled: undefined, registrationStatus: undefined, registrationOpenAt: undefined });
  h.apply([missing], { source: fresh([missing]) }); h.frame();
  assert.doesNotMatch(h.actions(h.summary(missing), true), />查看與報名</);
  h.apply([], { source: fresh([], { fromCache: true }) }); h.frame();
  assert.deepEqual(Array.from(h.state().cache), [], 'Cache must remain faithful to the actual snapshot');
  assert.doesNotMatch(h.run('renderTournamentLobby({loggedIn:true})'), /data-lobby-code=/);
});

test('missing source metadata and invalid counts or capacities cannot authorize signup wording', () => {
  const h = harness(), items = [row()];
  for (const source of [null, { ok: true }, { ok: true, fromCache: false }, { ok: true, hasPendingWrites: false }]) {
    h.apply(items, { source }); h.frame();
    assert.doesNotMatch(h.actions(h.summary(items[0]), true), />查看與報名</);
  }
  for (const patch of [{ confirmedCount: undefined }, { confirmedCount: -1 }, { capacity: undefined },
    { capacity: 0 }, { waitlistCount: undefined }, { waitlistCapacity: -1 }]) {
    const item = row(patch); h.apply([item], { source: fresh([item]) }); h.frame();
    assert.doesNotMatch(h.actions(h.summary(item), true), />查看與(?:報名|加入備取)</, JSON.stringify(patch));
  }
});

test('confirmed full, closed and cancelled snapshots immediately remove signup wording', () => {
  const h = harness();
  for (const [label, item] of [
    ['full', row({ confirmedCount: 32, waitlistCount: 4 })],
    ['closed', row({ registrationCloseAt: 1799999999999 })],
    ['cancelled', row({ eventCancelled: true })],
  ]) {
    h.apply([item], { source: fresh([item]) });
    const actions = h.actions(h.summary(item), true);
    assert.doesNotMatch(actions, />查看與報名</, label);
    assert.doesNotMatch(actions, /data-action="lobby-register"/, label);
  }
});

test('navigation and identity changes invalidate queued lobby work', () => {
  const h = harness();
  const old = h.capture(); h.request();
  h.context.appPhase = 'landing'; h.reconcile();
  assert.equal(h.current(old), false); h.frame(); assert.equal(h.renders(), 0);
  h.context.appPhase = 'player-center'; h.reconcile();
  const returned = h.capture(); h.request();
  h.context.firebaseUser = { uid: 'second-player' }; h.reconcile();
  assert.equal(h.current(returned), false); h.frame(); assert.equal(h.renders(), 0);
  assert.equal(h.state().freshness, 'unknown');
  assert.equal(h.context.myRegistrationsCache, null);
});

test('same-UID reauthentication fences previous public requests and registration ownership', async () => {
  const h = harness();
  const context = h.capture(), pending = h.refresh('before same-UID reauth'); await microtasks();
  assert.equal(h.queries.length, 1);
  const auth = between(core, 'async function processAuthStateChangeImpl(', '\n            const communityRoomAuthContext=');
  assert.match(auth, /lobbyAuthEpoch\+\+/, 'The actual auth callback must invalidate same-UID sessions');
  h.run('lobbyAuthEpoch++; reconcileLobbyContext();');
  assert.equal(h.current(context), false);
  const latest = [row({ name: 'Current auth generation' })]; h.apply(latest, { source: fresh(latest) });
  h.queries[0].resolve(fresh([row({ name: 'Old auth generation' })])); await pending;
  assert.equal(h.state().cache, latest); assert.equal(h.context.myRegistrationsCache, null);
});

test('registration mutation invalidation rejects old data without clearing the replacement loader', async () => {
  const h = harness();
  h.handle('load-my-registrations'); await microtasks();
  h.invalidateRegistrations();
  assert.equal(h.context.myRegistrationsCache, null); assert.equal(h.context.myRegistrationsLoading, false);
  h.handle('load-my-registrations'); await microtasks();
  assert.equal(h.registrationQueries.length, 2);
  h.registrationQueries[0].resolve([{ tournamentCode: 'BXH-FIXTURE-A', status: 'waitlist', marker: 'old' }]);
  await microtasks();
  assert.equal(h.context.myRegistrationsCache, null);
  assert.equal(h.context.myRegistrationsLoading, true, 'Stale finally must not clear current busy state');
  h.registrationQueries[1].resolve([{ tournamentCode: 'BXH-FIXTURE-A', status: 'confirmed', marker: 'current' }]);
  await microtasks();
  assert.equal(h.context.myRegistrationsCache[0].marker, 'current');
  assert.equal(h.context.myRegistrationsLoading, false);
});

test('same-account home-to-registered navigation permits the pending ownership-safe registration result', async () => {
  const h = harness();
  h.handle('load-my-registrations'); await microtasks();
  h.context.playerActiveTab = 'registered'; h.reconcile();
  h.registrationQueries[0].resolve([{ tournamentCode: 'BXH-FIXTURE-A', status: 'confirmed' }]);
  await microtasks();
  assert.equal(h.context.myRegistrationsCache[0].status, 'confirmed');
  assert.equal(h.context.myRegistrationsLoading, false);
});

test('mailbox overlay suppresses lobby refreshes even while the home tab stays selected', () => {
  const h = harness();
  h.context.mailboxContext = () => ({ open: true });
  h.reconcile();
  assert.equal(h.visible(), false);
  const items = [row()]; h.apply(items, { source: fresh(items) });
  assert.equal(h.frames.size, 0);
  assert.equal(h.state().cache, items);
});

test('a stopped realtime callback cannot update a newly entered lobby', () => {
  const h = harness(); h.subscribe();
  const old = h.subscriptions[0];
  h.context.appPhase = 'landing'; h.reconcile();
  h.context.appPhase = 'player-center'; h.reconcile(); h.subscribe();
  assert.equal(old.stopped, true);
  const latest = [row({ name: 'Current visit' })];
  h.subscriptions.at(-1).callback(fresh(latest));
  old.callback(fresh([row({ name: 'Obsolete visit' })]));
  assert.equal(h.state().cache[0].name, 'Current visit');
});

test('a query begun before a newer snapshot cannot overwrite it', async () => {
  const h = harness();
  const pending = h.refresh('fixture');
  await microtasks();
  assert.equal(h.queries.length, 1);
  const latest = [row({ name: 'Current snapshot' })];
  h.apply(latest, { source: fresh(latest) });
  h.queries[0].resolve(fresh([row({ name: 'Obsolete query' })]));
  await pending;
  assert.equal(h.state().cache[0].name, 'Current snapshot');
});

test('a late old-view query cannot overwrite a new-view response or loading state', async () => {
  const h = harness();
  const old = h.refresh('old visit'); await microtasks();
  h.context.appPhase = 'landing'; h.reconcile();
  h.context.appPhase = 'player-center'; h.reconcile();
  const current = h.refresh('current visit'); await microtasks();
  assert.equal(h.queries.length, 2);
  h.queries[1].resolve(fresh([row({ name: 'Current query' })])); await current;
  h.queries[0].resolve(fresh([row({ name: 'Obsolete query' })])); await old;
  assert.equal(h.state().cache[0].name, 'Current query');
});

test('T0 expiry requests refresh without clearing the current cache', async () => {
  const h = harness(), items = [row()];
  h.apply(items, { source: fresh(items) }); h.frame();
  const element = { dataset: {}, textContent: '', getAttribute: () => String(Date.now() - 1) };
  h.document.querySelectorAll = selector => selector === '[data-registration-countdown]' ? [element] : [];
  h.tick();
  await microtasks();
  assert.equal(h.queries.length, 1);
  assert.equal(h.state().cache, items);
  assert.equal(element.dataset.expired, 'true');
  h.tick();
  await microtasks();
  assert.equal(h.queries.length, 1, 'A countdown must not issue repeated T0 requests');
  h.queries[0].resolve(fresh(items));
  await microtasks();
});

test('wall-clock cutoff without a snapshot immediately removes signup wording', async () => {
  const h = harness(), items = [row({ registrationCloseAt: 1800000000100 })];
  h.apply(items, { source: fresh(items) }); h.frame();
  assert.match(h.actions(h.summary(items[0]), true), />查看與報名</);
  h.advance(100); h.tick(); await microtasks();
  assert.equal(h.queries.length, 1); assert.equal(h.frames.size, 1);
  assert.equal(h.state().cache, items, 'Do not blank the lobby while the boundary query is pending');
  assert.match(h.actions(h.summary(items[0]), true), /報名截止/);
  assert.doesNotMatch(h.actions(h.summary(items[0]), true), />查看與報名</);
  h.tick(); await microtasks(); assert.equal(h.queries.length, 1);
  h.queries[0].resolve(fresh(items)); await microtasks();
});

test('wall-clock cancellation deadline removes a retained cancellation action without a snapshot', async () => {
  const h = harness(), items = [row({ cancellationDeadline: 1800000000100 })];
  h.context.myRegistrationsCache = [{ tournamentCode: 'BXH-FIXTURE-A', status: 'confirmed' }];
  h.apply(items, { source: fresh(items) }); h.frame();
  assert.match(h.actions(h.summary(items[0]), true), /data-action="cancel-my-registration"/);
  h.advance(100); h.tick(); await microtasks();
  assert.doesNotMatch(h.actions(h.summary(items[0]), true), /data-action="cancel-my-registration"/);
  assert.equal(h.frames.size, 1); assert.equal(h.queries.length, 1);
  h.queries[0].resolve(fresh(items)); await microtasks();
});

test('an older failed initial query cannot clear a newer successful snapshot', async () => {
  const h = harness();
  h.handle('load-public-tournaments'); await microtasks();
  assert.equal(h.queries.length, 1);
  const latest = [row({ name: 'Current successful snapshot' })];
  h.apply(latest, { source: fresh(latest) }); h.frame();
  h.queries[0].reject(Error('Expected synthetic old-query failure'));
  await microtasks();
  assert.equal(h.state().cache, latest);
  assert.equal(h.state().freshness, 'server');
  assert.equal(h.context.publicTournamentsError, null);
  assert.equal(h.state().loading, false);
});

test('an identical manual refresh still clears a busy state rendered while awaiting it', async () => {
  const h = harness(), items = [row()];
  h.apply(items, { source: fresh(items) }); h.frame();
  h.handle('refresh-public-tournaments'); await microtasks();
  assert.equal(h.state().loading, true);
  // Another authorized UI update can paint the current loading state while the
  // request is pending. Its completion must always schedule the enabled state.
  h.request(); h.frame();
  h.queries[0].resolve(fresh(items)); await microtasks();
  assert.equal(h.state().loading, false);
  assert.equal(h.frames.size, 1);
});

// Minimal deterministic tree model for patch algorithm tests. This does not
// emulate focus, layout, native details activation or actual browser events;
// those remain the responsibility of lobby-stable-updates.spec.cjs.
class VirtualNode {
  constructor(tag, attrs = {}, children = []) {
    this.nodeType = tag === '#text' ? 3 : 1;
    this.nodeName = tag === '#text' ? '#text' : tag.toUpperCase();
    this.tagName = this.nodeType === 1 ? this.nodeName : undefined;
    this.attrs = new Map(Object.entries(attrs));
    this.childNodes = []; this.parentNode = null;
    this.nodeValue = this.nodeType === 3 ? attrs.value : null;
    for (const child of children) this.insertBefore(child, null);
  }
  get attributes() { return [...this.attrs].map(([name, value]) => ({ name, value })); }
  get id() { return this.getAttribute('id') || ''; }
  get firstChild() { return this.childNodes[0] || null; }
  get nextSibling() {
    if (!this.parentNode) return null;
    return this.parentNode.childNodes[this.parentNode.childNodes.indexOf(this) + 1] || null;
  }
  get outerHTML() {
    if (this.nodeType === 3) return String(this.nodeValue);
    return '<' + this.tagName + JSON.stringify([...this.attrs]) + '>' + this.childNodes.map(node => node.outerHTML).join('') + '</' + this.tagName + '>';
  }
  get open() { return this.hasAttribute('open'); }
  set open(value) { value ? this.setAttribute('open', '') : this.removeAttribute('open'); }
  getAttribute(name) { return this.attrs.has(name) ? this.attrs.get(name) : null; }
  hasAttribute(name) { return this.attrs.has(name); }
  setAttribute(name, value) { this.attrs.set(name, String(value)); }
  removeAttribute(name) { this.attrs.delete(name); }
  insertBefore(node, cursor) {
    if (node === cursor) return node;
    if (cursor !== null && cursor.parentNode !== this) throw Error('Invalid insertion cursor');
    node.remove();
    const at = cursor === null ? this.childNodes.length : this.childNodes.indexOf(cursor);
    this.childNodes.splice(at, 0, node); node.parentNode = this; return node;
  }
  remove() {
    if (!this.parentNode) return;
    this.parentNode.childNodes.splice(this.parentNode.childNodes.indexOf(this), 1); this.parentNode = null;
  }
  cloneNode(deep) {
    return new VirtualNode(this.nodeType === 3 ? '#text' : this.tagName, Object.fromEntries(this.attrs),
      deep ? this.childNodes.map(node => node.cloneNode(true)) : []);
  }
}

function element(tag, attrs, ...children) {
  return new VirtualNode(tag, attrs, children.flat().map(child => typeof child === 'string' ? new VirtualNode('#text', { value: child }) : child));
}
function treeCard(code, count) {
  return element('details', { 'data-lobby-code': code }, element('summary', {}, code),
    element('div', { class: 'lobby-card-detail' }, element('span', {}, String(count)),
      element('details', { class: 'lobby-roster-block' }, element('summary', {}, 'roster')),
      element('button', { 'data-action': 'view-public-tournament', 'data-code': code }, 'info')));
}
function patchTree(h, current, next, cards = [], hold = false) {
  const patch = { hold, deferred: false, cards: new Map(cards) };
  h.patchChildren(current, next, patch); return patch;
}

test('virtual DOM count patch retains nested details and plugin-owned attributes', () => {
  const h = harness(), a = treeCard('A', 1), root = element('div', {}, a);
  h.remember(root); a.open = true;
  const detail = a.childNodes[1], roster = detail.childNodes[1], button = detail.childNodes[2];
  roster.open = true; a.setAttribute('data-poster-access-hook', '1');
  a.setAttribute('data-poster-permission-busy', '1');
  patchTree(h, root, element('div', {}, treeCard('A', 2)), [['room:A', a]]);
  assert.equal(root.childNodes[0], a); assert.equal(detail.childNodes[1], roster); assert.equal(detail.childNodes[2], button);
  assert(a.open && roster.open); assert.equal(a.getAttribute('data-poster-access-hook'), '1');
  assert.equal(a.getAttribute('data-poster-permission-busy'), '1');
  assert.equal(detail.childNodes[0].childNodes[0].nodeValue, '2');
});

test('virtual DOM reorder and cross-section movement retain code-keyed cards and actions', () => {
  const h = harness(), a = treeCard('A', 1), b = treeCard('B', 2);
  const left = element('section', { 'data-lobby-section': 'left' }, a, b);
  const right = element('section', { 'data-lobby-section': 'right' }), root = element('div', {}, left, right);
  h.remember(root); const button = a.childNodes[1].childNodes[2];
  patchTree(h, root, element('div', {},
    element('section', { 'data-lobby-section': 'left' }, treeCard('B', 3)),
    element('section', { 'data-lobby-section': 'right' }, treeCard('A', 4))), [['room:A', a], ['room:B', b]]);
  assert.deepEqual(left.childNodes, [b]); assert.deepEqual(right.childNodes, [a]);
  assert.equal(a.childNodes[1].childNodes[2], button); assert.equal(button.getAttribute('data-code'), 'A');
});

test('virtual DOM held-gesture structural changes drain after release', () => {
  const h = harness(), a = treeCard('A', 1), b = treeCard('B', 2), root = element('div', {}, a, b);
  h.remember(root); const desired = element('div', {}, treeCard('B', 4));
  const patch = patchTree(h, root, desired, [['room:A', a], ['room:B', b]], true);
  assert.equal(patch.deferred, true); assert.deepEqual(root.childNodes, [a, b]);
  patchTree(h, root, desired, [['room:A', a], ['room:B', b]]);
  assert.deepEqual(root.childNodes, [b]); assert.equal(b.childNodes[1].childNodes[0].childNodes[0].nodeValue, '4');
});

test('virtual DOM unchanged generated permission control preserves external visibility and text', () => {
  const h = harness();
  const make = count => element('div', {}, element('span', {}, String(count)),
    element('button', { 'data-poster-manage': '', hidden: '' }, 'Add photo'));
  const root = make(1); h.remember(root); const button = root.childNodes[1];
  button.removeAttribute('hidden'); button.childNodes[0].nodeValue = 'Replace photo';
  patchTree(h, root, make(2));
  assert.equal(root.childNodes[1], button); assert.equal(button.hasAttribute('hidden'), false);
  assert.equal(button.childNodes[0].nodeValue, 'Replace photo');
});

test('virtual DOM public-player action keys cannot retarget a retained button', () => {
  const h = harness();
  const player = id => element('button', { 'data-action': 'card-event-open', 'data-code': 'A', 'data-player-id': id }, id);
  const one = player('one'), two = player('two'), root = element('div', {}, one, two); h.remember(root);
  patchTree(h, root, element('div', {}, player('two'), player('one')));
  assert.deepEqual(root.childNodes, [two, one]);
});

function viewportHarness() {
  const jobs = []; let y = 100;
  const noop = () => {};
  const context = {
    document: {}, window: { get scrollY() { return y; }, scrollTo: (_x, next) => { y = next; } },
    __lastRenderedViewportKey: null, __viewportRestoreToken: 0,
    restoreHorizontalNavPositions: noop, currentRenderViewportKey: () => 'same',
    requestAnimationFrame: callback => jobs.push(callback), setTimeout: callback => jobs.push(callback),
    hunterClashEntry: null, appPhase: 'player-center', playerActiveTab: 'home',
    syncBoardFullscreen: noop, scheduleCourtCallPoll: noop, syncPublicTournamentsRealtimeState: noop,
    bindTitleEditor: noop, bindPlayerCardInputs: noop, renderPlayerCardOverlay: noop,
    bindOnsiteWaitlistPanel: noop, positionAccountMenuOverlay: noop,
    isTournamentLobbyVisible: () => true, render: () => { y += 40; },
  };
  vm.createContext(context);
  vm.runInContext(between(core, 'function finishRenderViewport(snapshot){', '\nlet authFormRenderContext='), context);
  vm.runInContext(between(core, 'function renderPreservingScroll(){', '\nlet communityRoomSnapshotGeneration='), context);
  const renderer = between(core, 'function render(){', '\nfunction renderAdminSuccessScreen(){');
  const marker = '  } finally {';
  const from = renderer.lastIndexOf(marker), to = renderer.lastIndexOf('\n  }\n}');
  assert(from >= 0 && to > from, 'Actual render finally viewport seam is required');
  vm.runInContext('function finalize(__viewportSnapshot){' + renderer.slice(from + marker.length, to) + '}', context);
  return { context, getY: () => y, setY: value => { y = value; }, drain: () => { while (jobs.length) jobs.shift()(); } };
}

test('actual render finally preserves stable-lobby anchor correction and cancels delayed snapback', () => {
  const h = viewportHarness(), snapshot = { key: 'same', preserve: true, x: 0, y: 100 };
  h.context.finishRenderViewport(snapshot); // Previously scheduled legacy restoration.
  h.setY(140); h.context.finalize({ ...snapshot, lobbyPatched: true });
  assert.equal(h.getY(), 140, 'Do not undo the keyed patch anchor adjustment');
  h.setY(190); h.drain();
  assert.equal(h.getY(), 190, 'Do not undo subsequent user scrolling from old scheduled work');
});

test('non-lobby render finally keeps legacy viewport restoration', () => {
  const h = viewportHarness(); h.setY(140);
  h.context.finalize({ key: 'same', preserve: true, x: 0, y: 100 });
  assert.equal(h.getY(), 100);
  h.setY(190); h.drain(); assert.equal(h.getY(), 100);
});

test('renderPreservingScroll does not override stable-lobby anchor correction', () => {
  const h = viewportHarness();
  h.context.renderPreservingScroll(); assert.equal(h.getY(), 140);
  h.context.isTournamentLobbyVisible = () => false;
  h.context.renderPreservingScroll(); assert.equal(h.getY(), 140, 'Other screens retain legacy scroll restoration');
});
