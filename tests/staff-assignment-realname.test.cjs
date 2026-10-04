'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

const source = fs.readFileSync(path.join(__dirname, '../modules/main-app/core.js'), 'utf8');
const start = source.indexOf('function renderStaffAssignmentPanel(){');
const end = source.indexOf('\nfunction renderRefereeStationAssignmentPanel(){', start);
assert.ok(start >= 0 && end > start, 'staff renderer boundaries must exist');
const renderer = source.slice(start, end);
const escapeHtml = value => String(value == null ? '' : value).replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
const visible = html => html.replace(/<[^>]*>/g, '');

function render(users, assigned = [], extra = {}) {
  const context = {
    state: {meta: {assignedStaffUids: assigned}},
    accountMgmtUsers: users,
    isPartnerOrganizerMode: () => false,
    isEventStaffMode: () => false,
    isAdminTierOrAbove: () => true,
    renderEventStaffAssignmentPanel: () => 'PARTNER_PANEL',
    currentEventStaffMembership: () => ({duties: ['referee']}),
    eventStaffDutyLabel: () => '裁判',
    esc: escapeHtml,
    ...extra
  };
  return vm.runInNewContext(renderer + '\nrenderStaffAssignmentPanel();', context, {timeout: 1000});
}

const staff = overrides => ({
  uid: 'uid-staff-a',
  role: 'staff',
  realName: '測試人員甲',
  displayName: 'NICKNAME_ONLY',
  email: 'staff@example.invalid',
  ...overrides
});

test('shows trimmed real name while UID remains the assignment key', () => {
  const html = render([staff({realName: '  測試人員甲  '})]);
  const text = visible(html);
  assert.ok(text.includes('測試人員甲'));
  for (const value of ['NICKNAME_ONLY', 'staff@example.invalid', 'uid-staff-a']) assert.ok(!text.includes(value));
  assert.ok(html.includes('data-uid="uid-staff-a"'));
  assert.ok(text.includes('(工作人員)'));
});

test('preserves administrator role and checked assignment', () => {
  const html = render([staff({role: 'admin'})], ['uid-staff-a']);
  assert.match(html, /data-uid="uid-staff-a" checked/);
  assert.ok(visible(html).includes('(管理員)'));
  assert.ok(html.includes('data-action="save-staff-assignment"'));
});

test('missing, blank, or malformed real name uses an explicit placeholder', () => {
  for (const realName of [undefined, null, '', ' \t\n ', 123, false, {}, []]) {
    const html = render([staff({realName})], ['uid-staff-a']);
    const text = visible(html);
    assert.ok(text.includes('未填寫本名'), 'placeholder for ' + JSON.stringify(realName));
    for (const value of ['NICKNAME_ONLY', 'staff@example.invalid', 'uid-staff-a']) assert.ok(!text.includes(value));
    assert.match(html, /data-uid="uid-staff-a" checked/);
  }
});

test('same-name staff stay independently assigned by UID', () => {
  const html = render([staff(), staff({uid: 'uid-staff-b'})], ['uid-staff-b']);
  assert.equal((visible(html).match(/測試人員甲/g) || []).length, 2);
  assert.match(html, /data-uid="uid-staff-a"\s+style=/);
  assert.match(html, /data-uid="uid-staff-b" checked/);
});

test('escapes real names as HTML', () => {
  const html = render([staff({realName: '<img src=x onerror=alert(1)> & "姓名"'})]);
  assert.ok(html.includes('&lt;img src=x onerror=alert(1)&gt; &amp; &quot;姓名&quot;'));
  assert.ok(!html.includes('<img'));
});

test('preserves permission and special-role routes', () => {
  assert.equal(render([staff()], [], {isAdminTierOrAbove: () => false}), '');
  assert.equal(render([staff()], [], {isPartnerOrganizerMode: () => true}), 'PARTNER_PANEL');
  const eventHtml = render([staff()], [], {isEventStaffMode: () => true});
  assert.ok(eventHtml.includes('目前職務'));
  assert.ok(!eventHtml.includes('staff-assign-checkbox'));
});

test('preserves loading, empty, role filtering, and source data', () => {
  assert.ok(render(null).includes('data-action="load-staff-assignment-list"'));
  assert.ok(render([]).includes('目前沒有 staff 或 admin 帳號可供指派'));
  const user = Object.freeze(staff());
  const users = Object.freeze([user, staff({uid: 'player', role: 'player', realName: '非候選人'})]);
  const assigned = Object.freeze(['uid-staff-a']);
  const before = JSON.stringify({users, assigned});
  const html = render(users, assigned);
  assert.ok(!html.includes('非候選人'));
  assert.equal(JSON.stringify({users, assigned}), before);
});
