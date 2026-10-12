// Offline checks for tool 0.2.3's tree numbers (data release 6.1) on real v6 development records with a tree_number
// dataset added, and a small alias table in the release's layout served by a stub fetch:
//   display   the number as the tree's ID on the tree page and the map panel (Copy, permalink, the record ID second),
//             citation and share by number and permalink, KYTE links that keep the record ID, and the fallback to
//             record IDs on data without numbers;
//   search    what the map's search offers for numbers, mistyped numbers and older IDs, ranked first;
//   validate  the check character: the well-formed numbers one keystroke away and the one correction the release holds;
//   status    the pages for retired (tombstone or replaced), merged, split, unknown and mistyped IDs: a title with the
//             status and the reason, the trees that took its place as links, never a bare "Not a tree ID".
// Usage: node pipeline/tool/test_tree_numbers_ui.cjs
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),zlib=require('node:zlib'),os=require('node:os');
const web=path.join(__dirname,'..','..','web')+'/';
globalThis.window=globalThis;
for(const f of ['palette.js','version.js','tree-id.js','sources.js','growth-form.js','record-links.js','tree-summary.js','alto-viz.js'])require(web+f);
const Id=require(web+'tree-id.js'),R=require(web+'tree-record.js'),I=require(web+'tree-instrument.js'),P=require(web+'tree-panel.js'),C=require(web+'command-search.js');
const F=require('./fixtures/tree-records-v6dev.json');
const read=f=>fs.readFileSync(web+f,'utf8');
const visible=h=>h.replace(/<(svg|code)[\s\S]*?<\/\1>/g,' ').replace(/<[^>]+>/g,' ').replace(/&amp;/g,'&').replace(/\s+/g,' ');

const META61={release:{dataset_version:'metro-2026.10.13-pointcloud-v6.1',dataset_last_updated_utc:'2026-10-12T13:00:54+00:00',status:'research_only_not_independently_validated'},
  assembly:{tile_version:'20261013-v6.1'},derived_products:{tree_ids:'data/tree_ids/schema.json'}};
const META6={release:{dataset_version:'metro-2026.10.12-pointcloud-v6',dataset_last_updated_utc:'2026-10-11T21:30:30+00:00',status:'research_only_not_independently_validated'},
  assembly:{tile_version:'20261012-v6'}};
const REG='akl_tree_trp_ACCT0245027',NUM='T318JMKK',LINK=`https://alto.tfwelch.com/tree/${NUM}`;
assert.ok(Id.validNumber(NUM));
const env=meta=>({siteRoot:'.',dataBase:'./data',metadata:meta});
// The fixture record as release 6.1 publishes it: every record carries its tree's number.
function numbered(id,number,role='marker'){
  const t=F.trees[id],record=JSON.parse(JSON.stringify(t.record));
  record.datasets.tree_number={number,role,kind:'crown',status:'current',representative_tree_id:id,minted_release:'20261013-v6.1',correction_id:null};
  return {...t,record};
}
const build=(id,meta,t=F.trees[id])=>R.assemble({id,record:t.record,schema:F.schema,members:t.members,memberCount:t.memberCount,metadata:meta,env:env(meta)});

// ---- display: release 6.1
{
  const rec=build(REG,META61,numbered(REG,NUM));
  assert.deepEqual([rec.id,rec.number,rec.permalink],[REG,NUM,LINK]);
  assert.deepEqual(rec.numberRole,{role:'marker',kind:'crown',minted:'20261013-v6.1'});
  assert.ok(rec.url.endsWith(`tree.html?id=${NUM}`)&&rec.mapUrl.endsWith(`?tree=${NUM}`),'tree page and map links by number');
  assert.ok(rec.citation.includes(`Tree ${NUM}. In ALTO`)&&rec.citation.includes(` ${LINK} (accessed `)&&!rec.citation.includes(REG),`citation by number and permalink: ${rec.citation}`);
  // KYTE does not take numbers yet: its links keep the record ID.
  for(const k of rec.know)assert.ok(k.href.includes(`?tree=${encodeURIComponent(REG)}&task=`)&&!k.href.includes(NUM),k.href);
  // Tree page: the number (Copy, permalink) first, the record ID second.
  const line=I.idLine(rec);
  assert.ok(line.includes('<dt>Tree number</dt>')&&line.includes(`<code class="ti-tn">${NUM}</code>`)&&line.includes('aria-label="Copy the tree number"'),'number with Copy');
  assert.ok(line.includes(`href="${LINK}">${LINK}</a>`),'permalink shown and linked');
  assert.ok(line.includes('<dt class="ti-sub">Record ID</dt>')&&line.includes(`<code>${REG}</code>`)&&line.indexOf(NUM)<line.indexOf(REG),'record ID second');
  assert.ok(!line.includes('<dt>Tree ID</dt>'));
  // Map panel: the same IDs under the badges; the footer names the number; KYTE keeps the record ID.
  const panel=P.render(rec,{treeUrl:Id.url(NUM,{page:'tree',base:'https://alto.tfwelch.com/'}),kyteBase:'./kyte'});
  assert.ok(panel.includes('<dl class="tp-ids"><dt>Tree number</dt>')&&panel.includes(`<code class="tp-tn">${NUM}</code>`)&&panel.includes('data-panel-action="copy-number"'),'panel: number with Copy');
  assert.ok(panel.includes(`<a class="tp-permalink" href="${LINK}">${LINK}</a>`)&&panel.includes('<dt class="tp-sub">Record ID</dt>')&&panel.includes(`<dd class="tp-sub"><code>${REG}</code>`),'panel: permalink and record ID');
  assert.ok(panel.includes(`<footer class="tp-foot"><code>${NUM}</code>`),'panel footer: the number');
  assert.ok(panel.includes(`href="./kyte/?tree=${encodeURIComponent(REG)}"`)&&!/kyte\/\?tree=T[0-9A-Z]{7}/.test(panel),'panel: KYTE by record ID');
  assert.ok(panel.indexOf('tp-ids')<panel.indexOf('tp-actions'),'IDs before the actions');
  const noted=P.render(rec,{treeUrl:'./tree.html',note:'Record ID akl_tree_lid_1097624 is tree T318JMKK.'});
  assert.ok(noted.includes('<p class="tp-idnote" role="status">Record ID akl_tree_lid_1097624 is tree T318JMKK.</p>'),'panel: one-line note for an older ID');
  // Provenance popover: the number and the record ID.
  const pop=I.provenance(rec.measures.height,rec);
  assert.ok(pop.includes('<dt>Tree number</dt>')&&pop.includes(`data-copy="${NUM}"`)&&pop.includes('<dt>Record ID</dt>')&&!pop.includes('<dt>Tree ID</dt>'),'popover IDs');
  // The map tile's tn gives the quick panel its number; a malformed tn is ignored.
  assert.equal(R.fromTile({tree_id:REG,tn:NUM,source_primary:'council_trees'},env(META61)).number,NUM);
  assert.equal(R.fromTile({tree_id:REG,tn:'T318JMKL',source_primary:'council_trees'},env(META61)).number,null);
  // A member record's own number decides whether the records table links it to another tree's page.
  assert.ok(rec.records.every(r=>'number' in r));
}
// ---- display: data before 6.1 (no tn, no tree_number) keeps the record ID as the tree ID, as in 0.2.2
{
  const rec=build(REG,META6);
  assert.deepEqual([rec.number,rec.permalink],[null,null]);
  assert.ok(rec.url.endsWith(`tree.html?id=${REG}`)&&rec.citation.includes(`Tree ${REG}. In ALTO`),'record ID links and citation');
  const line=I.idLine(rec),panel=P.render(rec,{treeUrl:Id.url(REG,{page:'tree',base:'https://alto.tfwelch.com/'}),kyteBase:'./kyte'});
  assert.ok(line.includes('<dt>Tree ID</dt>')&&line.includes(`<code>${REG}</code>`)&&!/Tree number|Record ID/.test(line),'tree page: Tree ID');
  assert.ok(!panel.includes('tp-ids')&&!panel.includes('Tree number')&&panel.includes(`<footer class="tp-foot"><code>${REG}</code>`),'panel: as before');
  assert.ok(I.provenance(rec.measures.height,rec).includes('<dt>Tree ID</dt>'));
  assert.equal(R.fromTile({tree_id:REG,source_primary:'council_trees'},env(META6)).number,null);
}

// ---- search: what the map's search box offers
const E=(t,fix)=>Id.searchEntry(t,fix);
assert.deepEqual(E('TMCTT6X4'),{kind:'id',key:'TMCTT6X4',label:'Open tree TMCTT6X4',meta:'Tree number'});
assert.deepEqual(E(' tmct-t6x4 ').key,'TMCTT6X4','any case, a hyphen and spaces');
assert.deepEqual(E('akl_tree_lid_1097624'),{kind:'id',key:'akl_tree_lid_1097624',label:'Open tree akl_tree_lid_1097624',meta:'Record ID'});
assert.equal(E('trp_ACCT0245027').key,REG);
assert.equal(E('3520942_11845306').meta,'Release 4 crown key','release 4 crown keys are looked up too');
assert.equal(E('pc_BA32_1000_3310:1760512.25:5922649.75').meta,'Crown key');
assert.deepEqual(E('TMCTT6X5',undefined),{kind:'checking',key:'TMCTT6X5',label:'Checking the tree number…',meta:'Tree number'});
assert.deepEqual(E('TMCTT6X5','TMCTT6X4'),{kind:'mistyped',key:'TMCTT6X4',label:'Check character doesn’t match; did you mean TMCTT6X4?',meta:'Tree number'});
assert.deepEqual(E('TMCTT6X5',null),{kind:'invalid',key:'TMCTT6X5',label:'Not a valid tree number',meta:'Tree number'});
assert.equal(E('TMCTU6X4','TMCTT6X4').kind,'invalid','U is not a tree-number character: no correction offered');
for(const words of ['Takapuna','Tanekaha','12 Queen Street','pohutukawa','T123'])assert.equal(E(words),null,`${words}: left to the other searches`);
// The entry ranks first in the command search, in its own group.
const ctx={items:()=>[],species:()=>[['Tanekaha',120,['Tanekaha']]],places:()=>[{id:'place:Takapuna',label:'Takapuna',words:['Takapuna']}],
  treeId:t=>{const e=E(t,'TMCTT6X4');return e?{id:'tree:'+e.key,label:e.label,meta:e.meta,run:()=>null}:null;}};
for(const t of ['TMCTT6X4','TMCTT6X5','akl_tree_lid_1097624']){const s=C.suggest(t,ctx);assert.equal(s[0].group,'Tree',t);}
assert.equal(C.suggest('TMCTT6X5',ctx)[0].label,'Check character doesn’t match; did you mean TMCTT6X4?');
assert.ok(!C.suggest('Tanekaha',ctx).some(x=>x.group==='Tree')&&!C.suggest('Takapuna',ctx).some(x=>x.group==='Tree'),'8-letter words are not tree numbers');

// ---- validate: the check character and the corrections one keystroke away
const make=p=>'T'+p+Id.checkChar(p);
const A=make('8K5P7T'),B=make('417RK8'),Z=make('GAC6GY');
const typo=A.slice(0,7)+(A[7]==='0'?'1':'0');
const near=Id.nearNumbers(typo);
assert.ok(near.includes(A)&&near.every(Id.validNumber)&&!near.includes(typo),'the corrections are well-formed numbers and include the intended one');
assert.ok(near.length>=7&&near.length<=13,`one per position plus valid swaps (${near.length})`);
assert.deepEqual(Id.nearNumbers(A),[],'a valid number needs no correction');
assert.deepEqual(Id.nearNumbers('TMCTU6X4'),[]);
assert.equal(Id.parseNumber(typo).number,null);
const swapped=A.slice(0,3)+A[4]+A[3]+A.slice(5);
if(!Id.validNumber(swapped))assert.ok(Id.nearNumbers(swapped).includes(A),'a swap of neighbours is undone');

// ---- a small alias table in the release layout (data/tree_ids)
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'tree-numbers-'));
const T=path.join(dir,'data','tree_ids');
const N1='TMCTT6X4',N2='TZ9RC7ND',N3='TNXBTDBD',N4='TG91RZQY',N5='TY3F9Q4W';
const rows={
  [N1]:[null,'akl_tree_not_336','current'],[N2]:[null,'akl_tree_lid_0227622','current'],[N3]:[null,'akl_tree_pc5_1325e86032f4eedc9f3d','current'],
  [N4]:[null,'akl_tree_pc4_3480000_11791216','current',null,null,{k:'earlier_detection'}],[N5]:[null,'akl_tree_pc4_3517554_11848810','current'],
  [A]:[null,'akl_tree_x_a','current'],[B]:[null,'akl_tree_x_b','current'],
  'akl_tree_not_336':[N1,null,'current',null,'C00001+C00002'],
  'akl_tree_lid_1097624':[N1,'akl_tree_not_336','member',null,'C00001'],
  '3511932_11840418':[N1,'akl_tree_not_336','current',null,'v4_continues'],
  'akl_tree_pc4_3517546_11848800':[N5,'akl_tree_pc4_3517554_11848810','merged',N5,'C00004'],
  '3480000_11808040':[null,null,'split',[N2,N3],'v4_split'],
  '3480000_11791216':[null,'akl_tree_pc4_3480000_11791216','retired',N4,'v4_not_continued'],
  'pc_BA31_1000_3844:1752975.25:5918651.75':[null,'akl_tree_trp_ACCT0088845','retired','T295FVK7','C00307',{reason:'seeded_crown_retired',p:[174.7161989,-36.8656938]}],
  'akl_tree_lid_0001873':[null,null,'retired',null,'deleted_pointcloud_false_positive',{p:[174.5830158,-37.0779744],last_release:'2026-06-23 snapshot',source_tree_id:'LID0001873'}],
};
// A second number one keystroke from B's typo makes B's correction ambiguous.
const typoB=B.slice(0,7)+(B[7]==='0'?'1':'0'),rival=Id.nearNumbers(typoB).find(n=>n!==B);rows[rival]=[null,'akl_tree_x_rival','current'];
const shards={};
for(const [k,r] of Object.entries(rows)){const b=Id.bucketPath(k);(shards[b]=shards[b]||{})[k]=r;}
for(const [b,obj] of Object.entries(shards)){fs.mkdirSync(path.join(T,path.dirname(b)),{recursive:true});fs.writeFileSync(path.join(T,b),zlib.gzipSync(JSON.stringify(obj)));}
fs.writeFileSync(path.join(T,'schema.json'),JSON.stringify({bucket_algorithm:'fnv1a_utf8_mod65536_hex4_split2',notes:{
  v4_split:'v4 crown divided between several current crowns (each holds at least a fifth of it; largest share first)',
  v4_not_continued:'v4 crown no current crown continues; the successor is the tree its representative record belongs to now',
  seeded_crown_retired:'a crown drawn from a record in v5.2 that a reviewer moved to another crown; the successor is that record\'s tree',
  deleted_pointcloud_false_positive:'removed in Sep 2026 before the 9 Sep release: the 2024 point cloud showed no tree at this LiDAR detection (roof, vessel, crane or water); no successor'}}));
global.fetch=async url=>{
  const p=path.join(dir,'data',String(url).replace(/^\.\/data\//,'').replace(/\?.*$/,''));
  if(!fs.existsSync(p))return {ok:false,status:404};
  const buf=fs.readFileSync(p);
  return {ok:true,status:200,arrayBuffer:async()=>buf.buffer.slice(buf.byteOffset,buf.byteOffset+buf.byteLength)};
};
global.Response=global.Response||require('node:buffer').Response;
const OPT={base:'./data',version:'t',metadata:{derived_products:{tree_ids:'data/tree_ids/schema.json'}}};
const res=raw=>Id.resolve(raw,OPT);
const view=async(raw,o={})=>I.statusView(await res(raw),{typed:raw,...o});
const BASE='https://alto.tfwelch.com/';

(async()=>{
  // validate: the one correction the release holds, else none
  assert.equal(await Id.suggestNumber(typo,OPT),A,'one number one keystroke away exists: offered');
  assert.equal(await Id.suggestNumber(typo.toLowerCase().replace(/^(.{4})/,'$1-'),OPT),A,'typed in any case with a hyphen');
  assert.equal(await Id.suggestNumber(typoB,OPT),null,'two exist: ambiguous, none offered');
  assert.equal(await Id.suggestNumber(Z.slice(0,7)+(Z[7]==='0'?'1':'0'),OPT),null,'none exists: none offered');
  assert.equal(await Id.suggestNumber(A,OPT),null,'a valid number is not corrected');
  assert.equal(await Id.suggestNumber(typo,{...OPT,metadata:{}}),null,'no alias table (data before 6.1): none offered');

  // one line beside the tree an older ID opens
  const say=async raw=>Id.describe(await res(raw)).note;
  assert.equal(await say('akl_tree_lid_1097624'),`Record ID akl_tree_lid_1097624 is tree ${N1}.`);
  assert.equal(await say('not_336'),`Record ID akl_tree_not_336 is tree ${N1}.`);
  assert.equal(await say('3511932_11840418'),`Release 4 crown key 3511932_11840418 is tree ${N1}.`);
  assert.equal(await say(N1.toLowerCase()),null,'a number needs no note');
  assert.equal(await say('akl_tree_pc4_3517546_11848800'),`Record ID akl_tree_pc4_3517546_11848800 was merged into tree ${N5} (reviewer correction C00004).`);
  assert.equal(await say('3480000_11808040'),`Release 4 crown key 3480000_11808040 was split between 2 trees; the largest part is tree ${N2}.`);
  assert.equal(await say('akl_tree_lid_0001873'),'Record ID akl_tree_lid_0001873 is retired: no tree at this LiDAR detection.');
  // before 6.1 a record ID is its own tree: no note
  assert.equal(Id.describe(await Id.resolve('trp_ACCT0245027',{metadata:{}})).note,null);

  // status pages: the title states the status and the reason; never "Not a tree ID" for these
  let v=await view('akl_tree_lid_0001873');
  assert.equal(v.title,'Retired: no tree at this LiDAR detection');
  assert.ok(v.html.includes('Retired; no successor')&&v.html.includes('Removed in Sep 2026 before the 9 Sep release')&&v.html.includes('-37.077974, 174.583016')&&v.html.includes('23 Jun 2026 snapshot')&&v.html.includes('LID0001873'),'tombstone: reason, last position, last release, source ID');
  assert.equal(v.primary,null);assert.ok(v.mapHref.endsWith('?tree=akl_tree_lid_0001873')&&v.html.includes('See the place on the map'),'tombstone: the map opens at its last position');
  v=await view('3480000_11808040');
  assert.equal(v.title,'Split: release 4 crown divided between 2 current crowns');
  const parts=v.html.match(/<ol class="ti-succ">([\s\S]*?)<\/ol>/)[1];
  assert.ok(parts.indexOf(`tree.html?id=${N2}`)>=0&&parts.indexOf(`tree.html?id=${N2}`)<parts.indexOf(`tree.html?id=${N3}`),'split: every part a link, largest first');
  assert.ok(v.html.includes(`data-succ="${N2}"`)&&v.html.includes('Release 4 crown divided')&&v.primary===N2,'split: parts named when their records load; release in words');
  v=await view('akl_tree_pc4_3517546_11848800',{receipt:[{id:'C00004',decided_on:'2026-09-18',summary:'One multi-stemmed tree; v5 keeps one crown.'}]});
  assert.equal(v.title,'Merged: reviewer correction C00004');
  assert.ok(v.html.includes('Surviving tree')&&v.html.includes(`tree.html?id=${N5}`)&&v.primary===N5,'merged: links the surviving tree');
  assert.match(v.html,/18 Sept? 2026: One multi-stemmed tree; release 5 keeps one crown\./,'merged: the correction from the receipt, dated');
  v=await view('3480000_11791216');
  assert.equal(v.title,'Retired: no current crown continues this release 4 crown');
  assert.ok(v.html.includes('Successor')&&v.html.includes(`tree.html?id=${N4}`)&&v.primary===N4&&v.mapHref==='./','retired with a successor: links it');
  v=await view('pc_BA31_1000_3844:1752975.25:5918651.75');
  assert.equal(v.title,'Retired: crown drawn from a record that a reviewer moved');
  v=await view(make('ZZZZZZ'));
  assert.equal(v.title,'No tree has this number');
  v=await view(typo,{fix:A});
  assert.equal(v.title,'Check character doesn’t match');
  assert.ok(v.html.includes(`Did you mean <a href="${BASE}tree.html?id=${A}"><code>${A}</code></a>?`)&&v.primary===A,'mistyped: the one correction, linked');
  v=await view(typoB,{fix:null});
  assert.equal(v.title,'Not a valid tree number');assert.ok(!v.html.includes('Did you mean'));
  v=await view('<x>');
  assert.equal(v.title,'Not a tree ID','text that is no ID at all');
  v=I.statusView(await Id.resolve(N1,{metadata:{}}),{typed:N1});
  assert.equal(v.title,'Tree number not in this release','data before 6.1: a number cannot be resolved');
  for(const raw of ['akl_tree_lid_0001873','3480000_11808040','akl_tree_pc4_3517546_11848800','3480000_11791216',typo])assert.notEqual((await view(raw)).title,'Not a tree ID',raw);
  // the visible copy names releases in words and makes no claim about who labelled anything
  for(const raw of ['akl_tree_lid_0001873','3480000_11808040','3480000_11791216']){const t=visible((await view(raw)).html);assert.ok(!/\bv\d\b|by hand|by eye/i.test(t),`${raw}: ${t}`);}

  // the tree page uses these views and the record's number and permalink; the map keeps KYTE on record IDs
  const page=read('tree-page.js'),map=read('index.html'),html=read('tree.html');
  assert.ok(/I\.idLine\(rec\)/.test(page)&&/I\.statusView\(r,/.test(page),'tree page: ID line and status pages from tree-instrument.js');
  assert.ok(/\['retired','merged','split'\]\.includes\(resolved\.status\)\)return statusPage/.test(page),'tree page: retired, merged and split IDs get a status page');
  assert.ok(/copy\(rec\.number\|\|rec\.id/.test(page)&&/rec\.permalink\|\|rec\.url\|\|location\.href/.test(page),'tree page: Copy and Share by number and permalink');
  assert.ok(/l\.rel='canonical'/.test(page)&&html.includes('id="citeNote"'),'tree page: canonical link and cite note');
  assert.ok(/function setUrlTree\(number\)/.test(map)&&/if \(full\.number\) setUrlTree\(full\.number\)/.test(map)&&/setUrlTree\(null\); panelNote = null;/.test(map),'map: the number in the address while a tree is open');
  assert.ok(/Id\.searchEntry\(t,/.test(map)&&/openProfile\(\{ \.\.\.r, tree_id: record\.tree_id, tn: record\.datasets\.tree_number\?\.number \}, \{ resolved \}\)/.test(map),'map: search entries and the one-line note');
  assert.ok(/kyteBase\)\}\/\?tree=\$\{encodeURIComponent\(rec\.id\)\}/.test(read('tree-panel.js'))&&/KYTE\)\}\/\?tree=\$\{encodeURIComponent\(rec\.id\)\}/.test(page),'KYTE links send the record ID');
  fs.rmSync(dir,{recursive:true,force:true});
  console.log('tree numbers: display, fallback, search, check character and status pages checked');
})().catch(e=>{console.error(e);process.exit(1);});
