#!/usr/bin/env python3
"""Prepare a reviewable, functions-only Firebase deployment directory."""

import argparse
import io
import json
import runpy
import subprocess
import zipfile
from pathlib import Path

CODEBASE = "bxh-registration-v2-closed"
SCHEDULED_JOB = "firebase-schedule-registrationQueueV2Sweep-asia-east1"


def check_resources(preflight):
    read = preflight["gcloud"]
    functions = read("functions", "list")
    if not isinstance(functions, list):
        raise ValueError("unexpected-codebase-inventory")
    if any((row.get("labels") or {}).get("deployment-codebase") == CODEBASE for row in functions):
        raise ValueError("deployment-codebase-already-used")
    jobs = read("scheduler", "jobs", "list", "--location=" + preflight["REGION"])
    if not isinstance(jobs, list):
        raise ValueError("unexpected-scheduler-inventory")
    if any(row.get("name", "").rsplit("/", 1)[-1] == SCHEDULED_JOB for row in jobs):
        raise ValueError("scheduler-job-already-exists")


def stage_project(bundle, output, preflight):
    package = preflight["check_bundle"](bundle)
    production = preflight["check_live"]()
    check_resources(preflight)
    raw = (bundle / "function-source.zip").read_bytes()
    if preflight["digest"](raw) != package["bundleSha256"]:
        raise ValueError("bundle-changed-after-preflight")
    output.mkdir(mode=0o700, exist_ok=False)
    source = output / "functions"
    source.mkdir()
    with zipfile.ZipFile(io.BytesIO(raw)) as archive:
        archive.extractall(source)
    config = output / "firebase.json"
    config.write_text(json.dumps({
        "functions": [{"source": "functions", "codebase": CODEBASE, "runtime": "nodejs22"}],
    }, indent=2) + "\n")
    plan = {
        "status": "CLOSED_DEPLOY_PROJECT_PREPARED",
        "activation": "HARD_CLOSED",
        "productionWrites": 0,
        **package,
        **production,
        "codebase": CODEBASE,
        "schedulerJob": SCHEDULED_JOB,
        "output": str(output),
        "prepareDependenciesArgvForReview": [
            "npm", "--prefix", str(source), "install", "--omit=dev", "--ignore-scripts", "--no-audit", "--no-fund",
        ],
        "deploymentArgvForReview": [
            "firebase", "deploy", "--project", production["project"], "--config", str(config),
            "--only", "functions:" + CODEBASE, "--non-interactive",
        ],
    }
    (output / "deployment-plan.json").write_text(json.dumps(plan, indent=2) + "\n")
    return plan


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("bundle", type=Path)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    preflight = runpy.run_path(str(Path(__file__).with_name("preflight-closed.py")))
    try:
        plan = stage_project(args.bundle.resolve(), args.output.resolve(), preflight)
    except (OSError, subprocess.SubprocessError, ValueError, KeyError, TypeError, zipfile.BadZipFile) as error:
        print(json.dumps({"status": "CLOSED_DEPLOY_PROJECT_BLOCKED", "productionWrites": 0,
                          "reason": str(error) if type(error) is ValueError else type(error).__name__}))
        return 1
    print(json.dumps(plan, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
