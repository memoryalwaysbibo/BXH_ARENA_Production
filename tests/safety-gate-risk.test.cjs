'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { classify } = require('../scripts/classify-change-risk.cjs');

test('documentation and isolated unit tests are LOW', () => {
  assert.equal(classify(['docs/SAFETY_GATE.md']).level, 'low');
  assert.equal(classify(['tests/example.test.cjs']).level, 'low');
  assert.deepEqual(
    {ui: classify(['README.md']).run_ui, e2e: classify(['README.md']).run_e2e, deep: classify(['README.md']).run_deep},
    {ui: false, e2e: false, deep: false}
  );
});

test('visual and low-coupling runtime files are MEDIUM', () => {
  for (const path of ['styles/components.css', 'modules/main-app/mailbox.js', 'assets/title.webp']) {
    const result = classify([path]);
    assert.equal(result.level, 'medium', path);
    assert.equal(result.run_ui, true);
    assert.equal(result.run_e2e, false);
    assert.equal(result.run_deep, false);
  }
});

test('shared runtime, auth, rules, workflows, and E2E changes are HIGH', () => {
  const paths = [
    'index.html',
    'modules/main-app/core.js',
    'modules/cloud/cloud-runtime.js',
    'modules/main-app/match-utils.js',
    'auth-state.js',
    'tests/e2e/player-tournament-deep.e2e.cjs',
    '.github/workflows/validate-production-frontend.yml',
    'package-lock.json'
  ];
  for (const path of paths) {
    const result = classify([path]);
    assert.equal(result.level, 'high', path);
    assert.equal(result.run_ui, true);
    assert.equal(result.run_e2e, true);
    assert.equal(result.run_deep, true);
  }
});

test('highest risk wins for mixed changes and empty input fails safe', () => {
  assert.equal(classify(['README.md', 'styles/app.css']).level, 'medium');
  assert.equal(classify(['styles/app.css', 'modules/main-app/core.js']).level, 'high');
  assert.equal(classify([]).level, 'high');
});

test('manual acceptance override is explicit and validated', () => {
  assert.equal(classify(['README.md'], 'high').level, 'high');
  assert.equal(classify(['index.html'], 'low').level, 'low');
  assert.throws(() => classify(['README.md'], 'unexpected'), /Invalid risk override/);
});

test('paths are normalized and de-duplicated', () => {
  assert.deepEqual(classify([' ./docs/a.md ', 'docs/a.md']).paths, ['docs/a.md']);
});
