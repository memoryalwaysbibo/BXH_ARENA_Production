import copy
import io
import json
from pathlib import Path
import tempfile
import types
import unittest
from unittest.mock import patch
import urllib.error
import zipfile

import release_registration as release


def archive(files):
    stream = io.BytesIO()
    with zipfile.ZipFile(stream, 'w') as output:
        for name, data in files.items():
            output.writestr(name, data)
    return stream.getvalue()


class FakeCloud:
    def __init__(self, baseline, original):
        self.metadata = copy.deepcopy(baseline)
        self.current = original
        self.uploads = {}
        self.patches = []
        self.after_upload = None
        self.operation_error = None
        self.post_drift = False
        self.lost_response = False

    def get(self):
        return copy.deepcopy(self.metadata)

    def source(self, metadata):
        return self.current

    def upload(self, data, before):
        key = 'upload-' + str(len(self.uploads))
        self.uploads[key] = data
        if self.after_upload:
            self.after_upload()
        return {'bucket': 'synthetic-upload', 'object': key, 'generation': '1'}

    def patch(self, source):
        self.patches.append(copy.deepcopy(source))
        self.pending = source
        self.metadata['state'] = 'DEPLOYING'
        if self.lost_response:
            self.lost_response = False
            self.finish()
            raise ConnectionError('simulated response loss')
        return {'name': 'projects/bxh-arena/locations/asia-east1/operations/test-operation'}

    def finish(self):
        self.current = self.uploads[self.pending['object']]
        self.metadata['buildConfig']['source'] = {'storageSource': self.pending}
        self.metadata['buildConfig']['build'] = 'new-synthetic-build'
        self.metadata['buildConfig']['sourceProvenance'] = {'resolvedStorageSource': self.pending}
        self.metadata['serviceConfig']['revision'] = 'revision-' + str(len(self.patches))
        self.metadata['updateTime'] = 'synthetic-update-' + str(len(self.patches))
        self.metadata['state'] = 'ACTIVE'
        if self.post_drift:
            self.metadata['serviceConfig']['availableMemory'] = '512Mi'

    def operation(self, name):
        if self.operation_error:
            return {'done': True, 'error': self.operation_error}
        self.finish()
        return {'done': True}


class ReleaseTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix='registration-release-test-')
        self.root = Path(self.tmp.name)
        self.package = self.root / 'package'
        self.package.mkdir()
        before = {
            'name': release.NAME, 'environment': 'GEN_2', 'state': 'ACTIVE',
            'updateTime': 'synthetic-before', 'labels': {'retain': 'yes'},
            'buildConfig': {'runtime': 'nodejs22', 'entryPoint': 'familyRegistration',
                            'source': {'storageSource': {'bucket': 'original', 'object': 'source.zip', 'generation': '1'}},
                            'build': 'original-build', 'sourceProvenance': {}},
            'serviceConfig': {'revision': 'old-revision', 'timeoutSeconds': 60,
                              'availableMemory': '256Mi', 'availableCpu': '1',
                              'maxInstanceCount': 5, 'maxInstanceRequestConcurrency': 80,
                              'environmentVariables': {'PRIVATE': 'synthetic-secret'}},
        }
        files = {'index.js': b'unchanged entrypoint', 'family.js': b'unchanged wrapper',
                 'family-registration.js': b'original handler'}
        changed = {'family-registration.js': b'candidate handler', 'registration-admission.cjs': b'new scheduler'}
        self.original = archive(files)
        self.candidate = archive({**files, **changed})
        self.baseline = before
        manifest = {'originalSourceArchiveSha256': release.digest(self.original),
                    'candidateSourceArchiveSha256': release.digest(self.candidate),
                    'serviceConfigSha256': release.digest(release.canonical(before['serviceConfig'])),
                    'changedOrAdded': {name: release.digest(data) for name, data in changed.items()}}
        (self.package / 'original-source.zip').write_bytes(self.original)
        (self.package / 'candidate-source.zip').write_bytes(self.candidate)
        (self.package / 'baseline-description.json').write_text(json.dumps(before))
        (self.package / 'manifest.json').write_text(json.dumps(manifest))
        self.cloud = FakeCloud(before, self.original)
        self.logs = []
        self.operator = release.Release(self.package, cloud=self.cloud, emit=self.logs.append)

    def tearDown(self):
        self.tmp.cleanup()

    def journal(self):
        return next(self.root.glob('bxh-registration-release-*'))

    def test_check_reads_only_and_does_not_print_private_environment(self):
        self.operator.check()
        self.assertEqual(self.cloud.patches, [])
        self.assertEqual(self.cloud.uploads, {})
        self.assertNotIn('synthetic-secret', '\n'.join(self.logs))

    def test_apply_changes_only_code_and_verified_rollback_restores_original(self):
        self.assertTrue(self.operator.apply(self.root))
        self.assertEqual(release.file_map(self.cloud.current), release.file_map(self.candidate))
        self.assertEqual(release.stable_config(self.cloud.get()), release.stable_config(self.baseline))
        self.assertTrue(self.operator.rollback(self.journal()))
        self.assertEqual(release.file_map(self.cloud.current), release.file_map(self.original))
        self.assertEqual(len(self.cloud.patches), 2)
        self.assertEqual(self.journal().stat().st_mode & 0o777, 0o700)
        self.assertEqual((self.journal() / 'before.json').stat().st_mode & 0o777, 0o600)

    def test_package_tampering_stops_before_cloud_calls(self):
        (self.package / 'candidate-source.zip').write_bytes(b'changed')
        with self.assertRaisesRegex(RuntimeError, 'candidate-package-hash-mismatch'):
            release.Release(self.package, cloud=self.cloud)
        self.assertEqual(len(self.cloud.uploads), 0)

    def test_preflight_config_source_and_revision_drift_refuse_apply(self):
        for kind in ('config', 'source', 'revision', 'state'):
            with self.subTest(kind=kind):
                self.cloud.metadata = copy.deepcopy(self.baseline)
                self.cloud.current = self.original
                if kind == 'config':
                    self.cloud.metadata['serviceConfig']['maxInstanceCount'] = 6
                elif kind == 'source':
                    self.cloud.current = self.candidate
                elif kind == 'revision':
                    self.cloud.metadata['serviceConfig']['revision'] = 'external-revision'
                else:
                    self.cloud.metadata['state'] = 'DEPLOYING'
                with self.assertRaises(RuntimeError):
                    self.operator.apply(self.root)
        self.assertEqual(self.cloud.patches, [])
        self.assertEqual(self.cloud.uploads, {})

    def test_change_during_upload_stops_before_patch(self):
        self.cloud.after_upload = lambda: self.cloud.metadata['labels'].update(external='change')
        with self.assertRaisesRegex(RuntimeError, 'live-changed-during-upload'):
            self.operator.apply(self.root)
        self.assertEqual(self.cloud.patches, [])

    def test_lost_patch_response_resume_verifies_without_resubmitting(self):
        self.cloud.lost_response = True
        with self.assertRaises(ConnectionError):
            self.operator.apply(self.root)
        self.assertEqual(json.loads((self.journal() / 'journal.json').read_text())['phase'], 'SUBMISSION_UNCONFIRMED')
        self.assertTrue(self.operator.resume(self.journal()))
        self.assertEqual(len(self.cloud.patches), 1)

    def test_resume_completed_journal_does_not_adopt_an_external_revision(self):
        self.operator.apply(self.root)
        self.cloud.metadata['serviceConfig']['revision'] = 'external-new-revision'
        with self.assertRaisesRegex(RuntimeError, 'live-changed-after-completed-journal'):
            self.operator.resume(self.journal())
        self.assertEqual(len(self.cloud.patches), 1)

    def test_failed_operation_keeps_diagnostic_and_never_auto_rolls_back(self):
        self.cloud.operation_error = {'code': 7, 'message': 'synthetic failure'}
        with self.assertRaisesRegex(RuntimeError, 'function-operation-failed'):
            self.operator.apply(self.root)
        self.assertTrue((self.journal() / 'operation-error.json').exists())
        self.assertEqual(len(self.cloud.patches), 1)

    def test_post_config_mismatch_fails_verification_without_auto_rollback(self):
        self.cloud.post_drift = True
        with self.assertRaisesRegex(RuntimeError, 'post-deploy-config-mismatch'):
            self.operator.apply(self.root)
        self.assertEqual(len(self.cloud.patches), 1)

    def test_rollback_refuses_external_change(self):
        self.operator.apply(self.root)
        self.cloud.metadata['labels']['external'] = 'change'
        with self.assertRaisesRegex(RuntimeError, 'refusing-rollback'):
            self.operator.rollback(self.journal())
        self.assertEqual(len(self.cloud.patches), 1)

    def test_api_patch_field_mask_and_body_are_source_only(self):
        cloud = release.Cloud()
        requests = []
        cloud.request = lambda *args, **kwargs: requests.append((args, kwargs)) or {}
        source = {'bucket': 'b', 'object': 'o'}
        cloud.patch(source)
        args, kwargs = requests[0]
        self.assertEqual(args[0], 'PATCH')
        self.assertTrue(args[1].endswith('/familyRegistration?updateMask=buildConfig.source'))
        self.assertEqual(args[2], {'name': release.NAME, 'buildConfig': {'source': {'storageSource': source}}})

    def test_signed_put_never_fetches_or_attaches_credentials(self):
        class Response(io.BytesIO):
            def __enter__(self): return self
            def __exit__(self, *args): self.close()
        def open_request(request, **kwargs):
            self.assertNotIn('Authorization', request.headers)
            self.assertEqual(request.headers['Content-type'], 'application/zip')
            return Response(b'')
        with patch('release_registration.urllib.request.urlopen', open_request), \
             patch('release_registration.subprocess.run', side_effect=AssertionError('credential call')):
            release.Cloud().request('PUT', 'https://signed.invalid/upload', b'zip', authenticated=False, raw=True)

    def test_operation_project_number_alias_must_resolve_to_target_project(self):
        cloud=release.Cloud();calls=[]
        def request(method,url,*args,**kwargs):
            calls.append(url)
            return {'projectNumber':'123'} if 'cloudresourcemanager' in url else {'done':True}
        cloud.request=request
        self.assertEqual(cloud.operation('projects/123/locations/asia-east1/operations/one'),{'done':True})
        with self.assertRaisesRegex(RuntimeError,'unexpected-operation-project'):
            cloud.operation('projects/999/locations/asia-east1/operations/one')

    def test_pending_operation_resume_does_not_submit_again(self):
        clock=[0]
        def pending(name):
            clock[0]+=601
            return {'done':False}
        self.operator.now=lambda:clock[0];self.operator.sleep=lambda seconds:None
        original_operation=self.cloud.operation;self.cloud.operation=pending
        self.assertFalse(self.operator.apply(self.root))
        self.assertEqual(len(self.cloud.patches),1)
        self.cloud.operation=original_operation
        self.assertTrue(self.operator.resume(self.journal()))
        self.assertEqual(len(self.cloud.patches),1)

    def test_unconfirmed_submission_without_candidate_does_not_resubmit(self):
        def lost_before_accept(source):
            raise ConnectionError('request never accepted')
        self.cloud.patch=lost_before_accept
        with self.assertRaises(ConnectionError):
            self.operator.apply(self.root)
        with self.assertRaisesRegex(RuntimeError,'post-deploy-source-mismatch'):
            self.operator.resume(self.journal())
        self.assertEqual(self.cloud.patches,[])


if __name__ == '__main__':
    unittest.main()
