# RDW P3-19 — Audited deployed Hunter Reader integration test

Audited source: `syncHunterLicenseV21-production.zip` generation `1792487233621570`, SHA-256 `90c00efb537b216771f157b9ceff4cfaa11d6abb0d3a4aba6978b0600d779963`.

## Local verified dry-run observation

The archived `reader.cjs` was extracted and invoked as `createReader({db})({tx,uid:'fixtureUid'})` using an in-memory Firestore read fixture with **zero public tournaments**. It completed without network access or writes, returned `overview.grade.tier='ungraded'`, `complete=true`, `unresolvedIdentities=0`, `sourceScope='public-official-canonical-self-history-v1'`, and a 64-character source digest. This tests only an empty-history case; it does not validate ranking with completed tournament evidence.

## Reproducible verification

1. Obtain the original ZIP from the previously verified private Cloud Function source (do not upload its contents to public frontend assets).
2. Verify ZIP SHA-256 against the fixed value above, then extract it into a private temporary directory.
3. Run `RDW_HUNTER_BUNDLE_ROOT=/absolute/path/to/extracted-source node --test tests/rdw-production-hunter-reader-integration.test.cjs`.
4. Ensure the test **executes** rather than reports a skip. Regular CI intentionally skips this production-source test when no private artifact is provisioned; a green CI result is **not** proof the private integration passed.
5. Before production, exercise an official completed-room fixture with realistic UID links and a family-account participant; check both computed tier and failure-closed behavior.

## Blockers

- No backend callable has been deployed or wired to the tournament-start action.
- No production record or immutable tournament snapshot has been written by this work.
- This opt-in fixture is not a genuine Firestore Emulator test; tests against the Emulator and large-roster capacity remain necessary.
- Keep PR #557 draft, feature disabled, production untouched.
