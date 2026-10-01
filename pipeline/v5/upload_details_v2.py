#!/usr/bin/env python3
"""Push the 65,536 re-sharded detail buckets into the live tree_details directory.

The new files live in 256 subdirectories, so they sit beside the old flat buckets
without touching them; nothing served today changes until the page is switched.
Commands: push (six staggered rsync streams, retried), check (remote sha256 of every
file against details_manifest.json), schema (copy the new schema.json into place).
"""
import concurrent.futures, json, os, shlex, subprocess, sys, tempfile, time
from pathlib import Path
SRC=Path('/data/alto/working/alto_v5_20260922/details_v2')
MANIFEST=json.loads((SRC/'details_manifest.json').read_text())
HOST=os.environ.get('ALTO_DEPLOY_HOST','deploy-host'); LIVE=os.environ.get('ALTO_DEPLOY_DATA','alto.tfwelch.com/data')
SSH=['ssh','-o','BatchMode=yes','-o','Compression=no','-o','ControlPath=none','-o','ServerAliveInterval=30','-o','ServerAliveCountMax=6']
buckets=[f['path'] for f in MANIFEST['files'] if f['path'].endswith('.json.gz')]
def groups(n=6):
    dirs=sorted({p.split('/')[1] for p in buckets});out=[[] for _ in range(n)]
    for i,d in enumerate(dirs):out[i%n].append(d)
    return [[p for p in buckets if p.split('/')[1] in set(g)] for g in out]
def stream(label,files):
    for attempt in range(1,8):
        try:
            with tempfile.NamedTemporaryFile('w',prefix='alto-details-') as f:
                f.write('\n'.join(files)+'\n');f.flush()
                subprocess.run(['rsync','-a','--partial','--files-from='+f.name,'-e',shlex.join(SSH),str(SRC)+'/',HOST+':'+LIVE+'/'],check=True)
            print('completed',label,len(files),'files',flush=True);return
        except subprocess.CalledProcessError as e:
            print('retry',label,attempt,e,flush=True);time.sleep(25)
    raise RuntimeError('stream failed: '+label)
def push():
    subprocess.run(SSH+[HOST,'mkdir -p '+shlex.quote(LIVE+'/tree_details')],check=True)
    t0=time.time();futures=[]
    with concurrent.futures.ThreadPoolExecutor(max_workers=6) as pool:
        for i,g in enumerate(groups()):
            futures.append(pool.submit(stream,f'stream {i}',g));time.sleep(8)
        for f in futures:f.result()
    print('push done in',round(time.time()-t0),'s',flush=True)
def check():
    want={f['path']:f['sha256'] for f in MANIFEST['files'] if f['path'].endswith('.json.gz')}
    code='cd '+shlex.quote(LIVE)+' && find tree_details -mindepth 2 -name "*.json.gz" -print0 | xargs -0 sha256sum'
    out=subprocess.run(SSH+[HOST,code],capture_output=True,text=True,check=True).stdout
    got={}
    for line in out.splitlines():
        h,p=line.split(None,1);got[p.strip().lstrip('./')]=h
    missing=[p for p in want if p not in got];bad=[p for p,h in want.items() if p in got and got[p]!=h]
    print(json.dumps({'expected':len(want),'remote':len(got),'missing':len(missing),'mismatched':len(bad),'sample_missing':missing[:5],'sample_bad':bad[:5]}))
    return not missing and not bad
def schema():
    subprocess.run(['rsync','-a','-e',shlex.join(SSH),str(SRC/'tree_details/schema.json'),HOST+':'+LIVE+'/tree_details/schema.json'],check=True)
    print('schema.json in place')
if __name__=='__main__':
    {'push':push,'check':check,'schema':schema}[sys.argv[1]]()
