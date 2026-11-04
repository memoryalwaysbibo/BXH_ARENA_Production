"""Verify the operator capture with fake gcloud/API responses; no network."""
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('preflight', ROOT / 'scripts/community-referee-readonly-preflight.py')
preflight = importlib.util.module_from_spec(spec)
spec.loader.exec_module(preflight)


class Capture(unittest.TestCase):
    def run_capture(self, *, generation='12345'):
        calls = []
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        destination = Path(temporary.name)

        def command(args):
            calls.append(args)
            if args[:3] == ['gcloud', 'auth', 'print-access-token']:
                return 'private-test-token'
            if args[:3] == ['gcloud', 'functions', 'describe']:
                return json.dumps({'name': args[3], 'buildConfig': {'source': {'storageSource': {
                    'bucket': 'source-bucket', 'object': args[3] + '.zip', 'generation': generation}}},
                    'serviceConfig': {'environmentVariables': {'DO_NOT_SAVE': 'private-environment-value'}}})
            self.assertEqual(args[:3], ['gcloud', 'storage', 'cp'])
            self.assertTrue(args[3].endswith('#12345'))
            Path(args[4]).write_bytes(b'fake-source-archive')
            return ''

        def api(url, token):
            self.assertEqual(token, 'private-test-token')
            if '/releases/' in url:
                return {'rulesetName': 'projects/bxh-arena/rulesets/fixture'}
            if '/rulesets/' in url:
                return {'source': {'files': [{'content': 'captured-live-rules'}]}}
            return {'fields': {'enabled': {'booleanValue': True}, 'unrelatedSecret': {'stringValue': 'do-not-save-config'}}}

        with patch.object(preflight, 'command', command), patch.object(preflight, 'api', api):
            result = preflight.capture(destination)
        return destination, result, calls

    def test_only_describe_and_generation_pinned_downloads(self):
        destination, result, calls = self.run_capture()
        self.assertEqual(len(result['functions']), 2)
        self.assertEqual(result['productionWrites'], 0)
        self.assertFalse(result['matchesReviewedBaseline'])
        self.assertEqual(result['errors'], [])
        self.assertEqual([args[3] for args in calls if args[:3] == ['gcloud', 'functions', 'describe']], list(preflight.FUNCTIONS))
        saved = '\n'.join(file.read_text() for file in destination.glob('*.json'))
        for secret in ['private-test-token', 'private-environment-value', 'do-not-save-config']:
            self.assertNotIn(secret, saved)
        self.assertIn('DO_NOT_SAVE', saved)  # names only, never values

    def test_unpinned_function_source_is_not_downloaded(self):
        _, result, calls = self.run_capture(generation=None)
        self.assertEqual(result['functions'], [])
        self.assertEqual(len(result['errors']), 2)
        self.assertFalse(any(args[:3] == ['gcloud', 'storage', 'cp'] for args in calls))


if __name__ == '__main__':
    unittest.main()
