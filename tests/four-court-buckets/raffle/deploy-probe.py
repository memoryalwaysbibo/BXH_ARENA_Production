"""Exercise the cutover contract without credentials or network access."""
from copy import deepcopy
from pathlib import Path
import runpy
import unittest


script = Path(__file__).resolve().parents[3] / 'scripts/deploy-bucket-raffle.py'
deployment = runpy.run_path(str(script))
cutover = deployment['cutover']
order = deployment['ORDER']
archive_bytes = {'candidate': b'candidate fixture', 'compatibility': b'rollback fixture'}
hashes = {mode: deployment['sha'](archive) for mode, archive in archive_bytes.items()}
deployment['ARCHIVES'].update(hashes)


class LocalCloud:
    def __init__(self):
        self.hashes = {name: 'baseline' for name in order}
        self.info = {name: {'name': name, 'buildConfig': {'runtime': 'nodejs22'},
                           'serviceConfig': {'revision': 'old', 'timeoutSeconds': 60}} for name in order}
        self.baseline = {'sources': [
            {'name': name, 'sourceArchiveSha256': 'baseline', 'metadataSha256': deployment['digest'](self.info[name])}
            for name in order
        ]}
        self.calls = []
        self.failed = None

    def read(self, name):
        return deepcopy(self.info[name])

    def source_hash(self, info):
        return self.hashes[info['name']]

    def upload(self, archive):
        self.calls.append(('upload', archive))
        return deployment['sha'](archive)

    def submit(self, name, source):
        self.calls.append(('patch', name))
        self.pending = (name, source)
        return 'operation-' + name

    def wait(self, operation):
        name, source = self.pending
        self.calls.append(('wait', name))
        if name == self.failed:
            raise RuntimeError('simulated operation failed')
        self.hashes[name] = source
        self.info[name]['serviceConfig']['revision'] = operation


class CutoverTests(unittest.TestCase):
    def setUp(self):
        self.cloud = LocalCloud()
        self.events = []

    def execute(self, mode='candidate', apply=True):
        cutover(self.cloud, mode, archive_bytes[mode], self.cloud.baseline,
                lambda status, **fields: self.events.append((status, fields)), apply)

    def test_check_reads_without_writing(self):
        self.execute(apply=False)
        self.assertEqual(self.cloud.calls, [])
        self.assertEqual([status for status, _ in self.events], ['BASELINE_CHECKED'])

    def test_candidate_draw_is_last_then_compatibility_preserves_settings(self):
        self.execute()
        self.assertEqual([value for call, value in self.cloud.calls if call == 'patch'], list(order))
        self.assertEqual(set(self.cloud.hashes.values()), {hashes['candidate']})
        self.execute('compatibility')
        self.assertEqual(set(self.cloud.hashes.values()), {hashes['compatibility']})
        self.assertTrue(all(info['serviceConfig']['timeoutSeconds'] == 60 for info in self.cloud.info.values()))
        self.cloud.calls.clear()
        self.execute('compatibility')
        self.assertEqual(self.cloud.calls, [])

    def test_baseline_drift_rejects_all_writes(self):
        self.cloud.info[order[-1]]['serviceConfig']['timeoutSeconds'] = 90
        with self.assertRaisesRegex(RuntimeError, 'reviewed production baseline'):
            self.execute()
        self.assertEqual(self.cloud.calls, [])

    def test_unknown_source_rejects_rollback(self):
        self.cloud.hashes[order[0]] = 'unknown'
        with self.assertRaisesRegex(RuntimeError, 'unreviewed source'):
            self.execute('compatibility')
        self.assertEqual(self.cloud.calls, [])

    def test_failed_operation_stops_before_draw_and_can_be_reconciled(self):
        self.cloud.failed = order[1]
        with self.assertRaisesRegex(RuntimeError, 'simulated operation failed'):
            self.execute()
        self.assertEqual([value for call, value in self.cloud.calls if call == 'patch'], list(order[:2]))
        self.assertEqual([fields['function'] for status, fields in self.events if status == 'OPERATION'], list(order[:2]))
        self.cloud.failed = None
        self.execute('compatibility')
        self.assertEqual(set(self.cloud.hashes.values()), {hashes['compatibility']})

    def test_patch_only_sets_source(self):
        cloud = deployment['Cloud']()
        calls = []
        operation = deployment['LOCATION'] + '/operations/test-operation'
        cloud.request = lambda *args: calls.append(args) or {'name': operation}
        source = {'bucket': 'reviewed-source', 'object': 'archive.zip', 'generation': '10'}
        name = deployment['LOCATION'] + '/functions/' + order[0]
        self.assertEqual(cloud.submit(order[0], source), operation)
        self.assertEqual(calls, [
            ('PATCH', name + '?updateMask=buildConfig.source',
             {'name': name, 'buildConfig': {'source': {'storageSource': source}}})
        ])


if __name__ == '__main__':
    unittest.main()
