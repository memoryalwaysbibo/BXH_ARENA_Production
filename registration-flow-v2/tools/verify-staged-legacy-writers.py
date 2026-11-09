#!/usr/bin/env python3
"""Read-only preflight for the five remaining V2 legacy writer fences."""

import argparse
import hashlib
import json
import runpy
import subprocess
import zipfile
from pathlib import Path
from urllib.error import HTTPError
from urllib.request import Request, urlopen

RULES_SHA = "3d1b40acb1f4a53b43b8d8cdeabbe1a70779c59307465f0882f5e0e118500d7f"
RULES_PREFIX = "projects/bxh-arena/rulesets/"


def require(condition, reason):
    if not condition:
        raise ValueError(reason)


def get_json(url, headers):
    with urlopen(Request(url, headers=headers), timeout=30) as response:
        return json.load(response)


def verify(root):
    stage = runpy.run_path(str(root / "tools/stage-legacy-writers.py"))
    live = runpy.run_path(str(root / "tools/read-live-writers.py"))
    packages = root / "packages"
    report = json.loads((packages / "manifest.json").read_text())
    targets = stage["TARGETS"]
    require(report.get("status") == "LEGACY_WRITER_PACKAGES_STAGED"
            and (report.get("project"), report.get("region"), report.get("productionWrites"))
            == ("bxh-arena", "asia-east1", 0)
            and set(report.get("writers", {})) == set(targets), "MANIFEST_SCOPE")

    for name, expected in targets.items():
        row = report["writers"][name]
        require((row.get("revision"), row.get("generation"), row.get("changedFile")) == expected,
                "BASELINE_SCOPE " + name)
        before = packages / name / "original.zip"
        after = packages / name / "candidate.zip"
        for kind, archive in (("original", before), ("candidate", after)):
            require(archive.is_file()
                    and stage["archive_digest"](archive) == row.get(kind + "ArchiveSha256"),
                    "ZIP_HASH " + name + " " + kind)
        with zipfile.ZipFile(before) as source, zipfile.ZipFile(after) as candidate:
            original_names = source.namelist()
            candidate_names = candidate.namelist()
            require(len(original_names) == len(set(original_names))
                    and original_names == candidate_names, "ZIP_INVENTORY " + name)
            changed = [member for member in original_names
                       if source.read(member) != candidate.read(member)]
            require(changed == [expected[2]]
                    and hashlib.sha256(source.read(expected[2])).hexdigest() == row["originalFileSha256"]
                    and hashlib.sha256(candidate.read(expected[2])).hexdigest() == row["candidateFileSha256"],
                    "ZIP_DIFF " + name)
        info, pointer = live["read_function"](name)
        require((pointer[0], pointer[3]) == expected[:2]
                and info.get("state") == "ACTIVE"
                and info["serviceConfig"].get("allTrafficOnLatestRevision") is True
                and stage["snapshot"](info) == row["functionSnapshotSha256"],
                "LIVE_BASELINE " + name)
        print("WRITER_OK", name, pointer[0], flush=True)

    token = subprocess.check_output(
        ["gcloud", "auth", "print-access-token", "--quiet"], text=True, timeout=30
    ).strip()
    require(bool(token), "CLOUD_SHELL_AUTH_REQUIRED")
    headers = {"Authorization": "Bearer " + token}
    api = "https://firebaserules.googleapis.com/v1/"
    release = get_json(api + "projects/bxh-arena/releases/cloud.firestore", headers)
    ruleset = release["rulesetName"]
    require(ruleset.startswith(RULES_PREFIX), "UNEXPECTED_RULESET")
    sources = get_json(api + ruleset, headers)["source"]["files"]
    require(len(sources) == 1
            and hashlib.sha256(sources[0]["content"].encode()).hexdigest() == RULES_SHA,
            "RULES_CHANGED")
    print("RULES_MATCHED", flush=True)

    for name in ("registrationQueueV2", "registrationRosterQueueV2"):
        info, _ = live["read_function"](name)
        require(info.get("state") == "ACTIVE", "V2_FUNCTION_STATE " + name)
        request = Request(info["serviceConfig"]["uri"], data=b'{"data":{"action":"status"}}',
                          headers={"Content-Type": "application/json"})
        try:
            with urlopen(request, timeout=30):
                raise ValueError("V2_UNEXPECTED_RESPONSE " + name)
        except HTTPError as error:
            result = json.load(error).get("error", {})
            require(error.code == 400 and result.get("status") == "FAILED_PRECONDITION"
                    and result.get("message") == "registration-queue-disabled", "V2_GATE " + name)
        print("HARD_CLOSED", name, flush=True)

    print("LEGACY_SOURCE_PLAN_VERIFIED 5")
    print("productionWrites 0")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("staging_root", type=Path,
                        help="Directory containing tools/ and packages/manifest.json")
    args = parser.parse_args()
    try:
        verify(args.staging_root.resolve())
    except (OSError, ValueError, KeyError, TypeError, subprocess.SubprocessError,
            zipfile.BadZipFile, HTTPError) as error:
        raise SystemExit("LEGACY_PLAN_BLOCKED " +
                         (str(error) if type(error) is ValueError else type(error).__name__)) from None
