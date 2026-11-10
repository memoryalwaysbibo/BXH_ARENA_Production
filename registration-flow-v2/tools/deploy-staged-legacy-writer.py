#!/usr/bin/env python3
"""Update or restore one staged V2 legacy writer in bxh-arena."""

import argparse
import fcntl
import json
import os
import re
import runpy
import subprocess
import tempfile
import time
from pathlib import Path
from urllib.error import HTTPError
from urllib.parse import unquote, urlsplit
from urllib.request import HTTPRedirectHandler, Request, build_opener

LOCATION = "projects/bxh-arena/locations/asia-east1"
API = "https://cloudfunctions.googleapis.com/v2/"


def require(condition, reason):
    if not condition:
        raise SystemExit("LEGACY_WRITER_DEPLOY_BLOCKED " + reason)


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


class Cloud:
    def __init__(self):
        self.opener = build_opener(NoRedirect())
        self.token_expiry = 0

    def api(self, path, method="GET", payload=None):
        if time.monotonic() >= self.token_expiry:
            self.token = subprocess.check_output(
                ["gcloud", "auth", "print-access-token", "--quiet"], text=True, timeout=30
            ).strip()
            require(self.token, "CLOUD_SHELL_AUTH_REQUIRED")
            self.token_expiry = time.monotonic() + 600
        headers = {"Authorization": "Bearer " + self.token, "Content-Type": "application/json"}
        data = None if payload is None else json.dumps(payload).encode()
        req = Request(API + path, data=data, headers=headers, method=method)
        with self.opener.open(req, timeout=60) as response:
            return json.load(response)

    def upload(self, archive, kms_key):
        args = {"environment": "GEN_2"}
        if kms_key:
            args["kmsKeyName"] = kms_key
        ticket = self.api(LOCATION + "/functions:generateUploadUrl", "POST", args)
        url, source = ticket["uploadUrl"], ticket["storageSource"]
        bucket, obj = source["bucket"], source["object"]
        parsed = urlsplit(url)
        path = unquote(parsed.path, errors="strict")
        require(re.fullmatch(r"[a-z0-9][a-z0-9._-]+", bucket) and obj
                and not any(c in obj for c in "\r\n#")
                and parsed.scheme == "https" and parsed.port in (None, 443)
                and not (parsed.username or parsed.password or parsed.fragment) and parsed.query
                and ((parsed.hostname == "storage.googleapis.com" and path == f"/{bucket}/{obj}")
                     or (parsed.hostname == f"{bucket}.storage.googleapis.com" and path == f"/{obj}")),
                "UPLOAD_URL_BINDING")
        request = Request(url, data=archive, headers={"Content-Type": "application/zip"}, method="PUT")
        with self.opener.open(request, timeout=120) as response:
            generation = response.headers.get("x-goog-generation") or source.get("generation")
        binding = {"bucket": bucket, "object": obj}
        if generation:
            require(re.fullmatch(r"[0-9]+", str(generation)), "INVALID_UPLOAD_GENERATION")
            binding["generation"] = str(generation)
        return binding

    def submit(self, name, source):
        function = LOCATION + "/functions/" + name
        result = self.api(function + "?updateMask=buildConfig.source", "PATCH", {
            "name": function, "buildConfig": {"source": {"storageSource": source}},
        })
        operation = result["name"]
        require(re.fullmatch(
            r"projects/(bxh-arena|87261141693)/locations/asia-east1/operations/[A-Za-z0-9_-]+", operation
        ), "UNEXPECTED_OPERATION")
        return operation

    def wait(self, operation):
        deadline = time.monotonic() + 1200
        while time.monotonic() < deadline:
            result = self.api(operation)
            if result.get("done"):
                require("error" not in result, "OPERATION_FAILED " + str(result.get("error", {}).get("code")))
                return
            time.sleep(8)
        require(False, "OPERATION_PENDING_USE_STATUS")


def configuration(info, snapshot):
    settings = {key: info.get(key) for key in
                ("name", "description", "environment", "labels", "kmsKeyName", "eventTrigger")}
    settings["serviceConfig"] = {k: v for k, v in info["serviceConfig"].items() if k != "revision"}
    settings["buildConfig"] = {k: v for k, v in info["buildConfig"].items()
                               if k not in ("build", "source", "sourceProvenance", "runtimeVersion")}
    policy = settings["buildConfig"].get("onDeployUpdatePolicy")
    if policy is not None:
        settings["buildConfig"]["onDeployUpdatePolicy"] = {k: v for k, v in policy.items() if k != "runtimeVersion"}
    return snapshot(settings)


def readback(name, read, gcloud, stage, baseline_config, before_revision, expected):
    info, (revision, bucket, obj, generation) = read(name)
    require(revision != before_revision and info["serviceConfig"].get("allTrafficOnLatestRevision") is True,
            "REVISION_OR_TRAFFIC")
    require(configuration(info, stage["snapshot"]) == baseline_config, "NON_SOURCE_SETTINGS_CHANGED")
    with tempfile.TemporaryDirectory(prefix="bxh746-legacy-readback-") as directory:
        source = Path(directory) / "source.zip"
        gcloud("storage", "cp", f"gs://{bucket}/{obj}#{generation}", str(source))
        require(stage["archive_digest"](source) == expected, "DEPLOYED_SOURCE_HASH_MISMATCH")
    require(read(name)[1] == (revision, bucket, obj, generation), "SOURCE_CHANGED_DURING_READBACK")
    return {"revision": revision, "generation": generation, "sha256": expected}


def run(root, mode, name):
    journal_path = Path.home() / ("BXH-746-" + name + "-journal.jsonl")
    if mode == "status":
        require(journal_path.is_file(), "NO_LOCAL_JOURNAL")
        with journal_path.open() as journal:
            fcntl.flock(journal.fileno(), fcntl.LOCK_SH | fcntl.LOCK_NB)
            records = [json.loads(line) for line in journal]
        for row in records:
            print(row["status"], row.get("operation") or row.get("revision") or "")
        if records and records[-1].get("operation"):
            result = Cloud().api(records[-1]["operation"])
            if result.get("error"):
                print("OPERATION_FAILED", result["error"].get("code"))
            else:
                print("OPERATION_DONE" if result.get("done") else "OPERATION_PENDING")
        return
    root = root.resolve()
    stage = runpy.run_path(str(root / "tools/stage-legacy-writers.py"))
    live = runpy.run_path(str(root / "tools/read-live-writers.py"))
    read = live["read_function"]
    folder = root / "packages"
    manifest = json.loads((folder / "manifest.json").read_text())
    require((manifest["status"], manifest["project"], manifest["region"], manifest["productionWrites"])
            == ("LEGACY_WRITER_PACKAGES_STAGED", "bxh-arena", "asia-east1", 0), "MANIFEST_SCOPE")
    require(name in stage["TARGETS"] and set(manifest["writers"]) == set(stage["TARGETS"]), "MANIFEST_SCOPE")
    row = manifest["writers"][name]
    require((row["revision"], row["generation"], row["changedFile"]) == stage["TARGETS"][name], "BASELINE_SCOPE")
    kind = "candidate" if mode == "apply" else "original"
    archive = (folder / name / (kind + ".zip")).read_bytes()
    archive_sha = row[kind + "ArchiveSha256"]
    require(stage["digest"](archive) == archive_sha, "LOCAL_SOURCE_HASH_MISMATCH")
    flags = os.O_RDWR | os.O_APPEND | os.O_NOFOLLOW
    if mode == "apply":
        require(not journal_path.exists(), "JOURNAL_ALREADY_EXISTS_USE_STATUS")
        # Verify the whole plan once before starting; after one writer changes,
        # each other writer is still protected by its own snapshot below.
        if not (root / "legacy-preflight-passed.json").is_file():
            verifier = runpy.run_path(str(root / "tools/verify-staged-legacy-writers.py"))
            verifier["verify"](root)
            (root / "legacy-preflight-passed.json").write_text(json.dumps({
                "manifestSha256": stage["archive_digest"](folder / "manifest.json"),
                "targets": list(stage["TARGETS"]),
            }) + "\n")
        else:
            checkpoint = json.loads((root / "legacy-preflight-passed.json").read_text())
            require(checkpoint == {"manifestSha256": stage["archive_digest"](folder / "manifest.json"),
                                   "targets": list(stage["TARGETS"])}, "PREFLIGHT_CHECKPOINT_CHANGED")
        flags |= os.O_CREAT | os.O_EXCL
    else:
        require(journal_path.is_file(), "NO_LOCAL_JOURNAL")
    with os.fdopen(os.open(journal_path, flags, 0o600), "a+") as journal:
        fcntl.flock(journal.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        journal.seek(0)
        records = [json.loads(line) for line in journal]
        before, pointer = read(name)
        before_revision = pointer[0]
        baseline_config = configuration(before, stage["snapshot"])
        if mode == "apply":
            require((pointer[0], pointer[3]) == (row["revision"], row["generation"])
                    and stage["snapshot"](before) == row["functionSnapshotSha256"]
                    and before["serviceConfig"].get("allTrafficOnLatestRevision") is True, "LIVE_BASELINE")
        else:
            require(records and records[-1]["status"] == "LEGACY_WRITER_DEPLOY_VERIFIED", "ROLLBACK_NEEDS_VERIFIED_APPLY")
            applied = records[-1]
            require((before_revision, pointer[3], baseline_config, row["candidateArchiveSha256"])
                    == (applied["revision"], applied["generation"], applied["configurationSha256"], applied["sha256"])
                    and before["serviceConfig"].get("allTrafficOnLatestRevision") is True, "ROLLBACK_BASELINE")

        def record(status, **fields):
            journal.write(json.dumps({"status": status, **fields}) + "\n")
            journal.flush()
            os.fsync(journal.fileno())
            print(status, fields.get("operation") or fields.get("revision") or "", flush=True)

        label = "LEGACY_WRITER_DEPLOY" if mode == "apply" else "LEGACY_WRITER_ROLLBACK"
        cloud = Cloud()
        record(label + "_UPLOADING", revision=before_revision)
        source = cloud.upload(archive, before.get("kmsKeyName"))
        require(read(name) == (before, pointer), "LIVE_BASELINE_CHANGED_AFTER_UPLOAD")
        record(label + "_SUBMITTING", revision=before_revision)
        operation = cloud.submit(name, source)
        record(label + "_OPERATION", operation=operation)
        cloud.wait(operation)
        observed = readback(name, read, live["gcloud"], stage, baseline_config, before_revision, archive_sha)
        record(label + "_VERIFIED", configurationSha256=baseline_config, **observed)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("staging", type=Path)
    parser.add_argument("name", choices=(
        "familyRegistration", "registrationRosterService", "promoteSeatedRegistration",
        "manageOnsiteWaitlist", "manageRegistrationSelection",
    ))
    mode = parser.add_mutually_exclusive_group(required=True)
    for name in ("apply", "rollback", "status"):
        mode.add_argument("--" + name, dest="mode", action="store_const", const=name)
    args = parser.parse_args()
    try:
        run(args.staging, args.mode, args.name)
    except HTTPError as error:
        raise SystemExit(f"LEGACY_WRITER_DEPLOY_BLOCKED HTTP_{error.code}") from None
    except Exception as error:
        raise SystemExit("LEGACY_WRITER_DEPLOY_BLOCKED " + type(error).__name__) from None
