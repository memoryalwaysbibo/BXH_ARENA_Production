"""Archive preservation and fail-closed preparation; no cloud or deployed source execution."""
import hashlib
import importlib.util
import io
import json
import copy
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import zipfile
ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('prepare816',ROOT/'operator/BXH816_prepare_trial.py')
M=importlib.util.module_from_spec(spec);spec.loader.exec_module(M)

class TrialPrepare(unittest.TestCase):
    def archive(self, files):
        out=io.BytesIO()
        with zipfile.ZipFile(out,'w') as z:
            for name,data in files.items():z.writestr(name,data)
        return out.getvalue()

    def test_full_archive_retains_uncaptured_files_and_patch_is_exact(self):
        raw=self.archive({'index.js':b'entry','package-lock.json':b'lock','unreviewed.txt':b'retain','engine/index.cjs':b'old'})
        selected={'index.js':M.digest(b'entry'),'engine/index.cjs':M.digest(b'old')}
        new=M.overlay_archive(raw,selected,{'index.js':b'entry','engine/index.cjs':b'new','engine/helper.cjs':b'helper'},M.digest(raw))
        with zipfile.ZipFile(io.BytesIO(new)) as z:
            self.assertEqual(z.read('unreviewed.txt'),b'retain');self.assertEqual(z.read('package-lock.json'),b'lock')
            self.assertEqual(z.read('engine/index.cjs'),b'new');self.assertEqual(z.read('engine/helper.cjs'),b'helper')
        with self.assertRaises(ValueError):M.overlay_archive(raw,selected,{},'wrong')
        with self.assertRaises(ValueError):M.overlay_archive(raw,{'index.js':'wrong'},{},M.digest(raw))

    def test_paths_and_symlinks_rejected(self):
        for name in ['../escape','/escape','a\\b']:
            raw=self.archive({name:b'x'})
            with self.assertRaises(ValueError):M.overlay_archive(raw,{}, {},M.digest(raw))
        out=io.BytesIO()
        with zipfile.ZipFile(out,'w') as z:
            member=zipfile.ZipInfo('link');member.external_attr=0o120777<<16;z.writestr(member,'outside')
        raw=out.getvalue()
        with self.assertRaises(ValueError):M.overlay_archive(raw,{}, {},M.digest(raw))

    def test_live_policy_drift_rejected(self):
        with zipfile.ZipFile(M.BUNDLE) as z:
            baseline=json.loads(z.read('manifest.json'));rules=z.read('firestore.live.rules').decode()
        fields={key:{'booleanValue':value} for key,value in baseline['release']['flags'].items() if value is not None}
        fields['productionRooms']={'mapValue':{'fields':{r['code']:{'stringValue':r['allowlistEpoch']} for r in baseline['rooms']}}}
        responses={
            'releases/cloud.firestore':{'rulesetName':'projects/bxh-arena/rulesets/test'},
            'rulesets/test':{'source':{'files':[{'content':rules}]}},
            'systemConfig/fourCourtScoreBuckets':{'fields':fields,'updateTime':'stable'}
        }
        for room in baseline['rooms']:responses['tournaments/'+room['code']+'?mask.fieldPaths=scoreStorage']={'fields':{'scoreStorage':room['scoreStorage']}}
        def api(url,token):
            return next(value for key,value in responses.items() if url.endswith(key))
        with patch.object(M.CAP,'api',side_effect=api):
            self.assertEqual(len(M.policy_snapshot('test-only',baseline)['rooms']),2)
            fields['perCourtStorageEnabled']={'booleanValue':True}
            with self.assertRaisesRegex(ValueError,'flags changed'):M.policy_snapshot('test-only',baseline)
            fields.pop('perCourtStorageEnabled')
            fields['productionRooms']['mapValue']['fields']['BXH-EXTRA1']={'stringValue':'other'}
            with self.assertRaisesRegex(ValueError,'allowlist changed'):M.policy_snapshot('test-only',baseline)

    def test_mismatched_review_prevents_any_cloud_command(self):
        with patch.object(M.BUILD,'build',return_value=({},'',{'different':True})),patch.object(M.CAP,'command') as command:
            with self.assertRaisesRegex(ValueError,'reviewed plan'):M.prepare()
            command.assert_not_called()

if __name__=='__main__':unittest.main()
