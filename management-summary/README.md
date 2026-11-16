# Management summary candidate

The management browser requests exactly five rows per explicit action. Opening
the tab, clicking a status, submitting search or refreshing replaces the first
page. “Load five more” sends the current cursor once; rendering and elapsed time
never start another page. The owner tabs are replaced by Open / Upcoming / Closed.
Full events stay under Open, because waitlist registration may still be possible.
Drafts, all statuses and administrator-only community rooms remain in secondary
controls. Search covers the name, room code and location of the authorized scope,
including events not previously loaded. Management defaults to All with tabs All / Registration open / Live / Done / Registration closed.
Upcoming and Draft remain secondary filters. Legacy `closed` queries still work.
Registration closed excludes live/settling/completed rooms; Live includes settling.
The latest successfully managed room (`pinCode`) ranks first within the authorized,
searched category, then live rooms, then event date descending and stable room code.
Updates to counts or `updatedAt` do not shuffle same-day rooms. Pinning cannot bypass
permissions, room type, search or filters; the pin is included in the cursor scope.
Cards collapse their metadata, poster, roster and secondary actions into Details.

The frontend stores only the last private management code, mode, tab and station in
account/mode-scoped localStorage. Public viewing, history viewing and failed entry
do not replace it. On session restoration the frontend uses the existing private
join API with `serverOnly` to reauthorize and read fresh state before subscribing;
it does not replay any score submission or restore a cached score snapshot.
A lost seat returns to live view; unavailable/deleted rooms return to management
with an explicit retry shortcut. The latest-room pointer is local to the device.

This change requires the updated callable to be deployed and verified **before**
merging/publishing the frontend. The new filters and global pinning cannot be
implemented by sorting just the five already-loaded browser rows.

`listManagementTournamentSummaries` is an independent read-only callable codebase.
It checks the current user, organization/contract or effective activity-staff
invitation inside a Firestore read-only transaction. It uses Firestore `select()`
for scope-wide metadata. After pagination it preserves the deployed correction
that reads only those five individual rooms' runtime `data` to count occupied
player slots. It never returns runtime snapshots, bracket data or private player
fields. It returns five sanitized display rows, counts and a query-scoped cursor. It never writes, repairs or grants access.
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
