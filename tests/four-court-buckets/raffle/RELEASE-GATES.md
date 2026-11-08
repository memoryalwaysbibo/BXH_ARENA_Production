# Raffle candidate review gates — no release authorization

This checklist records preparation only. It is not a deployment instruction,
current production inspection, or permission to change any live room.

## Confirmed locally

- Exact pinned source-transfer digest checked before assembling full packages.
- Both participant-v1 and compatibility variants rebuilt twice: each 114 files,
  with 106 original files preserved, operations.js replaced, seven dependencies
  added. Both repeat builds are byte-identical.
- New version archive SHA-256:
  `38aec32a71b5eec7c507543eed2f013c61e9d31b504b2ffe76d635b0d4be2550`.
- Compatible fallback SHA-256:
  `534ca704c5800485392a8d310032f35b3fe6628efeb2205229b8c75f78f51dae`.
- Each variant passed all 113 JavaScript syntax checks on Node 22.
- The variants differ only in the server default for rooms without a ledger.
  Existing ledger identity versions are honored by both.
- Twelve independent offline builder tests passed. Modified baseline bytes,
  dependency collisions, unsupported identity versions, unverified transfer and
  existing output directories are rejected. Original source mappings are not
  mutated; fixture files match the assembled bytes.
- Browser, native SDK and authority/retry evidence is in
  ROLLBACK-CONTINUATION.md. Those tests are not live acceptance.

## Still closed

1. **Remote candidate publication and CI:** requires explicit approval to upload
   the candidate files to the named repository. No new remote CI evidence exists.
   Local changes now include the builder regression and its integration-workflow
   hook; any later upload approval must cover the actual changed-file scope.
2. **Fresh source and runtime configuration:** pinned source capture is from
   2026-11-06 18:52 UTC. It does not prove today's deployed source, service
   configuration, IAM or App Check settings. A new authorized readback must be
   compared independently for preview, draw and update callables.
3. **Authenticated operator acceptance:** fixture Auth and permissive Emulator
   Rules do not prove real Firebase Auth, App Check or revoked live sessions.
4. **Stable participant identity:** verify real participant IDs and ledger
   versions without assuming historical missing-player incidents share the
   synthetic shared-UID cause. No automatic old-winner migration.
5. **Coordinated revision switch:** actual three-callable switching is untested.
   Any separately authorized release plan must pause new draws, verify all three
   revisions are consistent, and require a fresh preview before resuming.
6. **Fallback safety:** once a participant-v1 ledger exists, use the reviewed
   compatible fallback rather than the captured old UID-only implementation.
   Otherwise prior winners could become eligible again. Preserve existing
   records and operation receipts; do not clear ledgers as a workaround.
7. **Broader bucket rollout:** writer coverage, My Events/Eventarc acceptance and
   controlled multi-court cutover/rollback remain separate gates. Raffle checks
   alone cannot authorize enabling bucket rooms.

Private source transfers and assembled archives remain outside the repository.
Only tests, digests and review documentation belong in this candidate. No upload,
merge, deployment, runtime enablement or live-data operation was done here.
