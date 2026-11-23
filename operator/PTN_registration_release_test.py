import hashlib
import json
from pathlib import Path
import tempfile
import unittest

import PTN_registration_release as release


class RegistrationReleaseTest(unittest.TestCase):
    def test_fingerprint_ignores_metadata_only_changes_but_detects_source_drift(self):
        name = 'registrationQueueV2Worker'
        info = {'buildConfig': {'entryPoint': name, 'runtime': 'nodejs22',
                                'source': {'storageSource': {'bucket': 'source',
                                                             'object': 'code.zip',
                                                             'generation': release.GENERATION[name]}}},
                'labels': {'firebase-functions-codebase': release.CODEBASE},
                'updateTime': 'earlier'}
        refreshed = json.loads(json.dumps(info))
        refreshed['updateTime'] = 'later'
        self.assertEqual(release.fingerprint(info), release.fingerprint(refreshed))
        refreshed['buildConfig']['source']['storageSource']['generation'] = 'changed'
        self.assertNotEqual(release.fingerprint(info), release.fingerprint(refreshed))

    def test_staged_source_and_generation_must_match_selected_function(self):
        name = 'registrationRosterQueueV2'
        info = {'buildConfig': {'entryPoint': name, 'runtime': 'nodejs22',
                                'source': {'storageSource': {'generation': release.GENERATION[name]}}},
                'labels': {'firebase-functions-codebase': release.CODEBASE}}
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / name / 'functions'
            source.mkdir(parents=True)
            (source / 'package.json').write_text(json.dumps({'engines': {'node': '22'}}))
            for path in release.FILES:
                target = source / path
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_bytes(b'candidate')
            (root / name / 'live.zip').write_bytes(b'live source')
            (root / 'report.json').write_text(json.dumps({
                'status': 'STAGED_ONLY', 'productionWrites': 0,
                'functions': [{'function': name, 'generation': release.GENERATION[name],
                               'codebase': release.CODEBASE,
                               'sourceSha256': hashlib.sha256(b'live source').hexdigest()}]}))
            old = release.FILES
            release.FILES = {path: hashlib.sha256(b'candidate').hexdigest() for path in old}
            try:
                self.assertEqual(release.preflight(root, name, info), source)
                info['buildConfig']['source']['storageSource']['generation'] = 'changed'
                with self.assertRaisesRegex(ValueError, 'live binding changed'):
                    release.preflight(root, name, info)
            finally:
                release.FILES = old


if __name__ == '__main__':
    unittest.main()
