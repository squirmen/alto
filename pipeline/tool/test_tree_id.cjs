// Offline checks for web/tree-id.js: permanent tree numbers (format, check character, typing slack) and the alias
// table (data/tree_ids, v6.1) read through a stub fetch from a small table built here in the release's own layout.
// With ALTO_TREE_IDS_ROOT=<bundle root> it also resolves keys listed in $ALTO_TREE_IDS_CASES (JSON) against a real
// bundle and checks the expected numbers (release_tools/verify_v61.py writes that file).
// Usage: node pipeline/tool/test_tree_id.cjs
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const zlib=require('node:zlib');
const web=path.join(__dirname,'..','..','web')+'/';
const Id=require(web+'tree-id.js');

// ---- numbers
const ALPHA=Id.ALPHABET;
assert.equal(ALPHA.length,32);
assert.ok(!/[ILOU]/.test(ALPHA));
const make=payload=>'T'+payload+Id.checkChar(payload);
const N1=make('8K5P7T'),N2=make('417RK8'),N3=make('GAC6GY');
for(const n of [N1,N2,N3])assert.ok(Id.validNumber(n)&&Id.isNumber(n),n);
assert.equal(N1,'T8K5P7T3');                 // same check character as release_tools/tree_numbers.py
assert.equal(Id.parseNumber(N1.toLowerCase()).number,N1);
assert.equal(Id.parseNumber(`${N1.slice(0,4)}-${N1.slice(4)}`).number,N1);
assert.equal(Id.parseNumber(` ${N1.slice(0,4)} ${N1.slice(4)} `).number,N1);
const withI=make('110A2B');                   // typed with I and L for 1 and O for 0
assert.equal(Id.parseNumber('T'+'IL'+'O'+withI.slice(4)).number,withI);
// every single-character substitution of a number is caught by the check character
let caught=0,total=0;
for(const n of [N1,N2,N3])for(let i=1;i<8;i++)for(const c of ALPHA){if(c===n[i])continue;total++;if(!Id.validNumber(n.slice(0,i)+c+n.slice(i+1)))caught++;}
assert.equal(caught,total);
assert.equal(Id.normalise(N1.slice(0,7)+(N1[7]==='0'?'1':'0')),null,'a mistyped number is refused, not read as a record ID');
assert.equal(Id.normalise(N1.toLowerCase()),N1);
assert.ok(Id.looksLikeId(N1)&&Id.looksLikeId('pc_BA32_1000_3310:1760512.25:5922649.75')&&!Id.looksLikeId('12 Queen Street'));
// record IDs and crown keys keep their old forms
assert.equal(Id.normalise('trp_ACCT0050811'),'akl_tree_trp_ACCT0050811');
assert.equal(Id.normalise('pc_BA32_1000_3310:1760512.25:5922649.75'),'pc_BA32_1000_3310:1760512.25:5922649.75');
assert.equal(Id.normalise('3520950_11845304'),'3520950_11845304');
for(const bad of ['','<script>','a b','../x'])assert.equal(Id.normalise(bad),null,bad);
// links
assert.equal(Id.permalink(N1.toLowerCase()),`https://alto.org.nz/tree/${N1}`);
assert.equal(Id.url(N1,{base:'https://alto.tfwelch.com/beta/tree.html?id=x'}),`https://alto.tfwelch.com/beta/tree.html?id=${N1}`);
assert.equal(Id.fromLocation({href:`https://alto.tfwelch.com/tree/${N1}`}),N1);
assert.equal(Id.fromLocation({href:`https://alto.tfwelch.com/tree.html?id=${N1}#m-crown`}),N1);
assert.equal(Id.fromLocation({href:'https://alto.tfwelch.com/?tree=akl_tree_lid_1097624'}),'akl_tree_lid_1097624');

// ---- a small alias table in the release layout
const dir=fs.mkdtempSync(path.join(require('node:os').tmpdir(),'tree-ids-'));
const T=path.join(dir,'data','tree_ids');
const rows={
  [N1]:[null,'akl_tree_not_336','current'],
  [N2]:[null,'akl_tree_lid_1110327','current',null,null,{k:'record'}],
  [N3]:[null,'akl_tree_pc4_3521064_11845460','current'],
  'akl_tree_not_336':[N1,null,'current',null,'C00001'],
  'akl_tree_lid_1097624':[N1,'akl_tree_not_336','member',null,'C00001'],
  'akl_tree_pc4_3517546_11848800':[N3,'akl_tree_pc4_3521064_11845460','merged',[N3],'C00004'],
  'pc_BA32_1000_3310:1760474.75:5922651.75':[N1,'akl_tree_not_336','current'],
  '3520950_11845304':[null,null,'split',[N3,N1],'v4_split'],
  '3520942_11845306':[null,'akl_tree_not_336','retired',[N1],'v4_not_continued'],
  'akl_tree_lid_0001873':[null,null,'retired',null,'deleted_pointcloud_false_positive',{p:[174.58301583,-37.0779744]}],
};
const shards={};
for(const [k,r] of Object.entries(rows)){const b=Id.bucketPath(k);(shards[b]=shards[b]||{})[k]=r;}
for(const [b,obj] of Object.entries(shards)){fs.mkdirSync(path.join(T,path.dirname(b)),{recursive:true});fs.writeFileSync(path.join(T,b),zlib.gzipSync(JSON.stringify(obj)));}
fs.writeFileSync(path.join(T,'schema.json'),JSON.stringify({bucket_algorithm:'fnv1a_utf8_mod65536_hex4_split2',
  notes:{v4_split:'v4 crown divided between several current crowns',deleted_pointcloud_false_positive:'removed in Sep 2026: no tree at this detection'}}));
const files=new Map();
global.fetch=async url=>{
  const p=path.join(dir,'data',String(url).replace(/^\.\/data\//,'').replace(/\?.*$/,''));
  if(!fs.existsSync(p))return {ok:false,status:404};
  const buf=fs.readFileSync(p);files.set(p,(files.get(p)||0)+1);
  return {ok:true,status:200,arrayBuffer:async()=>buf.buffer.slice(buf.byteOffset,buf.byteOffset+buf.byteLength)};
};
global.Response=global.Response||require('node:buffer').Response;
const META={derived_products:{tree_ids:'data/tree_ids/schema.json'}};
const R=raw=>Id.resolve(raw,{base:'./data',version:'t',metadata:META});

(async()=>{
  let r=await R(N1.toLowerCase());
  assert.deepEqual([r.kind,r.canonical,r.tree_id,r.status,r.relation],['number',N1,'akl_tree_not_336','current','crown']);
  r=await R(N2);
  assert.equal(r.relation,'record');
  r=await R('not_336');
  assert.deepEqual([r.canonical,r.tree_id,r.status,r.relation,r.record],[N1,'akl_tree_not_336','current','marker','akl_tree_not_336']);
  assert.match(r.note,/C00001/);
  r=await R('akl_tree_lid_1097624');   // a member shows its tree, and says which record was asked for
  assert.deepEqual([r.canonical,r.tree_id,r.status,r.relation,r.record],[N1,'akl_tree_not_336','current','member','akl_tree_lid_1097624']);
  r=await R('akl_tree_pc4_3517546_11848800');
  assert.deepEqual([r.canonical,r.status,r.successor,r.tree_id],[N3,'merged',N3,'akl_tree_pc4_3521064_11845460']);
  r=await R('pc_BA32_1000_3310:1760474.75:5922651.75');
  assert.deepEqual([r.kind,r.canonical,r.tree_id,r.relation],['crown_key',N1,'akl_tree_not_336','crown']);
  r=await R('3520950_11845304');       // split: the largest part, every part listed
  assert.deepEqual([r.status,r.canonical,r.successors,r.tree_id],['split',N3,[N3,N1],'akl_tree_pc4_3521064_11845460']);
  assert.match(r.note,/divided/);
  r=await R('3520942_11845306');
  assert.deepEqual([r.status,r.canonical,r.tree_id],['retired',N1,'akl_tree_not_336']);
  r=await R('akl_tree_lid_0001873');   // tombstone: no tree, a reason and the last position
  assert.deepEqual([r.status,r.tree_id,r.canonical],['retired',null,null]);
  assert.deepEqual(r.position,{lon:174.58301583,lat:-37.0779744});
  assert.match(r.note,/^Removed in Sep 2026: no tree at this detection\.$/);
  r=await R(make('ZZZZZZ'));
  assert.deepEqual([r.status,r.tree_id],['unknown',null]);
  r=await R(N1.slice(0,7)+(N1[7]==='0'?'1':'0'));
  assert.equal(r.status,'invalid');assert.match(r.note,/check character/);
  r=await R('akl_tree_trp_NOT_IN_TABLE');   // UX-13: a record ID the table does not hold is unknown, not opened as a record
  assert.deepEqual([r.tree_id,r.status,r.resolved_by,r.note],[null,'unknown','alias_table','This ID is not in the release\'s ID table.']);
  assert.equal(Id.describe(r).heading,'Unknown record ID');
  // releases before v6.1 (no table): record IDs resolve to themselves, numbers cannot be resolved
  r=await Id.resolve('trp_ACCT0050811',{base:'./data',version:'1',metadata:{}});
  assert.deepEqual([r.tree_id,r.canonical,r.status,r.resolved_by],['akl_tree_trp_ACCT0050811','akl_tree_trp_ACCT0050811','current','release_tree_id']);
  assert.equal((await Id.resolve(N1,{metadata:{}})).status,'unknown');
  assert.equal((await Id.resolve('<x>',{})).status,'invalid');
  fs.rmSync(dir,{recursive:true,force:true});

  // ---- optional: a real bundle (verify_v61.py)
  if(process.env.ALTO_TREE_IDS_ROOT&&process.env.ALTO_TREE_IDS_CASES){
    const rootDir=process.env.ALTO_TREE_IDS_ROOT;
    global.fetch=async url=>{
      const p=path.join(rootDir,String(url).replace(/^\.\//,'').replace(/\?.*$/,''));
      if(!fs.existsSync(p))return {ok:false,status:404};
      const buf=fs.readFileSync(p);
      return {ok:true,status:200,arrayBuffer:async()=>buf.buffer.slice(buf.byteOffset,buf.byteOffset+buf.byteLength)};
    };
    const cases=JSON.parse(fs.readFileSync(process.env.ALTO_TREE_IDS_CASES,'utf8'));
    const meta=JSON.parse(fs.readFileSync(path.join(rootDir,'release-metadata.json'),'utf8'));
    let n=0;
    for(const c of cases){
      const got=await Id.resolve(c.input,{base:'./data',version:'v',metadata:meta});
      for(const [k,v] of Object.entries(c.expect))assert.deepEqual(got[k],v,`${c.input} ${k}`);
      n++;
    }
    console.log(`real bundle: ${n} cases resolved as expected`);
  }
  // ---- UX-13: the vectors shared with KYTE, and the cases they hold (fixtures/tree_ids: rows from the release table)
  {
    const V=require('./tree_number_vectors.cjs'),v=await V.build();
    assert.equal(fs.readFileSync(V.OUT,'utf8'),V.text(v),'fixtures/tree_number_vectors.json is what tree-id.js answers (node pipeline/tool/tree_number_vectors.cjs)');
    const c=Object.fromEntries(v.cases.map(x=>[x.input,x]));
    // a link copied from a sentence, %-escaped or typed with other spaces and dashes opens TMCTT6X4
    for(const t of ['TMCTT6X4.','TMCTT6X4)','(TMCTT6X4)','TMCT%20T6X4','tmct-t6x4','TMCT\u00A0T6X4','TMCT\u2010T6X4','TMCT\u2011T6X4','TMCT\u2012T6X4','TMCT\u2013T6X4','TMCT\u2014T6X4','TMCT\u2015T6X4','TMCT\u200BT6X4'])
      assert.deepEqual([c[t].normalise,c[t].resolve.status,c[t].resolve.number,c[t].resolve.tree_id],['TMCTT6X4','current','TMCTT6X4','akl_tree_not_336'],JSON.stringify(t));
    for(const l of v.links)assert.equal(l.normalise,'TMCTT6X4',l.url);
    assert.ok(v.links.some(l=>/\/Tree\//.test(l.url))&&v.links.some(l=>/\/TREE\/tmct-t6x4\//.test(l.url)),'/Tree/ and /TREE/ in the links');
    // every 8-character input starting with T is shaped like a number
    assert.deepEqual([c.TATFKBGX.isNumberShaped,c.TATFKBGX.resolve.status,c.TATFKBGX.suggest],[true,'invalid','TATFKBGZ'],'TATFKBGX offers TATFKBGZ');
    assert.deepEqual([c.TZZZZZZZ.isNumberShaped,c.TZZZZZZZ.suggest,c.TZZZZZZZ.resolve.note],[true,null,'The check character does not match: is a character mistyped?'],'TZZZZZZZ: the check character fails');
    assert.equal(Id.describe({...c.TZZZZZZZ.resolve,input:'TZZZZZZZ'}).heading,'Not a valid tree number');
    for(const w of ['Takapuna','Tanekaha'])assert.deepEqual([c[w].isNumberShaped,c[w].normalise,c[w].resolve.status],[true,null,'invalid'],`${w}: a link reads it as a number, never a record ID`);
    assert.equal(c.Takapuna.resolve.note,'Tree numbers do not use the letter U: is a character mistyped?');
    // ... while the map's search leaves 8-letter words to the place and species search
    assert.deepEqual(['Takapuna','Tanekaha','TATFKBGX','TANEKAHA','tatfkbgx','t1234567'].map(Id.typedAsNumber),[false,false,true,true,false,true]);
    // record IDs: the family folds to lower case; a record ID the table does not hold is unknown
    assert.deepEqual([c.AKL_TREE_NOT_336.normalise,c.AKL_TREE_NOT_336.resolve.status,c.AKL_TREE_NOT_336.resolve.number],['akl_tree_not_336','current','TMCTT6X4']);
    for(const t of ['akl_tree_does_not_exist','akl_tree_lid_9999999'])assert.deepEqual([c[t].resolve.status,c[t].resolve.tree_id],['unknown',null],t);
    assert.equal(Id.normalise('AKL_TREE_TRP_ACCT0050811'),'akl_tree_trp_ACCT0050811','the family folds; the source ID keeps its case');
    assert.equal(Id.normalise('<script>'),null);
    // Shared with KYTE: its tests read the same file (tests/fixtures/tree_number_vectors.json, numbers.test.js and
    // numbers_test.php), byte for byte, with the release table's rows the cases need. Checked when a KYTE checkout sits
    // beside this repository (or KYTE_REPO names one).
    const kyte=process.env.KYTE_REPO||path.join(__dirname,'..','..','..','kyte'),kv=path.join(kyte,'tests','fixtures','tree_number_vectors.json');
    if(fs.existsSync(kv)){
      assert.equal(fs.readFileSync(kv,'utf8'),fs.readFileSync(V.OUT,'utf8'),`KYTE's copy (${kv}) is this fixture: copy pipeline/tool/fixtures/tree_number_vectors.json there`);
      const shard=zlib.gunzipSync(fs.readFileSync(path.join(kyte,'tests','fixtures','tree_ids','00','00.json.gz'))).toString('utf8');
      assert.ok(shard.includes('"TATFKBGZ"'),'KYTE’s table rows hold TATFKBGZ (the TATFKBGX correction)');
      console.log(`vectors: KYTE's copy at ${kv} is identical`);
    }else console.log('vectors: no KYTE checkout beside this repository; its copy not compared');
    console.log(`vectors: ${v.cases.length} inputs and ${v.links.length} links as fixtures/tree_number_vectors.json holds them`);
  }
  console.log('tree-id.js: all checks passed');
})().catch(e=>{console.error(e);process.exit(1);});
