'use strict';

// Local-only release overlay. Never recursively copies the repository or research inputs.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const model = require('../modules/bey-catalog/catalog-public-model.js');
const pendingModel = require('../modules/bey-catalog/catalog-pending-model.js');
const candidateModel = require('../modules/bey-catalog/catalog-candidate-model.js');
const candidatePolicy = require('../modules/bey-catalog/catalog-candidate-policy.js');
const CANDIDATE_SCRIPTS = ['modules/bey-catalog/catalog-candidate-model.js','modules/bey-catalog/catalog-candidate-policy.js','modules/bey-catalog/catalog-candidate-presentation.js'];
const ROOT = path.resolve(__dirname, '..');
const RUNTIME_FILES = Object.freeze([
  'bey-catalog.html',
  'bey-catalog.css',
  'modules/bey-catalog/catalog-public-model.js',
  'modules/bey-catalog/catalog-public-ui.js',
  model.DATA_URL.replace(/^\.\//, ''),
  ...[...model.OPTION_IMAGES, ...model.PART_IMAGES].map(image => image.path),
  'modules/bey-catalog/catalog-pending-model.js',
  'modules/bey-catalog/catalog-pending-ui.js',
  pendingModel.DATA_URL.replace(/^\.\//, ''),
  ...CANDIDATE_SCRIPTS,
  candidatePolicy.dataURL.replace(/^\.\//, ''),
  ...candidatePolicy.imageURLs
]);
const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex');

function readRegular(root, relative) {
  if (!RUNTIME_FILES.includes(relative)) throw new Error('NOT_ALLOWLISTED');
  let current = root;
  for (const component of relative.split('/')) {
    current = path.join(current, component);
    if (fs.lstatSync(current).isSymbolicLink()) throw new Error('SYMLINK_REJECTED');
  }
  if (!fs.statSync(current).isFile()) throw new Error('REGULAR_FILE_REQUIRED');
  return fs.readFileSync(current);
}

async function inspectRuntime(root = ROOT) {
  root = fs.realpathSync(root);
  const bytes = new Map(RUNTIME_FILES.map(file => [file, readRegular(root, file)]));
  const data = bytes.get(RUNTIME_FILES[4]);
  const catalog = await model.decodeSnapshot(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength));
  for (const image of [...model.OPTION_IMAGES, ...model.PART_IMAGES]) {
    const asset = bytes.get(image.path);
    if (asset.length !== image.bytes || sha256(asset) !== image.sha256) throw new Error('IMAGE_VERSION_MISMATCH');
  }
  const pendingBytes = bytes.get(pendingModel.DATA_URL.replace(/^\.\//, ''));
  const pending = await pendingModel.decodeSnapshot(pendingBytes.buffer.slice(pendingBytes.byteOffset, pendingBytes.byteOffset + pendingBytes.byteLength));
  const candidateBytes = bytes.get(candidatePolicy.dataURL.replace(/^\.\//, ''));
  const candidateData = await candidateModel.decodeSnapshot(candidateBytes.buffer.slice(candidateBytes.byteOffset,candidateBytes.byteOffset+candidateBytes.byteLength),candidatePolicy);
  if (new Set(candidateData.entries.map(row=>row.imageURL)).size !== candidatePolicy.imageURLs.length || candidateData.entries.some(row=>!candidatePolicy.imageURLs.includes(row.imageURL))) throw Error('CANDIDATE_ASSET_LIST_MISMATCH');
  for(const row of candidateData.entries) {
    const asset=bytes.get(row.imageURL);
    if(!asset || asset.length>2097152 || sha256(asset)!==row.imageSha256 || asset.toString('ascii',0,4)!=='RIFF' || asset.toString('ascii',8,12)!=='WEBP') throw Error('CANDIDATE_IMAGE_MISMATCH');
  }
  const html = bytes.get('bey-catalog.html').toString('utf8');
  const expectedAssets = new Set([...RUNTIME_FILES.slice(1, 4), 'modules/bey-catalog/catalog-pending-model.js', 'modules/bey-catalog/catalog-pending-ui.js', ...CANDIDATE_SCRIPTS]);
  const actualAssets = [...html.matchAll(/<(?:script|link)\b[^>]*\b(?:src|href)=["']([^"']+)["']/gi)]
    .map(match => match[1].split(/[?#]/)[0].replace(/^\.\//, ''));
  if (actualAssets.length !== expectedAssets.size || actualAssets.some(file => !expectedAssets.has(file))) throw new Error('UNEXPECTED_RUNTIME_DEPENDENCY');
  for (const name of ['bey-catalog.html', 'modules/bey-catalog/catalog-public-model.js', 'modules/bey-catalog/catalog-public-ui.js', 'modules/bey-catalog/catalog-pending-model.js', 'modules/bey-catalog/catalog-pending-ui.js', ...CANDIDATE_SCRIPTS]) {
    if (/\b(?:eval\s*\(|importScripts\s*\(|serviceWorker\s*\.|XMLHttpRequest\b|WebSocket\b)/.test(bytes.get(name).toString('utf8'))) throw new Error('UNEXPECTED_ACTIVE_DEPENDENCY');
  }
  const manifest = {
    artifactType: 'catalog-public-runtime-overlay',
    schemaVersion: 1,
    snapshotSha256: model.EXPECTED_SHA256,
    pendingInventory: {sha256: pendingModel.EXPECTED_SHA256, entries: pending.entries.length, unresolved: pending.unresolved.length},
    candidateImages: {sha256:candidatePolicy.sha256,entries:candidateData.entries.length,images:candidatePolicy.imageURLs.length,status:'candidate'},
    counts: Object.fromEntries(Object.entries(catalog).map(([key, rows]) => [key, rows.length])),
    requiredExistingHostPath: 'index.html',
    files: RUNTIME_FILES.map(file => ({path: file, bytes: bytes.get(file).length, sha256: sha256(bytes.get(file))}))
  };
  return {bytes, manifest};
}

async function packageRuntime(destination, root = ROOT) {
  if (typeof destination !== 'string' || !destination) throw new Error('OUTPUT_DIRECTORY_REQUIRED');
  const output = path.resolve(destination);
  const repo = fs.realpathSync(root);
  const parent = fs.realpathSync(path.dirname(output));
  const resolvedOutput = path.join(parent, path.basename(output));
  if (resolvedOutput === repo || resolvedOutput.startsWith(repo + path.sep)) throw new Error('OUTPUT_MUST_BE_OUTSIDE_REPOSITORY');
  if (fs.existsSync(resolvedOutput)) throw new Error('OUTPUT_ALREADY_EXISTS');
  const {bytes, manifest} = await inspectRuntime(repo);
  fs.mkdirSync(resolvedOutput); // Fail rather than replace an existing output or rollback artifact.
  for (const [name, value] of bytes) {
    const target = path.join(resolvedOutput, name);
    fs.mkdirSync(path.dirname(target), {recursive: true});
    fs.writeFileSync(target, value, {flag: 'wx'});
  }
  fs.writeFileSync(path.join(resolvedOutput, 'catalog-public-manifest.json'), JSON.stringify(manifest, null, 2) + '\n', {flag: 'wx'});
  return manifest;
}

if (require.main === module) {
  const [destination, ...extra] = process.argv.slice(2);
  if (!destination || extra.length) {
    console.error('Usage: node scripts/package-bey-catalog-public.cjs <new-directory-outside-repository>');
    process.exitCode = 1;
  } else packageRuntime(destination).then(manifest => console.log(JSON.stringify(manifest, null, 2))).catch(error => {
    console.error(error.message);
    process.exitCode = 1;
  });
}

module.exports = {RUNTIME_FILES, inspectRuntime, packageRuntime};
