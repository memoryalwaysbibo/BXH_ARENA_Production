import importlib.util
import io
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import zipfile

spec = importlib.util.spec_from_file_location('release819', Path(__file__).with_name('BXH819_release.py'))
M = importlib.util.module_from_spec(spec)
spec.loader.exec_module(M)


def archive(name):
    output = io.BytesIO()
    with zipfile.ZipFile(M.ROOT / 'tests/fixtures/pass-manual-source-baseline.zip') as fixtures:
        with zipfile.ZipFile(output, 'w', compression=zipfile.ZIP_DEFLATED) as z:
            for file in ['engine/pass-return.cjs', 'dispatch-core.cjs']:
                z.writestr(file, fixtures.read(name + '/' + file))
            for file, raw in [('index.js', b'/* deployed exports */'), ('package.json', b'{}'),
                              ('engine/index.cjs', b'/* deployed engine */'), ('untouched.bin', b'\x00\xff')]:
                z.writestr(file, raw)
    return output.getvalue()


class ReleaseTests(unittest.TestCase):
    def test_both_overlays_preserve_every_other_entry(self):
        candidate = (M.ROOT / 'referee-seats/functions/engine/pass-return.cjs').read_bytes()
        for name in M.REVISIONS:
            before = archive(name)
            after = M.patch_archive(before, name, candidate)
            with zipfile.ZipFile(io.BytesIO(before)) as a, zipfile.ZipFile(io.BytesIO(after)) as b:
                self.assertEqual(a.namelist(), b.namelist())
                changed = {n for n in a.namelist() if a.read(n) != b.read(n)}
                self.assertEqual(changed, {'engine/pass-return.cjs', 'dispatch-core.cjs'})
                self.assertEqual(b.read('engine/pass-return.cjs'), candidate)
                self.assertIn(M.NEW.encode(), b.read('dispatch-core.cjs'))

    def test_unknown_source_and_duplicate_entries_are_rejected(self):
        raw = archive('commitRefereeCommand')
        with zipfile.ZipFile(io.BytesIO(raw)) as z: files = {n: z.read(n) for n in z.namelist()}
        files['dispatch-core.cjs'] += b'/* drift */'
        output = io.BytesIO()
        with zipfile.ZipFile(output, 'w') as z:
            for name, value in files.items(): z.writestr(name, value)
        with self.assertRaisesRegex(ValueError, 'source has changed'):
            M.patch_archive(output.getvalue(), 'commitRefereeCommand', b'candidate')

    def test_dry_run_cannot_submit_a_deployment(self):
        name = 'commitRefereeCommand'
        info = {'name': M.PARENT + '/functions/' + name, 'state': 'ACTIVE', 'updateTime': 'before',
                'buildConfig': {'entryPoint': name, 'runtime': 'nodejs22', 'source': {'storageSource': {
                    'bucket': 'gcf-v2-sources-87261141693-asia-east1', 'object': name + '/function-source.zip', 'generation': '1'}}},
                'serviceConfig': {'revision': M.REVISIONS[name], 'timeoutSeconds': 30}}
        item = {'beforeRevision': M.REVISIONS[name], 'beforeSource': M.source(info),
                'protectedSha256': M.digest(M.protected(info)), 'candidateSha256': 'expected'}
        calls = []
        def api(resource, method='GET', body=None):
            calls.append((resource, method, body))
            self.assertEqual(method, 'GET')
            return info
        with tempfile.TemporaryDirectory() as d, patch.object(M, 'api', side_effect=api):
            result = M.release(Path(d), name, item)
            self.assertEqual(result['productionWrites'], 0)
            self.assertEqual(len(calls), 1)
            self.assertFalse(list(Path(d).iterdir()))

    def test_ambiguous_patch_is_not_retried(self):
        with tempfile.TemporaryDirectory() as d, patch.object(M, 'api') as api:
            directory = Path(d)
            (directory / 'commitRefereeCommand.release.json').write_text(json.dumps({'status': 'patching'}))
            with self.assertRaisesRegex(ValueError, 'Ambiguous prior request'):
                M.release(directory, 'commitRefereeCommand', {'candidateSha256': 'expected'}, apply=True)
            api.assert_not_called()

    def test_pending_operation_resumes_verification_without_another_patch(self):
        with tempfile.TemporaryDirectory() as d, patch.object(M, 'api') as api, patch.object(M, 'poll') as poll, patch.object(M, 'verify', return_value={'status': 'complete'}) as verify:
            directory = Path(d)
            (directory / 'commitRefereeCommand.release.json').write_text(json.dumps({'status': 'pending', 'operation': 'operation/one'}))
            result = M.release(directory, 'commitRefereeCommand', {'candidateSha256': 'expected'}, apply=True)
            self.assertEqual(result['status'], 'complete')
            poll.assert_called_once_with('operation/one')
            verify.assert_called_once()
            api.assert_not_called()


if __name__ == '__main__': unittest.main()
