# Sequential single-elimination court dispatch

Reported room: BXH-Z85SEZ. Screenshots show court 1 waiting while match 47 has a pair, then match 52 playing with 51 shown as next. No production room history was read, so this is a repository reproduction, not a confirmed replay of the live incident.

## Change

Ordinary single-elimination current/next selection uses execution sequence instead of promoting a larger old next pointer. Authoritative rebuilds compare eligible queued pairs across courts before starting work, including matches displayed as another court's next. Route changes increment dispatchRevision and clear old references. All next pointers are recomputed after routing so later idle courts cannot leave stale forecasts on earlier courts.

Cross-court routing is enabled only through the authoritative rebuild path, not ordinary client propagation. Actual in-progress play (including zero-score play), paused work, offline/confirmed/scored work, forced exits, retiring courts, PASS dependencies and explicit manual routing remain protected. Both endpoints of an explicit swap receive the existing dispatchPriorityAt protection so the displaced source is not stolen by automatic filling. Double elimination and round robin retain existing next-pointer behavior. The prior-round gate and bronze-before-final gate still apply.

The previous expansion tests explicitly required a larger displayed next to survive smaller eligible matches. Those expectations now check the requested sequential behavior. Full 24/128/320-player synthetic completion tests vary court completion order and check that newly started matches do not overtake a smaller same-round waiting pair.

## Notification behavior and limits

A displayed next pointer is now a forecast, not a routing lock for ordinary single elimination. The shared engine has no authoritative prepare-notification records and does not distinguish a forecast that was already notified. A forecast may change court or order after earlier eligible work appears. Existing preparation notifications are not retracted or automatically resent by this patch; the referee must check the refreshed next/current card and notify again if needed. No new call-service reads, Firestore collections, subscriptions or extra transactions are added.

This is local deterministic/in-memory verification, not a production room replay, browser acceptance session or Firestore Emulator concurrency test. The frontend cache key and generated server engine are included. Both frontend and backend engine must be deployed for production behavior; merging or frontend publication alone does not update deployed Cloud Functions. No live room or production deployment was modified during development.

## Validation

- Sequential dispatch: 16 browser/server cases, including 51 before stale 52, unstarted stale current 52, idle court 1 taking queued 47, current play preservation, distinct ordered fills, PASS/offline/manual protection and non-authoritative isolation.
- Critical regression suite: 42 groups pass.
- Referee core/service/cloud/scoring/dispatch/bridge, bucket dispatch, prepare UI and tournament completion: 123 tests pass.
- Production frontend verification, JavaScript syntax and git diff checks pass.
