"""Verify and publish the staged BXH822 registration functions."""
import argparse
import fcntl
import json
import os
from pathlib import Path
import sys
import tempfile
from urllib.error import HTTPError
from urllib.request import Request, urlopen

import BXH822_stage_fixed as stage

ORDER = (
    "registrationQueueV2Worker", "registrationQueueV2Sweep",
    "registrationQueueV2", "registrationDrawV2", "registrationStartV2",
    "registrationRosterQueueV2",
)


def assert_pilot_closed():
    token = stage.output("gcloud", "auth", "print-access-token", "--quiet").decode().strip()
    root = "https://firestore.googleapis.com/v1/projects/bxh-arena/databases/(default)/documents/systemSettings/"
    for document in ("commerceTicketCheckoutV1", "commerceTicketLifecycleV1"):
        request = Request(root + document, headers={"Authorization": "Bearer " + token})
        try:
            with urlopen(request, timeout=30) as response:
                fields = json.load(response).get("fields", {})
        except HTTPError as error:
            if error.code == 404:
                continue
            raise
        for flag in ("enabled", "bindingEnabled"):
            stage.need(fields.get(flag, {"booleanValue": False}) == {"booleanValue": False},
                       f"{document}: {flag} must be closed during deployment")


def load_publisher(repo, directory):
    source = stage.output("git", "show", f"{stage.CANDIDATE}:operator/BXH819_release.py", cwd=repo)
    helper = directory / "_bxh822_source_publisher.py"
    helper.write_bytes(source)
    sys.path.insert(0, str(directory))
    import _bxh822_source_publisher as publisher
    return publisher


def prepare(repo, directory, publisher):
    manifest = json.loads((directory / "manifest.json").read_bytes())
    stage.need(set(manifest) == set(ORDER) == set(stage.VERSIONS), "stage function set differs")
    plan = {}
    for name in ORDER:
        revision, generation = stage.VERSIONS[name]
        row = manifest[name]
        original = directory / f"{name}.original.zip"
        candidate = (directory / f"{name}.candidate.zip").read_bytes()
        stage.need(row["revision"] == revision and row["generation"] == generation
                   and row["originalSha256"] == stage.digest(original.read_bytes())
                   and row["candidateSha256"] == stage.digest(candidate)
                   and candidate == stage.prepare(name, original, repo), f"{name}: staged package differs")
        plan[name] = {"beforeRevision": revision, "beforeSource": None,
                      "candidateSha256": row["candidateSha256"]}

    state_path = directory / "bxh822.release-plan.json"
    if state_path.exists():
        saved = json.loads(state_path.read_bytes())
        stage.need(set(saved) == set(ORDER), "release plan function set differs")
        for name, item in saved.items():
            stage.need(item["beforeRevision"] == plan[name]["beforeRevision"]
                       and item["candidateSha256"] == plan[name]["candidateSha256"]
                       and str(item["beforeSource"]["generation"]) == stage.VERSIONS[name][1]
                       and item["beforeSource"]["bucket"] == stage.BUCKET
                       and item["beforeSource"]["object"] == f"{name}/function-source.zip",
                       f"{name}: saved release plan differs")
        return saved

    for name in ORDER:
        info = publisher.api(publisher.PARENT + "/functions/" + name)
        publisher.validate(info, name)
        stage.source_pointer(name, info)
        plan[name]["beforeSource"] = publisher.source(info)
        plan[name]["protectedSha256"] = publisher.digest(publisher.protected(info))
    publisher.save(state_path, plan)
    return plan


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("repo", type=Path)
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args()
    os.umask(0o077)
    repo = args.repo.resolve(strict=True)
    directory = (repo / "staged").resolve(strict=True)
    with (directory / ".bxh822.lock").open("a") as lock, tempfile.TemporaryDirectory() as temp:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        publisher = load_publisher(repo, Path(temp))
        plan = prepare(repo, directory, publisher)
        assert_pilot_closed()
        for name in ORDER:
            publisher.release(directory, name, plan[name])
        if not args.apply:
            print("BXH822_RELEASE_CHECKED", flush=True)
            return
        for name in ORDER:
            assert_pilot_closed()
            result = publisher.release(directory, name, plan[name], apply=True)
            print(f"{name}: {result['revision']} verified", flush=True)
        print("BXH822_DEPLOYED", flush=True)


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        detail = str(error) if isinstance(error, ValueError) else type(error).__name__
        if isinstance(error, HTTPError):
            detail = f"HTTP {error.code}"
        sys.exit(f"BXH822_RELEASE_STOPPED {detail}")
