const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const html = fs.readFileSync('index.html', 'utf8');
const source = html.slice(html.indexOf('const BXH_INTERFACE_THEME_KEY='), html.indexOf('function accountMenuItemsHtml()'));
assert.ok(source.startsWith('const BXH_INTERFACE_THEME_KEY='));

function createContext(role, mode, saved = 'directive') {
  const attributes = {};
  const stored = { 'bxh.interface.theme.v1': saved };
  const context = {
    currentRole: mode,
    firebaseUser: role ? { uid: `theme-test-${role}` } : null,
    userProfile: role ? { role, active: true } : null,
    localStorage: { getItem: key => stored[key], setItem: (key, value) => { stored[key] = value; } },
    document: { documentElement: {
      getAttribute: key => attributes[key] || null,
      setAttribute: (key, value) => { attributes[key] = value; },
    } },
    esc: value => value,
  };
  vm.createContext(context);
  vm.runInContext(source, context);
  context.syncInterfaceThemeVisibility();
  return { context, attributes, stored };
}

for (const role of ['super_admin', 'admin', 'staff']) {
  const { context, attributes } = createContext(role, 'admin');
  assert.equal(attributes['data-bxh-theme'], 'directive');
  assert.match(context.themePickerHtml(), /極限指令/);
}

const player = createContext('player', 'player');
assert.equal(player.attributes['data-bxh-theme'], 'gold');
assert.doesNotMatch(player.context.themePickerHtml(), /極限指令/);
player.context.applyInterfaceTheme('directive');
assert.equal(player.attributes['data-bxh-theme'], 'gold');

const staff = createContext('staff', 'admin');
staff.context.currentRole = 'player';
staff.context.syncInterfaceThemeVisibility();
assert.equal(staff.attributes['data-bxh-theme'], 'directive');
assert.match(staff.context.themePickerHtml(), /極限指令/);
assert.equal(staff.stored['bxh.interface.theme.v1'], 'directive');
staff.context.currentRole = 'admin';
staff.context.syncInterfaceThemeVisibility();
assert.equal(staff.attributes['data-bxh-theme'], 'directive');

for (const role of ['super_admin', 'admin']) {
  const ownPlayer = createContext(role, 'player');
  assert.equal(ownPlayer.attributes['data-bxh-theme'], 'directive');
  assert.match(ownPlayer.context.themePickerHtml(), /極限指令/);
}

console.log('PASS directive theme roles and mode switching');
