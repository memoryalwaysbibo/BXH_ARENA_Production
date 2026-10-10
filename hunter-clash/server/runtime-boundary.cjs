'use strict';
const { assertIsolated, PROJECT: EMULATOR_PROJECT } = require('../emulator/preflight.cjs');
const CLOUD_TEST_PROJECT_ID = 'bxh-hc-test';
const PRODUCTION_PROJECT = 'bxh-arena';
const LEGACY_BETA_PROJECT = [PRODUCTION_PROJECT, 'beta'].join('-');
function assertSandboxRuntime(db, auth, env = process.env, expectedCloudProject) {
  const dbProject = db?.projectId;
  const authProject = auth?.app?.options?.projectId;
  if (dbProject !== authProject || typeof dbProject !== 'string') throw Error('sandbox-service-only');
  const localEmulator = dbProject === EMULATOR_PROJECT &&
    env.FIRESTORE_EMULATOR_HOST === '127.0.0.1:8180' &&
    env.FIREBASE_AUTH_EMULATOR_HOST === '127.0.0.1:9098';
  if (localEmulator) {
    assertIsolated(env);
    if (dbProject !== EMULATOR_PROJECT || env.FIRESTORE_EMULATOR_HOST !== '127.0.0.1:8180' ||
        env.FIREBASE_AUTH_EMULATOR_HOST !== '127.0.0.1:9098') throw Error('sandbox-service-only');
    return { mode: 'emulator', projectId: dbProject };
  }
  if (env.HC_RUNTIME_MODE !== 'isolated-cloud-test' || env.FIRESTORE_EMULATOR_HOST ||
      env.FIREBASE_AUTH_EMULATOR_HOST || typeof expectedCloudProject !== 'string' ||
      expectedCloudProject !== dbProject || dbProject !== CLOUD_TEST_PROJECT_ID ||
      [PRODUCTION_PROJECT, LEGACY_BETA_PROJECT, EMULATOR_PROJECT].includes(dbProject))
    throw Error('sandbox-service-only');
  return { mode: 'isolated-cloud-test', projectId: dbProject };
}
module.exports = { assertSandboxRuntime, CLOUD_TEST_PROJECT_ID };
