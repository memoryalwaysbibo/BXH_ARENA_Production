"""Offline checks only; never access Google Cloud in tests."""
import hashlib
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import zipfile

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('inventory', ROOT / 'operator/BXH816_readonly_inventory.py')
M = importlib.util.module_from_spec(spec)
spec.loader.exec_module(M)


def info(name='commitRefereeCommand'):
    return {'name': f'projects/{M.PROJECT}/locations/{M.REGION}/functions/{name}', 'state': 'ACTIVE',
            'buildConfig': {'runtime': 'nodejs22', 'entryPoint': name, 'source': {'storageSource': {
                'bucket': 'gcf-v2-sources-87261141693-asia-east1', 'object': 'commitRefereeCommand/function-source.zip', 'generation': '12345'}}},
            'serviceConfig': {'revision': 'fixture-revision', 'environmentVariables': {'PRIVATE_SECRET': 'never-print-secret', 'BXH_BUCKET_RUNTIME_ENABLED': 'true'}, 'secretEnvironmentVariables': [{'key': 'secret-key'}]}}


class Inventory(unittest.TestCase):
    def test_fingerprints_read_selected_members_without_extracting(self):
        with tempfile.TemporaryDirectory() as directory:
            target = Path(directory) / 'fixture.zip'
            with zipfile.ZipFile(target, 'w') as archive:
                archive.writestr('scoring-core.cjs', 'synthetic-source')
                archive.writestr('unrelated-secret.txt', 'never-print-secret')
            result = M.fingerprints(target)
            self.assertEqual(result['scoring-core.cjs'], hashlib.sha256(b'synthetic-source').hexdigest())
            self.assertIsNone(result['index.js'])
            self.assertNotIn('unrelated-secret.txt', result)
            self.assertEqual(list(Path(directory).iterdir()), [target])

    def test_unexpected_project_and_storage_targets_refused(self):
        self.assertTrue(M.source_uri(info()).endswith('#12345'))
        for mutate in [lambda i: i.update(name='projects/other/functions/commitRefereeCommand'),
                       lambda i: i['buildConfig']['source']['storageSource'].update(bucket='other'),
                       lambda i: i['buildConfig']['source']['storageSource'].update(generation='latest'),
                       lambda i: i['buildConfig']['source']['storageSource'].update(object='../source.zip')]:
            value = info(); mutate(value)
            with self.assertRaises(ValueError): M.source_uri(value)

    def test_archive_path_guard(self):
        with tempfile.TemporaryDirectory() as directory:
            target = Path(directory) / 'fixture.zip'
            for name in ['../file', '/file', 'dir\\file']:
                with zipfile.ZipFile(target, 'w') as archive: archive.writestr(name, 'synthetic')
                with self.assertRaises(ValueError): M.fingerprints(target)

    def test_summaries_exclude_credentials_and_unrelated_config(self):
        summary = M.summarize_function(info())
        self.assertTrue(summary['bucketRuntimeEnabled'])
        self.assertNotIn('never-print-secret', json.dumps(summary)); self.assertNotIn('secret-key', json.dumps(summary))
        flags = M.summarize_flags({'fields': {'perCourtScoringVerified': {'booleanValue': True}, 'privateValue': {'stringValue': 'never-print-secret'}, 'productionRooms': {'mapValue': {'fields': {'BXH-TEST00': {'stringValue': 'private-epoch'}}}}}})
        self.assertTrue(flags['flags']['perCourtScoringVerified']); self.assertEqual(flags['productionRoomCount'], 1)
        self.assertNotIn('private-epoch', json.dumps(flags)); self.assertNotIn('never-print-secret', json.dumps(flags))

    def test_capture_uses_only_read_commands_and_never_echoes_token(self):
        calls = []
        def command(args):
            calls.append(args)
            if args[:3] == ['gcloud', 'functions', 'describe']: return json.dumps(info(args[3]))
            if args[:3] == ['gcloud', 'storage', 'cp']: return ''
            if args[:3] == ['gcloud', 'auth', 'print-access-token']: return 'never-print-token'
            raise AssertionError(args)
        def api(url, token):
            self.assertEqual(token, 'never-print-token')
            if '/releases/' in url: return {'rulesetName': 'projects/bxh-arena/rulesets/fixture'}
            if '/rulesets/' in url: return {'source': {'files': [{'name': 'firestore.rules', 'content': 'fixture-rules'}]}}
            return {'fields': {'enabled': {'booleanValue': False}}}
        with patch.object(M, 'command', command), patch.object(M, 'api', api), patch.object(M, 'fingerprints', return_value=M.CAPTURED):
            result = M.capture()
        self.assertEqual(result['productionWrites'], 0); self.assertFalse(result['trialAuthorized'])
        self.assertFalse(result['errors']); self.assertTrue(all(result['matchesProvidedCapture'].values()))
        self.assertNotIn('never-print', json.dumps(result)); self.assertEqual(len(calls), 7)

    def test_unavailable_reads_are_not_reported_as_absent_deployments(self):
        with patch.object(M, 'command', side_effect=RuntimeError('private diagnostic never-print-token')):
            result = M.capture()
        self.assertTrue(result['errors']); self.assertNotIn('never-print', json.dumps(result))
        self.assertTrue(all(f['readStatus'] == 'unavailable' for f in result['functions'].values()))


if __name__ == '__main__': unittest.main()
