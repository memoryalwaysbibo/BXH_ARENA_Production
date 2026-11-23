#!/usr/bin/env python3
"""Restage only the two untouched PTN registration functions after /tmp expires."""
import json
from pathlib import Path
import tempfile

import PTN_multi_stage as stage


NAMES = ('registrationDrawV2', 'registrationStartV2')


def main():
    out = Path(tempfile.mkdtemp(prefix='bxh-ptn-resume-'))
    front = out / 'candidates' / 'front'
    front.parent.mkdir()
    stage.checkout(front, 'BXH_ARENA_Production', stage.FRONT)
    report = []
    for name in NAMES:
        binding = stage.describe(name)
        if (binding[2] != stage.TARGETS[name][0] or
                binding[3] != 'bxh-registration-v2-closed'):
            raise ValueError(name + ': live generation or codebase changed')
        report.append(stage.stage_one(out, name, binding, front, 'room'))
        if stage.describe(name) != binding:
            raise ValueError(name + ': source changed during staging')
    (out / 'report.json').write_text(json.dumps({
        'status': 'STAGED_ONLY', 'productionWrites': 0,
        'candidateCommits': [stage.FRONT], 'functions': report,
    }, indent=2) + '\n')
    print('PTN_RESUME_STAGE_OK', out)
    print('STAGED_ONLY: no production changes')


if __name__ == '__main__':
    main()
