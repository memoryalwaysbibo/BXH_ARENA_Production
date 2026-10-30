# Staff roster read permissions

Active formal staff can read limited official-event rosters even when another staff member is assigned. Existing assigned-staff, administrator, owner, partner and activity-staff management routes remain unchanged. This does not grant promotion, check-in mutation, scoring or event-configuration authority.

The independent `staff-roster` Functions codebase exports only `readStaffRegistrationRoster`. It checks the live profile in a read-only transaction and returns names, confirmed/waitlist status, attendance and source; no contact information, identity keys or whole-runtime payload is returned. The client stores this view outside tournament state and discards stale replies.

Ordinary drawn/played events retain canonical confirmed participants but include registration-only waitlist entries. Cancelled rows and duplicate runtime shadows are omitted. Selection and onsite-managed events retain their authoritative lists without reviving excluded candidates. Family and team waitlist entries expand into separate display rows.

## Publishing

The reviewed backend package must be mirrored to `BXH_ARENA_Functions_Production/release/staff-roster`. The backend PR provides verification and a manually started deployment workflow. It does not publish merely because this frontend PR is merged or tested.

Deploy only:

```sh
firebase deploy --project bxh-arena --config release/staff-roster/firebase.json --only functions:staff-roster --non-interactive
```

Verify ACTIVE, nodejs22, the callable entry point and unauthenticated rejection before publishing the frontend. Do not stage historical referee-seat Rules, redeploy seat/scoring functions, or change rollout flags.

Use an authenticated backend smoke test for active staff, inactive/player/test accounts, privacy, ordinary drawn waitlist, family/team entries and frozen onsite lists. After frontend deployment, verify both affected workers in BXH-EKPRMZ and that script URLs contain `staff-roster=20261030.1`. Production deployment and authenticated acceptance are still pending until independently verified.

Validation:

```sh
node --test staff-roster/*.test.cjs tests/staff-roster-cache.test.cjs tests/community-host-roster-sync.test.cjs tests/roster-view.test.cjs tests/roster-recovery.test.cjs tests/seated-roster-promotion.test.cjs
```
