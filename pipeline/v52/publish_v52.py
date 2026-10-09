#!/usr/bin/env python3
"""Stage, verify and activate V5.2 with rollback using the established ALTO uploader.

push and check only write to the staging folder; the live site changes only on activate, which
rechecks every staged digest and that the live site is still exactly V5.1 on every path it replaces.
"""
import argparse
import importlib.util
import json
import os
import re
import shlex
from pathlib import Path

from build_v52 import PIPE, STAGE, VERSION, W, now, write

spec = importlib.util.spec_from_file_location('property_uploader', PIPE / 'v5/upload_property.py')
base = importlib.util.module_from_spec(spec)
spec.loader.exec_module(base)


class Upload(base.Upload):
    def validate(self):
        ready = json.loads((self.src / 'release-checks.json').read_text())
        if ready.get('status') != 'passed' or ready.get('version') != VERSION:
            raise RuntimeError('This release has not passed its static-product checks')
        # verify_v52.py has already hashed every artifact when sealing this manifest. Check the
        # local inventory here; check() independently hashes every staged byte after transfer and
        # again before activation, which also catches a same-size local change after sealing.
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
        jobs.append(('files', 'UI, evidence, positions layer and KYTE nearby index', rest))
        return jobs

    def baseline(self):
        """The live site must still be V5.1, byte for byte, on every path V5.2 replaces.

        Accepted field visits can update an individual profile independently of the page, so the
        whole V5.1 profile snapshot is checked, not only its schema; paths V5.2 adds must be absent.
        """
        deploy = json.loads((self.src / 'deployment.json').read_text())
        expected = deploy['baseline_hashes']
        for p in list(expected) + deploy['new_paths']:
            base.safe(p)
        lines = '\n'.join(h + '  ' + p for p, h in expected.items())
        code = 'set -e\ncd "$HOME"/' + shlex.quote(self.live) + "\nsha256sum -c --quiet <<'V52_BASELINE'\n" + lines + '\nV52_BASELINE\n'
        for p in deploy['new_paths']:
            code += f'if [ -e {shlex.quote(p)} ]; then echo "Path already exists on the live site: {p}" >&2; exit 1; fi\n'
        self.remote(code)
        print(f'Live site matches V5.1 on all {len(expected):,} replaced files; {len(deploy["new_paths"])} new paths are absent.', flush=True)

    def push(self):
        self.baseline()
        # Hardlink the unchanged public profiles into an isolated stage. rsync writes changed files
        # via temporary files plus rename (never --inplace), so every live inode stays intact and
        # unchanged buckets are not uploaded again. Property coverage can change: built fresh.
        code = 'set -e\ncd "$HOME"\n'
        target = shlex.quote(self.stage + '/data/tree_details')
        source = shlex.quote(self.live + '/data/tree_details')
        code += f'mkdir -p {shlex.quote(self.stage + "/data")}\nif [ ! -e {target} ]; then cp -al {source} {target}; fi\n'
        # Directories whose file set can change between builds are staged fresh, so a re-push never
        # leaves a file from an earlier staging that the manifest no longer lists. Staging only.
        assert re.fullmatch(r'alto_stage_v52_[0-9a-z_]+', self.stage)
        for name in ('data/property_details', 'kyte/data/nearby'):
            code += 'rm -rf ' + shlex.quote(self.stage + '/' + name) + '\n'
        self.remote(code)
        super().push()

    def activate(self):
        self.baseline()
        super().activate()
        write(W / 'verification/activation.json', {'version': VERSION, 'activated_utc': now(), 'public_url': self.a.base, 'stage': self.stage,
              'rollback_command': 'pipeline/v52/publish_v52.py rollback',
              'note': 'Activation rechecked every staged digest and the V5.1 baseline; previous replaced paths retained in the server backup.'})


if __name__ == '__main__':
    p = argparse.ArgumentParser()
    p.add_argument('command', choices=['plan', 'push', 'check', 'activate', 'rollback', 'status', 'smoke', 'baseline'])
    p.add_argument('--src', default=str(STAGE))
    p.add_argument('--host', default=os.environ.get('ALTO_DEPLOY_HOST', 'deploy-host'))
    p.add_argument('--live', default='alto.tfwelch.com')
    p.add_argument('--stage', default='alto_stage_v52_20261010')
    p.add_argument('--base', default='https://alto.tfwelch.com')
    args = p.parse_args()
    getattr(Upload(args), args.command)()
