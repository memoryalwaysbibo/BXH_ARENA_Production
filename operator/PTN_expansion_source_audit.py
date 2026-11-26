#!/usr/bin/env python3
"""Read-only, generation-pinned source inventory for PTN expansion integration.

Run in an authenticated Cloud Shell. No deploy, Firestore reads/writes, or
settings changes. Prints hashes only; does not expose source contents or env.
Optional candidate roots are local checkouts of the two expansion PRs.
"""
import argparse
import hashlib
import io
import json
import subprocess
import zipfile
from pathlib import Path

PROJECT = "bxh-arena"
REGION = "asia-east1"
ROOM = "registration-flow-v2/backend/"
ROOM_FILES = tuple(ROOM + name for name in (
    "bindings.cjs", "lifecycle.cjs", "prepare-family.cjs",
    "ticket-room-create.cjs", "ticket-host.cjs", "ticket-expansion.cjs"))
COMMERCE_FILES = ("domain.cjs", "service.cjs", "ticket-purchase.cjs",
                  "room-expansion-pricing.cjs")
SETTLEMENT_FILES = ("ladder-auto-settlement.js", "ladder-settlement-core.js",
                    "ptn-settlement-proof.cjs")
TARGETS = {name: ROOM_FILES for name in (
    "registrationRosterQueueV2", "registrationQueueV2",
    "registrationQueueV2Worker", "registrationQueueV2Sweep",
    "registrationDrawV2", "registrationStartV2")}
TARGETS.update(commerceService=COMMERCE_FILES,
               ladderAutoSettlement=SETTLEMENT_FILES)
# Historical release candidates, not a claim about today's deployed source.
HISTORICAL = {
    "commerceService": dict(zip(COMMERCE_FILES, (
        "91b11c26901c33bd9f45e7a9dbbc267f64838197f17fe26415b3d3de990b5b02",
        "20c05d56971d6dd76a4cd38beb47d6eb7a64963bc7a9ebf9d3921425e747a432",
        "c58930c1e0bd8bec1652cbcf700eaff5f1b9e5afb4e22b2e0c29bdef1363a553"))),
    "ladderAutoSettlement": dict(zip(SETTLEMENT_FILES, (
        "37c104e3ff7ce29ed37a1748fa6b70904d71c69e95fa78b24ae085039375386d",
        "f32ec50f5444812c8ec7658eeba2129b971d26ef0db0604b9cdee2c5f625cd1d",
        "d8356b409d40f9e8e176345d05aa9994ad8dea7d74e5bfd00ab291e525914870")))}


def digest(data):
    return hashlib.sha256(data).hexdigest()


def binding(name):
    info = json.loads(subprocess.check_output([
        "gcloud", "functions", "describe", name, "--gen2",
        "--project=" + PROJECT, "--region=" + REGION, "--format=json"]))
    build = info["buildConfig"]
    src = build["source"]["storageSource"]
    if build["entryPoint"] != name or not src.get("generation"):
        raise RuntimeError(name + ": missing source identity")
    return (src["bucket"], src["object"], str(src["generation"]))


def inventory(name, paths, archive, local_root=None):
    rows = {}
    with zipfile.ZipFile(io.BytesIO(archive)) as z:
        names = z.namelist()
        if len(names) != len(set(names)):
            raise RuntimeError(name + ": duplicate archive members")
        for path in paths:
            matches = [p for p in names if "node_modules/" not in p and
                       (p == path or p.endswith("/" + path))]
            if len(matches) > 1:
                raise RuntimeError(name + ": ambiguous source member " + path)
            actual = digest(z.read(matches[0])) if matches else None
            historical = HISTORICAL.get(name, {}).get(path)
            local = local_root / path if local_root else None
            candidate = digest(local.read_bytes()) if local and local.is_file() else None
            rows[path] = {
                "liveSha256": actual,
                "historicalSha256": historical,
                "historicalMatch": actual == historical if historical else None,
                "candidateSha256": candidate,
                "candidateMatch": actual == candidate if candidate else None,
            }
    return rows


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--front-root", type=Path)
    parser.add_argument("--backend-root", type=Path)
    args = parser.parse_args()
    initial = {name: binding(name) for name in TARGETS}
    reports = []
    # Read each generation at most once, even if several functions share it.
    grouped = {}
    for name, source in initial.items():
        grouped.setdefault(source, []).append(name)
    for source, names in grouped.items():
        bucket, obj, generation = source
        archive = subprocess.check_output([
            "gcloud", "storage", "cat", "gs://" + bucket + "/" + obj + "#" + generation])
        for name in names:
            root = args.front_root if name.startswith("registration") else None
            if name == "commerceService" and args.backend_root:
                root = args.backend_root / "release/commerce/functions"
            reports.append({"function": name, "generation": generation,
                            "archiveSha256": digest(archive),
                            "files": inventory(name, TARGETS[name], archive, root)})
    if any(binding(name) != source for name, source in initial.items()):
        raise RuntimeError("source generation changed during inventory; repeat audit")
    print(json.dumps({"status": "READ_ONLY_SOURCE_AUDIT", "productionWrites": 0,
                      "functions": reports}, indent=2))


if __name__ == "__main__":
    main()
