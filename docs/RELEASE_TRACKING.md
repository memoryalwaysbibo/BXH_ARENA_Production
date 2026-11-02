# Production artifact identity

`version.json` remains the existing application version/build label. It is not a reliable date of the latest deployed commit: later patches can preserve that label. Do not invent a new version or call a timestamp a successful publication before Pages finishes.

The validated Pages workflow now generates `release.json` inside the sanitized public staging directory, immediately before upload. No generated file is committed back to main. The record contains the checked-out validated source SHA, validation run ID, deployment run ID/attempt, artifact creation timestamp in UTC, a canonical Actions link, the existing version labels and SHA-256 fingerprints of version.json, index.html, Core and cloud runtime.

The generator rejects a source/checkout mismatch, another repository, malformed run identity, incomplete runtime, invalid version labels/time or an existing manifest. The existing private-data-free artifact builder and closed referee flags remain required.

The post-deploy check compares served release.json and all previously checked runtime files against the actual staging artifact. Existing missing-private-path checks remain in place. A release record identifies the artifact being served; it does not prove every feature is enabled or that end-to-end production acceptance passed.

For a release investigation:

1. Read `https://arena.bxh.com.tw/release.json` with a fresh request and retain its sourceCommit and deploymentRunUrl.
2. Check that exact run/attempt and its executed deployment and public readback steps. Skipped jobs do not prove deployment. Use the step timestamps for actual publication/readback times; artifactCreatedAt is earlier and is deliberately not named deployedAt.
3. Compare selected served-file SHA-256 values to the manifest. Match the actual source SHA, rather than the date in the legacy build label.
4. Check backend release, feature flags and functional acceptance separately.

The file will exist only after this change is merged and a validated main deployment actually succeeds. This PR alone does not publish it. Browser/application UI remains unchanged.
