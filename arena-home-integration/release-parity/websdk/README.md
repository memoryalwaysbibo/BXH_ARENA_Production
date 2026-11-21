# Homepage R2 real Web SDK cold / one-card acceptance candidate

One Playwright 1.55.0 Chromium test; pinned Firebase Web SDK 10.13.0. It has
been discovered by Playwright; it has **not** been browser-executed on this
environment. The prior denied local Chromium path was not retried.

The two fresh guest browser contexts read identical 20-room, 128-participant
synthetic fixtures, with original side using the pinned published
`where('visibility','==','public')` Watch shape and summary side using the
existing R2 controller to read first/version, then one delta. The minimal DOM
checks all counts and an unchanged card node on the 128→129 update. This is
transport/controller validation, not the entire ARENA UI or auth. On-demand
catalog read is checked against the lab-specific default-deny rules after the
measurement; all fixtures are disposable and no production data is used.

The measured gate is Chrome DevTools decoded Firestore *response body* chunk
bytes per phase (including data from a Listen request which opened before the
one-card update), no external SDK/script bytes. The completed Playwright HTTP
size subset is separate and may exclude open streams. No TCP/TLS costs,
complete encoded transfers, time/latency claims, or production billing.
Unrecognized path data, missing instrumentation, or zero measured bytes fail
rather than being labeled savings. Both fresh/updated view parity and body
reduction must pass on the same attempt to claim the synthetic result.

## Running in an approved isolated runner

From the workspace/repository root, with review-approved Playwright v1.55.0,
Chromium and pinned Firebase CLI/JDK already available:

```sh
node --test arena-home-integration/release-parity/websdk/wire.test.cjs
npx --no-install firebase emulators:exec --only firestore \
  --project demo-bxh-arena-r2-websdk \
  --config arena-home-integration/release-parity/websdk/firebase.json \
  'npx --no-install playwright test --config=arena-home-integration/release-parity/websdk/playwright.config.cjs'
```

The second dedicated emulator uses 8188 (Firestore), 4588 (hub), 4688 (logging),
loopback only. All non-lab routes except exact pinned gstatic SDK assets are
blocked in browser before requests are continued. No service account files,
Auth credentials, or cloud production rules. The unique CI lab head
`lab/r2-home-websdk-cold-20261121` must be an existing approved branch design;
new production config, branch, and workflow changes are not included here.
For any hosted branch candidate, verify no overlap with an outer Firebase hub,
append this invocation after all original E2E, move only required fixture files
onto the temporary validation-only branch, and verify head and trigger before
any remote step. No hosted actions were launched.
