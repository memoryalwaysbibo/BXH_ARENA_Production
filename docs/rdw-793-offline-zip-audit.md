# RDW #793 — Hunter License 2.1 offline ZIP audit

**Non-deploying, read-only candidate inspection.** This tool checks a Cloud Functions source ZIP supplied by an authorized operator. It does not download the archive, inspect production Firestore, verify live deployment provenance, or authorize a release.

## Prerequisites
- Node.js 22 and the system `unzip` utility.
- An independently collected `syncHunterLicenseV21` deployed Functions source archive, with its exact SHA-256 recorded separately.
- Current deployment metadata: project, region, function name, source bucket/object/generation, runtime revision and collection time. Do not use a historical ZIP as a substitute.

## Invocation
```bash
node scripts/lib/rdw-hunter-zip-audit.cjs /path/to/function-source.zip <independently-confirmed-64-char-sha256>
```
Do not commit the ZIP, user data, credentials or production runtime identifiers into the public frontend repository.

The tool verifies the provided archive's SHA-256, ZIP integrity, duplicate/path-traversal entries, and the pinned 12 Hunter source blobs from the backend candidate repository. On mismatch it exits nonzero. On match it returns `candidateVerified:true`, **always** `releaseApproved:false` and `deploymentGenerationVerified:false`.

## What still blocks release after a matching ZIP
1. Independently verify the exact source ZIP's bucket/object/generation against the **current deployed** `syncHunterLicenseV21` revision.
2. Inspect the complete transitive runtime dependencies, Firebase Rules, server account IAM and grant-service boundaries.
3. Execute the real imported Reader in Firestore Emulator against trusted fixture cases, with before/after comparisons for `users/{uid}/hunterLicense/highest`, `hunterLicenseAwards/{awardId}`, XP and V1 ladder data.
4. Implement a trusted server-sealed immutable pre-event snapshot; an in-memory candidate match is not a saved snapshot.
5. Complete PR CI, review and explicit owner authorization. Keep the runtime feature OFF. **Never merge or deploy merely because the ZIP audit matches.**
