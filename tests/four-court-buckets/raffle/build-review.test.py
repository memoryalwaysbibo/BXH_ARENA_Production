"""Offline review-builder boundaries; no network, credentials or private source."""
import importlib.util
from pathlib import Path
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[3]
spec = importlib.util.spec_from_file_location('raffle_builder', ROOT / 'scripts/build-bucket-raffle-review.py')
builder = importlib.util.module_from_spec(spec)
spec.loader.exec_module(builder)
FIXTURE = ROOT / 'tests/four-court-buckets/operations/fixtures/5'


class ReviewBuilderTests(unittest.TestCase):
    def baseline(self):
        return {name: (FIXTURE / name).read_bytes()
                for name in ('operations.js', 'operations-core.js', 'release-controls.js')}

    def test_fixture_variants_are_deterministic(self):
        for version in builder.IDENTITY_VERSIONS:
            with self.subTest(version=version):
                self.assertEqual(builder.assemble(self.baseline(), version),
                                 builder.assemble(self.baseline(), version))

    def test_original_source_mapping_is_not_mutated(self):
        files = self.baseline()
        before = dict(files)
        builder.assemble(files, 'participant-v1')
        self.assertEqual(files, before)

    def test_original_non_operations_members_preserved(self):
        source = self.baseline()
        result = builder.assemble(source, 'participant-v1')
        for name, content in source.items():
            if name != 'operations.js':
                self.assertEqual(result[name], content)

    def test_dependency_closure_is_exact(self):
        source = self.baseline()
        result = builder.assemble(source, 'participant-v1')
        expected = {'bucket-raffle/' + p for p in builder.CLOSURE}
        self.assertEqual(set(result) - set(source), expected)
        for member in builder.CLOSURE:
            self.assertEqual(result['bucket-raffle/' + member],
                             (ROOT / 'release/buckets' / member).read_bytes())

    def test_variants_differ_only_in_server_default(self):
        source = self.baseline()
        new = builder.assemble(source, 'participant-v1')
        old = builder.assemble(source, 'legacy')
        self.assertEqual([k for k in new if new[k] != old[k]], ['operations.js'])
        self.assertEqual(old['operations.js'].replace(b",newIdentityVersion:'legacy'", b''),
                         new['operations.js'])

    def test_callable_exports_preserve_options(self):
        for version in builder.IDENTITY_VERSIONS:
            text = builder.assemble(self.baseline(), version)['operations.js'].decode()
            for name in builder.ENTRYPOINTS:
                self.assertEqual(text.count(f'exports.{name}=onCall({builder.CALL_OPTIONS},'), 1)

    def test_changed_baseline_is_rejected(self):
        source = self.baseline()
        source['operations.js'] += b'\n// changed\n'
        with self.assertRaisesRegex(ValueError, 'baseline hash mismatch'):
            builder.assemble(source, 'participant-v1')

    def test_unsupported_identity_is_rejected(self):
        with self.assertRaisesRegex(ValueError, 'unsupported new raffle identity version'):
            builder.assemble(self.baseline(), 'client-selected')

    def test_existing_dependency_is_rejected(self):
        source = self.baseline()
        source['bucket-raffle/' + builder.CLOSURE[0]] = b'collision'
        with self.assertRaisesRegex(ValueError, 'collides with original member'):
            builder.assemble(source, 'participant-v1')

    def test_unverified_transfer_creates_no_output(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            transfer = root / 'unverified.json'
            transfer.write_text('{}')
            output = root / 'review'
            with self.assertRaisesRegex(ValueError, 'source transfer does not match reviewed input'):
                builder.build(transfer, output, 'participant-v1')
            self.assertFalse(output.exists())

    def test_fixture_output_refuses_overwrite(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / 'review'
            builder.fixture_tree(output, 'participant-v1')
            before = {str(p.relative_to(output)): p.read_bytes()
                      for p in output.rglob('*') if p.is_file()}
            with self.assertRaises(FileExistsError):
                builder.fixture_tree(output, 'legacy')
            self.assertEqual(before, {str(p.relative_to(output)): p.read_bytes()
                                     for p in output.rglob('*') if p.is_file()})

    def test_fixture_tree_matches_assembled_bytes(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / 'review'
            builder.fixture_tree(output, 'participant-v1')
            self.assertEqual(builder.assemble(self.baseline(), 'participant-v1'),
                             {str(p.relative_to(output)): p.read_bytes()
                              for p in output.rglob('*') if p.is_file()})


if __name__ == '__main__':
    unittest.main(verbosity=2)
