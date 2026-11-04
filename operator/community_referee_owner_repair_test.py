"""Offline guards for the source archive used by the repair operator."""
import importlib.util
from pathlib import Path
import shutil
import tempfile
import unittest
from unittest.mock import patch
import zipfile

spec = importlib.util.spec_from_file_location(
    'owner_repair', Path(__file__).with_name('community_referee_owner_repair.py'))
repair = importlib.util.module_from_spec(spec)
spec.loader.exec_module(repair)


class SourceArchive(unittest.TestCase):
    def read(self, names):
        with tempfile.TemporaryDirectory() as directory:
            archive_path = Path(directory) / 'input.zip'
            with zipfile.ZipFile(archive_path, 'w') as archive:
                for name in names:
                    archive.writestr(name, name.encode())

            def copy_source(args, **kwargs):
                shutil.copyfile(archive_path, args[4])
                return type('Result', (), {'returncode': 0})()

            with patch.object(repair.subprocess, 'run', side_effect=copy_source):
                return repair.source_files({'bucket': 'candidate-source',
                                            'object': 'source.zip', 'generation': '123'})

    def test_nested_engine_files_are_valid(self):
        files = self.read(['core.cjs', 'engine/index.cjs', 'engine/fault.cjs'])
        self.assertEqual(set(files), {'core.cjs', 'engine/index.cjs', 'engine/fault.cjs'})

    def test_duplicate_and_unsafe_paths_are_rejected(self):
        for names in (['core.cjs', 'core.cjs'], ['../core.cjs'],
                      ['/core.cjs'], ['engine//fault.cjs'], ['engine\\fault.cjs']):
            with self.subTest(names=names):
                with self.assertRaisesRegex(repair.Stop, 'deployed source scope mismatch'):
                    self.read(names)


if __name__ == '__main__':
    unittest.main()
