import importlib.util
import io
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import zipfile

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location('followup', ROOT / 'scripts/bucket-writer-followup.py')
M = importlib.util.module_from_spec(spec)
spec.loader.exec_module(M)
SECRET = 'PRIVATE_ENV_VALUE'


class Followup(unittest.TestCase):
    def info(self):
        return {'name': 'projects/bxh-arena/locations/asia-east1/functions/manageRefereeSeats',
                'state': 'ACTIVE', 'environment': 'GEN_2', 'updateTime': 'snapshot',
                'serviceConfig': {'environmentVariables': {'PRIVATE': SECRET}},
                'buildConfig': {'entryPoint': 'manageRefereeSeats', 'source': {'storageSource': {
                    'bucket': 'synthetic-source', 'object': 'function-source.zip', 'generation': '123456'}}}}

    def test_error_details_keep_status_and_reasons_without_messages(self):
        raw = json.dumps({'error': {'status': 'PERMISSION_DENIED', 'message': SECRET,
                                   'details': [{'reason': 'LOCATION_POLICY_VIOLATED', 'metadata': {'secret': SECRET}}]}}).encode()
        result = M.safe_http_error(403, raw)
        self.assertEqual(result['httpStatus'], 403)
        self.assertEqual(result['reasons'], ['LOCATION_POLICY_VIOLATED'])
        self.assertNotIn(SECRET, json.dumps(result))

    def test_region_pagination_and_identity(self):
        pages = iter([{'services': [], 'nextPageToken': 'next'}, {'services': [
            {'name': 'projects/bxh-arena/locations/me-central2/services/sample'}]}])
        result = M.retry_region('services', 'synthetic', lambda *args: next(pages))
        self.assertTrue(result['complete'])
        self.assertEqual(len(result['resources']), 1)
        for name in ['projects/999999999999/locations/me-central2/services/sample',
                     'projects/bxh-arena/locations/asia-east1/services/sample']:
            with self.assertRaises(M.ReadError):
                M.retry_region('services', 'synthetic', lambda *args: {'services': [{'name': name}]})
        with self.assertRaises(M.ReadError):
            M.retry_region('jobs', 'synthetic', lambda *args: {'jobs': [], 'nextPageToken': 'same'})

    def test_immutable_source_capture_and_config_redaction(self):
        with tempfile.TemporaryDirectory() as directory:
            dest = Path(directory)
            def command(args):
                self.assertEqual(args[:3], ['gcloud', 'storage', 'cp'])
                self.assertEqual(args[3], 'gs://synthetic-source/function-source.zip#123456')
                with zipfile.ZipFile(args[4], 'w') as z:
                    z.writestr('index.js', 'synthetic source')
            row = M.capture_function('manageRefereeSeats', 'synthetic', dest, lambda *args: self.info(), command)
            self.assertTrue(row['stableDuringCapture'])
            self.assertEqual(len(row['sourceArchiveSha256']), 64)
            self.assertNotIn(SECRET, json.dumps(row))
            self.assertEqual((dest / row['sourceArchiveFile']).stat().st_mode & 0o777, 0o600)

    def test_deployment_drift_and_missing_generation_stop_capture(self):
        with tempfile.TemporaryDirectory() as directory:
            dest = Path(directory)
            def command(args):
                with zipfile.ZipFile(args[4], 'w') as z:
                    z.writestr('index.js', 'synthetic source')
            info, after = self.info(), self.info()
            after['updateTime'] = 'new deployment'
            responses = iter([info, after])
            with self.assertRaises(M.ReadError):
                M.capture_function('manageRefereeSeats', 'synthetic', dest, lambda *args: next(responses), command)
            info['buildConfig']['source']['storageSource'].pop('generation')
            with self.assertRaises(M.ReadError):
                M.capture_function('manageRefereeSeats', 'synthetic', dest, lambda *args: info,
                                   lambda *args: self.fail('Must not download unpinned source'))

    def test_get_is_bodyless_and_endpoint_limited(self):
        class Opener:
            def open(inner, request, timeout):
                self.assertEqual(request.get_method(), 'GET')
                self.assertIsNone(request.data)
                return io.BytesIO(b'{}')
        with patch.object(M.urllib.request, 'build_opener', return_value=Opener()):
            self.assertEqual(M.get(M.FUNCTION_ROOT + 'manageRefereeSeats', 'synthetic'), {})
        with patch.object(M.urllib.request, 'build_opener', side_effect=AssertionError('Unexpected request')):
            for url in ['https://example.com/anything', M.FUNCTION_ROOT + 'other',
                        M.RUN_ROOT + 'services:delete', M.RUN_ROOT + 'jobs?alt=media']:
                with self.assertRaises(M.ReadError):
                    M.get(url, 'synthetic')
        with self.assertRaises(M.ReadError):
            M.NoRedirect().redirect_request(None, None, None, None, None, None)


if __name__ == '__main__':
    unittest.main()
