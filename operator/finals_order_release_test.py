import copy
import importlib.util
import io
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch
import zipfile

spec = importlib.util.spec_from_file_location('release', Path(__file__).with_name('finals_order_release.py'))
release = importlib.util.module_from_spec(spec)
spec.loader.exec_module(release)


def archive(engine):
    stream = io.BytesIO()
    with zipfile.ZipFile(stream, 'w') as result:
        result.writestr('engine/index.cjs', engine)
        result.writestr('index.js', 'exports.commitRefereeCommand = 1;')
        result.writestr('package-lock.json', '{"preserve":true}')
    return stream.getvalue()


class ReleaseTests(unittest.TestCase):
    def test_only_gate_changes(self):
        baseline = archive(release.OLD)
        candidate, target = release.patch_archive(baseline)
        with zipfile.ZipFile(io.BytesIO(baseline)) as before, zipfile.ZipFile(io.BytesIO(candidate)) as after:
            self.assertEqual(before.namelist(), after.namelist())
            self.assertEqual([p for p in before.namelist() if before.read(p) != after.read(p)], [target])
            self.assertEqual(after.read(target).decode(), release.NEW)

    def test_already_released_is_noop(self):
        self.assertIsNone(release.patch_archive(archive(release.NEW))[0])

    def test_changed_or_duplicate_gate_stops(self):
        for text in ('function changed(){}', release.OLD+'\n'+release.OLD):
            with self.assertRaisesRegex(RuntimeError, 'anchor-changed'):
                release.patch_archive(archive(text))

    def test_configuration_comparison_ignores_only_generated_revision_and_build_source(self):
        baseline = {'serviceConfig':{'revision':'old','maxInstanceCount':10,'serviceAccountEmail':'original'},
                    'buildConfig':{'runtime':'nodejs22','source':{'old':True},'build':'old'}}
        after = copy.deepcopy(baseline)
        after['serviceConfig']['revision'] = 'new'
        after['buildConfig']['source'] = {'new':True}
        after['buildConfig']['build'] = 'new'
        self.assertEqual(release.config(baseline), release.config(after))
        after['serviceConfig']['maxInstanceCount'] = 20
        self.assertNotEqual(release.config(baseline), release.config(after))

    def test_apply_updates_only_named_function_source_and_verifies_archive(self):
        baseline = archive(release.OLD)
        candidate, _ = release.patch_archive(baseline)
        before = {'name':release.FUNCTION,'state':'ACTIVE','updateTime':'old',
                  'environment':'GEN_2','buildConfig':{'entryPoint':'commitRefereeCommand',
                  'source':{'storageSource':{'bucket':'old','object':'src','generation':'1'}}},
                  'serviceConfig':{'revision':'old','maxInstanceCount':10}}
        after = copy.deepcopy(before)
        after['buildConfig']['source']['storageSource'] = {'bucket':'new','object':'src','generation':'2'}
        after['serviceConfig']['revision'] = 'new'
        calls = []
        metas = iter([before, before, before, after])
        def api(path, method='GET', body=None):
            calls.append((path, method, body))
            if 'generateUploadUrl' in path:
                return {'uploadUrl':'https://example.test/upload','storageSource':{'bucket':'new','object':'src'}}
            if method == 'PATCH':
                return {'name':'projects/bxh-arena/locations/asia-east1/operations/op', 'done':True}
            return next(metas)
        response = io.BytesIO(b'')
        with tempfile.TemporaryDirectory() as folder, patch.object(sys, 'argv', ['release', '--apply']), \
             patch.object(release, 'api', side_effect=api), \
             patch.object(release, 'cli', side_effect=[baseline, candidate]), \
             patch.object(release.tempfile, 'mkdtemp', return_value=folder), \
             patch.object(release.urllib.request, 'urlopen', return_value=response) as upload, \
             patch('sys.stdout', new_callable=io.StringIO) as output:
            release.main()
            self.assertIn('RELEASE_VERIFIED', output.getvalue())
            request = upload.call_args.args[0]
            self.assertEqual(request.data, candidate)
            self.assertFalse(request.has_header('Authorization'))
        writes = [call for call in calls if call[1] == 'PATCH']
        self.assertEqual(len(writes), 1)
        self.assertEqual(writes[0][0], release.FUNCTION+'?updateMask=buildConfig.source')
        self.assertEqual(set(writes[0][2]), {'name','buildConfig'})
        self.assertEqual(set(writes[0][2]['buildConfig']), {'source'})


if __name__ == '__main__':
    unittest.main()
