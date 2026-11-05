# Read-only writer metadata discovery

Run `python3 -B bucket-writer-discovery.py` in authenticated Cloud Shell with
the active project set to `bxh-arena`. No third-party Python dependencies are
required. The tool prints paths to a private report and a small ZIP to return
for review. A partial result still saves its report and exits nonzero; do not
interpret partial discovery as an empty or approved writer set.

The tool lists both v1 and v2 Functions across all regions. For Cloud Run,
an authenticated locations-list GET discovers supported regions;
the tool then lists services and jobs in each concrete region. It does not
send the unsupported `-` wildcard to the Cloud Run service-list API. Pagination
cycles, unreachable regions, missing linked Function services, cross-project
identities and read-permission failures block metadata completeness.

Every entry remains `unreviewed`, including services linked to Functions.
A Function-looking label does not exempt a direct Cloud Run service. The
report preserves separate API-view metadata hashes and Function/service links;
it does not save environment values, credentials, source archives, document
data, container configuration or raw API responses. A metadata hash is a
snapshot comparison aid, not source-code review or release authorization.

Only gcloud project/identity reads and authenticated
HTTP GET requests occur. There is no deployment, IAM change, API enablement,
Firestore read/write, source upload, runtime activation or room migration.
The tool refuses redirects and other API methods/endpoints. It never prints
gcloud diagnostics, tokens or raw server errors. Reports and ZIPs have private
file permissions. Cloud Run region listing can take a few minutes; every
region is checked even if the main application normally uses asia-east1.

After discovery, review exact deployed sources/dependencies for newly identified
writers. Admin scripts, externally held Admin credentials, impersonation and
IAM permissions are explicitly outside this inventory. Consequently
`writerInventoryComplete`, `sourceReviewComplete` and `acceptanceCompleted`
remain false even when `metadataDiscoveryComplete` is true. Fresh live
source/configuration readback and the remaining cutover acceptance are separate.

Offline verification:

```sh
python3 -B tests/four-court-buckets/writer-discovery.py
```

API contracts reviewed while implementing the tool:

- [Functions v1 list contract](https://github.com/googleapis/googleapis/blob/master/google/cloud/functions/v1/functions.proto)
- [Functions v2 list contract](https://github.com/googleapis/googleapis/blob/master/google/cloud/functions/v2/functions.proto)
- [Cloud Run v2 services contract](https://github.com/googleapis/googleapis/blob/master/google/cloud/run/v2/service.proto)
- [Cloud Run supported locations](https://docs.cloud.google.com/run/docs/reference/rest/v1/projects.locations/list)
- [Cloud Run v2 jobs](https://docs.cloud.google.com/run/docs/reference/rest/v2/projects.locations.jobs/list)

This tool is a release-evidence helper; its own offline tests do not establish
that the current operator has GCP permissions or that live discovery completed.
