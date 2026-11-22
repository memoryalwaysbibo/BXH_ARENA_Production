import importlib.util
import json
import tempfile
import unittest
import zipfile
from pathlib import Path
from unittest.mock import patch


module_path = Path(__file__).with_name("BXH851_release.py")
spec = importlib.util.spec_from_file_location("bxh851_release", module_path)
release = importlib.util.module_from_spec(spec)
spec.loader.exec_module(release)


class ReleaseStageTest(unittest.TestCase):
    def test_deploy_target_scopes_to_one_function_in_codebase(self):
        self.assertEqual(release.DEPLOY_TARGET,
                         "functions:bxh-registration-v2-closed:registrationRosterQueueV2")

    def test_stage_changes_only_reviewed_files(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            candidate = root / "candidate"
            old = b"'use strict';\nmodule.exports='old';\n"
            new = b"'use strict';\nmodule.exports='new';\n"
            path = "registration-flow-v2/backend/bindings.cjs"
            (candidate / path).parent.mkdir(parents=True)
            (candidate / path).write_bytes(new)
            archive = root / "live.zip"
            with zipfile.ZipFile(archive, "w") as zipped:
                zipped.writestr(path, old)
                zipped.writestr("index.cjs", "module.exports = require('./bindings.cjs');\n")
                zipped.writestr("package.json", json.dumps({"main": "index.cjs", "engines": {"node": "22"}}))
                zipped.writestr("keep.cjs", "module.exports = 'live only';\n")
            with patch.object(release, "FILES", {path: release.digest(old)}):
                source = release.stage(archive, candidate, root / "out")
            self.assertEqual((source / path).read_bytes(), new)
            self.assertEqual((source / "keep.cjs").read_text(), "module.exports = 'live only';\n")
            config = json.loads((root / "out/firebase.json").read_text())
            self.assertEqual(config["functions"][0]["codebase"], release.CODEBASE)

    def test_stage_rejects_unknown_live_source(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            archive = root / "live.zip"
            with zipfile.ZipFile(archive, "w") as zipped:
                zipped.writestr("registration-flow-v2/backend/bindings.cjs", "unexpected")
            with self.assertRaisesRegex(ValueError, "deployed source differs"):
                release.stage(archive, root, root / "out")


if __name__ == "__main__":
    unittest.main()
