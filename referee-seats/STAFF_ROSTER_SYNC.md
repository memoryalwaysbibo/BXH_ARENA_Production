# Staff roster read permissions

Active formal `staff` accounts already have private tournament read access, but
full registration reads are denied when another staff member is assigned. This
change gives those accounts a separate display-only roster for official events.
Assigned staff and legacy empty assignment lists retain their existing routes.

`readStaffRegistrationRoster` checks the live user profile on every request and
returns only names, confirmed/waitlist status, attendance and source. It performs
no writes. It does not grant event configuration, contact data, scoring, check-in
mutation or promotion authority. Player, activity-staff, community and test-account
authorization is unchanged. The client keeps this result outside tournament state
and discards responses after navigation, account changes or loss of eligibility.

Undrawn individual/family/team registrations are projected with local participants;
drawn, started, selection and onsite-managed events use their canonical participant
arrays. The new display supports existing surname search and stroke sorting.

## Release order

1. Deploy only `readStaffRegistrationRoster` from the `referee-seats` Functions
   codebase. Do not redeploy scoring or referee-seat functions as part of this fix.
2. Verify using two active formal staff accounts excluded from the room assignment
   list. Confirm regular, waitlist, family, team and attendance rows match the source;
   verify inactive/player/test identities are rejected and contact data is absent.
3. Merge/deploy the frontend only after the callable is available. Before then,
   the new client reports the service as unavailable and provides a retry.
4. Check BXH-EKPRMZ with the affected workers. No production room has been changed
   by the tests, and no production deployment is certified by the local checks.

Validation: `node --test referee-seats/staff-roster.test.cjs tests/community-host-roster-sync.test.cjs tests/roster-view.test.cjs`.
