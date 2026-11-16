# PR #811 live-source release overlay

Purpose: deploy the round-order correction to the exact active commitRefereeCommand source reported by the user, preserving all live diagnostics, authorization and unrelated functions.

Pinned production baseline:

- Project bxh-arena, asia-east1, function commitRefereeCommand, nodejs22.
- Revision commitrefereecommand-00007-bib.
- Source generation 1794716878951598, gcf-v2-sources-87261141693-asia-east1/commitRefereeCommand/function-source.zip.
- Live engine SHA-256 81dda03aae3ee16c0cb09f0acbf17e9ffaba80e52d02c751569a0b8ea2952a4d, exact match to engine/index.cjs at historical commit 46559a743041d5cb3bb380d124f764e31cc29456.

The six modified live functions exactly match those same functions at PR #811's original main baseline. The embedded payload replaces only those functions, adds two pure helpers and exports the round gate. The scoring-core change inserts a single guard after the existing bronze gate. The patched live engine intentionally retains its old generator, exports and other functions; it does not replace the whole engine with newer repository functionality. Its resulting SHA-256 is 0d7703606695bfd77cfb43ada72df7452d611367d833eba68e4be88225948116.

Default invocation `python3 release.py` only stages and verifies. `python3 release.py --deploy` also updates that existing function after all checks pass. No IAM, environment, scaling, timeout or trigger flags are supplied. Only engine/index.cjs and scoring-core.cjs may change. Original index.js, scoring-service, dependencies and all other source files remain byte-identical. Existing generated manifest provenance is retained; actual overlay hashes and revision are recorded separately in release-report.json outside the uploaded source.

Checks: current metadata matches the pinned source/revision, archive paths and size are safe, engine baseline and patched hashes match, the scoring anchor is unique, syntax checks pass, actual live pure modules pass pending/ready/paused/PASS versus in_progress round gating, existing score/fault handling, active-match preservation, and complete 24/128/320-player synthetic brackets. Another metadata read immediately before deployment rejects a concurrent release.

After deployment the script redownloads the exact newly deployed source generation, compares every staged original file, reruns the behavioral checks, verifies protected service configuration and confirms the new ready revision receives 100% of Cloud Run traffic. Only then it emits BACKEND_VERIFIED=true. It saves the original source and deployment metadata in a private local folder and records a rollback command; it does not automatically roll back another concurrent deployment.

Validation performed locally against reconstructed historical source with a mocked gcloud boundary: full staging/deployment/source-verification/traffic-verification path and fail-closed production-revision, engine-hash and scoring-anchor cases. This mock is not a live deployment. Run `python3 referee-seats/releases/round-dispatch-811/test_release.py` from a checkout containing the pinned historical commit to reproduce.

This is backend only. PR #811 frontend merge/publication remains separate, after the user returns the verified backend output. No live tournament scoring requests or production data writes are used for validation.
