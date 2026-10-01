'use strict';

const { spawnSync } = require('node:child_process');

const suites = {
  critical: [
    { name: 'claimed-card album refresh and session isolation', args: ['--test', 'tests/card-album-claim-refresh.test.cjs'] },
    { name: 'idle court dispatch', args: ['tests/idle-court-dispatch.test.cjs'] },
    { name: 'event staff permission boundary', args: ['--test', 'tests/event-staff-permission.test.cjs'] },
    { name: 'makeup check-in contract', args: ['tests/checkin-makeup-v2-ui.test.cjs'] },
    { name: 'ladder ranking UI contract', args: ['tests/ladder-ranking-ui.test.cjs'] },
    { name: 'community room cloud sync contract', args: ['tests/community-room-cloud-sync.test.cjs'] },
    { name: 'bronze-before-final ordering', args: ['tests/finals-order-core.test.cjs'] },
    { name: 'court-call PASS defer contract', args: ['tests/court-call-pass-queue.test.cjs'] },
  ],
  warning: [
    { name: 'hunter license grade', args: ['tests/hunter-license-grade.test.cjs'] },
    { name: 'account theme isolation', args: ['tests/theme-entrance-account.test.cjs'] },
    { name: 'directive theme access', args: ['tests/theme-directive-access.test.cjs'] },
    { name: 'inventory catalog UI', args: ['--test', 'tests/inventory-catalog-ui.test.cjs'] },
    { name: 'title artwork integrity', args: ['tests/title-host-3-art.test.cjs'] },
  ],
};

const tier = process.argv[2] || 'critical';
if (!Object.hasOwn(suites, tier)) {
  console.error('Unknown regression tier:', tier);
  process.exit(2);
}

const failures = [];
console.log('\nBXH ARENA Regression Suite');
console.log('Tier:', tier.toUpperCase());
console.log('Tests:', suites[tier].length, '\n');

for (const item of suites[tier]) {
  console.log('▶', item.name);
  const result = spawnSync(process.execPath, item.args, {
    stdio: 'inherit',
    env: process.env,
  });
  if (result.status !== 0) {
    failures.push({ name: item.name, status: result.status });
    console.error('✖ FAIL:', item.name, '\n');
  } else {
    console.log('✔ PASS:', item.name, '\n');
  }
}

console.log('----------------------------------------');
console.log(
  failures.length
    ? `Regression ${tier.toUpperCase()}: ${failures.length} failure(s)`
    : `Regression ${tier.toUpperCase()}: ALL PASS`
);

if (failures.length) {
  for (const failure of failures) console.error('-', failure.name);
  process.exit(1);
}
