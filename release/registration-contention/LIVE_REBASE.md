# Rebase onto captured deployed familyRegistration

The user's capture has been materialized and verified locally. Both the inner source ZIP SHA-256 and canonical full serviceConfig SHA-256 match its report. This is evidence at capture time, not a fresh cloud readback or production acceptance.

- Source generation: 1793592677411039
- Function updateTime: 2026-11-02T04:12:41.393898651Z
- Source archive SHA-256: 87362c9e7ffd86109338781d05f3e2dca95bcdfbee5f8646fd9a242843d299ec
- Service config SHA-256: 44cd1d6b381b34b12a25bdddfb1daae97365c620d47a8bb722629e0e26e4b117
- Runtime nodejs22; firebase-admin 14.4.0; firebase-functions 7.3.2. Captured source has no package lockfile; no claim about exact deployed transitive dependency versions is made.
- Captured service: timeout 60 seconds, memory 256Mi, CPU 1, max instances 5, request concurrency 80 per instance. Preserve settings; no capacity configuration change is proposed.

The live handler differs from the original October fixture: it ALREADY uses a read-only preview, initial getAll and reuse of the self-registration snapshot. The other eleven captured handler dependencies are byte-identical. Historical old/new results in earlier reports must not be attributed to this newer live handler.

The candidate is now derived from this live handler. Its getAll/read-only/self-snapshot reuse are preserved exactly. The only business-handler additions are module-level admission, same-operation sharing and refreshed transactional clocks. The new admission module remains a per-process limiter; database transactions stay authoritative across instances.

The actual family.js wrapper is pinned in the source fixture. It creates the registration handler once per module and exports onCall with region asia-east1 / timeout 60 / maxInstances 5. The captured index re-exports family.js; its whole-file hash is retained. Wrapper tests execute the actual captured family.js with the real firebase-functions HttpsError but synthetic onCall/project/non-registration services. Recovery integration now passes backend errors through that wrapper's mapping and simulated client error conversion. Queue errors map to generic internal errors in this unchanged wrapper, and the frontend must retain uncertainty; this is explicitly checked. This is not a live HTTP callable/Auth/App Check test.

The benchmark baseline now uses live-source-20261105.json. Candidate comparison uses one and FIVE independent module schedulers, matching the observed maximum instance count as a model only. CI reruns real Emulator recovery, 40-client and two-round 100-client comparisons on this source. This is not five deployed instances and excludes browser polling, weak network and cloud scaling latency. Prior latency results remain historical.

compose_source.py checks the exact captured archive, generation, function identity, configuration and source file hashes; creates a new source ZIP; and proves all files except family-registration.js and the newly added registration-admission.cjs are byte-identical. It performs no cloud call and refuses an existing output directory. The full configuration stays outside repository fixtures.

Remaining release gates: rerun exact-head CI, current live source/config drift check immediately before publishing, authenticated cloud/browser acceptance with the existing 60-second timeout and 80-request concurrency, then a single-entrypoint source-only deployment preserving all config plus readback/rollback verification. No deployment occurred in this rebase.
