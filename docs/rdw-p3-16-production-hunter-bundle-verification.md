# RDW P3-16 — Production Hunter bundle verification

Audited user-provided ZIP: `syncHunterLicenseV21-production.zip`

- Deployed source generation: `1792487233621570`
- ZIP SHA-256: `90c00efb537b216771f157b9ceff4cfaa11d6abb0d3a4aba6978b0600d779963`
- ZIP contains 17 entries, including `reader.cjs`, `evaluator.cjs`, `service.cjs`, `recovery-window.cjs`, and `vendor/*`.
- Local inspection verified all 15 file digests listed in `bundle-manifest.json` against the actual ZIP members: **15/15 match**.
- Verified `reader.cjs` exports `createReader({db})` and invokes `evaluateInTransaction({tx,uid})`.
- Verified reader returns `sourceScope: 'public-official-canonical-self-history-v1'`, a SHA-256 `sourceDigest`, and `overview.grade.tier`.
- The bundle's `service.cjs` contains permanent award logic. **Never call the grant service for RDW**.

## Integration release gates

1. Do not copy production ZIP blindly into public GitHub Pages assets. Vendor the audited reader/dependencies only in a dedicated private backend deployment package after reviewing its code and provenance.
2. Resolve each UID from canonical registrations. Guardian UID is not the child's player identity.
3. Use the read-only reader in a trusted server transaction and validate complete history, sourceScope, sourceDigest and current tier.
4. Seal an immutable tournament baseline and start state in a transaction; if unavailable, permit an explicitly authorized, auditable RDW-only PASS.
5. Benchmark 8/32/128/320 players and check Firestore transaction limits before production rollout.
6. Do not merge or deploy until Emulator and browser E2E cover the actual deployed handler.

Status: source integrity verified; **runtime service integration not yet implemented**. Production unchanged.
