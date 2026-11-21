# Bucket writer source review — 2026-11-03, rollout closed

Evidence: uploaded regional metadata inventory SHA-256
`c84cb0aff9509a93d1a94f96bedee9c81951d91a999423311ff7ce97af74af03`,
captured 01:37:21 UTC (09:37:21 Taiwan), plus the priority capture started
01:42:21 UTC. All 158 regional functions were ACTIVE; 20 names had prior capture
or review and 138 names were not yet classified. The priority capture covered
32 entrypoints in 26 byte-distinct source archives. Every selected source file's
size and hash was verified against its capture manifest before this review.
No deployment, production data write, room read or room activation occurred.

This is a source-based initial triage, not an exhaustive static proof of all
possible writes or a live acceptance receipt. Reading a tournament trigger does
not establish that it writes tournaments. Conversely, a get/list action may
perform a write. Review the actual entrypoint and its dependencies.

| Assessment | Functions | Evidence / next action |
| --- | --- | --- |
| Six transaction-fence candidates prepared | familyRegistration, teamRegistration, teamScoring, teamLineup, courtCallService, enchantmentService | Captured service modules have legacy room/child writers without bucket ownership checks. See interactions package and 363 fixture checks. Not deployed. |
| Root/mirror or mixed registration writers still require fixes/adapters | lotteryRegistration, manageEntrySelection, manageRegistrationSelection, registrationInvitations, eventStaffService, roomPosterCover, settleLadderTournament, ladderAutoSettlement, preserveCompletedRoomAndCountHost, preserveExistingCompletedRooms | Captured registration-selection, entry-selection, registration-invitations, event-staff, room-poster-cover, ladder-settlement, ladder-auto-settlement and hosting modules write canonical roots or room children. Existing QR/onsite guards are not bucket ownership guards. |
| Raffle room-child writers still require deletion isolation | drawTournamentRaffle, updateTournamentRaffleWinner | operations.js creates/updates raffles, raffleControl, operationLog and tournamentActivity; needs current ownership checking before receipts and every write transaction. |
| Delayed maintenance metadata requires current-room/identity checks | trackTournamentActivity, trackTournamentRegistrationActivity | operations.js updates tournamentActivity by room code without reading the current parent in that transaction. A delayed event can outlive deletion or code reuse. |
| New-room creation is separate from existing-room mutation | createOfficialRoomWithRefereeSeats | auto-create-service.cjs transaction reads private/public roots and refuses either existing document before atomic create. Protected-create field allowlist exists. Reused-code receipt behavior and new-room policy still require normal acceptance. |
| No direct canonical room-state mutation identified in reviewed path | activityTournamentCompleted, cardAlbumEventAward, courtCallPushService, eventTemplateService, myEventsRegistrationChanged, myEventsRoomChanged, myEventsRosterOperationChanged, reconcileFirstExitTitles, refreshHunterLeaderboardOnSettlement, teamActivityArchived, roomPosterCoverCleanup | Writes target derived wallets/grants/mail/jobs/projections/team stats, push registry, settings, or exact prior image objects. This is not a guarantee that derived results remain correct with bucket storage; stale legacy-state reads, source incarnation, retries and cancellation must be accepted separately. |

## Blockers found beyond the six candidates

- **Alternate recursive deletion:** manageRegistrationSelection action delete
  freezes registrationSelection then calls recursiveDelete on the parent and
  deletes the public document. This bypasses the proposed audited parent-retaining
  deletion worker. An initial marker check alone cannot prove safety after the
  lock is released. Resolve this route and migration/deletion interleavings before
  deploying/enabling the bucket cutover; do not silently disable a legitimate
  workflow or route it through a handler with different authorization semantics.
- **Settlement must read authoritative state:** both manual and automatic ladder
  settlement consume serialized legacy state and can write it back. A fence
  prevents overwrite but is not a bucket-aware settlement adapter. Do not call
  the feature complete while settlement/archival is merely blocked.
- **Completed-room preservation also writes state:** hosting.keepAndCount can
  clear expiration by serializing the complete room state. That helper is used
  by syncMyHostingProgress as well as the two captured hosting entrypoints.
  The former function's own exact deployed archive was not in this 32-function
  capture and needs follow-up; sharing a source module in another archive is
  insufficient proof of its live bytes.
- **Other coverage remains:** 106 names from the 138 unclassified regional
  functions were not in this priority source capture. Other regions, direct
  Cloud Run services, maintenance scripts and Admin credentials are not covered
  by a Cloud Functions regional list. No global writer-complete claim is made.

## Release boundary

PR707's deletion recovery tests and this additional writer work do not enable
runtime gates. Existing closed Rules hash remains
`580da8c9dbde90e936ff7ddd88543b3370ff2f3cd9c27c749b6aecc11802977e`;
the deletion Rules candidate is separate. Exact current source/config readback,
controlled deployment, real Auth/App Check/network checks, and six-court
multi-referee cutover/rollback acceptance remain required. No room is activated
by source review, a passing CI check, or a prepared patch package.
