# Poster and cover metadata writer candidate

Draft candidate, not deployed. No runtime settings, flags, room activation, score data, points or room lifecycle are changed. Deployment target is **only roomPosterCover**, from independently captured source-set20 / archiveSHA668657471b49be8fab9a0a7e77984f243a8e4b6629c9a3daf8262635d1ce8665. Preserve the source archive's existing index, package, environment, callable configuration and all unrelated files. Replace only root room-poster-cover.js and add the two reviewed root helpers bucket-poster-fence.cjs and bucket-state.cjs. Do not deploy roomPosterCoverCleanup or any sibling from this old source archive; the captured cleanup export's body is intentionally unchanged and separately tested for exact path scope.

The source originally checked cover-only actor eligibility before upload, but not at its final database transaction. Neither image route bound an upload to the physical private/public root generations, owner or bucket epoch. A same-code replacement could therefore receive an old upload. Both routes now pin the two SDK createTime values, owner, and legacy/bucket context before uploading and compare them in the final transaction. Cover actor eligibility is re-read inside that transaction; poster access retains its existing fresh actor, accepted assignment and organizer checks. Accepted staff grants now bind explicitly to the current parent sourceCreatedAt, or require a legacy assignment document's actual SDK birth to be no earlier than that parent. Client invitation timestamps cannot adopt an old assignment into a reused room.

Migration/deletion fields block by presence (including null/false) on either root. Active valid bucket manifest/projection identity permits metadata-only edits; the two expected root types must have consistent epoch and vector shape. Resizing, epoch/mode change, owner transfer, missing root or reused root during upload rejects the operation. Normal score-vector advancement can coexist with an image edit. The service does not read/certify score bucket contents, change the manifest/vector, or write serialized score/roster state. Existing actor policies, published/public poster scope, cover-only beta owner policy, image validation, URL format and ordinary success response shapes remain intact.

New objects use existing server-generated UUID paths. An upload whose Storage response is lost is included in attempted-object cleanup. Cleanup never scans a prefix or deletes unrelated paths. Database commit errors are handled separately: if writes were prepared, a fresh transaction checks both metadata references and the original binding before deleting anything. A confirmed commit returns success; confirmed unreferenced new objects may be removed. An unavailable read, partial reference, changed parent or migration is treated as unknown, and new objects are retained rather than deleting an image that might already be referenced. This avoids the captured baseline's broken-image bug after a committed transaction loses its response. Storage and Firestore do not share an atomic transaction: deletion remains best effort, unknown results may retain orphan objects, and the existing supported writers must never reuse old asset UUID paths. No new Storage lifecycle policy is introduced.

Validation runs the actual captured decoder, authorization helpers and candidate business functions. Unit fixtures cover legacy parity, 4-field fences, both physical roots, actor/owner/grant changes, bucket metadata, attempted uploads, lost commit responses, unknown outcomes, rollback and cleanup scope. Native tests use real Firestore SDK transactions in demo-bxh-bucket-posters, with synthetic auth, injected business project/clock and mocked Storage. They include concurrent uploads and preserve current database-referenced assets. They are not real Storage, Auth/App Check, Eventarc or full browser acceptance. Source-set20 declares SDK ranges ^14.4.0 / ^7.3.2; CI pins those lower-bound versions, not a claimed production lockfile resolution.

This closes the reviewed priority image-metadata writer gap. Wider Admin/non-Functions inventory, derived consumers, candidate integration, live source/configuration readback and controlled six-court cutover/rollback remain outstanding before bucket activation.

## Native image metadata read strategy

Diagnostic run42015506049 reproduced the failure at concurrent-saveCover-4:
transaction44's publicTournaments read waited8656ms before code3 invalid/closed,
while its peer transaction retried and committed. The source used parallel
transactional point reads for actor/private/public snapshots. This is evidence
for changing the read request strategy, not proof of every code3 cause or a
production incident.

Cover finalization and transactional poster authorization now obtain those same
three snapshots with one tx.getAll request. Nontransactional preflight reads,
conditional staff/organizer checks, physical generation/epoch binding, Storage
paths/cleanup, commit-outcome recovery, write payloads and SDK retry policy retain
their existing behavior. The source still writes only image metadata, never
serialized score state or bucket vectors.

Two fixture regressions require the exact three-document batch for each image
route and preserve paired writes/state. The previous parallel-read candidate
fails this regression; the revised candidate passes78 checks and exact source/
protocol verification. Native CI retains20 fresh concurrent workloads per action,
requiring both calls to succeed and final referenced assets to remain present.
Native outcome is pending; no deployment or production acceptance is claimed.
