'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const {RUNTIME_FILES, inspectRuntime, packageRuntime} = require('../scripts/package-bey-catalog-public.cjs');
const ROOT = path.resolve(__dirname, '..');
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
function fixture(t) {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'catalog-public-package-'));
  t.after(() => fs.rmSync(temp, {recursive: true, force: true}));
  const repo = path.join(temp, 'repo'); fs.mkdirSync(repo);
  for (const file of RUNTIME_FILES) {
    fs.mkdirSync(path.dirname(path.join(repo, file)), {recursive: true});
    fs.copyFileSync(path.join(ROOT, file), path.join(repo, file));
  }
  return {temp, repo, output: path.join(temp, 'public')};
}
function allFiles(root, parent = '') {
  return fs.readdirSync(path.join(root, parent), {withFileTypes: true}).flatMap(entry => {
    const name = parent ? parent + '/' + entry.name : entry.name;
    return entry.isDirectory() ? allFiles(root, name) : [name];
  }).sort();
}
test('public overlay has exactly eighteen reviewed runtime files and safe manifest', async () => {
  const {manifest} = await inspectRuntime();
  assert.equal(manifest.files.length, 18);
  assert.deepEqual(manifest.counts, {products: 9, parts: 47, options: 13, assemblyRelations: 11, contentFacts: 38});
  assert.equal(manifest.requiredExistingHostPath, 'index.html');
  assert.ok(manifest.files.every(file => /^[a-f0-9]{64}$/.test(file.sha256) && file.bytes > 0));
});
test('packaging copies exact bytes, omits all unrelated private fixtures and never executes them', async t => {
  const {repo, output} = fixture(t);
  fs.writeFileSync(path.join(repo, 'private-evidence-registry.json'), 'PRIVATE_SENTINEL');
  fs.writeFileSync(path.join(repo, 'catalog-research.json'), 'PRIVATE_SENTINEL');
  fs.writeFileSync(path.join(repo, 'internal-handoff.md'), 'PRIVATE_SENTINEL');
  const manifest = await packageRuntime(output, repo);
  assert.deepEqual(allFiles(output), [...RUNTIME_FILES, 'catalog-public-manifest.json'].sort());
  for (const entry of manifest.files) assert.equal(hash(fs.readFileSync(path.join(output, entry.path))), entry.sha256);
  assert.ok(allFiles(output).every(file => !fs.readFileSync(path.join(output, file), 'utf8').includes('PRIVATE_SENTINEL')));
});
test('packaging is deterministic and never overwrites a previous artifact', async t => {
  const {repo, output, temp} = fixture(t);
  const a = await packageRuntime(output, repo);
  const b = await packageRuntime(path.join(temp, 'second'), repo);
  assert.deepEqual(a, b);
  await assert.rejects(packageRuntime(output, repo), /OUTPUT_ALREADY_EXISTS/);
});
test('reject output inside repository including through a symlink parent', async t => {
  const {repo, temp} = fixture(t);
  await assert.rejects(packageRuntime(path.join(repo, 'dist'), repo), /OUTPUT_MUST_BE_OUTSIDE_REPOSITORY/);
  fs.symlinkSync(repo, path.join(temp, 'alias'), 'dir');
  await assert.rejects(packageRuntime(path.join(temp, 'alias', 'dist'), repo), /OUTPUT_MUST_BE_OUTSIDE_REPOSITORY/);
});
test('tampered snapshot fails before any output is created', async t => {
  const {repo, output} = fixture(t);
  const target = path.join(repo, RUNTIME_FILES[4]);
  const data = fs.readFileSync(target); data[20] ^= 1; fs.writeFileSync(target, data);
  await assert.rejects(packageRuntime(output, repo), /SNAPSHOT_VERSION_MISMATCH/);
  assert.equal(fs.existsSync(output), false);
});
test('reject symlinked runtime file and symlinked parent directory', async t => {
  const {repo, temp} = fixture(t);
  const css = path.join(repo, 'bey-catalog.css'); fs.renameSync(css, path.join(temp, 'css'));
  fs.symlinkSync(path.join(temp, 'css'), css);
  await assert.rejects(inspectRuntime(repo), /SYMLINK_REJECTED/);
  fs.unlinkSync(css); fs.copyFileSync(path.join(temp, 'css'), css);
  fs.renameSync(path.join(repo, 'data'), path.join(temp, 'data'));
  fs.symlinkSync(path.join(temp, 'data'), path.join(repo, 'data'), 'dir');
  await assert.rejects(inspectRuntime(repo), /SYMLINK_REJECTED/);
});
test('unexpected private or remote runtime dependency is rejected', async t => {
  const {repo} = fixture(t);
  const html = path.join(repo, 'bey-catalog.html');
  fs.appendFileSync(html, '<script src="private-evidence-registry.json"></script>');
  await assert.rejects(inspectRuntime(repo), /UNEXPECTED_RUNTIME_DEPENDENCY/);
});
test('CI invokes all new catalog contracts and browser suite without changed deployment privileges', () => {
  const ci = fs.readFileSync(path.join(ROOT, '.github/workflows/validate-production-frontend.yml'), 'utf8');
  for (const file of ['bey-catalog-public-evidence-policy.test.cjs', 'bey-catalog-public-ui.test.cjs', 'bey-catalog-public-package.test.cjs', 'bey-catalog-public-browser.test.cjs']) assert.ok(ci.includes(file));
  assert.match(ci, /permissions:\n  contents: read\n/);
});

test('tampered local image fails packaging before output exists', async t => {
  const {repo,output}=fixture(t);
  const target=path.join(repo,RUNTIME_FILES[5]);const bytes=fs.readFileSync(target);bytes[20]^=1;fs.writeFileSync(target,bytes);
  await assert.rejects(packageRuntime(output,repo),/IMAGE_VERSION_MISMATCH/);assert.equal(fs.existsSync(output),false);
});
test('six packaged images match source manifest and contain actual WebP bytes', async () => {
  const source=JSON.parse(fs.readFileSync(path.join(ROOT,'docs/bey-catalog/UX18_IMAGE_SOURCES.json')));
  const {manifest}=await inspectRuntime();
  assert.equal(source.assets.length,6);
  for (const image of source.assets) {
    const entry=manifest.files.find(row=>row.path===image.path);assert.equal(entry.sha256,image.sha256);assert.equal(entry.bytes,image.bytes);
    const bytes=fs.readFileSync(path.join(ROOT,image.path));assert.equal(bytes.toString('ascii',0,4),'RIFF');assert.equal(bytes.toString('ascii',8,12),'WEBP');
  }
  assert.ok(source.assets.reduce((sum,image)=>sum+image.bytes,0)<220000);
});

test('part image manifest exactly matches runtime mapping and verified local bytes', () => {
  const model=require('../modules/bey-catalog/catalog-public-model.js');
  const source=JSON.parse(fs.readFileSync(path.join(ROOT,'docs/bey-catalog/BASIC_BIT_IMAGE_SOURCES.json')));
  assert.deepEqual(source.assets,model.PART_IMAGES);
  for(const image of model.PART_IMAGES) {
    const bytes=fs.readFileSync(path.join(ROOT,image.path));assert.equal(bytes.length,image.bytes);assert.equal(hash(bytes),image.sha256);
    assert.match(image.sourceSha256,/^[a-f0-9]{64}$/);assert.match(image.identitySourceSha256,/^[a-f0-9]{64}$/);
  }
});

test('each altered part image is rejected before packaging output is created', async t => {
  const model=require('../modules/bey-catalog/catalog-public-model.js');
  for(const image of model.PART_IMAGES) {
    const {repo,output}=fixture(t);const target=path.join(repo,image.path);
    const bytes=fs.readFileSync(target);bytes[20]^=1;fs.writeFileSync(target,bytes);
    await assert.rejects(packageRuntime(output,repo),/IMAGE_VERSION_MISMATCH/);assert.equal(fs.existsSync(output),false);
  }
});
