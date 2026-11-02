'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const root = path.join(__dirname, '..');
const vm = require('node:vm');
const core = fs.readFileSync(path.join(root, 'modules', 'main-app', 'core.js'), 'utf8');
const titleUtils = fs.readFileSync(path.join(root, 'modules', 'main-app', 'title-utils.js'), 'utf8');
const ladder = fs.readFileSync(path.join(root, 'ladder-secondary-ui.js'), 'utf8');
const context = { window: {} };
vm.createContext(context);
vm.runInContext(titleUtils, context, { filename: 'title-utils.js' });
const artworkPath = context.window.BXHTitleUtils.titleArtworkPath;
assert.equal(typeof artworkPath, 'function', 'Title artwork helper is exported');
assert.doesNotMatch(core, /function titleArtworkPath\(/, 'Core retains only the module binding, not the helper implementation');
assert.match(core, /const \{[^}]*titleArtworkPath[^}]*\}=window\.BXHTitleUtils;/, 'Core binds the exported artwork helper');
const expectedArtwork = {
  '創世者': 'assets/title-eternal-creator.webp',
  '裁決者': 'assets/title-eternal-adjudicator.webp',
  '審判者': 'assets/title-eternal-adjudicator.webp',
  '開拓者': 'assets/title-limited-pioneer.webp',
  '諸神典藏者': 'assets/title-limited-gods-collector.webp',
  '諸神收藏家': 'assets/title-limited-gods-collector.webp',
  'S2總冠軍': 'assets/title-limited-s2-champion.webp',
  'S3總冠軍': 'assets/title-limited-s3-champion.webp',
  '新銳獵人': 'assets/title-common-rookie-hunter-v1.webp',
  '戰場熟面孔': 'assets/title-rare-familiar-face-v1.webp',
  '三冠王': 'assets/title-legendary-triple-crown-v3.webp',
  '初來乍到': 'assets/title-common-first-checkin-v1.webp',
  '七日常客': 'assets/title-common-seven-day-guest-v1.webp',
  '二當家': 'assets/title-limited-co-leader.webp',
  '三當家': 'assets/title-limited-third-leader.webp',
  'BXH 工作人員': 'assets/title-limited-bxh-staff.webp',
  '封測先鋒': 'assets/title-limited-closed-beta.webp',
  '百戰磨練': 'assets/title-milestone-100.webp',
  '雙生修羅': 'assets/title-milestone-200.webp',
  '三途橫渡': 'assets/title-milestone-300.webp',
  '四神俱滅': 'assets/title-milestone-400.webp',
  '五嶽崩摧': 'assets/title-milestone-500.webp',
  '六道輪迴': 'assets/title-milestone-600.webp',
  '七星隕落': 'assets/title-milestone-700.webp',
  '八荒血帝': 'assets/title-milestone-800.webp',
  '九天終焉': 'assets/title-milestone-900.webp',
  '千古不滅': 'assets/title-milestone-1000.webp',
  '四強霸主': 'assets/title-epic-top4-overlord.webp',
  '冠軍獵人': 'assets/title-epic-champion-hunter.webp',
  '百日戰士': 'assets/title-epic-hundred-day-warrior.webp',
  '初次開局': 'assets/title-rare-first-match.webp',
  '整裝待發': 'assets/title-common-ready-zhulu-v2.webp',
  '初次上陣': 'assets/title-common-debut-zhulu-v2.webp',
  '對戰召集人': 'assets/title-rare-host-3.webp',
  '賽事推手': 'assets/title-rare-host-10.webp',
  '資深主辦': 'assets/title-rare-host-20.webp',
  '競技場主': 'assets/title-rare-host-30.webp',
};
for (const name of ['新銳獵人','戰場熟面孔','三冠王','初來乍到','七日常客']) {
  const webp = expectedArtwork[name];
  const png = webp.slice(0, -5) + '.png';
  assert(fs.existsSync(path.join(root, webp)), name + ' WebP missing');
  assert(fs.existsSync(path.join(root, png)), name + ' PNG fallback missing');
  assert(ladder.includes('"' + name + '":"' + webp + '"'), name + ' ladder artwork mapping missing');
}
for (const [name, expected] of Object.entries(expectedArtwork)) {
  assert.equal(artworkPath(name), expected, `Artwork mapping changed for ${name}`);
}
assert.equal(artworkPath('未知稱號'), '', 'Unknown titles do not receive artwork');
// Reject partially uploaded monthly artwork before it can reach Pages.
const monthly = 'assets/title-rare-monthly-hunter-moon-phases-v2';
assert.equal(artworkPath('月度獵人'), monthly + '.webp');
assert(ladder.includes('"月度獵人":"' + monthly + '.webp"'));
const monthlyPng = fs.readFileSync(path.join(root, monthly + '.png'));
assert.equal(monthlyPng.readUInt32BE(16), 768);
assert.equal(monthlyPng.readUInt32BE(20), 256);
assert.equal(monthlyPng[25], 6, 'Monthly PNG must retain RGBA');
let monthlyOffset = 8, monthlyEnded = false;
const monthlyIdat = [];
while (monthlyOffset < monthlyPng.length) {
  const length = monthlyPng.readUInt32BE(monthlyOffset);
  const end = monthlyOffset + length + 12;
  assert(end <= monthlyPng.length, 'Monthly PNG chunk truncated');
  const kind = monthlyPng.toString('ascii', monthlyOffset + 4, monthlyOffset + 8);
  if (kind === 'IDAT') monthlyIdat.push(monthlyPng.subarray(monthlyOffset + 8, end - 4));
  if (kind === 'IEND') { monthlyEnded = true; assert.equal(end, monthlyPng.length); }
  monthlyOffset = end;
}
assert(monthlyEnded, 'Monthly PNG IEND missing');
assert.equal(require('node:zlib').inflateSync(Buffer.concat(monthlyIdat)).length, (768 * 4 + 1) * 256, 'Monthly PNG must decode every row');
const monthlyWebp = fs.readFileSync(path.join(root, monthly + '.webp'));
assert.equal(monthlyWebp.toString('ascii', 0, 4), 'RIFF');
assert.equal(monthlyWebp.toString('ascii', 8, 12), 'WEBP');
assert.equal(monthlyWebp.readUInt32LE(4) + 8, monthlyWebp.length, 'Monthly WebP truncated');
assert(monthlyWebp.length < 400000, 'Monthly WebP exceeds website budget');
assert.equal(artworkPath('對戰召集人', 'common'), 'assets/title-rare-host-3.webp', 'Legacy rarity argument remains behaviorally ignored');
assert(ladder.includes('"對戰召集人":"assets/title-rare-host-3.webp"'), 'Host-3 ladder artwork mapping missing');
const png = fs.readFileSync(path.join(root, 'assets/title-rare-host-3.png'));
assert.equal(crypto.createHash('sha256').update(png).digest('hex'), 'f25be44b04c7b99851e22a824154b380221c6652868a34d1e16201030536247b', 'PNG must be the exact user-approved original');
assert.equal(png.subarray(1, 4).toString(), 'PNG');
assert.equal(png.readUInt32BE(16), 2172);
assert.equal(png.readUInt32BE(20), 724);
assert.equal(png[25], 6, 'PNG must retain RGBA transparency');
const webp = fs.readFileSync(path.join(root, 'assets/title-rare-host-3.webp'));
assert.equal(webp.subarray(0, 4).toString(), 'RIFF');
assert.equal(webp.subarray(8, 12).toString(), 'WEBP');
assert.equal(webp.readUInt32LE(4) + 8, webp.length, 'WebP container is truncated');
assert(webp.length > 1000 && webp.length < 1000000, 'WebP image size outside expected budget');

// The ten milestone artworks retain the existing WebP -> PNG fallback contract.
const milestoneArtwork = {
  "百戰磨練": "assets/title-milestone-100.webp",
  "雙生修羅": "assets/title-milestone-200.webp",
  "三途橫渡": "assets/title-milestone-300.webp",
  "四神俱滅": "assets/title-milestone-400.webp",
  "五嶽崩摧": "assets/title-milestone-500.webp",
  "六道輪迴": "assets/title-milestone-600.webp",
  "七星隕落": "assets/title-milestone-700.webp",
  "八荒血帝": "assets/title-milestone-800.webp",
  "九天終焉": "assets/title-milestone-900.webp",
  "千古不滅": "assets/title-milestone-1000.webp"
};
for (const [name, asset] of Object.entries(milestoneArtwork)) {
  assert.equal(artworkPath(name), asset, name + ' milestone mapping missing');
  assert(ladder.includes('"' + name + '":"' + asset + '"'), name + ' ladder mapping missing');
  const webpBytes = fs.readFileSync(path.join(root, asset));
  const pngBytes = fs.readFileSync(path.join(root, asset.replace(/\.webp$/, '.png')));
  assert.equal(webpBytes.toString('ascii', 0, 4), 'RIFF');
  assert.equal(webpBytes.toString('ascii', 8, 12), 'WEBP');
  assert.equal(webpBytes.readUInt32LE(4) + 8, webpBytes.length, name + ' WebP truncated');
  assert.equal(webpBytes.toString('ascii', 12, 16), 'VP8L', name + ' WebP must remain lossless');
  assert.equal(webpBytes[20], 0x2f, name + ' lossless WebP signature missing');
  const flags = webpBytes.readUInt32LE(21);
  const width = (flags & 0x3fff) + 1;
  const height = ((flags >>> 14) & 0x3fff) + 1;
  assert.equal(width, 768, name + ' website artwork width changed');
  assert(webpBytes.length < 400000, name + ' WebP exceeds website size budget');
  assert.equal((flags >>> 28) & 1, 1, name + ' WebP alpha missing');
  assert.equal(pngBytes.subarray(1, 4).toString(), 'PNG');
  assert.equal(pngBytes.readUInt32BE(16), width, name + ' fallback width mismatch');
  assert.equal(pngBytes.readUInt32BE(20), height, name + ' fallback height mismatch');
  assert.equal(pngBytes[25], 6, name + ' PNG must retain RGBA transparency');
}

console.log('PASS host-3 and ten milestone artwork, transparency, fallback and mapping');
