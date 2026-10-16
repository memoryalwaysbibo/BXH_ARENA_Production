"""Regression checks for reproducible packaging and refusing damaged sources."""
import hashlib
import importlib.util
import json
import pathlib
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('writer_build', pathlib.Path(__file__).with_name('build-writer-packages.py'))
builder = importlib.util.module_from_spec(spec)
spec.loader.exec_module(builder)


class PackageTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = pathlib.Path(self.temp.name)
        self.source, self.output = self.root / 'source', self.root / 'output'
        services = []
        for name, version in [('first', 1), ('second', 2)]:
            path = self.source / name / 'nested/index.js'
            path.parent.mkdir(parents=True)
            raw = ("const {getFirestore}=require('firebase-admin/firestore');\nexports.version=" + str(version) + ';\n').encode()
            path.write_bytes(raw)
            services.append({'name': name, 'sourceGeneration': str(version), 'files': {'nested/index.js': {'sha256': hashlib.sha256(raw).hexdigest(), 'bytes': len(raw)}}})
        self.pin = self.root / 'pin.json'
        self.pin.write_text(json.dumps({'project': 'demo-only', 'auditRunId': 1, 'functions': services}))
        old_pin, old_hash = builder.PIN, builder.PIN_HASH
        self.addCleanup(lambda: (setattr(builder, 'PIN', old_pin), setattr(builder, 'PIN_HASH', old_hash)))
        builder.PIN, builder.PIN_HASH = self.pin, hashlib.sha256(self.pin.read_bytes()).hexdigest()

    def test_independent_service_versions_and_nested_imports(self):
        report = builder.build(self.source, self.output)
        self.assertFalse(report['deploymentReady'])
        for name, version in [('first', 1), ('second', 2)]:
            text = (self.output / name / 'nested/index.js').read_text()
            self.assertIn('../_qr_checkin/admin-firestore.cjs', text)
            self.assertIn('exports.version=' + str(version), text)
            self.assertTrue((self.output / name / '_qr_checkin/guard-firestore.cjs').is_file())

    def test_mismatched_source_creates_no_partial_package(self):
        (self.source / 'second/nested/index.js').write_text('changed')
        with self.assertRaisesRegex(ValueError, 'Deployed source mismatch'):
            builder.build(self.source, self.output)
        self.assertFalse(self.output.exists())

    def test_changed_manifest_is_not_trusted(self):
        self.pin.write_text('{}')
        with self.assertRaisesRegex(ValueError, 'manifest changed'):
            builder.build(self.source, self.output)
        self.assertFalse(self.output.exists())

    def test_existing_output_is_not_overwritten(self):
        self.output.mkdir()
        (self.output / 'keep').write_text('keep')
        with self.assertRaisesRegex(ValueError, 'refusing to overwrite'):
            builder.build(self.source, self.output)
        self.assertEqual((self.output / 'keep').read_text(), 'keep')


if __name__ == '__main__':
    unittest.main()
