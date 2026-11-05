import contextlib
import importlib.util
import io
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import zipfile

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location('priority_capture', ROOT / 'scripts/bucket-priority-readonly.py')
M = importlib.util.module_from_spec(spec)
spec.loader.exec_module(M)


class PriorityCapture(unittest.TestCase):
    def info(self, name=None):
        name = name or M.TARGETS[0]
        return {'name': f'projects/bxh-arena/locations/asia-east1/functions/{name}',
                'state': 'ACTIVE', 'updateTime': 'synthetic-time',
                'buildConfig': {'entryPoint': name, 'source': {'storageSource': {
                    'bucket': 'synthetic-bucket', 'object': 'archive.zip', 'generation': '123'}}},
                'serviceConfig': {'revision': 'synthetic-revision',
                                  'environmentVariables': {'PRIVATE': 'DO_NOT_PRINT'}}}

    def test_read_is_bodyless_get_to_allowlisted_endpoint(self):
        class Opener:
            def __call__(inner, request, timeout):
                self.assertEqual(request.get_method(), 'GET')
                self.assertIsNone(request.data)
                self.assertEqual(request.full_url, M.ROOT + M.TARGETS[0])
                self.assertEqual(request.get_header('Authorization'), 'Bearer SECRET_TOKEN')
                return io.BytesIO(json.dumps(self.info()).encode())
        self.assertEqual(M.read_function(M.TARGETS[0], 'SECRET_TOKEN', Opener())['state'], 'ACTIVE')
        with self.assertRaises(ValueError):
            M.read_function('other', 'SECRET_TOKEN', Opener())

    def test_immutable_source_and_identity_checks(self):
        info = self.info()
        self.assertEqual(M.source_identity(info, M.TARGETS[0])[1], 'gs://synthetic-bucket/archive.zip#123')
        for bad in [{**info, 'state': 'INACTIVE'},
                    {**info, 'name': 'projects/other/locations/asia-east1/functions/' + M.TARGETS[0]}]:
            with self.assertRaises(ValueError):
                M.read_function(M.TARGETS[0], 'token', lambda *_args, **_kw: io.BytesIO(json.dumps(bad).encode()))
        info['buildConfig']['source']['storageSource']['generation'] = ''
        with self.assertRaises(ValueError):
            M.source_identity(info, M.TARGETS[0])

    def test_capture_stability_and_exact_archive_hash(self):
        with tempfile.TemporaryDirectory() as directory:
            out = Path(directory)
            def command(args):
                self.assertEqual(args[:3], ['gcloud', 'storage', 'cp'])
                self.assertEqual(args[3], 'gs://synthetic-bucket/archive.zip#123')
                with zipfile.ZipFile(args[4], 'w') as z:
                    z.writestr('index.js', 'synthetic')
            row = M.capture(M.TARGETS[0], 'token', out, read=lambda name, token: self.info(name), command=command)
            self.assertTrue(row['stableDuringCapture'])
            self.assertEqual(row['sourceArchiveSha256'], M.sha((out / row['sourceArchiveFile']).read_bytes()))
            self.assertNotIn('DO_NOT_PRINT', json.dumps(row))

    def test_changed_function_fails_closed(self):
        with tempfile.TemporaryDirectory() as directory:
            samples = [self.info(), {**self.info(), 'updateTime': 'later'}]
            def command(args):
                with zipfile.ZipFile(args[4], 'w') as z:
                    z.writestr('index.js', 'synthetic')
            with self.assertRaisesRegex(ValueError, 'function-changed-during-capture'):
                M.capture(M.TARGETS[0], 'token', Path(directory), read=lambda *_: samples.pop(0), command=command)

    def test_wrong_project_stops_without_reading_token(self):
        output = io.StringIO()
        with patch.object(M, 'cli', return_value='(unset)') as command, \
                patch('sys.argv', ['bucket-priority-readonly.py']), \
                patch.object(Path, 'home', return_value=Path(tempfile.gettempdir())), \
                contextlib.redirect_stdout(output):
            with self.assertRaises(SystemExit):
                M.main()
        self.assertEqual(command.call_count, 1)
        value = json.loads(output.getvalue())
        self.assertEqual(value['errors'], [{'scope': 'setup', 'kind': 'wrong-active-project'}])
        self.assertEqual(value['productionWrites'], 0)


if __name__ == '__main__':
    unittest.main()
