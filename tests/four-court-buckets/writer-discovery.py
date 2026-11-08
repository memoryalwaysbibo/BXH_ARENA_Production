"""Offline discovery tests: pagination, coverage gaps, identities and redaction."""
import importlib.util
import json
import io
import contextlib
import os
import tempfile
from pathlib import Path
import unittest
from urllib.parse import urlsplit, parse_qs
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location('discovery', ROOT / 'scripts/bucket-writer-discovery.py')
M = importlib.util.module_from_spec(spec)
spec.loader.exec_module(M)
BASE = 'projects/bxh-arena/locations/asia-east1/'
NUMBER = '123456789012'
SECRET = 'ENVIRONMENT_VALUE_MUST_NOT_APPEAR'


def function():
    return {'name': BASE + 'functions/sample', 'environmentVariables': {'KEY': SECRET},
            'buildConfig': {'entryPoint': 'sample', 'runtime': 'nodejs22'},
            'serviceConfig': {'service': BASE + 'services/sample', 'environmentVariables': {'KEY': SECRET}}}


class Discovery(unittest.TestCase):
    def read(self, url, token):
        self.assertEqual(token, 'synthetic-token')
        parts = urlsplit(url)
        self.calls.append(url)
        if parts.hostname == 'cloudfunctions.googleapis.com':
            return {'functions': [function()]}
        self.assertNotIn('/locations/-/', parts.path)
        if parts.path.endswith('/services'):
            region = parts.path.split('/')[5]
            return {'services': [
                {'name': BASE.replace('/asia-east1/', '/' + region + '/') + 'services/sample', 'template': {'containers': [{'env': [{'value': SECRET}]}]}},
                {'name': BASE.replace('/asia-east1/', '/' + region + '/') + 'services/direct-admin', 'labels': {'goog-managed-by': 'cloudfunctions'}},
            ]}
        region = parts.path.split('/')[5]
        return {'jobs': [{'name': BASE.replace('/asia-east1/', '/' + region + '/') + 'jobs/maintenance', 'template': {'env': SECRET}}]}

    def setUp(self):
        self.calls = []

    def run_discovery(self, read=None):
        return M.discover('synthetic-token', NUMBER, {'asia-east1'}, read or self.read)

    def test_all_api_views_services_and_jobs_remain_unreviewed(self):
        report = self.run_discovery()
        self.assertTrue(report['metadataDiscoveryComplete'])
        self.assertEqual(len(report['functions']), 1)
        self.assertEqual(set(report['functions'][0]['apiViews']), {'v1', 'v2'})
        self.assertEqual(len(report['services']), 2)
        self.assertEqual(len(report['jobs']), 1)
        linked = next(x for x in report['services'] if x['name'].endswith('/sample'))
        self.assertEqual(linked['linkedFunctions'], [BASE + 'functions/sample'])
        direct = next(x for x in report['services'] if x['name'].endswith('/direct-admin'))
        self.assertEqual(direct['linkedFunctions'], [])
        self.assertEqual(direct['writerClassification'], 'unreviewed')
        for kind in ['functions', 'services', 'jobs']:
            self.assertTrue(all(x['writerClassification'] == 'unreviewed' for x in report[kind]))
        self.assertNotIn(SECRET, json.dumps(report))
        for gate in ['writerInventoryComplete', 'sourceReviewComplete', 'acceptanceCompleted']:
            self.assertFalse(report[gate])

    def test_locations_discovery_paginates_and_rejects_cycles(self):
        def read(url, token):
            self.assertEqual(urlsplit(url).path, '/v1/projects/bxh-arena/locations')
            if parse_qs(urlsplit(url).query).get('pageToken'):
                return {'locations': [{'locationId': 'us-central1'}]}
            return {'locations': [{'locationId': 'asia-east1'}], 'nextPageToken': 'next'}
        regions, digest = M.read_regions('synthetic-token', read)
        self.assertEqual(regions, {'asia-east1', 'us-central1'})
        self.assertEqual(len(digest), 64)
        with self.assertRaises(RuntimeError):
            M.read_regions('synthetic-token', lambda *args: {'locations': [], 'nextPageToken': 'same'})
        with self.assertRaises(RuntimeError):
            M.read_regions('synthetic-token', lambda *args: {'locations': []})

    def test_global_functions_and_pagination(self):
        def read(url, token):
            parts = urlsplit(url)
            if parts.hostname != 'cloudfunctions.googleapis.com':
                return self.read(url, token)
            self.assertIn('/locations/-/functions', parts.path)
            f = function()
            if not parse_qs(parts.query).get('pageToken'):
                return {'functions': [f], 'nextPageToken': 'next'}
            f['name'] = f['name'].replace('asia-east1', 'us-central1')
            f['serviceConfig'].pop('service')
            return {'functions': [f]}
        report = M.discover('synthetic-token', NUMBER, {'asia-east1', 'us-central1'}, read)
        self.assertEqual(len(report['functions']), 2)
        self.assertTrue(report['metadataDiscoveryComplete'])

    def test_missing_linked_service_blocks(self):
        def read(url, token):
            data = self.read(url, token)
            if urlsplit(url).path.endswith('/services'):
                data['services'] = []
            return data
        report = self.run_discovery(read)
        self.assertFalse(report['metadataDiscoveryComplete'])
        self.assertTrue(any(x['scope'] == 'function-service-links' for x in report['errors']))

    def test_unreachable_is_not_success(self):
        def read(url, token):
            data = self.read(url, token)
            if '/v2/projects/' in url and '/functions?' in url:
                data['unreachable'] = ['missing-region']
            return data
        report = self.run_discovery(read)
        self.assertFalse(report['metadataDiscoveryComplete'])
        self.assertEqual(len(report['unreachable']), 1)

    def test_any_pagination_cycle_is_not_success(self):
        def read(url, token):
            if '/v1/' in url:
                page = parse_qs(urlsplit(url).query).get('pageToken', [''])[0]
                return {'functions': [], 'nextPageToken': {'': 'a', 'a': 'b', 'b': 'a'}[page]}
            return self.read(url, token)
        report = self.run_discovery(read)
        self.assertFalse(report['metadataDiscoveryComplete'])
        self.assertTrue(any(x['scope'] == 'functions-v1' for x in report['errors']))

    def test_permission_failure_keeps_other_scopes_and_blocks_completeness(self):
        def read(url, token):
            if urlsplit(url).path.endswith('/jobs'):
                raise RuntimeError('HTTP 403 ' + SECRET)
            return self.read(url, token)
        report = self.run_discovery(read)
        self.assertFalse(report['metadataDiscoveryComplete'])
        self.assertEqual(len(report['services']), 2)
        self.assertNotIn(SECRET, json.dumps(report))

    def test_resource_identity_and_project_alias(self):
        name, region = M.resource(BASE.replace('bxh-arena', NUMBER) + 'services/direct', 'services', {'bxh-arena', NUMBER})
        self.assertEqual(name, BASE + 'services/direct')
        self.assertEqual(region, 'asia-east1')
        for value in [BASE.replace('bxh-arena', 'other-project') + 'services/x', BASE + 'services/x/extra']:
            with self.assertRaises(RuntimeError):
                M.resource(value, 'services', {'bxh-arena', NUMBER})

    def test_empty_or_incomplete_region_discovery_blocks(self):
        self.assertFalse(M.discover('synthetic-token', NUMBER, set(), self.read)['metadataDiscoveryComplete'])
        self.assertFalse(M.discover('synthetic-token', NUMBER, {'us-central1'}, self.read)['metadataDiscoveryComplete'])

    def test_duplicate_identity_blocks(self):
        def read(url, token):
            if '/functions?' in url:
                return {'functions': [function(), function()]}
            return self.read(url, token)
        self.assertFalse(self.run_discovery(read)['metadataDiscoveryComplete'])

    def test_endpoint_guard_rejects_writes_cross_project_and_token_redirects(self):
        with patch.object(M.urllib.request, 'build_opener', side_effect=AssertionError('No request allowed')):
            for url in [
                'https://example.com/v2/projects/bxh-arena/locations/asia-east1/services',
                'http://run.googleapis.com/v2/projects/bxh-arena/locations/asia-east1/services',
                'https://run.googleapis.com/v2/projects/other/locations/asia-east1/services',
                'https://run.googleapis.com/v2/projects/bxh-arena/locations/-/services',
                'https://run.googleapis.com/v2/projects/bxh-arena/locations/asia-east1/services:delete',
                'https://run.googleapis.com/v2/projects/bxh-arena/locations/asia-east1/services?alt=media',
            ]:
                with self.assertRaises(RuntimeError):
                    M.get_api(url, 'synthetic-token')
        with self.assertRaises(RuntimeError):
            M.NoRedirect().redirect_request(None, None, None, None, None, None)

    def test_allowed_request_is_get_and_has_no_body(self):
        class Response(io.BytesIO):
            pass

        class Opener:
            def open(inner, request, timeout):
                self.assertEqual(request.get_method(), 'GET')
                self.assertIsNone(request.data)
                self.assertEqual(timeout, 60)
                self.assertEqual(request.get_header('Authorization'), 'Bearer synthetic-token')
                return Response(b'{"functions": []}')

        with patch.object(M.urllib.request, 'build_opener', return_value=Opener()):
            result = M.get_api('https://cloudfunctions.googleapis.com/v2/projects/bxh-arena/locations/-/functions?pageSize=100', 'synthetic-token')
        self.assertEqual(result, {'functions': []})

    def test_setup_failure_saves_private_redacted_report_and_exits_nonzero(self):
        previous = os.umask(0o077)
        try:
            with tempfile.TemporaryDirectory() as home, patch.object(M.Path, 'home', return_value=Path(home)):
                # Never contact gcloud or the network in this failure-path test.
                output = io.StringIO()
                with patch.object(M, 'cli', side_effect=RuntimeError(SECRET)), \
                        patch('sys.argv', ['bucket-writer-discovery.py']), contextlib.redirect_stdout(output):
                    with self.assertRaises(SystemExit) as caught:
                        M.main()
                self.assertEqual(caught.exception.code, 1)
                summary = json.loads(output.getvalue())
                path = Path(summary['reportFile'])
                self.assertFalse(summary['metadataDiscoveryComplete'])
                self.assertNotIn(SECRET, path.read_text())
                self.assertEqual(path.stat().st_mode & 0o777, 0o600)
                self.assertEqual(Path(summary['reviewZip']).stat().st_mode & 0o777, 0o600)
        finally:
            os.umask(previous)


if __name__ == '__main__':
    unittest.main()
