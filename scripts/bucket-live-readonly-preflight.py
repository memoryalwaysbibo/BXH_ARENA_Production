#!/usr/bin/env python3
"""Capture the current bucket release boundary from authenticated Cloud Shell.

GETs live Rules and regional Function metadata, then downloads immutable source
generations for the selected writers. No deploy, Firestore document write, IAM
change, or runtime activation. Source archives stay local with mode 0600.
"""

import argparse
import datetime as dt
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import tempfile
import urllib.error
import urllib.parse
import urllib.request

PROJECT = "bxh-arena"
REGION = "asia-east1"
ROOT = f"projects/{PROJECT}/locations/{REGION}"
REVIEWED_RULES_SHA = "580da8c9dbde90e936ff7ddd88543b3370ff2f3cd9c27c749b6aecc11802977e"
TARGETS = (
    "commitBucketRefereeCommand", "manageBucketRefereeSeats", "projectBucketPublicScore",
    "commitRefereeCommand", "manageRefereeSeats", "deleteTournamentSafely",
    "restoreIdleTournament", "roomAccess", "manageRegistrationSelection",
    "lotteryRegistration", "manageEntrySelection", "registrationInvitations",
    "eventStaffService", "settleLadderTournament", "ladderAutoSettlement",
    "syncMyHostingProgress", "preserveCompletedRoomAndCountHost",
    "preserveExistingCompletedRooms", "trackTournamentActivity",
    "trackTournamentRegistrationActivity", "drawTournamentRaffle",
    "updateTournamentRaffleWinner",
)
RUNTIME_TARGETS = frozenset(TARGETS[:3])


def sha(data):
    return hashlib.sha256(data).hexdigest()


def cli(args):
    try:
        result = subprocess.run(args, capture_output=True, text=True, timeout=240, check=False)
    except (OSError, subprocess.TimeoutExpired) as exc:
        raise RuntimeError("Cloud Shell command unavailable or timed out") from exc
    if result.returncode:
        # Do not echo gcloud diagnostics: a signed URL or credential may occur there.
        raise RuntimeError("Cloud Shell command failed: " + " ".join(args[:3]))
    return result.stdout.strip()


def get(url, token):
    parts = urllib.parse.urlsplit(url)
    if parts.scheme != "https" or parts.hostname not in (
        "cloudfunctions.googleapis.com", "firebaserules.googleapis.com"
    ):
        raise RuntimeError("Unexpected API endpoint")
    req = urllib.request.Request(url, headers={"Authorization": "Bearer " + token})
    try:
        with urllib.request.urlopen(req, timeout=90) as response:
            return json.load(response)
    except urllib.error.HTTPError as exc:
        raise RuntimeError("Read API returned HTTP " + str(exc.code)) from None
    except (urllib.error.URLError, TimeoutError) as exc:
        raise RuntimeError("Read API unavailable") from exc


def canonical_sha(value):
    return sha(json.dumps(value, sort_keys=True, separators=(",", ":")).encode())


def save(path, value):
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n")
    path.chmod(0o600)


def list_region(token):
    names = set()
    page = ""
    while True:
        query = urllib.parse.urlencode({"pageSize": 100, **({"pageToken": page} if page else {})})
        data = get(f"https://cloudfunctions.googleapis.com/v2/{ROOT}/functions?{query}", token)
        for item in data.get("functions", []):
            name = item.get("name", "")
            if not name.startswith(ROOT + "/functions/") or "/" in name[len(ROOT + "/functions/"):]:
                raise RuntimeError("Unexpected regional Function name")
            names.add(name.rsplit("/", 1)[-1])
        next_page = data.get("nextPageToken", "")
        if not next_page:
            return sorted(names)
        if next_page == page:
            raise RuntimeError("Repeated Function listing page")
        page = next_page


def capture(destination):
    active = cli(["gcloud", "config", "get-value", "project", "--quiet"])
    if active != PROJECT:
        raise RuntimeError("Active project must be bxh-arena")
    token = cli(["gcloud", "auth", "print-access-token", "--quiet"])
    if not token:
        raise RuntimeError("No gcloud identity")
    release = get(f"https://firebaserules.googleapis.com/v1/projects/{PROJECT}/releases/cloud.firestore", token)
    ruleset_name = release.get("rulesetName", "")
    if not re.fullmatch(rf"projects/{PROJECT}/rulesets/[A-Za-z0-9_-]+", ruleset_name):
        raise RuntimeError("Unexpected Firestore Rules release")
    ruleset = get("https://firebaserules.googleapis.com/v1/" + ruleset_name, token)
    files = ruleset.get("source", {}).get("files", [])
    if len(files) != 1 or not isinstance(files[0].get("content"), str):
        raise RuntimeError("Rules source is not a single text file")
    rules = files[0]["content"].encode()
    (destination / "firestore.live.rules").write_bytes(rules)
    (destination / "firestore.live.rules").chmod(0o600)

    region_names = list_region(token)
    report = {
        "stage": "BUCKET_LIVE_READONLY_PREFLIGHT",
        "observedAt": dt.datetime.now(dt.timezone.utc).isoformat(),
        "project": PROJECT, "region": REGION, "productionWrites": 0,
        "deploymentPerformed": False, "roomActivationPerformed": False,
        "rulesetName": ruleset_name, "rulesSha256": sha(rules),
        "rulesMatchReviewedBaseline": sha(rules) == REVIEWED_RULES_SHA,
        "regionalFunctionCount": len(region_names),
        "regionalFunctionNames": region_names,
        "targetFunctions": [], "missingTargets": [], "errors": [],
        "writerInventoryComplete": False,
        "acceptanceCompleted": False,
    }
    downloaded = {}
    for name in TARGETS:
        if name not in region_names:
            report["missingTargets"].append(name)
            continue
        print("READONLY: " + name, flush=True)
        try:
            full = ROOT + "/functions/" + name
            info = get("https://cloudfunctions.googleapis.com/v2/" + full, token)
            if info.get("name") != full or info.get("state") != "ACTIVE":
                raise RuntimeError("Function identity or state changed")
            build = info.get("buildConfig", {})
            service = info.get("serviceConfig", {})
            source = build.get("source", {}).get("storageSource", {})
            bucket, obj, generation = source.get("bucket", ""), source.get("object", ""), str(source.get("generation", ""))
            if not re.fullmatch(r"[a-z0-9][a-z0-9._-]+", bucket) or not obj or "#" in obj or not generation.isdecimal():
                raise RuntimeError("Immutable deployed source generation unavailable")
            source_key = (bucket, obj, generation)
            if source_key not in downloaded:
                archive = destination / ("source-set-" + str(len(downloaded) + 1) + ".zip")
                cli(["gcloud", "storage", "cp", "gs://" + bucket + "/" + obj + "#" + generation, str(archive), "--quiet"])
                archive.chmod(0o600)
                downloaded[source_key] = (archive.name, sha(archive.read_bytes()))
            archive_name, archive_sha = downloaded[source_key]
            save(destination / (name + ".metadata.json"), info)
            # Hash the complete configs without disclosing environment values in the report.
            row = {
                "name": name, "updateTime": info.get("updateTime"),
                "revision": service.get("revision"), "runtime": build.get("runtime"),
                "entryPoint": build.get("entryPoint"), "source": source,
                "sourceArchiveFile": archive_name,
                "sourceArchiveSha256": archive_sha,
                "buildConfigSha256": canonical_sha(build),
                "serviceConfigSha256": canonical_sha(service),
                "eventTriggerSha256": canonical_sha(info.get("eventTrigger")),
                "environmentVariableNames": sorted(service.get("environmentVariables", {})),
            }
            if name in RUNTIME_TARGETS:
                row["bucketRuntimeEnabled"] = service.get("environmentVariables", {}).get("BXH_BUCKET_RUNTIME_ENABLED", "<unset>")
            report["targetFunctions"].append(row)
        except (RuntimeError, OSError, ValueError) as exc:
            report["errors"].append({"function": name, "reason": str(exc)})
    report["readyForHumanReview"] = (
        report["rulesMatchReviewedBaseline"] and not report["missingTargets"]
        and not report["errors"] and all(
            x.get("bucketRuntimeEnabled") == "false" for x in report["targetFunctions"]
            if x["name"] in RUNTIME_TARGETS
        )
    )
    save(destination / "report.json", report)
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.parse_args()
    os.umask(0o077)
    destination = Path(tempfile.mkdtemp(prefix="bxh-bucket-live-readonly-", dir=Path.home()))
    try:
        report = capture(destination)
    except (RuntimeError, OSError, ValueError) as exc:
        save(destination / "error.json", {"productionWrites": 0, "reason": str(exc)})
        raise SystemExit("STOP: read-only preflight incomplete; local report directory: " + str(destination)) from None
    print(json.dumps({
        "reportFile": str(destination / "report.json"),
        "rulesSha256": report["rulesSha256"],
        "regionalFunctionCount": report["regionalFunctionCount"],
        "sourcesCaptured": len(report["targetFunctions"]),
        "missingTargets": report["missingTargets"], "errors": report["errors"],
        "readyForHumanReview": report["readyForHumanReview"],
        "writerInventoryComplete": False, "acceptanceCompleted": False,
        "productionWrites": 0,
    }, ensure_ascii=False, indent=2))
    if not report["readyForHumanReview"]:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
