import hashlib
import json
from pathlib import Path
import tempfile
import unittest

import PTN_settlement_release as release


class SettlementReleaseTest(unittest.TestCase):
    def test_preflight_rejects_trigger_drift_and_checks_staged_hashes(self):
        info = {'buildConfig': {'entryPoint': release.NAME, 'runtime': 'nodejs22',
                                'source': {'storageSource': {'generation': release.GENERATION}}},
                'serviceConfig': {'availableMemory': '256Mi', 'timeoutSeconds': 60},
                'eventTrigger': {'eventType': 'google.cloud.firestore.document.v1.written',
                                 'eventFilters': [
                                     {'attribute': 'database', 'value': '(default)'},
                                     {'attribute': 'namespace', 'value': '(default)'},
                                     {'attribute': 'document', 'operator': 'match-path-pattern',
                                      'value': 'tournaments/{code}'}]}}
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / release.NAME / 'functions'
            source.mkdir(parents=True)
            (source / 'package.json').write_text(json.dumps({'engines': {'node': '22'}}))
            for path in release.SOURCE:
                (source / path).write_bytes(b'candidate')
            zip_bytes = b'live archive'
            (root / release.NAME / 'live.zip').write_bytes(zip_bytes)
            (root / 'report.json').write_text(json.dumps({
                'status': 'STAGED_ONLY', 'productionWrites': 0,
                'functions': [{'function': release.NAME, 'generation': release.GENERATION,
                               'sourceSha256': hashlib.sha256(zip_bytes).hexdigest()}]}))
            old = release.SOURCE
            release.SOURCE = {path: hashlib.sha256(b'candidate').hexdigest() for path in old}
            try:
                self.assertEqual(release.preflight(root, info), source)
                info['eventTrigger']['eventFilters'][-1]['value'] = 'tournaments/{id}'
                with self.assertRaisesRegex(ValueError, 'trigger differs'):
                    release.preflight(root, info)
            finally:
                release.SOURCE = old


if __name__ == '__main__':
    unittest.main()
