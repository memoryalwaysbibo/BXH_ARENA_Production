import hashlib
import importlib.util
import json
import tempfile
import unittest
import zipfile
from pathlib import Path
from unittest.mock import patch


spec = importlib.util.spec_from_file_location("release", Path(__file__).with_name("BXH859_release.py"))
release = importlib.util.module_from_spec(spec)
spec.loader.exec_module(release)


class ReleaseTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.candidate = self.root / "candidate"
        self.live = {}
        for path, expected in release.CANDIDATE.items():
            data = (Path(__file__).parents[1] / path).read_bytes()
            self.assertEqual(hashlib.sha256(data).hexdigest(), expected)
            target = self.candidate / path
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(data)
            self.live[path] = data + b"\n// previous deployed version\n"
        self.diagnostic = b"// existing diagnostic binding\n"
        self.fixture_hashes = {path: hashlib.sha256(data).hexdigest()
                               for path, data in self.live.items()}

    def stage(self, *, old_change=None, candidate_change=None):
        if candidate_change:
            path = self.candidate / candidate_change
            path.write_bytes(path.read_bytes() + b"\n// unexpected candidate change\n")
        archive = self.root / "live.zip"
        with zipfile.ZipFile(archive, "w") as z:
            for path, data in self.live.items():
                z.writestr(path, data + (b"x" if path == old_change else b""))
            z.writestr(release.BINDINGS, self.diagnostic)
            z.writestr("package.json", json.dumps({"main": "index.cjs", "engines": {"node": "22"}}))
            z.writestr("index.cjs", "'use strict';\n")
            z.writestr("referee-seats/functions/engine/index.cjs", "// preserved engine\n")
        with patch.dict(release.LIVE, self.fixture_hashes), patch.object(
                release, "DIAGNOSTIC_BINDINGS", hashlib.sha256(self.diagnostic).hexdigest()):
            return release.stage(archive, self.candidate, self.root / "release")

    def test_exact_targets_preserve_diagnostic_and_engine(self):
        source = self.stage()
        for path in release.LIVE:
            self.assertEqual((source / path).read_bytes(), (self.candidate / path).read_bytes())
        self.assertEqual((source / release.BINDINGS).read_bytes(), self.diagnostic)
        self.assertEqual((source / "referee-seats/functions/engine/index.cjs").read_text(),
                         "// preserved engine\n")

    def test_live_source_drift_stops(self):
        with self.assertRaisesRegex(ValueError, "deployed source differs"):
            self.stage(old_change=next(iter(release.LIVE)))

    def test_candidate_source_drift_stops(self):
        with self.assertRaisesRegex(ValueError, "candidate source differs"):
            self.stage(candidate_change=next(iter(release.CANDIDATE)))


if __name__ == "__main__":
    unittest.main()
