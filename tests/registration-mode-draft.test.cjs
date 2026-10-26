const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

test('selecting online registration does not write an incomplete room to cloud', () => {
  const source = fs.readFileSync(path.join(__dirname, '../modules/main-app/core.js'), 'utf8');
  const start = source.indexOf('  if(action==="set-registration-enabled"){');
  const end = source.indexOf('  if(action==="set-registration-draft-visibility"){', start);
  assert.ok(start > 0 && end > start);
  const state = { bracketSize: 0, meta: { registrationEnabled: false, registrationCapacity: null } };
  const draft = { registrationEnabled: false, registrationCapacity: null };
  let writes = 0;
  const context = {
    state,
    registrationFormDraft: draft,
    registrationFormDraftDirty: false,
    aiCreateLastApplied: null,
    syncSettingsDraftFromDom() {},
    ensureRegistrationFormDraft() {},
    render() {},
    showToast() {},
    onsiteRegistrationSettingsLocked:()=>false,
    reportManagedRegistrationSettings() {},
    saveState() { writes++; return Promise.resolve(true); },
  };
  vm.createContext(context);
  vm.runInContext(`function selectMode(action,target){${source.slice(start, end)}}`, context);
  context.selectMode('set-registration-enabled', { getAttribute() { return 'true'; } });
  assert.equal(draft.registrationEnabled, true);
  assert.equal(context.registrationFormDraftDirty, true);
  assert.equal(state.meta.registrationEnabled, false);
  assert.equal(writes, 0);
});

