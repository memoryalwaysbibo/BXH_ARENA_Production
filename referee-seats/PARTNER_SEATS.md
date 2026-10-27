# Partner event referee seats

Partner organizers can enable the existing three-seat model on their own official individual, standard-mode room. Accepted activity staff with `referee` or `head_referee` duties can claim a main/backup seat, leave, request a handoff and score only their seated court. Main referees can revoke backups; the organizer retains management without a fourth seat. Check-in and assistant duties alone grant no referee access.

Each Callable reads the current room assignment, actor and organizer profiles, and rollout configuration in the same transaction. Activity access requires the original organization/contract fingerprint and parent expiry to remain valid. Revocation, expiry, frozen accounts and duty changes deny new operations, including replay of a formerly valid scoring receipt. User-profile membership caches and client-supplied authorization are not trusted.

The private room subscription projects only the signed-in actor's activity assignment. A denied subscription disables seat controls. Public seat output contains display names, never activity assignments or seat UIDs.

## Release

The frontend release candidate sets `PARTNER_REFEREE_SEATS_ROLLOUT` to true. Merge and deploy this candidate only after the partner-aware backend is deployed, its exact source archives are verified, and its partner gate is enabled. This candidate branch alone does not activate production. The two partner-aware backend Callables also require `systemConfig/refereeSeatsV1.partnerSeatsEnabled === true`, in addition to existing referee rollout gates. Deploy and verify the backend first, enable that additional gate, then release the frontend switch and accept the partner flow with real accounts.

Do not use the original disabled-staging deployment against the already-enabled production referee service. The backend Functions-only hotfix flow snapshots existing configuration and Rules before deployment, then verifies the exact resolved source generations of both Callables against the runtime manifest. Both configuration and Rules must remain unchanged. No Rules release or contract/quota write is needed for this extension.

Existing partner rooms require organizer activation and empty legacy court assignments. New partner rooms retain their current atomic room/quota creation path; this patch does not add automatic three-seat initialization to partner creation. Team and enchantment modes remain unsupported by the three-seat scoring engine. Keep activity invitations: they define which player accounts may officiate that event, unlike the legacy global Staff assignment checklist.

## Verification

`node --test referee-seats/partner.test.cjs referee-seats/partner-ui.test.cjs` covers grant boundaries, room/organization/contract mismatch, parent expiry, revocation, account suspension, handoff reauthorization, own-court scoring, idempotency, same-seat concurrency, disabled controls and private-subscription revocation. The existing referee unit, scoring, dispatch, cloud bridge, Rules and browser suites remain in CI.

Release acceptance: host activation; main/two backups; unseated denial; handoff; revoke invitation while seated; parent expiry; reload/reconnect; another event's invite denial; public data privacy; unchanged room quota.
