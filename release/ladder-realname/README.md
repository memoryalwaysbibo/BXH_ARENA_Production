# Automatic ladder settlement real-name repair candidate

Draft only. No deployment, production reads/writes, historical backfill or leaderboard publication is performed by this package.

## Finding

The captured manual `settleLadderTournament` source reads `users/{resolved UID}` and assigns trimmed `profile.realName` (or `—`) to player, ledger and settlement results. The 2026-11-05 08:51 UTC readback records revision `settleladdertournament-00003-ker`, updateTime `2026-11-03T18:22:37.975781528Z` (2026-11-04 02:22 Taipei), source archive SHA-256 `920c82c930ff1771a4593d67f3ebe7b5e1bfb8594fa69ae1a707dac1c65d837e` and module SHA-256 `1aa2c25e7c74a5d8b4f131343e15b50d2519a97ec6bbcaaebb972ce43393d348`.

The independently captured `ladderAutoSettlement` source first builds a plan preferring `item.player.name`, then writes `row.playerName` before `profile.realName`. Executing the actual captured service with its actual scoring core reproduces replacement of an existing real name by the event nickname. This is a demonstrated code path, not proof of the writer responsible for any particular production account.

Evidence is pinned to Production integration commit `95f5352974c8625b542998d6a5d0cbfa4487dc64`: `tests/four-court-buckets/settlement/fixtures/10/` and `release/buckets/integration/live-priority-writers-20261105.json`. The auto source archive pin is `81063c0fc575378a75639e625f93c74e7e0daaf3aebf4baf1f4b9c2645d1c5c9`; module SHA-256 `4b7944b6c239aff6bedf7cc1ddd16e8be915d7abdbcbd2e1c61ccd5454e0a258`; core SHA-256 `9ba05fa0548bd6cb52225c18f8e52d078c70e10be3e6ef7c28a2e676abbf32a6`. These pins identify reviewed captures, not a fresh live readback from this task.

## Candidate

`patch.cjs` accepts only that exact auto module hash. Three narrow edits resolve the name from the already transaction-read profile linked by `row.uid`, use it for new player/ledger/archive writes, and use it in the archived result when an existing ledger prevents another credit. Existing ledgers and prior player documents are not rewritten on replay. Missing/invalid real names use the same neutral `—` fallback as the captured manual writer. UID identity, eligibility, scoring, triggers, runtime/configuration and dependencies remain unchanged.

Run `node --test release/ladder-realname/test.cjs` from repository root. Fourteen local tests pass using the actual captured handler/core and an in-memory transaction adapter. This is not Firestore Emulator, Auth/App Check, Eventarc, live race or mobile acceptance. Test data is synthetic.

## Remaining release work

Obtain a fresh independent `ladderAutoSettlement` source/configuration capture and compare this module and its dependency closure before composing a source-only release. Inspect the current public ladder publisher and every other `ladderPlayers.playerName` writer; this package does not establish that scheduled publication can or cannot overwrite names. Verify Firestore/native behavior and CI. Any deployment must preserve source dependencies, configuration and trigger settings and verify readback. The historical affected names require a separate bounded preview keyed by UID, preserving every numeric and identity field; never settle old events again to repair a display name.

The user's recollection of a Tuesday change is consistent with the manual-source behavior but its exact Tuesday implementation/deployment history remains unverified. Do not claim the new candidate is live or that existing displayed names have been repaired.
