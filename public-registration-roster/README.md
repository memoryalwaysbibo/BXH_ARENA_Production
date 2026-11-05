# Public registration roster synchronization — candidate, not deployed

A public event can have `confirmedCount=60` while `bracketView.players` still has 53 entries. Previously the lobby preferred that partial list's length and showed 53.

The candidate adds two asynchronous Firestore triggers: `syncPublicRegistrationRoster` watches individual registration documents, and `refreshPublicRegistrationRoster` watches the private room. Both read the latest records and publish a **separate**, names-only `publicRegistrationRoster` field. The private runtime, counters, registration records, player IDs, QR fences, and bracket are not rewritten. The write transaction only reads/locks the public document; private room reads happen before it. Source `updateTime` must still match before publication; stale work is rejected for Eventarc retry. Identical output is a no-op, and each trigger is limited to one active request / one instance. This reduces additional write work but does not demonstrate a live latency or throughput improvement. Publishing the overlay still briefly locks the shared public document; measure contention alongside registration PR #730 before wider activation.

The existing public snapshot feed refreshes the lobby automatically. An overlay is used only when its counters, source timestamp and original visible player list still match. Partial or cancelled stale lists display the recorded confirmed count and a synchronization message. Existing live/drawn rosters retain their original IDs. Newly projected people whose IDs are not yet in the runtime are shown as names without an invalid player-card link.

Supported initially: public, individual, registration-enabled rooms before drawing, with public registration visibility and consistent confirmed/waitlist records. Children use the existing stable family identity projector; manual onsite players and attendance are retained. Public name selection excludes the private real-name fallback. **Not applied to** selection lotteries, server-owned onsite waitlist draws, bucket scoring, team rooms, hidden registration lists, started/drawn/closed-by-system rooms or cancelled events. Those services retain their existing authoritative projections. Such rooms still require a separate review; this candidate is not a universal synchronization claim.

## Build and validation

```
node --test public-registration-roster/roster.test.cjs tests/lobby-stable-updates.test.cjs tests/lobby-ordering.test.cjs tests/family-roster-checkin.test.cjs
python3 public-registration-roster/build.py --output /tmp/bxh-public-roster-source
```

The PR workflow also runs real Firestore transactions in `demo-qr-checkin` at `127.0.0.1:8091`. Its 100 overlapping events exercise duplicate-event convergence; **they are not 100 real registration requests or a latency benchmark**.

## Production preflight still required

1. Read current W5WR86 room/public counters, actual confirmed/waitlist record counts, modes and synchronization flags. Do not infer which number is correct from the screenshots. Inspect the deployed existing `syncRegistrationRoster` configuration/source and why it skipped or failed. The new projection does not repair inconsistent counters.
2. Run emulator and CI, then deploy only the two new functions from the generated standalone source. Do not deploy the repository's entire legacy Functions bundle or replace any existing registration/referee function. The source builder performs no deployment or cloud writes.
3. Initially set `systemConfig/publicRegistrationRosterSync` to `{enabled:true,roomCodes:["BXH-W5WR86"]}` after verifying that the room is supported. Missing configuration is disabled. Create the allowlist before activation. `enabled:false` is the emergency stop. Removing the overlay field restores the legacy view.
4. Existing rooms need one initial catch-up: call the packaged `createSync(db)(code)` once from an authorized Admin SDK operator after reviewing the room, or wait for the next legitimate room/registration change. Do not fabricate registrations to trigger it.
5. Deploy the frontend after verifying public projection readback; verify a still-open player screen updates after signup, cancellation and promotion, preserves scroll/folds, and does not expose phone/email/account fields. Check #730 registration contention with the extra public-document write.

No production function, flag, room, registration or frontend has been changed by creating this candidate.
