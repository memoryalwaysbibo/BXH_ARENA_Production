# Four-court scoring buckets: isolated candidate

The current score and confirmation transactions update both `tournaments/{code}.data` and `publicTournaments/{code}.bracketView`. The three-seat callable does too. Therefore a court-to-bucket label alone cannot reduce contention: all operations would still write the two shared room documents. The 2026-10-31 incident cause remains unproven. See the baseline in PR #679.

This PR contains a **non-runtime** routing and Firestore Emulator candidate. It does not alter the app entrypoint, production Rules, Functions, flags, rooms or deployed scoring. It creates no production collections. An emulator pass is evidence for partition behavior, not certification of a six- or twelve-court live event.

## Mapping

For positive court number `s`, bucket index is `floor((s - 1) / 4)`. ID `court-1` stores courts 1–4, `court-2` stores 5–8, `court-3` stores 9–12, and so on. The count is `ceil(stations / 4)`; the organizer does not configure a bucket count. Normal Firestore document size, write rate, transaction and billing limits still apply; “automatic” does not mean physically unlimited capacity.

The candidate stores only its own court matches and receipt documents under `tournaments/{code}/scoreBuckets/{bucketId}`. A synthetic score transaction writes one bucket and its idempotency receipt. The room and public mirror remain unchanged during that transaction. A projection reader verifies all bucket identities and match routes before combining their scores with the structural room state. The unit tests cover boundaries 4→5 and 8→9, scope, stale revisions and incomplete projections.

The emulator suite launches six and twelve requests together for two repetitions, comparing a synthetic shared-room-document control with the bucket candidate. It records successes, failures, callback attempts and elapsed times. The control is **not** the full existing app transaction. Admin SDK transactions use server-side locks, so callback retry counts are not directly comparable to the browser SDK result in PR #679. An emulator result cannot establish production throughput or explain the incident. Receipt and score checks ensure acknowledged writes persist once, and the candidate must not change room/public document update times. These are synthetic non-scoring room codes in the `demo-bxh-four-court-buckets` project; the test refuses any other host/project before constructing Firebase clients. Rules deny all client access and are lab-only.

## Required before a production rollout

1. Make a versioned server-owned room cutover: prevent every old client and callable from writing `data` or `bracketView` after score buckets become authoritative. Seed and verify buckets from a frozen canonical state; never let an old whole-room retry overwrite a newer bucket score. Fail closed on missing, mismatched or partial bucket sets.
2. Move all normal score, undo, fault and three-seat commands to the bucket authority with the current seat, identity, dispatch and revision checks. Maintain operation receipts so lost replies cannot double-score. Pure score writes must not touch the room or public mirror.
3. Handle confirmation, winner propagation, same-round changes, venue transfers, retirement and bracket edits as structural operations. Lock or validate affected bucket revisions, including cross-bucket successor matches. Keep accepted results and ledger/audit data atomic. Full-rules, other tournament formats and settlement must be covered before release.
4. Materialize a public projection from bucket revisions using a single controlled writer or another bounded fan-in, and let private referee pages read the authoritative bucket for their court. Reject late projections with older revisions. A public view can lag briefly, but must converge without mixing old room scores into new results.
5. Define migration and rollback separately. A feature flag starts disabled. Disabling after cutover is unsafe until a server process has rebuilt and verified the old room snapshot from every bucket; rollback cannot rely on the stale root `data`. Test interrupted migration, stale clients, network loss and mixed-version users. Complete 6/12-court emulator and isolated UI tests, then a supervised live test room.

The candidate deliberately has no rollout flag or wiring. Its current `compose` overlays only scores and revisions for synthetic matches; it does not certify confirmation, public subscriptions, side effects, security authorization or settlement.
