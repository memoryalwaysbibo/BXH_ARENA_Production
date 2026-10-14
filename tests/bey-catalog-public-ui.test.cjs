'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {createHash} = require('node:crypto');
const root = path.resolve(__dirname, '..');
const model = require('../modules/bey-catalog/catalog-public-model.js');
const bytes = fs.readFileSync(path.join(root, model.DATA_URL));
const original = JSON.parse(bytes);
const copy = () => structuredClone(original);
const arrayBuffer = buffer => buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
const html = fs.readFileSync(path.join(root, 'bey-catalog.html'), 'utf8');
const ui = fs.readFileSync(path.join(root, 'modules/bey-catalog/catalog-public-ui.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'bey-catalog.css'), 'utf8');

test('the only public JSON is the exact pinned snapshot and contains 116 cross-category records', async () => {
  assert.equal(bytes.length, model.EXPECTED_BYTES);
  assert.equal(createHash('sha256').update(bytes).digest('hex'), model.EXPECTED_SHA256);
  assert.match(model.DATA_URL, new RegExp(model.EXPECTED_SHA256 + '\\.json$'));
  const data = await model.decodeSnapshot(arrayBuffer(bytes));
  assert.deepEqual(Object.fromEntries(Object.entries(data).map(([key, value]) => [key, value.length])), model.COUNTS);
  assert.equal(Object.values(model.COUNTS).reduce((a, b) => a + b), 116);
  assert.deepEqual(fs.readdirSync(path.join(root, 'data/bey-catalog')), [path.basename(model.DATA_URL)]);
});

test('byte changes, truncation, JSON reserialization and missing WebCrypto fail closed', async () => {
  const changed = Buffer.from(bytes); changed[100] ^= 1;
  for (const buffer of [changed, bytes.subarray(1), Buffer.from(JSON.stringify(original)), Buffer.from('{}')]) {
    await assert.rejects(model.decodeSnapshot(arrayBuffer(buffer)), /SNAPSHOT_VERSION_MISMATCH/);
  }
  await assert.rejects(model.decodeSnapshot(arrayBuffer(bytes), {}), /SECURE_CONTEXT_REQUIRED/);
  await assert.rejects(model.decodeSnapshot(bytes), /SNAPSHOT_VERSION_MISMATCH/);
});

const invalidCases = {
  'extra root private field': data => {data.registry = {};},
  'unexpected private product field': data => {data.products[0].reviewerUid = 'not-public';},
  'missing product name': data => {delete data.products[0].originalName;},
  'nontext name': data => {data.parts[0].originalName = 123;},
  'empty name': data => {data.parts[0].originalName = ' ';},
  'control character': data => {data.parts[0].originalName = 'part\u0000';},
  'wrong record count': data => {data.parts.pop();},
  'duplicate record id': data => {data.parts[1].partId = data.parts[0].partId;},
  'duplicate product code': data => {data.products[1].productCode = data.products[0].productCode;},
  'unknown product category': data => {data.products[0].packageType = 'guess';},
  'unknown part category': data => {data.parts[0].category = 'guess';},
  'product completeness overclaim': data => {data.products[0].compositionComplete = true;},
  'option completeness overclaim': data => {data.options[0].compositionComplete = true;},
  'partial assembly': data => {data.assemblyRelations[0].compositionComplete = false;},
  'missing group name source': data => {data.assemblyRelations[0].sourceUrls = {};},
  'missing composition source': data => {data.assemblyRelations[0].compositionSourceUrls = [];},
  'missing property source': data => {data.parts[0].sourceUrls = {originalName: data.parts[0].sourceUrls.originalName};},
  'unexpected source field': data => {data.parts[0].sourceUrls.secret = ['https://example.com'];},
  'unapproved source': data => {data.products[0].sourceUrls.productCode = ['https://example.com'];},
  'orphan option': data => {data.options[0].productId = 'product_999999';},
  'option name without code': data => {data.options[0].originalName = 'Invented';},
  'option code without name': data => {delete data.options[4].originalName;},
  'wrong option id format': data => {data.options[0].optionId = 'raw_000001';},
  'group option from other product': data => {data.assemblyRelations[0].optionId = data.options[1].optionId;},
  'extra expected-part field': data => {data.assemblyRelations[0].expectedParts[0].color = 'red';},
  'unknown part reference': data => {data.assemblyRelations[0].expectedParts[0].partId = 'part_999999';},
  'wrong part category': data => {data.assemblyRelations[0].expectedParts[0].category = 'bit';},
  'wrong claim quantity': data => {data.contentFacts[0].quantity = 2;},
  'wrong claim parent': data => {data.contentFacts[0].productId = 'product_000002';},
  'nonpositive part quantity': data => {data.assemblyRelations[0].expectedParts[0].quantity = 0;data.contentFacts[0].quantity = 0;},
  'fractional part quantity': data => {data.assemblyRelations[0].expectedParts[0].quantity = 1.5;data.contentFacts[0].quantity = 1.5;},
  'unused content fact': data => {data.assemblyRelations[0].expectedParts.pop();},
  'empty group': data => {data.assemblyRelations[0].expectedParts = [];},
  'duplicate expected part': data => {data.assemblyRelations[0].expectedParts[1] = {...data.assemblyRelations[0].expectedParts[0]};},
  'unsafe prototype key': data => {data.parts[0] = JSON.parse(JSON.stringify(data.parts[0]).replace('{', '{"__proto__":{},'));}
};
for (const [name, mutate] of Object.entries(invalidCases)) test('schema rejects ' + name, () => {
  const data = copy(); mutate(data); assert.throws(() => model.validateCatalog(data), /INVALID_PUBLIC_CATALOG/);
});

test('content and claim identifiers remain distinct and all facts have a complete group reference', () => {
  const data = model.validateCatalog(copy());
  assert.ok(data.contentFacts.some(fact => fact.contentClaimId.startsWith('claim_')));
  assert.ok(data.contentFacts.some(fact => fact.contentClaimId.startsWith('content_')));
  assert.equal(new Set(data.assemblyRelations.flatMap(group => group.expectedParts.map(part => part.contentClaimId))).size, 38);
});

test('source allowlist is exact and resists credential, path, query, fragment and origin tricks', () => {
  const safe = original.products[0].sourceUrls.productCode[0];
  assert.equal(model.safeSourceUrl(safe), safe);
  for (const url of [null, {}, 'javascript:alert(1)', '//beyblade.takaratomy.co.jp/beyblade-x/lineup/ux03.html',
    safe + '?token=secret', safe + '#secret', safe.replace('https:', 'http:'), safe.replace('https://', 'https://user:secret@'),
    safe.replace('co.jp', 'co.jp.evil.test'), safe.replace('co.jp/', 'co.jp:443/'), safe.replace('ux03.html', '../lineup/ux03.html'),
    safe.replace('ux03', 'private'), safe.replace('https://', 'https://evil.test/'), safe + '\n']) assert.equal(model.safeSourceUrl(url), null);
  assert.deepEqual(model.uniqueSources(original.products[0], original.products[0]), [safe]);
});

test('search supports codes, kana, full-width text, part names and category filtering', () => {
  assert.equal(model.filterCatalog(original, 'products').length, 9);
  assert.equal(model.filterCatalog(original, 'parts').length, 45);
  assert.deepEqual(model.filterCatalog(original, 'products', 'ｕｘ１８').map(item => item.productCode), ['UX-18']);
  assert.deepEqual(model.filterCatalog(original, 'products', 'UX-18').map(item => item.productCode), ['UX-18']);
  for (const code of ['UX-18-03', 'UX-18-05', 'ｕｘ１８０３']) assert.deepEqual(model.filterCatalog(original, 'products', code).map(item => item.productCode), ['UX-18']);
  assert.equal(model.filterCatalog(original, 'products', 'ウィザード').length, 1);
  assert.equal(model.filterCatalog(original, 'parts', '5-70').length, 1);
  assert.ok(model.filterCatalog(original, 'products', 'ブラッシュ').some(item => item.productCode === 'UX-18'));
  assert.ok(model.filterCatalog(original, 'parts', 'BX-20').length > 0);
  assert.equal(model.filterCatalog(original, 'products', 'no-such-record').length, 0);
  assert.equal(model.filterCatalog(original, 'invalid').length, 0);
  for (const key of Object.keys(model.PACKAGE_LABELS)) assert.equal(model.filterCatalog(original, 'products', '', key).length, original.products.filter(item => item.packageType === key).length);
  for (const key of Object.keys(model.CATEGORY_LABELS)) assert.equal(model.filterCatalog(original, 'parts', '', key).length, original.parts.filter(item => item.category === key).length);
});

test('display aliases cover every named record, remain provisional, and retain exact originals', () => {
  const expected = {products: 9, parts: 22, options: 6, assemblyRelations: 9};
  const translatedOriginals = new Set();
  for (const [section, count] of Object.entries(expected)) {
    const translated = original[section].filter(record => model.displayName(record).status === 'provisional_translation');
    assert.equal(translated.length, count, section);
    for (const record of translated) {
      const name = model.displayName(record);
      assert.equal(name.original, record.originalName);
      assert.match(name.primary, /\p{Script=Han}/u);
      assert.doesNotMatch(name.primary, /[\p{Script=Hiragana}\p{Script=Katakana}]/u);
      assert.equal(name.label, '中文暫譯');
      assert.doesNotMatch(name.status, /official|attested|verified/);
      translatedOriginals.add(record.originalName);
    }
  }
  assert.deepEqual(Object.keys(model.DISPLAY_NAMES).sort(), [...translatedOriginals].sort(), 'no stale or invented source names');
  assert.equal(Object.keys(model.DISPLAY_NAMES).length, 39);
});

test('23 code-only parts keep their exact code and category without inventing an official full name', () => {
  const codeParts = original.parts.filter(part => model.displayName(part).status === 'code_label');
  assert.equal(codeParts.length, 23);
  for (const part of codeParts) {
    const name = model.displayName(part);
    assert.equal(name.primary, part.originalName + ' ' + model.CATEGORY_LABELS[part.category]);
    assert.equal(name.original, part.originalName);
    assert.equal(name.label, '代碼＋分類');
  }
  const byId = id => model.displayName(original.parts.find(part => part.partId === id));
  assert.equal(byId('part_000002').primary, '5-70 棘輪');
  assert.equal(byId('part_000003').primary, 'DB 軸心');
  assert.equal(byId('part_000026').primary, 'Tr 棘輪／軸心整合型');
  assert.equal(byId('part_000033').primary, 'C 軸心');
  assert.equal(byId('part_000039').primary, '衝鋒 C');
  assert.equal(byId('part_000039').status, 'provisional_translation');
  assert.equal(original.parts.find(part => part.partId === 'part_000029').category, 'over_blade');
});

test('missing names stay generic and unexpected names never borrow an alias from a reused ID', () => {
  const unnamedOptions = original.options.filter(record => !record.originalName);
  const unnamedGroups = original.assemblyRelations.filter(record => !record.originalName);
  assert.equal(unnamedOptions.length, 7);assert.equal(unnamedGroups.length, 2);
  for (const record of [...unnamedOptions, ...unnamedGroups]) {
    assert.deepEqual(model.displayName(record, '部件清單'), {primary: '部件清單', original: '', status: 'missing', label: ''});
  }
  const unknown = {...original.parts[0], originalName: '未収録の名前'};
  assert.deepEqual(model.displayName(unknown), {primary: '中文名稱待補', original: unknown.originalName, status: 'untranslated', label: '中文名稱待補'});
  assert.equal(model.displayName({...original.products[0], originalName: 'Unknown product'}).status, 'untranslated');
});

test('display and Chinese searches never mutate source records, integrity pins or evidence status', () => {
  const data = copy(), before = JSON.stringify(data);
  assert(Object.isFrozen(model.DISPLAY_NAMES));
  for (const key of ['products', 'parts', 'options', 'assemblyRelations']) for (const record of data[key]) {
    const name = model.displayName(record);
    assert(Object.isFrozen(name));
    assert.throws(() => {name.primary = 'changed';}, TypeError);
  }
  assert.throws(() => {model.DISPLAY_NAMES['ウィザードロッド'] = 'changed';}, TypeError);
  for (const query of ['魔導神杖', '布拉許', '索爾', '5-70 棘輪', 'DB 軸心', 'UX-18-03']) {
    model.filterCatalog(data, 'products', query);model.filterCatalog(data, 'parts', query);
  }
  assert.equal(JSON.stringify(data), before);
  assert.deepEqual(model.validateCatalog(data), original);
  assert.equal(createHash('sha256').update(fs.readFileSync(path.join(root, model.DATA_URL))).digest('hex'), model.EXPECTED_SHA256);
});

test('Chinese aliases find products, options and parts while full option codes and original names still work', () => {
  const matches = (tab, query) => model.filterCatalog(original, tab, query);
  assert.deepEqual(matches('products', '魔導神杖').map(row => row.productCode), ['UX-03']);
  for (const [query, partId, productCode] of [['布拉許', 'part_000034', 'UX-18'], ['索爾', 'part_000037', 'UX-18'], ['突襲', 'part_000025', 'CX-07'], ['馬西夫', 'part_000035', 'UX-18']]) {
    assert.deepEqual(matches('parts', query).map(row => row.partId), [partId]);
    assert(matches('products', query).some(row => row.productCode === productCode));
  }
  assert.deepEqual(matches('products', '古屍詛咒 4-60C').map(row => row.productCode), ['UX-18']);
  assert.equal(matches('parts', '5-70 棘輪').length, 1);
  assert.equal(matches('parts', 'DB 軸心').length, 1);
  for (const query of ['UX-18-03', 'ｕｘ１８０３', 'ペガサスブラッシュM3-85W']) assert.deepEqual(matches('products', query).map(row => row.productCode), ['UX-18']);
  assert.equal(matches('parts', 'ウィザードロッド').length, 1);
});

// A deliberately small DOM harness executes the actual UI script. This is not browser/layout QA.
class Element {
  constructor(tagName = 'div') { this.tagName = tagName.toUpperCase();this.children = [];this.dataset = {};this.attributes = {};this.listeners = {};this._text = '';this.value = '';this.hidden = false;this.disabled = false; }
  set textContent(value) { this._text = String(value);this.children = []; }
  get textContent() { return this._text + this.children.map(child => child.textContent).join(''); }
  set innerHTML(_) { throw Error('Unsafe HTML sink'); }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this._text = '';this.children = children;if(this.tagName === 'SELECT') this.value = children[0]?.value || ''; }
  setAttribute(key, value) { this.attributes[key] = String(value); }
  addEventListener(name, callback) { (this.listeners[name] ||= []).push(callback); }
  async emit(name) { return Promise.all((this.listeners[name] || []).map(callback => callback({target: this}))); }
  focus() { this.focused = true; }
}
function harness(fetcher, suppliedModel = model) {
  const ids = Object.fromEntries([...html.matchAll(/id="([^"]+)"/g)].map(match => [match[1], new Element(match[1] === 'catalog-category' ? 'select' : 'div')]));
  ids['catalog-search'].value = ''; ids['catalog-category'].value = 'all';
  const tabs = ['products', 'parts'].map(value => {const element = new Element('button');element.dataset.catalogTab = value;return element;});
  const body = new Element('body'), calls = [], timeouts = new Map(); let timerId = 0;
  const document = {body, getElementById: id => ids[id], createElement: tag => new Element(tag), querySelectorAll: query => {assert.equal(query, '[data-catalog-tab]');return tabs;}};
  const window = {BXHPublicCatalog: suppliedModel,setTimeout: callback => {timeouts.set(++timerId, callback);return timerId;},clearTimeout: id => timeouts.delete(id)};
  const context = vm.createContext({window,document,URL,AbortController,fetch: (url, options) => {calls.push({url,options});return fetcher(url, options, calls.length);}});
  vm.runInContext(ui, context, {filename: 'catalog-public-ui.js'});
  return {ids,tabs,body,calls,timeouts};
}
const response = (buffer = bytes, ok = true) => ({ok,arrayBuffer: async () => arrayBuffer(buffer)});
async function waitState(h, desired) {
  const deadline = Date.now() + 5000;
  while (h.body.dataset.catalogState !== desired && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 5));
  assert.equal(h.body.dataset.catalogState, desired);
}
function descendants(element) {return [element, ...element.children.flatMap(descendants)];}

test('UI loads only the fixed public resource anonymously, renders 9 products, and filters locally', async () => {
  const h = harness(async () => response());
  assert.equal(h.body.dataset.catalogState, 'loading');assert.equal(h.ids['catalog-controls'].disabled, true);
  await waitState(h, 'ready');
  assert.equal(h.calls.length, 1);assert.equal(h.calls[0].url, model.DATA_URL);
  assert.equal(h.calls[0].options.credentials, 'omit');assert.equal(h.calls[0].options.cache, 'no-store');assert.equal(h.calls[0].options.redirect, 'error');assert.equal(h.calls[0].options.method, 'GET');
  assert.equal(h.ids['catalog-results'].children.length, 9);assert.equal(h.ids['catalog-product-count'].textContent, '9');
  assert.equal(h.ids['catalog-part-count'].textContent, '45');assert.equal(h.ids['catalog-group-count'].textContent, '11');
  assert.equal(h.ids['catalog-controls'].disabled, false);assert.equal(h.timeouts.size, 0);
  h.ids['catalog-search'].value = 'UX-18';await h.ids['catalog-search'].emit('input');
  assert.equal(h.ids['catalog-results'].children.length, 1);assert.match(h.ids['catalog-count'].textContent, /1／9/);
  assert.match(h.ids['catalog-results'].textContent, /部件清單待補/);
  h.ids['catalog-search'].value = 'unmatched';await h.ids['catalog-search'].emit('input');
  assert.match(h.ids['catalog-results'].textContent, /沒有符合條件/);
  await h.ids['catalog-reset'].emit('click');assert.equal(h.ids['catalog-results'].children.length, 9);assert.equal(h.ids['catalog-search'].focused, true);
  await h.tabs[1].emit('click');assert.equal(h.ids['catalog-results'].children.length, 45);assert.equal(h.tabs[1].attributes['aria-pressed'], 'true');
  h.ids['catalog-category'].value = 'blade';await h.ids['catalog-category'].emit('change');
  assert.equal(h.ids['catalog-results'].children.length, original.parts.filter(part => part.category === 'blade').length);
  await h.ids['catalog-reset'].emit('click');assert.equal(h.ids['catalog-results'].children.length, 45);
  await h.tabs[1].emit('click');assert.equal(h.ids['catalog-results'].children.length, 45);
  await h.tabs[0].emit('click');assert.equal(h.ids['catalog-results'].children.length, 9);assert.equal(h.ids['catalog-category'].value, 'all');
  assert.equal(h.calls.length, 1);
});

test('UI keeps incomplete products and missing BX-20 names honest, without displaying raw IDs', async () => {
  const h = harness(async () => response());await waitState(h, 'ready');
  const ux19 = h.ids['catalog-results'].children.find(card => card.dataset.productId === 'product_000002');
  assert.match(ux19.textContent, /部件組成資料待補/);
  const bx20 = h.ids['catalog-results'].children.find(card => card.dataset.productId === 'product_000008');
  assert.match(bx20.textContent, /完整組合原文名稱待補/);
  assert.match(bx20.textContent, /部件清單 2/);assert.match(bx20.textContent, /部件清單 3/);
  assert.match(h.ids['catalog-results'].textContent, /不表示整盒內容、成品配色或所有款式皆完整/);
  assert.doesNotMatch(h.ids['catalog-results'].textContent, /product_\d|part_\d|group_\d|claim_\d|content_\d/);
});

test('UI uses marked Chinese primary names and verbatim original secondary text at every named level', async () => {
  const h = harness(async () => response());await waitState(h, 'ready');
  for (const product of original.products) {
    const card = h.ids['catalog-results'].children.find(row => row.dataset.productId === product.productId);
    const title = card.children.find(row => row.tagName === 'H2');
    assert.equal(title.lang, 'zh-Hant-TW');
    assert.equal(title.dataset.nameStatus, 'provisional_translation');
    assert(title.textContent.startsWith(model.displayName(product).primary));
    assert.equal(card.children.find(row => row.className === 'original-name').textContent, '原文：' + product.originalName);
  }
  for (const section of ['options', 'assemblyRelations']) for (const record of original[section].filter(row => row.originalName)) {
    const key = section === 'options' ? 'optionId' : 'groupId';
    const view = descendants(h.ids['catalog-results']).find(row => row.dataset[key] === record[key]);
    const translated = view.children.find(row => row.className === 'localized-name');
    assert(translated.textContent.startsWith(model.displayName(record).primary));
    assert.equal(translated.dataset.nameStatus, 'provisional_translation');
    assert.equal(view.children.find(row => row.className === 'original-name').textContent, '原文：' + record.originalName);
  }
  const all = descendants(h.ids['catalog-results']);
  for (const name of all.filter(row => row.className === 'localized-name')) assert.doesNotMatch(name.textContent, /[\p{Script=Hiragana}\p{Script=Katakana}]/u);
  for (const originalName of all.filter(row => row.className === 'original-name')) assert.equal(originalName.children[1].lang, 'ja');
  assert.equal(all.filter(row => row.dataset.nameStatus === 'untranslated').length, 0);
});

test('all 45 part cards distinguish provisional names from code labels, with Chinese search kept local', async () => {
  const h = harness(async () => response());await waitState(h, 'ready');await h.tabs[1].emit('click');
  for (const part of original.parts) {
    const card = h.ids['catalog-results'].children.find(row => row.dataset.partId === part.partId), name = model.displayName(part);
    const title = card.children.find(row => row.tagName === 'H2');
    assert.equal(title.dataset.nameStatus, name.status);
    assert(title.textContent.startsWith(name.primary));
    assert.equal(card.children.find(row => row.className === 'original-name').textContent, '原文：' + part.originalName);
    if (name.status === 'code_label') assert.doesNotMatch(title.textContent, /暫譯|官方/);
  }
  for (const query of ['布拉許', '索爾', 'DB 軸心']) {
    h.ids['catalog-search'].value = query;await h.ids['catalog-search'].emit('input');
    assert.equal(h.ids['catalog-results'].children.length, 1);
  }
  assert.equal(h.calls.length, 1);
});

test('CX-00 provisional title preserves both named items and the original color-version wording without new color claims', async () => {
  const product = original.products.find(row => row.productCode === 'CX-00');
  assert.equal(model.displayName(product).primary, '蒼龍鎖定紋章〈透明黑版〉＋陀螺對戰通行證貼紙');
  assert.equal(model.displayName(product).original, product.originalName);
  assert.equal(model.displayName(product).status, 'provisional_translation');
  const h = harness(async () => response());await waitState(h, 'ready');
  const card = h.ids['catalog-results'].children.find(row => row.dataset.productId === product.productId);
  assert.match(card.textContent, /陀螺對戰通行證貼紙/);
  assert.match(card.textContent, /台灣官方中文名稱、實物配色待補/);
  assert.equal(Object.hasOwn(product, 'taiwanName'), false);assert.equal(Object.hasOwn(product, 'color'), false);
});

test('all rendered source links are exact allowed URLs with new-window protections', async () => {
  const h = harness(async () => response());await waitState(h, 'ready');
  for (const tab of h.tabs) {
    await tab.emit('click');
    const links = descendants(h.ids['catalog-results']).filter(node => node.tagName === 'A');assert.ok(links.length > 0);
    for (const link of links) {assert.equal(model.safeSourceUrl(link.href), link.href);assert.equal(link.target, '_blank');assert.equal(link.rel, 'noopener noreferrer');assert.equal(link.referrerPolicy, 'no-referrer');assert.match(link.attributes['aria-label'], /另開視窗/);}
  }
});

for (const [label, fetcher] of Object.entries({
  'HTTP failure': async () => response(bytes, false),
  'network rejection': async () => {throw Error('network');},
  'malformed JSON': async () => response(Buffer.from('{bad')),
  'hash mismatch': async () => {const changed = Buffer.from(bytes);changed[100] ^= 1;return response(changed);}
})) test('UI fails closed on ' + label + ' and retry recovers', async () => {
  let attempt = 0;const h = harness(async (...args) => ++attempt === 1 ? fetcher(...args) : response());
  await waitState(h, 'error');assert.equal(h.ids['catalog-results'].children.length, 0);assert.equal(h.ids['catalog-controls'].disabled, true);assert.equal(h.ids['catalog-retry'].hidden, false);
  assert.equal(h.ids['catalog-product-count'].textContent, '—');assert.equal(h.ids['catalog-version'].textContent, '');
  await h.ids['catalog-retry'].emit('click');await waitState(h, 'ready');assert.equal(h.ids['catalog-results'].children.length, 9);assert.equal(h.ids['catalog-retry'].hidden, true);assert.equal(h.calls.length, 2);
});

test('synthetic validated-name rendering treats markup as literal text and never creates a tag', async () => {
  const data = copy();data.products[0].originalName = '<img src=x onerror=alert(1)>';
  // This test injects already-decoded synthetic data. Production decodeSnapshot still rejects changed bytes.
  const h = harness(async () => response(), {...model,decodeSnapshot: async () => model.validateCatalog(data)});
  await waitState(h, 'ready');assert.match(h.ids['catalog-results'].textContent, /<img src=x onerror=alert\(1\)>/);
  assert.equal(descendants(h.ids['catalog-results'].children[0]).filter(node => ['IMG','SCRIPT','IFRAME'].includes(node.tagName)).length, 0);
});

test('missing model and unsupported crypto report a recoverable error without any records', async () => {
  const h = harness(async () => response(), null);await waitState(h, 'error');assert.equal(h.calls.length, 0);assert.equal(h.ids['catalog-results'].children.length, 0);
  const noCrypto = harness(async () => response(), {...model,decodeSnapshot: async () => {throw Error('SECURE_CONTEXT_REQUIRED');}});
  await waitState(noCrypto, 'error');assert.match(noCrypto.ids['catalog-status'].textContent, /HTTPS/);
});

test('latest request wins; an earlier timeout only aborts its own request', async () => {
  let finishOld;
  const h = harness(async (_url, _options, count) => count === 1 ? new Promise(resolve => {finishOld = resolve;}) : response());
  const oldTimeout = [...h.timeouts.values()][0];
  const retry = h.ids['catalog-retry'].emit('click');oldTimeout();
  assert.equal(h.calls[0].options.signal.aborted, true);assert.equal(h.calls[1].options.signal.aborted, false);
  await retry;await waitState(h, 'ready');finishOld(response(Buffer.from('bad')));
  await new Promise(resolve => setImmediate(resolve));assert.equal(h.body.dataset.catalogState, 'ready');assert.equal(h.ids['catalog-results'].children.length, 9);
});

test('static page is accessible, same-origin-only and contains no auth or admin operations', () => {
  assert.match(html, /戰鬥陀螺X・公開圖鑑/);assert.doesNotMatch(html, /PUBLIC CATALOG|placeholder="[^"]*[\p{Script=Hiragana}\p{Script=Katakana}]/u);
  assert.match(html, /中文名稱為暫譯，非台灣官方命名/);assert.match(html, /代碼＋分類/);
  assert.match(html, /lang="zh-Hant-TW"/);assert.match(html, /width=device-width,initial-scale=1/);
  assert.match(html, /Content-Security-Policy/);assert.match(html, /connect-src 'self'/);assert.match(html, /img-src 'self'/);assert.match(html, /base-uri 'none'/);
  assert.match(html, /href="\.\/index.html"/);assert.match(html, /<noscript>/);assert.match(html, /role="status"/);assert.match(html, /aria-pressed="true"/);
  for (const id of ['catalog-search','catalog-category']) assert.match(html, new RegExp('for="' + id + '"'));
  assert.match(css, /focus-visible/);assert.match(css, /@media\(max-width:680px\)/);assert.match(css, /min-height:46px/);
  assert.doesNotMatch(html + ui, /<iframe|<img|firebase|inventory-catalog-ui|localStorage|sessionStorage|innerHTML|insertAdjacentHTML|document\.write|XMLHttpRequest|\.json\(\)|method:\s*['"]POST['"]/i);
  assert.equal((ui.match(/fetch\(/g) || []).length, 1);
});

test('main app integration is an ordinary public anchor with a fresh core asset key', () => {
  const core = fs.readFileSync(path.join(root,'modules/main-app/core.js'),'utf8');
  const landing = core.slice(core.indexOf('function renderLandingScreen(){'), core.indexOf('function renderLandingScreen(){') + 7000);
  assert.match(landing, /<a class="btn btn-ghost" href="\.\/bey-catalog.html" data-catalog-entry="public">陀螺圖鑑 · 免登入<\/a>/);
  const index = fs.readFileSync(path.join(root,'index.html'),'utf8');
  assert.match(index, /id="bxh-main-app-m7"[^>]+&catalog-public=20261014\.1/);
});

test('UX-18 maps exactly six option identities to the manual-verified official photos (not carousel order)', () => {
  const product = original.products.find(row => row.productCode === 'UX-18');
  const options = original.options.filter(row => row.productId === product.productId);
  assert.equal(model.OPTION_IMAGES.length, 6);
  options.forEach((option, index) => {
    const image = model.optionImage(product, option);
    assert.equal(image.optionCode, String(index + 1).padStart(2, '0'));
    assert.equal(image.sourceUrl, `https://beyblade.takaratomy.co.jp/beyblade-x/lineup/_image/UX18_${String([2,3,6,7,4,5][index]).padStart(2, '0')}@1.png`);
    assert.equal(image.originalName, option.originalName);
    assert.equal(image.width, 586);assert.equal(image.height, 709);
  });
});
test('image lookup rejects mismatched names, option codes and products', () => {
  const product = original.products.find(row => row.productCode === 'UX-18');
  const option = original.options.find(row => row.productId === product.productId);
  for (const changed of [{originalName:'unknown'}, {optionCode:'07'}, {optionId:'option_999999'}, {productId:'product_000001'}]) assert.equal(model.optionImage(product, {...option,...changed}), null);
  assert.equal(model.optionImage({...product,productCode:'BX-01'}, option), null);
  assert.equal(model.optionImage({...product,originalName:'Unknown'}, option), null);
  assert.equal(model.optionImage(null, option), null);assert.equal(model.optionImage(product, null), null);
});
test('image metadata is immutable and lookup never changes evidence or snapshot', () => {
  assert(Object.isFrozen(model.OPTION_IMAGES));
  for (const image of model.OPTION_IMAGES) {assert(Object.isFrozen(image));assert.throws(() => {image.path='https://example.com/evil';}, TypeError);}
  const data = copy(), before = JSON.stringify(data);
  for (const product of data.products) for (const option of data.options) model.optionImage(product, option);
  assert.equal(JSON.stringify(data), before);
  assert.equal(require('node:crypto').createHash('sha256').update(bytes).digest('hex'), model.EXPECTED_SHA256);
});
test('the six owner-provided combination names remain provisional, searchable and preserve originals', () => {
  const names = ['古屍詛咒 7-55W','古屍詛咒 4-60C','天馬九尾 M3-85W','焰神勇氣 C9-70TP','蒼龍利刃 7-55G','皓戰猛虎 4-80LR'];
  for (const [index,image] of model.OPTION_IMAGES.entries()) {
    const option = original.options.find(row => row.optionId === image.optionId), display = model.displayName(option);
    assert.equal(display.primary, names[index]);assert.equal(display.original, option.originalName);
    assert.equal(display.status, 'provisional_translation');assert.equal(display.label, '中文暫譯');
    assert.equal(model.filterCatalog(original, 'products', names[index])[0].productCode, 'UX-18');
  }
});
test('six local lazy images have dimensions, meaningful alt text and attribution', async () => {
  const h = harness(async () => response());await waitState(h, 'ready');
  const all = descendants(h.ids['catalog-results']), images = all.filter(row => row.tagName === 'IMG');
  assert.equal(images.length, 6);
  images.forEach((image,index) => {
    assert.equal(image.src, './' + model.OPTION_IMAGES[index].path);
    assert.equal(image.width,586);assert.equal(image.height,709);assert.equal(image.loading,'lazy');assert.equal(image.decoding,'async');
    assert.match(image.alt,new RegExp('UX-18-0'+(index+1)));assert.match(image.alt,/原廠商品示意圖/);
    assert.equal(image.referrerPolicy,'no-referrer');
  });
  assert.match(h.ids['catalog-results'].textContent,/© TOMY/);assert.match(h.ids['catalog-results'].textContent,/BBXProject/);
});
test('image failure shows a stable text fallback while other images and catalog stay available', async () => {
  const h = harness(async () => response());await waitState(h, 'ready');
  const frames = descendants(h.ids['catalog-results']).filter(row => row.className === 'option-image-frame');
  await frames[0].children[0].emit('error');await frames[0].children[0].emit('error');
  assert.equal(frames[0].children[0].hidden,true);assert.equal(frames[0].children[1].hidden,false);
  assert.equal(frames[1].children[0].hidden,false);assert.equal(frames[1].children[1].hidden,true);
  assert.equal(h.body.dataset.catalogState,'ready');assert.equal(h.ids['catalog-product-count'].textContent,'9');
});
test('repeated filters and tabs neither duplicate images nor issue additional data fetches', async () => {
  const h = harness(async () => response());await waitState(h,'ready');
  for (let i=0;i<3;i++) {
    h.ids['catalog-search'].value='UX-18';await h.ids['catalog-search'].emit('input');
    assert.equal(descendants(h.ids['catalog-results']).filter(row => row.tagName==='IMG').length,6);
    await h.tabs[1].emit('click');assert.equal(descendants(h.ids['catalog-results']).filter(row => row.tagName==='IMG').length,0);
    await h.tabs[0].emit('click');await h.ids['catalog-reset'].emit('click');
  }
  assert.equal(h.calls.length,1);
});
test('no image requests or image nodes are created when snapshot authentication fails', async () => {
  const h = harness(async () => response(Buffer.from('bad')));await waitState(h,'error');
  assert.equal(descendants(h.ids['catalog-results']).filter(row => row.tagName==='IMG').length,0);
});
