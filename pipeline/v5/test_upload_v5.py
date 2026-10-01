import unittest,tempfile,json,hashlib,importlib.util,argparse,subprocess
from pathlib import Path
spec=importlib.util.spec_from_file_location('upload',str(Path(__file__).with_name('upload_v5.py')));mod=importlib.util.module_from_spec(spec);spec.loader.exec_module(mod)
class UploadTest(unittest.TestCase):
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory(prefix='alto-upload-test-');self.root=Path(self.tmp.name);self.src=self.root/'src';self.src.mkdir()
  files=[]
  for name,text in [('index.html','new page'),('data/example.json','new data'),('new.js','new script')]:
   p=self.src/name;p.parent.mkdir(parents=True,exist_ok=True);p.write_text(text);files.append({'path':name,'bytes':p.stat().st_size,'sha256':mod.sha(p)})
  (self.src/'bundle-manifest.json').write_text(json.dumps({'files':files,'version':'test','tree_records':2}));(self.src/'deployment.json').write_text(json.dumps({'replace_paths':[f['path'] for f in files]}));(self.src/'release-checks.json').write_text('{"status":"passed"}')
  self.u=mod.Upload(argparse.Namespace(src=str(self.src),host='deploy-host',live='live',stage='stage',base='https://example.invalid'))
  for name,text in [('index.html','old page'),('data/example.json','old data'),('keep.php','keep')]:
   p=self.root/'live'/name;p.parent.mkdir(parents=True,exist_ok=True);p.write_text(text)
  import shutil;shutil.copytree(self.src,self.root/'stage')
  self.u.remote=lambda code,capture=False:subprocess.run(['bash','-s'],input=code.replace('"$HOME"',str(self.root)).replace('sha256sum','shasum -a 256'),text=True,capture_output=True,check=True)
 def tearDown(self):self.tmp.cleanup()
 def test_round_trip(self):
  self.u.activate();self.assertEqual((self.root/'live/index.html').read_text(),'new page');self.assertEqual((self.root/'live/keep.php').read_text(),'keep');self.u.rollback();self.assertEqual((self.root/'live/index.html').read_text(),'old page');self.assertFalse((self.root/'live/new.js').exists());self.assertEqual((self.root/'stage/new.js').read_text(),'new script')
 def test_repeated_rollback_leaves_restored_files(self):
  self.u.activate();self.u.rollback()
  with self.assertRaises(subprocess.CalledProcessError):self.u.rollback()
  self.assertEqual((self.root/'live/index.html').read_text(),'old page')
 def test_tamper_blocks_activation(self):
  (self.root/'stage/data/example.json').write_text('changed')
  with self.assertRaises(subprocess.CalledProcessError):self.u.activate()
  self.assertEqual((self.root/'live/index.html').read_text(),'old page')
 def test_missing_file_after_check_rolls_back(self):
  self.u.check=lambda:(self.root/'stage/index.html').unlink()
  with self.assertRaises(subprocess.CalledProcessError):self.u.activate()
  self.assertEqual((self.root/'live/index.html').read_text(),'old page');self.assertEqual((self.root/'live/data/example.json').read_text(),'old data');self.assertFalse((self.root/'live/new.js').exists())
 def test_bad_paths(self):
  for s in ['/live','../live','stage;bad','stage/../live']:
   with self.assertRaises(ValueError):mod.safe(s)
 def test_incomplete_validation(self):
  (self.src/'release-checks.json').write_text('{"status":"running"}')
  with self.assertRaises(RuntimeError):self.u.validate()
if __name__=='__main__':unittest.main()
