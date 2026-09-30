'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { assertIsolated, PROJECT } = require('../hunter-clash/emulator/preflight.cjs');
test('emulator guard rejects production projects, credentials and remote hosts', () => {
  assert.equal(assertIsolated({}), PROJECT);
  assert.equal(assertIsolated({ GCLOUD_PROJECT: PROJECT, FIRESTORE_EMULATOR_HOST: '127.0.0.1:8180' }), PROJECT);
  for (const env of [{GCLOUD_PROJECT:'bxh-arena'}, {GOOGLE_CLOUD_PROJECT:'bxh-arena-beta'},
    {FIREBASE_PROJECT_ID:'bxh-arena'}, {GOOGLE_APPLICATION_CREDENTIALS:'credential.json'},
    {FIREBASE_TOKEN:'test'}, {FIRESTORE_EMULATOR_HOST:'example.com:8180'},
    {FIREBASE_AUTH_EMULATOR_HOST:'example.com:9098'}])
    assert.throws(() => assertIsolated(env));
});
