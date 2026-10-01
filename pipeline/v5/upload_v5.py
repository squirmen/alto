#!/usr/bin/env python3
"""ALTO v5 SSH staging. Parallel byte ranges and four detail-bucket streams, as in v4.
Commands: plan, push, check, activate, rollback, status, smoke.
Only activate changes the live files. Every activation rechecks staged SHA-256s.
"""
from pathlib import Path,PurePosixPath
import argparse,concurrent.futures,hashlib,json,math,os,re,shlex,subprocess,sys,tempfile,time,urllib.request
DEFAULT='/data/alto/working/alto_v5_20260922/deploy/alto_v5_upload_20260923'
SSH=['ssh','-o','BatchMode=yes','-o','Compression=no','-o','ControlPath=none','-o','ServerAliveInterval=30','-o','ServerAliveCountMax=6']
def sha(path):
 h=hashlib.sha256()
 with path.open('rb') as f:
  for b in iter(lambda:f.read(8<<20),b''):h.update(b)
 return h.hexdigest()
def safe(path):
 p=PurePosixPath(path)
 if p.is_absolute() or '..' in p.parts or not re.fullmatch(r'[A-Za-z0-9_./-]+',path):raise ValueError('Unsafe relative path: '+path)
 return path
class Upload:
 def __init__(self,a):
  self.a=a;self.src=Path(a.src).resolve();self.live=safe(a.live);self.stage=safe(a.stage)
  if not re.fullmatch(r'[A-Za-z0-9_.@-]+',a.host):raise ValueError('Unsafe host alias')
  if self.live==self.stage:raise ValueError('Staging must be separate from live')
  self.m=json.loads((self.src/'bundle-manifest.json').read_text());self.files=self.m['files']
  for f in self.files:safe(f['path'])
  self.items=json.loads((self.src/'deployment.json').read_text())['replace_paths']
  for p in self.items:safe(p)
 def remote(self,code,capture=False):
  return subprocess.run(SSH+[self.a.host,'bash','-s'],input=code,text=True,capture_output=capture,check=True)
 def validate(self):
  ready=json.loads((self.src/'release-checks.json').read_text())
  if ready.get('status')!='passed':raise RuntimeError('Release checks have not passed')
  for f in self.files:
   p=self.src/f['path']
   if not p.is_file() or p.is_symlink() or p.stat().st_size!=f['bytes'] or sha(p)!=f['sha256']:raise RuntimeError('Local manifest mismatch: '+f['path'])
 def jobs(self):
  jobs=[];rest=[];groups=[[] for _ in range(4)]
  for f in self.files:
   p=f['path']
   if p.endswith('.pmtiles') and f['bytes']>=32<<20:
    mb=math.ceil(f['bytes']/(1<<20));length=math.ceil(mb/2)
    for i in range(2):jobs.append(('range',p,i*length,length))
   elif re.fullmatch(r'data/tree_details/[0-9a-f]{3}\.json\.gz',p):groups[int(Path(p).name[0],16)//4].append(p)
   else:rest.append(p)
  rest.append('bundle-manifest.json')
  jobs += [('files','details '+str(i),g) for i,g in enumerate(groups) if g]
  if rest:jobs.append(('files','page, metadata and auxiliary data',rest))
  return jobs
 def plan(self):
  print(json.dumps({'source':str(self.src),'host':self.a.host,'live':self.live,'staging':self.stage,'bytes':sum(f['bytes'] for f in self.files),'files':len(self.files),'parallel_workers':6,'jobs':[{'kind':j[0],'label':j[1],'offset_mib':j[2],'length_mib':j[3]} if j[0]=='range' else {'kind':j[0],'label':j[1],'files':len(j[2])} for j in self.jobs()],'activation':'Requires all staged SHA-256 hashes to pass. Backs up replaced paths and switches index.html last. KYTE accounts, PHP configuration, field uploads and root .htaccess are excluded.'},indent=2))
 def push(self):
  self.validate();parents={str(PurePosixPath(f['path']).parent) for f in self.files}
  code='set -e\ncd "$HOME"\n'+'\n'.join('mkdir -p '+shlex.quote(self.stage+'/'+p) for p in parents)+'\n'
  for f in self.files:
   if f['path'].endswith('.pmtiles') and f['bytes']>=32<<20:code+=f"truncate -s {f['bytes']} "+shlex.quote(self.stage+'/'+f['path'])+'\n'
  self.remote(code)
  def job(j):
   for attempt in range(1,7):
    try:
     if j[0]=='range':
      _,path,start,length=j
      command=f"dd of={shlex.quote(self.stage+'/'+path)} bs=1048576 seek={start} conv=notrunc status=none"
      dd=subprocess.Popen(['dd','if='+str(self.src/path),'bs=1048576','skip='+str(start),'count='+str(length)],stdout=subprocess.PIPE,stderr=subprocess.DEVNULL)
      ssh=subprocess.Popen(SSH+[self.a.host,command],stdin=dd.stdout);dd.stdout.close();sc=ssh.wait();dc=dd.wait()
      if sc or dc:raise RuntimeError(f'dd={dc} ssh={sc}')
     else:
      with tempfile.NamedTemporaryFile('w',prefix='alto-v5-files-') as f:
       f.write('\n'.join(j[2])+'\n');f.flush()
       subprocess.run(['rsync','-a','--partial','--files-from='+f.name,'-e',shlex.join(SSH),str(self.src)+'/',self.a.host+':'+self.stage+'/'],check=True)
     print('Completed:',j[1],flush=True);return
    except (subprocess.CalledProcessError,RuntimeError) as e:
     print(f'Retrying {j[1]}: attempt {attempt}, {e}',flush=True)
     if attempt==6:raise
     time.sleep(20)
  futures=[]
  with concurrent.futures.ThreadPoolExecutor(max_workers=6) as pool:
   for j in self.jobs():futures.append(pool.submit(job,j));time.sleep(6)
   failures=[]
   for f in concurrent.futures.as_completed(futures):
    try:f.result()
    except Exception as e:failures.append(str(e))
   if failures:raise RuntimeError('Transfer failures: '+'; '.join(failures))
  self.check()
 def check(self):
  # The checksum list is generated locally. Remote manifest contents cannot choose commands.
  lines='\n'.join(f["sha256"]+'  '+f['path'] for f in self.files)
  self.remote('set -e\ncd "$HOME"/'+shlex.quote(self.stage)+"\nsha256sum -c --quiet <<'ALTO_V5_HASHES'\n"+lines+'\nALTO_V5_HASHES\n')
  print('Every staged file matches the local manifest.',flush=True)
 def activate(self):
  self.validate();self.check();stamp=time.strftime('%Y%m%d%H%M%S');backup='alto_backup_v5_'+stamp
  # Files are moved on the same filesystem. A trap restores any completed move if a later one fails.
  ordered=sorted(self.items,key=lambda p:p=='index.html')
  code='set -euo pipefail\ncd "$HOME"\n'
  code+='mkdir '+shlex.quote(backup)+'\n'
  code+='BK='+shlex.quote(backup)+'\nLIVE='+shlex.quote(self.live)+'\nSTAGE='+shlex.quote(self.stage)+'\n'
  code+='''restore(){
 trap - ERR
 while IFS= read -r p; do
  if [[ ! -e "$STAGE/$p" && -e "$LIVE/$p" ]]; then mkdir -p "$STAGE/$(dirname "$p")"; mv "$LIVE/$p" "$STAGE/$p"; fi
  if [[ -e "$BK/$p" ]]; then mkdir -p "$LIVE/$(dirname "$p")"; mv "$BK/$p" "$LIVE/$p"; fi
 done < "$BK/moved.txt"
 echo 'Activation failed; completed moves restored.' >&2
}
trap restore ERR
: > "$BK/moved.txt"
'''
  for p in ordered:
   q=shlex.quote(p);code+=f'p={q}\n[[ -e "$STAGE/$p" ]]\nmkdir -p "$BK/$(dirname "$p")" "$LIVE/$(dirname "$p")"\n'
   # Register the item before changing it; rollback can restore old even if the second move fails.
   code+='printf "%s\\n" "$p" >> "$BK/moved.txt"\n[[ ! -e "$LIVE/$p" ]] || mv "$LIVE/$p" "$BK/$p"\nmv "$STAGE/$p" "$LIVE/$p"\n'
  code+='trap - ERR\nprintf "%s\\n" "$BK" > .alto_v5_last_backup\necho "Activated; backup: $BK"\n';self.remote(code)
 def rollback(self):
  code='set -euo pipefail\ncd "$HOME"\nBK=$(cat .alto_v5_last_backup)\n[[ "$BK" =~ ^alto_backup_v5_[0-9]+$ ]]\nLIVE='+shlex.quote(self.live)+'\nSTAGE='+shlex.quote(self.stage)+'\n'
  code+='''[[ -f "$BK/moved.txt" && ! -e "$BK/rolled_back" ]] || { echo "Backup missing or already restored" >&2; exit 1; }
while IFS= read -r p; do
 [[ "$p" != /* && "$p" != *..* ]]
 mkdir -p "$STAGE/$(dirname "$p")" "$LIVE/$(dirname "$p")"
 [[ ! -e "$LIVE/$p" ]] || mv "$LIVE/$p" "$STAGE/$p"
 [[ ! -e "$BK/$p" ]] || mv "$BK/$p" "$LIVE/$p"
done < "$BK/moved.txt"
touch "$BK/rolled_back"
echo 'Previous release restored; v5 files retained in staging.'
''';self.remote(code)
 def status(self):
  self.remote('cd "$HOME"\ndf -h .\nfor p in '+shlex.quote(self.live)+' '+shlex.quote(self.stage)+'; do test ! -d "$p" || du -sh "$p"; done\n')
 def smoke(self):
  base=self.a.base.rstrip('/');version=self.m['version'];headers={'User-Agent':'Mozilla/5.0 ALTO release check'}
  def get(path,extra=None):return urllib.request.urlopen(urllib.request.Request(base+'/'+path,headers={**headers,**(extra or {})}),timeout=60)
  with get('index.html') as r:assert ('AKL_TILE_VERSION="'+version+'"') in r.read().decode()
  with get('data/tree_details/schema.json') as r:assert json.load(r)['records']==self.m['tree_records']
  for f in self.files:
   if f['path'].endswith('.pmtiles'):
    with get(f['path'],{'Range':'bytes=0-127','Accept-Encoding':'identity'}) as r:assert r.status==206 and len(r.read())==128 and not r.headers.get('Content-Encoding'),f['path']
  print('Page, detail snapshot and PMTiles byte ranges passed.')
def main():
 p=argparse.ArgumentParser(description=__doc__);p.add_argument('command',choices=['plan','push','check','activate','rollback','status','smoke']);p.add_argument('--src',default=DEFAULT);p.add_argument('--host',default=os.environ.get('ALTO_DEPLOY_HOST','deploy-host'));p.add_argument('--live',default='alto.tfwelch.com');p.add_argument('--stage',default='alto_stage_v5_20260923');p.add_argument('--base',default='https://alto.tfwelch.com');a=p.parse_args();getattr(Upload(a),a.command)()
if __name__=='__main__':main()
