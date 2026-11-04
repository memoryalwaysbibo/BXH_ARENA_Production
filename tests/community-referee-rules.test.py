"""Composition invariants for the captured-live general-room release candidate."""
import importlib.util
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('community_rules', ROOT / 'scripts/build-community-referee-rules.py')
builder = importlib.util.module_from_spec(spec)
spec.loader.exec_module(builder)


class Composition(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.base = builder.BASE.read_text()
        cls.reviewed = (ROOT / 'referee-seats/firestore.candidate.rules').read_text()
        cls.result = builder.build(cls.base, cls.reviewed)

    def test_artifact_is_reproducible(self):
        self.assertEqual(builder.TARGET.read_text(), self.result)

    def test_every_unrelated_policy_byte_is_preserved(self):
        helper = self.reviewed[self.reviewed.index('    // General-room referees receive private read access'):
                               self.reviewed.index('    // Read-only bucket access follows')]
        restored = self.result.replace(helper, '', 1)
        restored = restored.replace('|| isCommunityOwnerData(room) ', '')
        restored = restored.replace('communityRefereeReadable(resource.data) || ', '', 1)
        self.assertEqual(restored, self.base)
        self.assertNotIn('function scoreBucketReadable(', self.result)

    def test_changed_live_capture_is_rejected(self):
        with self.assertRaisesRegex(ValueError, 'differ from reviewed capture'):
            builder.build(self.base + '\n', self.reviewed)


if __name__ == '__main__':
    unittest.main()
