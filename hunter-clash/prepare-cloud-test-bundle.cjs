'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { CLOUD_TEST_PROJECT } = require('./server/runtime-boundary.cjs');
const BLOCKED_PROJECTS = ['bxh-arena', ['bxh-arena','beta'].join('-'), 'demo-hunter-clash'];
const SOURCE_FILES = Object.freeze([
  'contracts.cjs', 'server/callable-handler.cjs', 'server/runtime-boundary.cjs',
  'server/sandbox-service.cjs', 'emulator/firestore.rules', 'emulator/preflight.cjs',
  'emulator/package.json', 'emulator/package-lock.json'
]);
const sha256 = value => createHash('sha256').update(value).digest('hex');
function safeOut(root, output) {
  const resolved = path.resolve(output), parent = path.dirname(resolved);
  if (resolved === root || parent === root || !path.basename(resolved).startsWith('hc-cloud-test-'))
    throw Error('unsafe-output-path');
  return resolved;
}
function buildBundle({ projectId, sourceCommit, output, root = __dirname }) {
  if (!CLOUD_TEST_PROJECT.test(projectId) || BLOCKED_PROJECTS.includes(projectId))
    throw Error('invalid-cloud-test-project');
  if (!/^[a-f0-9]{40}$/.test(sourceCommit)) throw Error('invalid-source-commit');
  const destination = safeOut(path.resolve(root), output);
  if (fs.existsSync(destination)) throw Error('output-already-exists');
  fs.mkdirSync(destination, { recursive: false, mode: 0o700 });
  try {
    for (const relative of SOURCE_FILES) {
      const source = path.join(root, relative);
      if (!fs.statSync(source).isFile()) throw Error('missing-source-file');
      const targetName = relative.startsWith('emulator/') ? relative.slice('emulator/'.length) : relative;
      const target = path.join(destination, targetName);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.copyFileSync(source, target, fs.constants.COPYFILE_EXCL);
    }
    const entry = `'use strict';\nprocess.env.HC_RUNTIME_MODE='isolated-cloud-test';\n`+
      `const PROJECT=${JSON.stringify(projectId)};\n`+
      `const {onCall,HttpsError}=require('firebase-functions/https');\n`+
      `const {initializeApp}=require('firebase-admin/app');\n`+
      `const {getAuth}=require('firebase-admin/auth');\n`+
      `const {getFirestore,FieldValue}=require('firebase-admin/firestore');\n`+
      `const {createSandboxService}=require('./server/sandbox-service.cjs');\n`+
      `const {createCallableHandler}=require('./server/callable-handler.cjs');\n`+
      `const app=initializeApp();if(app.options.projectId!==PROJECT)throw Error('cloud-test-project-mismatch');\n`+
      `const service=createSandboxService({db:getFirestore(app),auth:getAuth(app),serverTimestamp:()=>FieldValue.serverTimestamp()},process.env,{expectedCloudProject:PROJECT});\n`+
      `exports.hcSandboxCommand=onCall({region:'asia-east1',timeoutSeconds:30,enforceAppCheck:true,invoker:'private'},createCallableHandler(service,HttpsError));\n`;
    fs.writeFileSync(path.join(destination, 'functions.cjs'), entry, { flag: 'wx', mode: 0o600 });
    const firebase = { firestore: { rules: 'firestore.rules' }, functions: { source: '.', codebase: 'hc-isolated-test' } };
    fs.writeFileSync(path.join(destination, 'firebase.json'), JSON.stringify(firebase, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
    const packageFile = path.join(destination, 'package.json');
    const pkg = JSON.parse(fs.readFileSync(packageFile, 'utf8'));
    pkg.name = 'hunter-clash-isolated-cloud-test'; pkg.main = 'functions.cjs'; delete pkg.scripts;
    fs.writeFileSync(packageFile, JSON.stringify(pkg, null, 2) + '\n', { mode: 0o600 });
    const records = [];
    for (const relative of fs.readdirSync(destination, { recursive: true }).sort()) {
      const file = path.join(destination, relative);
      if (fs.statSync(file).isFile()) records.push({ path: relative, bytes: fs.statSync(file).size, sha256: sha256(fs.readFileSync(file)) });
    }
    const manifest = { schemaVersion: 1, kind: 'HC_ISOLATED_CLOUD_TEST_CANDIDATE', projectId,
      sourceRepository: 'memoryalwaysbibo/BXH_ARENA_Production', sourceCommit,
      functionTarget: 'hcSandboxCommand', codebase: 'hc-isolated-test', region: 'asia-east1',
      appCheckEnforced: true, publicEntryEnabled: false, productionDataAllowed: false,
      deploymentAuthorized: false, files: records,
      treeSha256: sha256(JSON.stringify(records)) };
    fs.writeFileSync(path.join(destination, 'deployment-manifest.json'), JSON.stringify(manifest, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
    return manifest;
  } catch (error) {
    fs.rmSync(destination, { recursive: true, force: true });
    throw error;
  }
}
function main(args) {
  const values = {};
  for (let i = 0; i < args.length; i += 2) values[args[i]] = args[i + 1];
  if (args.length !== 6 || !values['--project'] || !values['--source-commit'] || !values['--out'])
    throw Error('usage: --project bxh-hc-test-* --source-commit SHA --out hc-cloud-test-*');
  const manifest = buildBundle({ projectId: values['--project'], sourceCommit: values['--source-commit'], output: values['--out'] });
  process.stdout.write(`Prepared ${manifest.kind}; deployment remains unauthorized.\n`);
}
if (require.main === module) { try { main(process.argv.slice(2)); } catch (error) { console.error(error.message); process.exitCode = 1; } }
module.exports = { buildBundle, SOURCE_FILES };
