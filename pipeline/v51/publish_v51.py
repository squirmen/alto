#!/usr/bin/env python3
"""Stage, verify and activate V5.1 with rollback using the established ALTO uploader."""
import argparse
import importlib.util
import json
import os
import re
import shlex
from pathlib import Path

from build_v51 import PIPE, STAGE, VERSION, V5, W, now, write

spec = importlib.util.spec_from_file_location('property_uploader', PIPE / 'v5/upload_property.py')
base = importlib.util.module_from_spec(spec)
spec.loader.exec_module(base)


class Upload(base.Upload):
    def validate(self):
        ready = json.loads((self.src / 'release-checks.json').read_text())
        if ready.get('status') != 'passed' or ready.get('version') != VERSION:
            raise RuntimeError('This release has not passed its static-product checks')
        # verify_v51.py has already hashed every artifact when sealing this
        # manifest. Check the local inventory here; check() independently hashes
        # every staged byte after transfer and again before activation. That
        # end-to-end check also catches any same-size local change after sealing,
        # without reading the entire 8 GB bundle repeatedly on the source drive.
        for f in self.files:
            p = self.src / f['path']
            if not re.fullmatch('[0-9a-f]{64}', f['sha256']):
                raise RuntimeError('Invalid manifest digest: ' + f['path'])
            if not p.is_file() or p.is_symlink() or p.stat().st_size != f['bytes']:
                raise RuntimeError('Local inventory changed: ' + f['path'])
        print('Local inventory matches the sealed release; server byte checks remain mandatory.', flush=True)

    def jobs(self):
        jobs, rest, groups = [], [], [[] for _ in range(8)]
        for f in self.files:
            p = f['path']
            if p.endswith('.pmtiles') and f['bytes'] >= 32 << 20:
                mb = base.math.ceil(f['bytes'] / (1 << 20))
                length = base.math.ceil(mb / 4)
                for i in range(4):
                    jobs.append(('range', p, i * length, length))
            elif re.fullmatch(r'data/(tree_details|property_details)/[0-9a-f]{2}/[0-9a-f]{2}\.json\.gz', p):
                groups[int(Path(p).parent.name[0], 16) // 4 + (4 if '/property_details/' in p else 0)].append(p)
            else:
                rest.append(p)
        rest.append('bundle-manifest.json')
        jobs.extend(('files', 'profile stream ' + str(i), g) for i, g in enumerate(groups) if g)
        jobs.append(('files', 'UI, evidence and KYTE nearby index', rest))
        return jobs

    def baseline(self):
        expected = json.loads((self.src / 'deployment.json').read_text())['baseline_hashes']
        # Accepted field visits can update an individual profile independently of
        # the page. Check the entire old profile snapshot, not only its schema,
        # before replacing it, so a concurrent accepted visit cannot be lost.
        prior = json.loads((V5 / 'details_v2/details_manifest.json').read_text())
        expected.update({'data/' + f['path']: f['sha256'] for f in prior['files']})
        for p in expected:
            base.safe(p)
        lines = '\n'.join(h + '  ' + p for p, h in expected.items())
        self.remote('set -e\ncd "$HOME"/' + shlex.quote(self.live) + "\nsha256sum -c --quiet <<'V51_BASELINE'\n" + lines + '\nV51_BASELINE\n')

    def push(self):
        self.baseline()
        # Hardlink unchanged public shards into an isolated stage. rsync writes
        # changed files via temporary files plus rename (never --inplace), keeping
        # every live inode intact and avoiding an unnecessary unchanged upload.
        code = 'set -e\ncd "$HOME"\n'
        # All tree IDs (and therefore all 65,536 tree buckets) are retained.
        # Property coverage can shrink: build that directory fresh so obsolete
        # buckets cannot survive outside the new manifest.
        for name in ('data/tree_details',):
            target = shlex.quote(self.stage + '/' + name)
            source = shlex.quote(self.live + '/' + name)
            parent = shlex.quote(self.stage + '/data')
            code += f'mkdir -p {parent}\nif [ ! -e {target} ]; then cp -al {source} {target}; fi\n'
        self.remote(code)
        super().push()

    def activate(self):
        self.baseline()
        super().activate()
        write(W / 'verification/activation.json', {'version': VERSION, 'activated_utc': now(),
              'public_url': self.a.base, 'stage': self.stage, 'rollback_command': 'pipeline/v51/publish_v51.py rollback',
              'note': 'Activation rechecked every staged digest; previous replaced paths retained in the server backup.'})


if __name__ == '__main__':
    p = argparse.ArgumentParser()
    p.add_argument('command', choices=['plan', 'push', 'check', 'activate', 'rollback', 'status', 'smoke', 'baseline'])
    p.add_argument('--src', default=str(STAGE))
    p.add_argument('--host', default=os.environ.get('ALTO_DEPLOY_HOST', 'deploy-host'))
    p.add_argument('--live', default='alto.tfwelch.com')
    p.add_argument('--stage', default='alto_stage_v51_20261008')
    p.add_argument('--base', default='https://alto.tfwelch.com')
    args = p.parse_args()
    getattr(Upload(args), args.command)()
