'use strict';
const { assertIsolated, PROJECT: EMULATOR_PROJECT } = require('../emulator/preflight.cjs');
const CLOUD_TEST_PROJECT = /^bxh-hc-test-[a-z0-9](?:[a-z0-9-]{1,27}[a-z0-9])$/;
function assertSandboxRuntime(db, auth, env = process.env, expectedCloudProject) {
  const dbProject = db?.projectId;
  const authProject = auth?.app?.options?.projectId;
  if (dbProject !== authProject || typeof dbProject !== 'string') throw Error('sandbox-service-only');
  if (env.FUNCTIONS_EMULATOR === 'true') {
    assertIsolated(env);
    if (dbProject !== EMULATOR_PROJECT || env.FIRESTORE_EMULATOR_HOST !== '127.0.0.1:8180' ||
        env.FIREBASE_AUTH_EMULATOR_HOST !== '127.0.0.1:9098') throw Error('sandbox-service-only');
    return { mode: 'emulator', projectId: dbProject };
  }
  if (env.HC_RUNTIME_MODE !== 'isolated-cloud-test' || env.FIRESTORE_EMULATOR_HOST ||
      env.FIREBASE_AUTH_EMULATOR_HOST || typeof expectedCloudProject !== 'string' ||
      expectedCloudProject !== dbProject || !CLOUD_TEST_PROJECT.test(dbProject) ||
      ['bxh-arena', 'bxh-arena-beta', EMULATOR_PROJECT].includes(dbProject))
    throw Error('sandbox-service-only');
  return { mode: 'isolated-cloud-test', projectId: dbProject };
}
module.exports = { assertSandboxRuntime, CLOUD_TEST_PROJECT };
