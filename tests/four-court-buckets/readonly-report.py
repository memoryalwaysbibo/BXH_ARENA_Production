import copy
import hashlib
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('report_export', Path(__file__).resolve().parents[2] / 'scripts/bucket-readonly-report.py')
M = importlib.util.module_from_spec(spec)
spec.loader.exec_module(M)


class ReportBoundary(unittest.TestCase):
    def sample(self, home):
        folder = home / 'bxh-raffle-sources-test'
        folder.mkdir()
        rows = []
        for name in M.TARGETS:
            data = b'PRIVATE_SOURCE_TOKEN'
            (folder / (name + '.source.zip')).write_bytes(data)
            rows.append({'name': name, 'entryPoint': name, 'sourceArchiveFile': name + '.source.zip',
                         'stableDuringCapture': True, 'sourceArchiveSha256': hashlib.sha256(data).hexdigest(),
                         **{key: 'a' * 64 for key in ['metadataSha256', 'buildConfigSha256', 'serviceConfigSha256']},
                         'source': {'bucket': 'PRIVATE_BUCKET'}, 'environmentVariables': {'secret': 'PRIVATE_SECRET'}})
        report = {'project': 'bxh-arena', 'stage': 'BUCKET_RAFFLE_SOURCES_READONLY', 'targets': list(M.TARGETS),
                  'sources': rows, 'errors': [], 'captureComplete': True, 'productionWrites': 0,
                  'deploymentPerformed': False, 'writerInventoryComplete': False, 'acceptanceCompleted': False,
                  'token': 'PRIVATE_ACCESS_TOKEN'}
        return folder / 'report.json', report

    def test_only_hashes_leave_capture_directory(self):
        with tempfile.TemporaryDirectory() as tmp:
            home = Path(tmp); path, report = self.sample(home); path.write_text(json.dumps(report))
            destination = home / 'filtered.json'; result = M.export(home, destination)
            self.assertTrue(result['captureComplete']); self.assertEqual(len(result['sources']), 3)
            self.assertNotIn('PRIVATE', destination.read_text())
            self.assertEqual([p.name for p in home.glob('*.json')], ['filtered.json'])

    def test_corruption_duplicate_target_and_path_escape_reject(self):
        with tempfile.TemporaryDirectory() as tmp:
            home = Path(tmp); path, report = self.sample(home)
            for change in [lambda r: r['sources'][0].update(sourceArchiveSha256='b'*64),
                           lambda r: r['sources'].append(copy.deepcopy(r['sources'][0])),
                           lambda r: r['sources'][0].update(sourceArchiveFile='../secret'),
                           lambda r: r.update(productionWrites=1),
                           lambda r: r['sources'][0].update(stableDuringCapture=False),
                           lambda r: r.update(captureComplete=False)]:
                candidate = copy.deepcopy(report); change(candidate); path.write_text(json.dumps(candidate))
                with self.assertRaises(ValueError): M.export(home, home / 'filtered.json')
                self.assertFalse((home / 'filtered.json').exists())

    def test_failed_capture_remains_incomplete(self):
        with tempfile.TemporaryDirectory() as tmp:
            home = Path(tmp); path, report = self.sample(home)
            report.update(sources=[], errors=[{'kind': 'PRIVATE_ERROR_DETAIL'}], captureComplete=False)
            path.write_text(json.dumps(report)); result = M.export(home, home / 'filtered.json')
            self.assertFalse(result['captureComplete']); self.assertEqual(result['errorCount'], 1)
            self.assertNotIn('PRIVATE', (home / 'filtered.json').read_text())


if __name__ == '__main__':
    unittest.main()
