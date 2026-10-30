# Management summary candidate

The management browser requests exactly five rows per explicit action. Opening
the tab, clicking a status, submitting search or refreshing replaces the first
page. “Load five more” sends the current cursor once; rendering and elapsed time
never start another page. The owner tabs are replaced by Open / Upcoming / Closed.
Full events stay under Open, because waitlist registration may still be possible.
Drafts, all statuses and administrator-only community rooms remain in secondary
controls. Search covers the name, room code and location of the authorized scope,
including events not previously loaded. Default sorting is event date descending,
then update time descending, with a stable code tie-breaker.

`listManagementTournamentSummaries` is an independent read-only callable codebase.
It checks the current user, organization/contract or effective activity-staff
invitation inside a Firestore read-only transaction. It uses Firestore `select()`
to read only a field allowlist; it never fetches runtime `data`, `bracketView`,
registration subcollections, matches or scores. It returns five sanitized display
rows, counts and a query-scoped cursor. It never writes, repairs or grants access.
Opening a room or explicitly expanding its roster continues to use the existing
authorized detail APIs.

This version reads metadata for the authorized scope on the server to support
substring search, complete category counts, sorting and legacy records without
requiring new indexes. Each browser response is limited to five summaries, but
this does **not** mean only five Firestore metadata documents are billed per call.
There is no hidden full-document/client fallback and no background page scan.
For much larger scopes, a dedicated indexed summary/search store is follow-up work.

## Release order

Mirror the backend package into `BXH_ARENA_Functions_Production/release/management-summary`.
Deploy only this codebase after backend tests and explicit release authorization:

```
firebase deploy --project bxh-arena --config release/management-summary/firebase.json --only functions:management-summary --non-interactive
```

Verify the Node 22 callable is ACTIVE and rejects unauthenticated requests.
Complete authenticated administrator/staff/tester/partner/activity-staff smoke
checks before publishing the frontend. Never deploy historical Rules or other
codebases. The frontend depends on the new callable and must remain unmerged until
the backend is verified. No production rollout is performed merely by opening PRs.

## Verification

```
node --test management-summary/service.test.cjs tests/management-loading.test.cjs tests/partner-workspace-access.test.cjs
firebase emulators:exec --project demo-bxh-management-summary --config management-summary/firebase.emulator.json --only firestore "node --test management-summary/emulator.test.cjs"
```

Browser acceptance covers five-row idle behavior, explicit expansion, failed-page
retry, backend search for unloaded events, status switching, Enter search, stale
responses and logged-out privacy on desktop Chromium, iPhone WebKit and Android.
