'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const core = read('modules/main-app/core.js');
const domain = read('modules/main-app/domain-utils.js');
const index = read('index.html');

function moduleContext() {
  const context = { window: {} };
  vm.createContext(context);
  vm.runInContext(domain, context, { filename: 'domain-utils.js' });
  return context;
}

test('lobby ordering helper sorts dated events newest first and unknown dates last', () => {
  const context = moduleContext();
  const compare = context.window.BXHDomainUtils.lobbyNewestFirst;
  assert.equal(typeof compare, 'function');
  const rows = [
    { code: 'UNKNOWN-B' },
    { code: 'OLDER', startMs: 100 },
    { code: 'NEWER', startMs: 300 },
    { code: 'UNKNOWN-A' },
  ];
  assert.deepEqual(rows.sort(compare).map(row => row.code), [
    'NEWER', 'OLDER', 'UNKNOWN-A', 'UNKNOWN-B',
  ]);
});

test('Core lobby comparator delegates to the loaded domain module and orders live cards', () => {
  const scriptSources = [...index.matchAll(/<script\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/g)].map(match => match[1]);
  const domainIndex = scriptSources.findIndex(src => src.startsWith('modules/main-app/domain-utils.js'));
  const coreIndex = scriptSources.findIndex(src => src.startsWith('modules/main-app/core.js'));
  assert(domainIndex >= 0 && coreIndex > domainIndex, 'domain utilities load before Core');

  const context = moduleContext();
  const comparatorStart = core.indexOf('function lobbyNewestFirst(a,b){');
  const listsStart = core.indexOf('function lobbyLists(rawList){', comparatorStart);
  const buttonsStart = core.indexOf('\nfunction lobbyRegistrationButtons(', listsStart);
  assert(comparatorStart >= 0 && listsStart > comparatorStart, 'Core lobby ordering seam exists');
  assert(buttonsStart > listsStart, 'Core lobby list helper boundary exists');
  const comparatorSource = core.slice(comparatorStart, listsStart);
  assert.match(comparatorSource, /window\.BXHDomainUtils\.lobbyNewestFirst/);
  const listsSource = core.slice(listsStart, buttonsStart);
  vm.runInContext(
    comparatorSource + '\nglobalThis.__lobbyLists=lobbyLists;\n' + listsSource + '\nglobalThis.__lobbyLists=lobbyLists;',
    context,
  );
  context.lobbySummary = row => row;
  context.lobbyMatchesActiveFilters = () => true;

  const result = context.__lobbyLists([
    { code: 'ROOM-OLD', startMs: 100, phase: 'live', visibility: 'public', publishedAt: 1 },
    { code: 'ROOM-NEW', startMs: 300, phase: 'live', visibility: 'public', publishedAt: 1 },
    { code: 'ROOM-UNKNOWN-B', phase: 'live', visibility: 'public', publishedAt: 1 },
    { code: 'ROOM-UNKNOWN-A', phase: 'live', visibility: 'public', publishedAt: 1 },
  ]);
  assert.deepEqual(Array.from(result.live, row => row.code), [
    'ROOM-NEW', 'ROOM-OLD', 'ROOM-UNKNOWN-A', 'ROOM-UNKNOWN-B',
  ]);
});
