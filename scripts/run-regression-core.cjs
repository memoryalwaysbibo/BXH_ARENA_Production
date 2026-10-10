'use strict';

const { spawnSync } = require('node:child_process');

const suites = {
  critical: [
    {name:'Hunter Clash final rehydration, revocation and legacy isolation',args:['--test','tests/hunter-clash-final-check.test.cjs']},
    {name:'Hunter Clash PK badge settlement, quotas and revocation',args:['--test','tests/hunter-pk-achievements.test.cjs']},
    {name:'Hunter Clash practice XP atomic settlement and daily limits',args:['--test','tests/hunter-practice-xp.test.cjs']},
    { name: "Hunter Clash A2/A3 ledger, auth, paging and source adapter", args: ["--test", "tests/hunter-clash-a23.test.cjs"] },
    { name: "Hunter Clash A1 identity gate and camera lifecycle", args: ["--test", "tests/hunter-clash-a1-entry.test.cjs"] },
    { name: 'hunter B6 grade transparency and career replay', args: ['--test', 'tests/hunter-b6-license.test.cjs'] },
    { name: 'hunter B5 offline replay and strength diagnostics', args: ['--test', 'tests/hunter-b5-strength.test.cjs'] },
    { name: 'hunter B4 sample maturity and comparable recent windows', args: ['--test', 'tests/hunter-b4-trends.test.cjs'] },
    { name: 'hunter B3 radar denominator, scale and inline evidence', args: ['--test', 'tests/hunter-b3-radar.test.cjs'] },
    { name: 'hunter B2 source categories and enchantment base scoring', args: ['--test', 'tests/hunter-b2-modes.test.cjs'] },
    { name: 'hunter B1 statistics and partial-read states', args: ['--test', 'tests/hunter-b1-statistics.test.cjs', 'tests/hunter-b1-cloud.test.cjs'] },
    { name: 'inline mailbox reading and stable refresh', args: ['--test', 'tests/mailbox-inline.test.cjs'] },
    { name: 'claimed-card album refresh and session isolation', args: ['--test', 'tests/card-album-claim-refresh.test.cjs'] },
    { name: 'Core module exports, shared state, and stale callback guards', args: ['--test', 'tests/module-seam-contracts.test.cjs'] },
    { name: 'public lobby ordering utility and Core seam', args: ['--test', 'tests/lobby-ordering.test.cjs'] },
    { name: 'idle court dispatch', args: ['tests/idle-court-dispatch.test.cjs'] },
    { name: 'event staff permission boundary', args: ['--test', 'tests/event-staff-permission.test.cjs'] },
    { name: 'staff assignment real-name display', args: ['--test', 'tests/staff-assignment-realname.test.cjs'] },
    { name: 'assignment commit / confirmation separation', args: ['--test', 'tests/assignment-cloud-confirmation.test.cjs'] },
    { name: 'offline queue render dedupe', args: ['tests/offline-queue-render-dedupe.test.cjs'] },
    { name: 'makeup check-in contract', args: ['tests/checkin-makeup-v2-ui.test.cjs'] },
    { name: 'ladder ranking UI contract', args: ['tests/ladder-ranking-ui.test.cjs'] },
    { name: 'ladder history access and loading state', args: ['--test', 'tests/ladder-history-access.test.cjs'] },
    { name: 'community room cloud sync contract', args: ['tests/community-room-cloud-sync.test.cjs'] },
    { name: 'bronze-before-final ordering', args: ['tests/finals-order-core.test.cjs'] },
    { name: 'court-call PASS defer contract', args: ['tests/court-call-pass-queue.test.cjs'] },
    { name: 'team scoring board initial state', args: ['tests/team-scoring-ui.test.cjs'] },
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
