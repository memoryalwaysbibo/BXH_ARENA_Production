"""Reproduce function-specific overlays against the immutable uploaded source capture."""
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import zipfile
ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('builder',ROOT/'scripts/build-score-stability-release.py')
M=importlib.util.module_from_spec(spec);spec.loader.exec_module(M)
BUNDLE=ROOT/'referee-seats/reference/BXH816_bucket_sources-20261118.zip'

class ScopedRelease(unittest.TestCase):
    def test_only_reviewed_modules_change_and_deployed_auth_entrypoints_are_preserved(self):
        files,rules,report=M.build(BUNDLE)
        with zipfile.ZipFile(BUNDLE) as z:
            for function,members in files.items():
                for name in M.PROTECTED:
                    if function+'/'+name in z.namelist():self.assertEqual(members[name],z.read(function+'/'+name),name)
                self.assertNotIn(b'communitySupport',members['scoring-core.cjs'])
                self.assertNotIn(b'communityRoom',members['core.cjs'])
                self.assertIn(b'PassReturn.readiness',members['scoring-core.cjs'])
                self.assertIn(b'singleElimRoundDispatchBlocked',members['scoring-core.cjs'])
                self.assertIn(b'publicProjection:deferredPublic',members['bucket-scoring-service.cjs'])
            # All three callable/event definitions will execute identical reviewed code.
            self.assertEqual(files['commitBucketRefereeCommand'],files['manageBucketRefereeSeats'])
            self.assertEqual(files['commitBucketRefereeCommand'],files['projectBucketPublicScore'])
        self.assertFalse(report['deployableWithoutFreshReview']);self.assertEqual(report['productionWrites'],0)

    def test_live_rules_are_preserved_byte_for_byte_except_schema_opt_in(self):
        files,rules,report=M.build(BUNDLE)
        with zipfile.ZipFile(BUNDLE) as z:live=z.read('firestore.live.rules').decode()
        before="        && storage.get('schema', '') == 'bxh-match-buckets-v1'"
        after="        && (storage.get('schema', '') == 'bxh-match-buckets-v1'\n          || (storage.get('schema', '') == 'bxh-court-buckets-v2' && config.get('perCourtStorageEnabled', false) == true))"
        self.assertEqual(rules.replace(after,before),live)
        for guard in ['registrationQueueOwnsRoom','registrationQueueVersion','communityRefereeReadable']:
            self.assertIn(guard,rules)

    def test_changed_capture_rules_or_patch_anchor_refused(self):
        with tempfile.TemporaryDirectory() as directory:
            changed=Path(directory)/'changed.zip';changed.write_bytes(b'not-the-reviewed-capture')
            with self.assertRaisesRegex(ValueError,'hash mismatch'):M.build(changed)
        with self.assertRaisesRegex(ValueError,'Unreviewed live Rules'):M.overlay_rules('different')
        with self.assertRaisesRegex(ValueError,'anchor changed'):M.overlay_dispatch('different')

    def test_manifest_is_reproducible(self):
        first=M.build(BUNDLE)[2];second=M.build(BUNDLE)[2]
        self.assertEqual(first,second)
        self.assertEqual(first,json.loads((ROOT/'release/score-stability/release-plan.json').read_text()))

if __name__=='__main__':unittest.main()
