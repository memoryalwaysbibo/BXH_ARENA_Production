import io
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import zipfile

import PTN_multi_stage as release


class StageTest(unittest.TestCase):
    def test_preserves_unreviewed_files_and_rejects_source_drift(self):
        live = {'domain.cjs': b'module.exports=1;', 'service.cjs': b'module.exports=2;',
                'ticket-purchase.cjs': b'module.exports=3;',
                'index.js': b'module.exports=4;',
                'package.json': json.dumps({'engines': {'node': '22'}}).encode()}
        proposed = {name: b'module.exports=' + str(i + 5).encode() + b';'
                    for i, name in enumerate(release.FILES['commerce'])}
        def archive(data):
            raw = io.BytesIO()
            with zipfile.ZipFile(raw, 'w') as out:
                for name, content in data.items():
                    out.writestr(name, content)
            return raw.getvalue()
        def run(command, **kwargs):
            if command[:3] == ['gcloud', 'storage', 'cp']:
                Path(command[4]).write_bytes(archive(live))
            elif command[:2] != ['node', '--check']:
                raise AssertionError(command)
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            candidate = root / 'candidate'
            candidate.mkdir()
            for name, content in proposed.items():
                (candidate / name).write_bytes(content)
            with (patch.dict(release.TARGETS, {'commerceService': ('1', tuple(map(release.digest, live.values()))[:3])}),
                  patch.dict(release.REPLACEMENT, {'commerce': tuple(release.digest(proposed[name])
                                                            for name in release.FILES['commerce'])}),
                  patch.object(release.subprocess, 'run', side_effect=run)):
                report = release.stage_one(root, 'commerceService', ('bucket', 'source.zip', '1', 'commerce'),
                                           candidate, 'commerce')
                staged = root / 'commerceService' / 'functions'
                self.assertEqual(report['replaced'], list(release.FILES['commerce']))
                self.assertEqual((staged / 'index.js').read_bytes(), live['index.js'])
                self.assertEqual((staged / 'service.cjs').read_bytes(), proposed['service.cjs'])
                live['service.cjs'] = b'module.exports=99;'
                with self.assertRaisesRegex(ValueError, 'live file differs'):
                    release.stage_one(root / 'retry', 'commerceService',
                                      ('bucket', 'source.zip', '1', 'commerce'), candidate, 'commerce')


if __name__ == '__main__':
    unittest.main()
