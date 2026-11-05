# Registration 730 release operator

This tool is specific to projects/bxh-arena/locations/asia-east1/functions/familyRegistration. The backend source is the candidate verified by CI on ae0711f08e1db9ed1d0aad09e3fed81db7e490e6, rebased onto captured generation 1793592677411039. Source differs in only family-registration.js and the new registration-admission.cjs; all other 102 files are preserved.

The release bundle contains the original/candidate source ZIPs, captured complete metadata, composition manifest and release_registration.py. Complete metadata/environment values remain private in the local bundle and journals, not repository commits or console output. No dependency installation or Node version change is needed in Cloud Shell.

Run --check first (the default):

```
python3 release_registration.py --check
```

It validates local hashes and the exact live function identity, active state, build configuration, service configuration including revision and original generation-pinned source archive. It performs GETs only. A matching report from collect_live_registration.py does not skip this immediate check.

After the relevant checks/acceptance have passed, --apply explicitly changes the code:

```
python3 release_registration.py --apply
```

It obtains an upload URL, sends the ZIP without Authorization on the signed PUT, re-reads metadata immediately before submission, then PATCHes only buildConfig.source on this one function. It never deploys other exports, changes Rules, writes registration data or deliberately changes service configuration. Since the API has no source compare-and-swap precondition here, the second metadata read reduces but cannot eliminate cross-operator races. Avoid concurrent work on this same function; unexpected state/source/config causes a stop.

The tool writes a private local journal (directory 0700, metadata 0600) and prints its path. A verified DEPLOYED result requires ACTIVE state, exact candidate source file hashes, preserved labels/build settings/service config, excluding only normal source/build provenance and generated revision changes. It does not establish Firebase client/Auth/App Check or load acceptance; complete that controlled verification separately.

If it reports a pending/unconfirmed operation, use the printed journal:

```
python3 release_registration.py --resume /path/to/printed-journal
```

Resume polls the existing operation or checks for an already-deployed candidate; it never re-submits a PATCH. A source mismatch after an unconfirmed submission remains unresolved and requires inspection. Completed journals refuse to adopt a later external revision.

To restore source after a verified deployment:

```
python3 release_registration.py --rollback /path/to/printed-journal
```

Rollback refuses any metadata change since the verified deployment and proves current candidate contents before re-uploading the original ZIP. It patches source only and verifies original file hashes/config after completion. It is not automatic on failure, does not modify existing registration data and cannot undo effects of already-executed requests. If someone else has updated this function, inspect/rebase rather than force rollback.

Fifteen local synthetic-API tests pass, covering check-only behavior, package drift, source/config/revision drift, changes during upload, exact source-only PATCH, credential-free signed PUT, apply/readback/rollback, lost PATCH response without duplicate submission, operation-pending resume, project number aliases, rejected rollback after external changes and diagnostic preservation. These tests do not execute cloud mutations or demonstrate live API success.

The backend-specific CI passed; the broader frontend workflow was still running while preparing this operator. Keep live authenticated cloud/browser acceptance and current CI status explicit before deployment. No live function was updated by creating or testing this package.
