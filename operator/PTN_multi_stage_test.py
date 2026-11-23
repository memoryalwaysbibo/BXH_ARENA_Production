import io
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import zipfile

import PTN_multi_stage as release


class StageTest(unittest.TestCase):
    def test_main_selects_three_candidate_directories(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory) / 'stage'
            root.mkdir()
            seen = {}
            targets = {'registrationQueueV2': ('11', ()),
                       'commerceService': ('22', ()),
                       'ladderAutoSettlement': ('33', ())}
            def fake_checkout(path, repo, ref):
                path.mkdir()
            def fake_describe(name):
                return ('bucket', 'source.zip', targets[name][0],
                        None if name == 'ladderAutoSettlement' else 'codebase')
            def fake_stage(root, name, binding, candidate, category):
                seen[name] = (candidate, category)
                return {'function': name, 'generation': binding[2], 'codebase': binding[3]}
            with (patch.dict(release.TARGETS, targets, clear=True),
                  patch.object(release.tempfile, 'mkdtemp', return_value=str(root)),
                  patch.object(release, 'checkout', side_effect=fake_checkout),
                  patch.object(release, 'describe', side_effect=fake_describe),
                  patch.object(release, 'stage_one', side_effect=fake_stage)):
                release.main()
            self.assertEqual(seen, {
                'registrationQueueV2': (root / 'candidates/front', 'room'),
                'commerceService': (root / 'candidates/commerce/release/commerce/functions', 'commerce'),
                'ladderAutoSettlement': (root / 'candidates/settlement/release/bucket-settlement-package/auto', 'settlement')})

    def test_requires_codebase_for_other_functions(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory) / 'stage'
            root.mkdir()
            with (patch.dict(release.TARGETS, {'commerceService': ('22', ())}, clear=True),
                  patch.object(release.tempfile, 'mkdtemp', return_value=str(root)),
                  patch.object(release, 'checkout', side_effect=lambda path, repo, ref: path.mkdir()),
                  patch.object(release, 'describe', return_value=('bucket', 'source.zip', '22', None)),
                  patch.object(release, 'stage_one') as stage):
                with self.assertRaisesRegex(ValueError, 'codebase changed'):
                    release.main()
                stage.assert_not_called()

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
