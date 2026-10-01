from pathlib import Path
import shutil,urllib.request,re,json,posixpath,concurrent.futures
W=Path('/data/alto/working/alto_v5_20260922');S=W/'deploy/alto_v5_upload_20260923';P=W/'preview';B=W/'live_baseline';P.mkdir(exist_ok=True)
for p in B.iterdir():
 if p.is_file() and p.suffix in {'.html','.js','.mjs','.css','.png'}:shutil.copyfile(p,P/p.name)
for p in S.iterdir():
 if p.is_file() and p.suffix in {'.html','.js','.mjs','.css','.png','.json'}:shutil.copyfile(p,P/p.name)
(P/'data').mkdir(exist_ok=True)
for p in Path('/data/alto/web_deploy_20260910/data').iterdir():
 target=P/'data'/p.name
 if not target.exists() and not target.is_symlink():target.symlink_to(p)
for name in ['tree_change.pmtiles']:
 target=P/'data'/name
 if target.is_symlink():target.unlink()
 target.symlink_to(Path('/data/alto/working/alto_v4_20260917/deploy/alto_v4_upload_20260918015343/data')/name)
for p in (S/'data').iterdir():
 target=P/'data'/p.name
 if target.is_symlink():target.unlink()
 elif target.exists():
  if target.is_dir():shutil.rmtree(target)
  else:target.unlink()
 target.symlink_to(p)
# Mirror public client assets only. No API files or server-side configuration enter this preview.
K=Path('/data/alto/working/kyte_live_20260918');(P/'kyte').mkdir(exist_ok=True)
for p in K.iterdir():
 if p.is_file() and p.suffix in {'.html','.js','.css','.png','.svg','.webmanifest'}:shutil.copyfile(p,P/'kyte'/p.name)
for folder in ['shared','research']:
 if (K/folder).exists():shutil.copytree(K/folder,P/'kyte'/folder,dirs_exist_ok=True)
if (S/'kyte').exists():
 for p in (S/'kyte').rglob('*'):
  if not p.is_file():continue
  target=P/'kyte'/p.relative_to(S/'kyte');target.parent.mkdir(parents=True,exist_ok=True)
  if target.exists() or target.is_symlink():target.unlink()
  target.symlink_to(p)
seen=set()
def fetch(path):
 if path in seen:return
 seen.add(path);dest=P/path
 if not dest.exists():
  req=urllib.request.Request('https://alto.tfwelch.com/'+path,headers={'User-Agent':'Mozilla/5.0 ALTO release check'})
  with urllib.request.urlopen(req,timeout=60) as r:b=r.read()
  dest.parent.mkdir(parents=True,exist_ok=True);dest.write_bytes(b)
 if dest.suffix in {'.js','.mjs'}:
  for rel in re.findall(r'(?:from\s*|import\s*)[\"\'](\.[^\"\']+)[\"\']',dest.read_text()):
   fetch(posixpath.normpath(posixpath.join(posixpath.dirname(path),rel)))
for path in ['vendor/three/three.module.js','vendor/three/addons/loaders/GLTFLoader.js','vendor/three/addons/exporters/GLTFExporter.js','models/manifest.json','kyte/vendor/exifr-7.1.3.js','kyte/vendor/leaflet-1.9.4.js','kyte/vendor/leaflet-1.9.4.css']:
 fetch(path)
meta=json.loads((P/'models/manifest.json').read_text())
for entry in meta.get('models',{}).values():fetch(posixpath.normpath('models/'+entry['file']))
print('Preview assets ready',P,flush=True)
