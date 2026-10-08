# Safe court retirement validation

Implementation branch: fix/safe-court-retirement.

Court count changes retain current matches on retiring courts, stop new dispatch there, move waiting matches to retained courts, and persist the retirement plan in tournament state. Authorized takeover preserves recorded scores and logs and increments the dispatch revision. Offline pending matches cannot be transferred until synced.

Verified:
- Unit coverage: 12 → 8 → 1, expansion, stale configuration, stale dispatch, offline hold, PASS dependencies, serialized restoration, live scores and takeover.
- Critical regression suite: 15 suites passed.
- Production frontend invariant checker passed.
- Firestore/Auth emulator browser test: 320-player published tournament, 12 → 8, page reload, preserved 3-point score, takeover onto a busy retained court without replacing its current match, and completion of the other draining courts. No production Firebase requests occurred.

Run the browser test:

```sh
firebase emulators:exec --only auth,firestore --project demo-bxh-arena-e2e --config tests/e2e/firebase.json "npx playwright test --config=playwright.court-retirement.config.cjs"
```

An optional BXH_FIREBASE_SDK_CACHE directory can provide the exact Firebase 10.13.0 JavaScript modules for offline CDN routing.

Release limitations:
- Not merged or deployed.
- Twelve simultaneously connected referee devices and the full 320-match cloud schedule have not been verified.
- The staged v13.40.10 rules patch activates `courtLifecycleEpoch=1` on the first retirement/exit and requires every later browser JSON write to advance `courtLifecycleWriteSeq`. Older open tabs lack this write protocol and receive `permission-denied`. The patched rules and matching frontend must be deployed together before retirement/exit is enabled.
- Team/community-specific settings paths require separate integration and validation.
- Scores never uploaded from an offline or failed device cannot be recovered from cloud state. Pending local sync must be resolved before takeover.

## Emergency exit button

Each individual referee scoreboard has a confirmed “強制退場” action. Assigned referees can exit permitted courts; managers can reopen courts and claim detached matches. The operation reads the latest server state and rejects a changed current match or dispatch version rather than detaching a different match silently.

Exit clears the court's current/next pointers and lock fields, removes duplicate references to its current match, pauses and detaches unfinished work (station 0), retains uploaded scores/logs and completed results, and invalidates queued commands. The court stays closed across reloads. Detached matches are explicitly listed for takeover; reopening does not automatically bind them again. Exiting the last court keeps the match pending rather than deleting it. The emergency action bypasses the normal whole-state write queue and releases its UI busy flag after 15 seconds without an acknowledgement; a timed-out transaction may still commit, so reread before retrying.

Browser emulator validation passed with 320 players: scored 3 points, forced court 3 to exit, read the detached match and cleared references from Firestore, rejected old-device scoring, reloaded, claimed the match on busy court 2 without replacing its live match, and reopened court 3 without restoring the old binding.

The deployed call and enchantment services have separate server state. A source-verified server guard is staged separately from this frontend branch; the frontend alone must not be released as a complete all-service exit. The lifecycle rules patch is also staged and not deployed.

Backend source check: the Production bootstrap tree at e35674736011b6b52c4d80c1e6c105a07fa96d27 has no deployed court-call/enchantment implementation. Deploy repository 025ec9de2934c976395107ad7ae7d4bd6ca94184 carries beta-court-call migration sources; its functions-source.zip (blob 2349494562f18699458681f156b9c4f8d2e95a51) does not include either current Production service implementation. Do not substitute Beta source for a Production cancellation patch. A verified current runtime source snapshot is required to finish cancellation integration.

## Backend integration gate

On 2026-10-07, the deployed `courtCallService` and `courtCallPushService` source ZIPs were compared byte for byte after extraction and matched. `enchantmentService` has a separate, newer snapshot; its bundled copy of the call service is different and must not overwrite the running call service. The deployed call service stores active calls in `courtCalls/{code}.calls[matchId]`. Its `respond` and PASS approval path checks call sequence and completion but does not check the court exit marker. The enchantment service checks current assignment at `start` only, leaving subsequent draw, reveal, score, fault, undo and confirm operations exposed after a detachment.

The staged backend guard binds call/prepare and enchantment ledgers to the tournament match dispatch revision and court. Exit advances the revision, so list/notify/respond/approve/prepare/delayed push and enchantment get/draw/reveal/score/fault/undo/confirm reject the prior session. A draining court may finish its current match. After takeover, a fresh referee notification or explicit enchanted start creates a new binding; confirmed score/history remain intact. Already handed-off FCM notifications cannot be recalled from a device.

The supplied Production Firestore Rules v13.40.10 are now the base for a staged rules patch. It leaves untouched rooms on their legacy write path. First retirement/exit activates a top-level epoch and write sequence; later private JSON updates must advance that sequence and carry the epoch, and public mirror rewrites require an accompanying private advancement in the same atomic write. The frontend transaction paths implement this protocol. Firestore/Auth emulator compilation and a 320-player browser run passed with these rules: legacy private/public writes after activation received `permission-denied`, while resize, scoring, exit, reload, claim and reopen succeeded. This protects against older unmodified tabs; an authorized client deliberately forging matching revisions is beyond this protocol's threat model. Deploy and verify the rules, frontend and both patched service sources together before Production use.

Validation gate: create an active call and enchantment session, exit the court while a score is pending, then race an old referee, player response, PASS approval, delayed push, offline score, and new court claim. Verify old operations fail; uploaded score/logs survive; the other 11 courts keep progressing; reload and reactivation do not revive stale calls. Run against the verified current Production service source in emulators before staging release.
