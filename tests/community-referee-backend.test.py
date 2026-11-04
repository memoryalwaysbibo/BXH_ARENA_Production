"""Check deployment scope against the immutable production source archive."""
import importlib.util
import io
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import zipfile

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('backend', ROOT / 'scripts/build-community-referee-backend.py')
backend = importlib.util.module_from_spec(spec)
spec.loader.exec_module(backend)


class LiveSource(unittest.TestCase):
    def test_manifest_reproduces_and_only_five_files_change(self):
        files, manifest = backend.build()
        self.assertEqual(manifest, json.loads(backend.MANIFEST.read_text()))
        self.assertEqual(manifest['changedFiles'], sorted((*backend.OVERLAYS, 'scoring-core.cjs')))
        reference = json.loads(backend.REFERENCE.read_text())
        with zipfile.ZipFile(io.BytesIO((backend.REFERENCE.parent / reference['sourceFile']).read_bytes())) as archive:
            for name in files:
                if name not in manifest['changedFiles']:
                    self.assertEqual(files[name], archive.read(name), name)
        self.assertNotIn(b'transitionLocal', files['scoring-core.cjs'])
        self.assertNotIn(b'bucket-runtime-entry', files['index.js'])
        self.assertIn(b"throw Error('bucket-scoring-required')", files['bucket-legacy-fence.cjs'])

    def test_changed_archive_is_rejected_before_build(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            reference = json.loads(backend.REFERENCE.read_text())
            (root / reference['sourceFile']).write_bytes(b'changed-source')
            path = root / 'reference.json'
            path.write_text(json.dumps(reference))
            with patch.object(backend, 'REFERENCE', path):
                with self.assertRaisesRegex(ValueError, 'archive mismatch'):
                    backend.build()


if __name__ == '__main__':
    unittest.main()
