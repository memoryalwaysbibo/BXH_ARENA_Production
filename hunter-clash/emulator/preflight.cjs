'use strict';
const PROJECT = 'demo-hunter-clash';
function assertIsolated(env) {
  for (const key of ['GCLOUD_PROJECT', 'GOOGLE_CLOUD_PROJECT', 'FIREBASE_PROJECT_ID']) {
    if (env[key] && env[key] !== PROJECT) throw Error('unsafe-emulator-project');
  }
  for (const key of ['GOOGLE_APPLICATION_CREDENTIALS', 'FIREBASE_TOKEN']) {
    if (env[key]) throw Error('production-credentials-not-allowed');
  }
  if (env.FIRESTORE_EMULATOR_HOST && env.FIRESTORE_EMULATOR_HOST !== '127.0.0.1:8180')
    throw Error('unsafe-emulator-host');
  if (env.FIREBASE_AUTH_EMULATOR_HOST && env.FIREBASE_AUTH_EMULATOR_HOST !== '127.0.0.1:9098')
    throw Error('unsafe-auth-emulator-host');
  return PROJECT;
}
if (require.main === module) {
  assertIsolated(process.env);
  process.stdout.write('PASS isolated demo project preflight\n');
}
module.exports = { assertIsolated, PROJECT };
