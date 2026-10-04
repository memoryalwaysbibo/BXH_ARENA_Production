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
  '三冠王': 'assets/title-legendary-triple-crown.webp',
  '二當家': 'assets/title-limited-co-leader.webp',
  '三當家': 'assets/title-limited-third-leader.webp',
  'BXH 工作人員': 'assets/title-limited-bxh-staff.webp',
  '封測先鋒': 'assets/title-limited-closed-beta.webp',
  '百戰磨練': 'assets/title-epic-hundred-battles.webp',
  '四強霸主': 'assets/title-epic-top4-overlord.webp',
  '冠軍獵人': 'assets/title-epic-champion-hunter.webp',
  '百日戰士': 'assets/title-epic-hundred-day-warrior.webp',
  '初次開局': 'assets/title-rare-first-match.webp',
  '整裝待發': 'assets/title-common-ready.svg',
  '初次上陣': 'assets/title-common-debut.svg',
  '對戰召集人': 'assets/title-rare-host-3.webp',
  '賽事推手': 'assets/title-rare-host-10.webp',
  '資深主辦': 'assets/title-rare-host-20.webp',
  '競技場主': 'assets/title-rare-host-30.webp',
};
for (const [name, expected] of Object.entries(expectedArtwork)) {
  assert.equal(artworkPath(name), expected, `Artwork mapping changed for ${name}`);
}
assert.equal(artworkPath('未知稱號'), '', 'Unknown titles do not receive artwork');
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
console.log('PASS host-3 original artwork, transparency metadata, catalog and ladder mapping');
