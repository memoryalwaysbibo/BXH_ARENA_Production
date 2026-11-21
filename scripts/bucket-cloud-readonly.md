# Cloud Shell independent bucket provenance

This is a draft operational alternative, not a configured cloud connection.
No cloud identity, IAM policy, repository variable or production resource is
changed by this PR. The workflow has no deployment or room activation path.

## Already available

PR validation runs eight offline tests without cloud authorization. Existing
bucket native SDK/Emulator validation remains in PR719/734. A trusted home
computer can run the same Python capture using its installed gcloud CLI:

```sh
gcloud auth login
gcloud config set project bxh-arena
python3 -B scripts/bucket-raffle-readonly.py
```

Login happens through Google's browser flow; do not send passwords, access tokens
or credential JSON to chat. Keep the generated source ZIP private. This route
does not require Cloud Shell or the GitHub identity setup below.

## One-time GitHub setup through Google Cloud Console

An administrator must configure the following before a live GitHub read can run.
This setup can be performed through the web Console, without Cloud Shell.

1. Create a dedicated service account in bxh-arena for source provenance reads.
   Grant only function metadata GET (`cloudfunctions.functions.get`) for the three
   raffle functions in asia-east1 and object GET (`storage.objects.get`) for their
   source archive objects. Scope permissions to those functions/source buckets or
   narrower objects using supported IAM bindings/conditions. Do not give this
   account Firestore access, write roles, project Editor or Owner. If gcloud needs
   another permission, review that exact denial rather than broadening blindly.
2. Enable the IAM, Security Token Service and Service Account Credentials APIs if
   required and not already enabled. Create an OIDC Workload Identity Pool/provider
   with issuer `https://token.actions.githubusercontent.com`.
3. Map `google.subject=assertion.sub` and
   `attribute.repository_id=assertion.repository_id`. Restrict the provider with:

   ```text
   assertion.repository_owner_id == '324277135' &&
   assertion.repository_id == '1377260014' &&
   assertion.ref == 'refs/heads/main' &&
   assertion.event_name == 'workflow_dispatch' &&
   assertion.workflow_ref == 'memoryalwaysbibo/BXH_ARENA_Production/.github/workflows/bucket-cloud-readonly.yml@refs/heads/main'
   ```

4. On that service account, grant `roles/iam.workloadIdentityUser` only to
   `principalSet://iam.googleapis.com/projects/PROJECT_NUMBER/locations/global/workloadIdentityPools/POOL_ID/attribute.repository_id/1377260014`.
   Replace PROJECT_NUMBER and POOL_ID with actual values; they are not yet known.
5. In GitHub Settings → Secrets and variables → Actions → Variables, set
   `BXH_READONLY_WIF_PROVIDER` to the full provider resource name and
   `BXH_READONLY_SERVICE_ACCOUNT` to the dedicated account email. These are
   identity identifiers, not account keys. This workflow uses no JSON key.
6. After review and explicit approval to merge this narrow operational PR, the
   workflow must exist on the default branch before manual dispatch is available.
   Run “Bucket Cloud read-only provenance” on main. PR runs never authenticate.

## Evidence and limits

The fixed helper GETs previewTournamentRaffle, drawTournamentRaffle and
updateTournamentRaffleWinner, downloads generation-pinned source ZIPs, and
rechecks full metadata after each download. It never executes downloaded code.
The export independently checks source/archive identity and SHA256, then uploads
only allowlisted hashes, target names, success/error counts and read-only flags.
Unknown report fields, raw configuration values, credentials and source ZIPs are
excluded. Temporary source files are removed even on failure. The artifact is a
hash report, not a private source transport mechanism.

A successful run provides fresh provenance, not feature or production acceptance.
If a deployed hash differs from a privately reviewed archive, acquire the changed
archive through the trusted computer/private review path before changing its
callable. Auth/App Check, actual callable transactions, Eventarc and room rollout
remain separate acceptance work. Google Cloud IAM/location restrictions still
apply regardless of execution host.

References:
- https://docs.cloud.google.com/iam/docs/workload-identity-federation-with-deployment-pipelines
- https://github.com/google-github-actions/auth
- https://github.com/google-github-actions/setup-gcloud
- https://docs.cloud.google.com/sdk/docs/authenticate
