# Referee sync recovery

When an old whole-state write resolves false, the existing confirmation guard can continue rejecting new results before issuing a cloud request. The diagnostic in PR #679 establishes this condition; it does not establish the cause of the 10/31 incident.

This patch adds an explicit recovery action to the individual referee page. It does not remove guards, reset promises in the running page, replay pending actions, alter scoring, or implement storage sharding.

## User flow

1. Open 同步復原 and confirm 備份並重新載入. Cancellation performs no writes or reads.
2. Serialize the current in-memory tournament into a unique local backup scoped to the authenticated UID and room code. Read it back and verify exact bytes, then verify the latest-backup pointer. These keys are separate from the normal tournament cache.
3. Read the private room using existing `joinRoom(code, {serverOnly:true})`. Do not use a cached or public fallback. Validate the same immutable room ID and code, plus minimum state shape.
4. Cache that canonical snapshot with the existing local record/index writer. If any step fails, do not reload. Keep the original backup.
5. Only if account, room, permission and in-memory state still match the captured context, reload the browser. This starts fresh in-memory queues; the ordinary room initialization and subscription continue from the canonical cache. The referee must compare cloud-confirmed scores before acting again.
6. 匯出復原備份 downloads the original local snapshot, including uncertain scores, for review. It is not automatically imported or treated as a confirmed result.

Already in-flight server operations cannot be cancelled by reloading and may finish later; normal subscriptions and authoritative transactions still determine accepted scores. Recovery makes no promise that an uncertain operation failed. No automatic score replay is added.

## Boundaries

- Individual events only; existing authenticated tournament-operation permission is required. Team events retain the original reconnect flow.
- Scoring and confirmation entries reject interaction while recovery is active. Generic state writes and the automatic retry timer do not begin a new write during recovery. Other state changes cancel reload through the snapshot fingerprint check.
- Existing writes are not cancelled or declared successful. The failed gate remains intact until the page reloads; a read alone does not turn a rejected request into a successful write.
- Storage, server read and local cache steps have bounded waits. Account/room changes, quota errors, wrong room responses, unreadable backup, and local record/index failure stop navigation.
- No Functions, Rules, feature flags, points, XP, quotas or production room records are changed by recovery. Backups contain private local tournament data, remain on that device, and are scoped for export to the same UID/room.
- `index.html` loads the new helper before core and cache-busts the changed core asset.

## Validation

`node --test tests/referee-sync-recovery.test.cjs` checks backup readback, failure paths, context isolation, duplicate requests, timeout, server-only read, preservation of another court's fresh score, zero cloud writes and a fresh queue after reload.

`node tests/referee-sync-recovery.browser.cjs` runs eight isolated Chromium cases at widths 390/1280: historical failure, pending queue, quota failure and server-read failure. It uses actual localStorage, navigation reload and backup downloads, with actual core controls/callbacks and simulated cloud/auth/cache boundaries. It is not a full production/Firebase device acceptance test.

The normal repository validation and referee/registration regressions must pass before release. The change is prepared for review; it is not a claim that six-/twelve-court cloud capacity has been fixed or certified.
