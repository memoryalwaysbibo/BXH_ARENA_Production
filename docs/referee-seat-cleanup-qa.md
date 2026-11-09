# Referee notice and deleted-room lifecycle candidate

Draft validation only. Do not merge or deploy as part of this test run. No production credentials, real users, real room codes, archived match data, or screenshots are used by these tests.

## Changes

- Seed historical terminal requests silently only from a current authoritative snapshot. Record each accepted snapshot synchronously so same-tick pending-to-terminal transitions are not lost. Ignore stale revisions before seeding the baseline.
- On confirmed deletion, remove active room state and only that room's displayed/queued referee notices. Invalidate late callbacks. Retain complete local archival history.
- Ignore cached absence and pending writes. Subscribe to metadata transitions so server confirmation is observed.
- Serialize local archive/index updates and current-ID writes; preserve later room selections during asynchronous persistence.

## Tests

`node --test tests/referee-seat-cleanup/regression.test.cjs` runs 19 synthetic tests wired to the actual seat, primary subscription, cleanup, storage/index, and toast functions.

`NODE_PATH=/tmp/referee-cleanup-tests/node_modules node tests/referee-seat-cleanup/browser.test.cjs` runs 13 checks in each of three Chromium viewport sizes, including full module syntax, actual cleanup functions, historical/live notices, stale revisions, and scoped DOM removal. The browser server is loopback-only and test page requests to other origins are blocked.

The fixture extracts the lifecycle functions from the modified core rather than maintaining a separate replacement implementation. It uses a synthetic DOM host and mocked data providers. This is not a full-app Firebase end-to-end test, real-device Safari acceptance, or proof of production deletion state. Existing repository referee/community/management CI should also be reviewed.

## Release boundary

This workflow has read-only repository permissions and no deployment, cloud login, secrets, or merge step. Existing production Pages deployment requires successful validation caused by a push to main; pull-request validation does not meet that condition. All deployment workflows and runtime version/entrypoint files are unchanged by this candidate.
