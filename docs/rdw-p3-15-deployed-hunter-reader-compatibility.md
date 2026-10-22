# RDW P3-15 — Deployed Hunter 2.1 reader compatibility findings

Source inspected: user-provided production source ZIP for `syncHunterLicenseV21`, Cloud Functions Gen 2 source generation `1792487233621570`, archive SHA-256 `90c00efb537b216771f157b9ceff4cfaa11d6abb0d3a4aba6978b0600d779963`.

## Verified code contracts

- `reader.cjs` exports `createReader({db})`, returning an async `evaluateInTransaction({tx,uid})` function.
- Its result includes `uid`, `version`, `complete`, `unresolvedIdentities`, `sourceDigest`, `overview`, and `sourceScope`. `overview.grade.tier` is the current candidate tier; `overview.highest` is distinct.
- `service.cjs` calls the reader inside a Firestore transaction and separately writes `users/{uid}/hunterLicense/highest` and award audits on promotion. RDW must call **reader only**, never the grant service.
- The deployed reader reads canonical registration/tournament evidence, and may report incomplete evidence. Its `sourceDigest` identifies input provenance, but is not itself a pre-match snapshot.

## Integration corrections required

1. Bundle the **verified deployed reader and all relative vendor dependencies** into the new RDW backend codebase, or explicitly version and audit a shared immutable package. The P3-14 injected `createReader` is a seam only, not a wired import.
2. The bridge must check `sourceScope`, `sourceDigest` (64 lowercase hex), `complete`, `unresolvedIdentities`, `overview.grade.tier`, and server timestamp before sealing.
3. The P3-14 check `user.active===true` is not grounded in the deployed reader contract; verify account eligibility against canonical user records before treating it as authoritative.
4. Read-only evaluation may be expensive for large events. Benchmark 8/32/128/320-person snapshots and avoid an unbounded Firestore transaction.
5. Avoid writing current tier as a durable authoritative grade outside the event snapshot; preserve highest-tier award immutability.
6. Keep RDW disabled until the backend start transaction and deployed reader are genuinely connected and verified in Emulator.

No deployment, migration or production writes performed.
