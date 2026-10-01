import importlib.util,sys,hashlib,json,os,tempfile,unittest
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1];sys.path.insert(0,str(ROOT/'scripts'))
import verify_tile_repair as v

class AttestationTests(unittest.TestCase):
    def test_exact_restored_tile_is_accepted_without_rewriting_timestamp(self):
        with tempfile.TemporaryDirectory() as tmp:
            p=Path(tmp);db=p/'db';db.write_bytes(b'db');tile=p/'tree_root_shapes.pmtiles';tile.write_bytes(b'known');os.utime(tile,(1,1));stamp=tile.stat().st_mtime_ns
            report=p/'report.json';data={'version':v.VERSION,'status':'applied','database_mtime_ns':db.stat().st_mtime_ns,'database_before_mtime_ns':stamp+100,'unchanged_tiles':[{'path':tile.name,'bytes':5,'sha256':hashlib.sha256(b'known').hexdigest()}]};report.write_text(json.dumps(data))
            self.assertTrue(v.verified(db,tile,report));self.assertEqual(tile.stat().st_mtime_ns,stamp)
            tile.write_bytes(b'other');self.assertFalse(v.verified(db,tile,report))
            tile.write_bytes(b'known');data['database_mtime_ns']=0;report.write_text(json.dumps(data));self.assertFalse(v.verified(db,tile,report))

if __name__=='__main__':unittest.main()
