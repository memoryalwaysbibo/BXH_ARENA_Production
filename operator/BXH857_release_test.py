import importlib.util
import hashlib
import json
import tempfile
import unittest
import zipfile
from pathlib import Path


spec = importlib.util.spec_from_file_location("release", Path(__file__).with_name("BXH857_release.py"))
release = importlib.util.module_from_spec(spec)
spec.loader.exec_module(release)


class ReleaseTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.candidate = (Path(__file__).parents[1] / release.PATH).read_bytes()
        self.live = self.candidate.replace(release.DIAGNOSTIC, b"", 1)
        self.assertEqual(hashlib.sha256(self.live).hexdigest(), release.LIVE_SHA)
        self.assertEqual(self.candidate.count(release.DIAGNOSTIC), 1)
        self.assertEqual(self.live.count(release.ANCHOR), 1)

    def stage(self, live=None, candidate=None):
        source = self.root / "candidate"
        path = source / release.PATH
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(candidate if candidate is not None else self.candidate)
        archive = self.root / "live.zip"
        with zipfile.ZipFile(archive, "w") as z:
            z.writestr(release.PATH, live if live is not None else self.live)
            z.writestr("package.json", json.dumps({"main": "index.cjs", "engines": {"node": "22"}}))
            z.writestr("index.cjs", "'use strict';\n")
        return release.stage(archive, source, self.root / "release")

    def test_exact_pinned_insertion(self):
        source = self.stage()
        self.assertEqual((source / release.PATH).read_bytes(), self.candidate)
        self.assertEqual((source / "index.cjs").read_text(), "'use strict';\n")

    def test_live_source_change_stops(self):
        with self.assertRaisesRegex(ValueError, "deployed bindings differ"):
            self.stage(live=self.live + b"\n")

    def test_candidate_extra_change_stops(self):
        with self.assertRaisesRegex(ValueError, "candidate differs"):
            self.stage(candidate=self.candidate + b"\n")

    def test_diagnostic_missing_stops(self):
        with self.assertRaisesRegex(ValueError, "candidate differs"):
            self.stage(candidate=self.live)


if __name__ == "__main__":
    unittest.main()
