#!/usr/bin/env python3
"""Build review-only source ZIPs from an already captured restore/access bundle.

No cloud commands, credentials, deployment, runtime activation or room access.
The capture must match the exact source/configuration digests pinned in this tree.
"""
import argparse
import copy
import hashlib
import io
import json
from pathlib import Path, PurePosixPath
import zipfile

ROOT = Path(__file__).resolve().parents[1]
TARGETS = {
    "restoreIdleTournament": ("operations.js", "restore-operations.js"),
    "roomAccess": ("room-access-service.js", "room-access-service.js"),
}


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def canonical(value):
    return sha(json.dumps(value, sort_keys=True, separators=(",", ":")).encode())


def read_zip(raw):
    archive = zipfile.ZipFile(io.BytesIO(raw))
    names = archive.namelist()
    if len(names) != len(set(names)):
        raise ValueError("Duplicate ZIP members")
    if sum(x.file_size for x in archive.infolist()) > 100 * 1024 * 1024:
        raise ValueError("Capture exceeds the review size budget")
    for name in names:
        path = PurePosixPath(name)
        if path.is_absolute() or ".." in path.parts or "\\" in name:
            raise ValueError("Unsafe ZIP member")
    return archive


def build(capture, output):
    release = ROOT / "release/buckets/deletion"
    manifest = json.loads((release / "manifest.json").read_text())
    pinned = manifest["deployedSourceReadback"]
    raw = capture.read_bytes()
    if sha(raw) != pinned["captureBundleSha256"]:
        raise ValueError("Capture bundle differs from the reviewed capture")
    planned = []
    with read_zip(raw) as bundle:
        report = json.loads(bundle.read("report.json"))
        if (report["project"], report["region"], report["observedAt"]) != (
                pinned["project"], pinned["region"], pinned["observedAt"]):
            raise ValueError("Capture identity/time differs from the pinned snapshot")
        rows = {x["name"]: x for x in report["targetFunctions"]}
        for item in pinned["functions"]:
            name = item["name"]
            source_path, candidate_path = TARGETS[name]
            row = rows[name]
            metadata = json.loads(bundle.read(name + ".metadata.json"))
            original = bundle.read(row["sourceArchiveFile"])
            if sha(original) != item["archiveSha256"] or row["sourceArchiveSha256"] != item["archiveSha256"]:
                raise ValueError(name + ": source archive drift")
            if metadata["name"] != f"projects/{pinned['project']}/locations/{pinned['region']}/functions/{name}":
                raise ValueError(name + ": wrong Function identity")
            for field in ("buildConfig", "serviceConfig", "eventTrigger"):
                if canonical(metadata.get(field)) != item[field + "Sha256"]:
                    raise ValueError(name + ": " + field + " drift")
            if metadata["buildConfig"]["source"]["storageSource"] != item["storageSource"]:
                raise ValueError(name + ": source generation drift")
            if metadata["buildConfig"]["entryPoint"] != name or metadata["serviceConfig"]["revision"] != item["revision"]:
                raise ValueError(name + ": entrypoint/revision drift")
            replacement = (release / candidate_path).read_bytes()
            if sha(replacement) != manifest["candidates"][candidate_path]:
                raise ValueError(name + ": candidate source drift")
            target = io.BytesIO()
            with read_zip(original) as baseline:
                for path, digest in item["sourceFileSha256"].items():
                    if sha(baseline.read(path)) != digest:
                        raise ValueError(name + ": captured dependency drift: " + path)
                with zipfile.ZipFile(target, "w") as candidate:
                    candidate.comment = baseline.comment
                    for member in baseline.infolist():
                        candidate.writestr(copy.copy(member), replacement if member.filename == source_path else baseline.read(member))
                with read_zip(target.getvalue()) as candidate:
                    if candidate.namelist() != baseline.namelist():
                        raise ValueError(name + ": archive members changed")
                    changed = [p for p in baseline.namelist() if baseline.read(p) != candidate.read(p)]
                    if changed != [source_path]:
                        raise ValueError(name + ": unexpected source changes: " + repr(changed))
                    preserved = len(candidate.namelist()) - 1
            planned.append((name, target.getvalue(), {
                "function": name, "file": name + ".review-source.zip",
                "baselineRevision": item["revision"], "baselineSource": item["storageSource"],
                "baselineArchiveSha256": item["archiveSha256"],
                "baselineServiceConfigSha256": item["serviceConfigSha256"],
                "baselineBuildConfigSha256": item["buildConfigSha256"],
                "baselineEventTriggerSha256": item["eventTriggerSha256"],
                "changedFiles": changed, "unchangedMemberCount": preserved,
                "candidateFileSha256": sha(replacement), "candidateArchiveSha256": sha(target.getvalue()),
            }))
    if {name for name, _, _ in planned} != set(TARGETS):
        raise ValueError("Capture does not cover exactly the two reviewed targets")
    # Finish all validation before creating any deliverable; never overwrite a prior review.
    output.mkdir(parents=True, mode=0o700, exist_ok=False)
    result = {"status": "review-only-not-deployed", "project": pinned["project"],
              "observedAt": pinned["observedAt"], "captureBundleSha256": sha(raw),
              "cloudRequests": 0, "productionWrites": 0, "deploymentPerformed": False,
              "runtimeActivationPerformed": False, "requiresFreshLiveReadback": True,
              "releaseAcceptanceCompleted": False, "candidates": []}
    for _, data, record in planned:
        target = output / record["file"]
        target.write_bytes(data)
        target.chmod(0o600)
        result["candidates"].append(record)
    record_path = output / "review-manifest.json"
    record_path.write_text(json.dumps(result, indent=2) + "\n")
    record_path.chmod(0o600)
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--capture", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()
    try:
        result = build(args.capture, args.output)
    except (OSError, ValueError, KeyError, zipfile.BadZipFile) as error:
        raise SystemExit("STOP: " + str(error)) from None
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
