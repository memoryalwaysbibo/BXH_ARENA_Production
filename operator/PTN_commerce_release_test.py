import hashlib
import json
from pathlib import Path
import tempfile
import unittest

import PTN_commerce_release as release


class CommerceReleaseTest(unittest.TestCase):
    def test_rejects_source_drift_and_requires_exact_staged_code(self):
        info = {'buildConfig': {'entryPoint': release.NAME, 'runtime': 'nodejs22',
                                'source': {'storageSource': {'generation': release.GENERATION}}},
                'labels': {'firebase-functions-codebase': release.CODEBASE}}
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / release.NAME / 'functions'
            source.mkdir(parents=True)
            (source / 'package.json').write_text(json.dumps({'engines': {'node': '22'}}))
            for path in release.FILES:
                (source / path).write_bytes(b'candidate')
            archive = root / release.NAME / 'live.zip'
            archive.write_bytes(b'live source')
            (root / 'report.json').write_text(json.dumps({
                'status': 'STAGED_ONLY', 'productionWrites': 0,
                'functions': [{'function': release.NAME, 'generation': release.GENERATION,
                               'codebase': release.CODEBASE,
                               'sourceSha256': hashlib.sha256(b'live source').hexdigest()}]}))
            old = release.FILES
            release.FILES = {name: hashlib.sha256(b'candidate').hexdigest() for name in old}
            try:
                self.assertEqual(release.preflight(root, info), source)
                (source / 'service.cjs').write_bytes(b'changed')
                with self.assertRaisesRegex(ValueError, 'staged commerce source differs'):
                    release.preflight(root, info)
            finally:
                release.FILES = old


if __name__ == '__main__':
    unittest.main()
