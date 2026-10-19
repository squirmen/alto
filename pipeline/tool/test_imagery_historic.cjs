// Offline checks for the scanned historical surveys in "Aerial imagery through time" (tool 0.2.11): the survey list in
// imagery-coverage.json (LINZ's 85 scanned surveys of Auckland, 1939–2004, with their metadata), how tree-imagery.js
// reads it, the coverage skip (a survey whose capture area or files leave the tree out is not covering it, with no
// request), the attribution, the credits page rows and the page wiring (the group, phones, the larger view's strip).
// Usage: node pipeline/tool/test_imagery_historic.cjs
const assert=require('node:assert/strict');
const path=require('node:path'),fs=require('node:fs');
const web=path.join(__dirname,'..','..','web')+'/';
const X=require(web+'tree-imagery.js');
const INDEX=JSON.parse(fs.readFileSync(web+'imagery-coverage.json','utf8'));
const read=f=>fs.readFileSync(web+f,'utf8');

// ---------- the survey list (built from LINZ's STAC catalogue by build_imagery_coverage.py) ----------
const H=INDEX.historic;
assert.equal(H.length,85,'85 scanned surveys of Auckland');
assert.equal(H[0].start.slice(0,4),'1939');
assert.equal(Math.max(...H.map(h=>+h.end.slice(0,4))),2004);
assert.ok(H.every((h,i)=>!i||H[i-1].start<=h.start),'oldest first');
assert.equal(new Set(H.map(h=>h.id)).size,85,'one entry per collection');
assert.ok(H.every(h=>/^(auckland|northland|waikato)\/[\w.-]+\/rgb\/2193$/.test(h.path)&&h.path.split('/')[1]===h.id&&/Auckland/.test(h.title)&&
  /^SNC?\d+C?$/.test(h.number)&&h.title.includes(h.number)&&h.gsd>0&&h.gsd<1&&X.GRID[h.scale]&&/^\d{4}-\d{2}-\d{2}$/.test(h.start)&&h.start<=h.end&&
  h.licensors.length&&h.producers.length),'each survey: path, title, number, pixel size, sheet grid, flying period, licensors and producers');
// The label is the years of LINZ's title: "(1939-1940)" reads 1939–40, "(1950-1960)" 1950–60, "(1940)" 1940.
assert.ok(H.every(h=>{const m=/\((\d{4})(?:-(\d{4}))?\)$/.exec(h.title);return h.label===(!m[2]||m[1]===m[2]?m[1]:`${m[1]}–${m[2].slice(2)}`);}));
// Colour: the ten surveys whose number has the C suffix or the SNC prefix (checked against pixels, 17 Oct 2026).
assert.deepEqual(H.filter(h=>h.colour).map(h=>h.number).sort(),['SN50393C','SN5615C','SN9025C','SN9026C','SN9907C','SN9909C','SN9997C','SN9998C','SN9999C','SNC50347']);
assert.ok(H.every(h=>h.colour===/^SNC|C$/.test(h.number)));
// Dates: NZ midnight stored in UTC, read as the NZ date (SN139: 1939-12-28T12:00Z is 29 Dec 1939 in Auckland).
const sn139=H.find(h=>h.number==='SN139');
assert.deepEqual([sn139.start,sn139.end,sn139.label,sn139.gsd,sn139.scale],['1939-12-29','1940-04-14','1939–40',0.4,5000]);
// Providers as LINZ lists them.
assert.deepEqual([sn139.licensors,sn139.producers],[['Toitū Te Whenua Land Information New Zealand','Auckland Council'],['SKYVUW']]);
const sn5600=H.find(h=>h.number==='SN5600');
assert.deepEqual([sn5600.licensors,sn5600.producers],[['Toitū Te Whenua Land Information New Zealand','Ministry for Primary Industries'],['New Zealand Aerial Mapping','SKYVUW']]);
// Every survey, scanned or since 2010, has its files and its capture area in the index.
assert.ok([...H.map(h=>h.id),...X.SURVEYS.map(s=>s.id)].every(id=>{const s=INDEX.surveys[id];
  return s&&X.GRID[s.scale]&&Object.keys(s.sheets).length&&s.footprint.rings.length&&s.footprint.bbox.length===4;}));

// ---------- tree-imagery.js: the scanned surveys as surveys it reads ----------
const S=X.historic(INDEX);
assert.equal(S.length,85);
assert.ok(S.every(s=>s.scanned&&s.kind==='Scanned'&&s.collection===`${X.BUCKET}/${s.path}/collection.json`));
assert.equal(X.historic(null).length,0,'no index, no scanned surveys');
assert.equal(X.historic({historic:[{id:'x',path:'../../etc',scale:5000,start:'1950-01-01',end:'1950-01-01'},{id:'y',path:'auckland/y/rgb/2193',scale:123,start:'1950-01-01',end:'1950-01-01'}]}).length,0,'malformed entries are left out');
assert.equal(X.kindText(S.find(s=>s.number==='SN139')),'Scanned black-and-white photograph');
assert.equal(X.kindText(S.find(s=>s.number==='SN9998C')),'Scanned colour photograph');
assert.equal(X.kindText(X.SURVEYS[0]),'Urban survey');
assert.equal(X.period(S.find(s=>s.number==='SN139')),'29 Dec 1939 – 14 Apr 1940');
// The larger view's strip: two scanned surveys of one year name their survey numbers; other labels stay as they are.
{const two=['SN9907C','SN9938'].map(n=>S.find(s=>s.number===n)),L=X.stripLabels([...two,X.SURVEYS[0]]);
  assert.deepEqual([...L.values()],['2000 SN9907C','2000 SN9938','2010']);}
// Attribution: the surveys since 2010 as before; the scanned surveys with their numbers, licensors and producers.
{const a=X.attribution([S.find(s=>s.number==='SN146')],{one:true});
  assert.ok(a.startsWith('Scanned aerial photograph (survey SN146): Toitū Te Whenua LINZ and Auckland Council (licensors), SKYVUW (producer); from the open imagery archive of Toitū Te Whenua Land Information New Zealand (LINZ), licensed under <a href="https://creativecommons.org/licenses/by/4.0/"'),a);
  const both=X.attribution([X.SURVEYS[0],S.find(s=>s.number==='SN146'),S.find(s=>s.number==='SN5600')]);
  assert.ok(both.startsWith('Aerial photographs: Auckland Council (licensors), flown by New Zealand Aerial Mapping; scanned aerial photographs (surveys SN146 and SN5600): Toitū Te Whenua LINZ, Auckland Council and Ministry for Primary Industries (licensors), SKYVUW and New Zealand Aerial Mapping (producers); '),both);
  assert.equal(X.attribution([X.SURVEYS[0]]).split(';')[0],'Aerial photographs: Auckland Council (licensors), flown by New Zealand Aerial Mapping','the surveys since 2010 are credited as before');}

// ---------- the coverage skip: capture areas and files ----------
// Footprints: whole metres, x0, y0, dx1, dy1, ...; inside = an odd number of rings around the point.
{const idx={grid:{1000:[50,50]},surveys:{sq:{scale:1000,sheets:{},footprint:{bbox:[0,0,100,100],rings:[[0,0,100,0,0,100,-100,0],[40,40,20,0,0,20,-20,0]]}}}};
  const sq={id:'sq',scale:1000};
  assert.deepEqual([[10,10],[50,50],[99,1],[150,50],[-1,50]].map(p=>X.inFootprint(idx,sq,p)),[true,false,true,false,false],'a square with a hole');
  assert.equal(X.inFootprint(idx,{id:'other',scale:1000},[10,10]),null,'a survey without a footprint: not known');}
const at=(lon,lat)=>X.view({lon,lat,area:100});
const covering=v=>[...S,...X.SURVEYS].filter(s=>X.covers(INDEX,s,v)!==false);
// T3GH0GQC (the kauri on the plaza, central Auckland): 14 scanned collections (13 survey numbers; SN8772 is published
// at 37.5 and 40 cm) and 7 surveys since 2010; the 2010 urban, 2020 and 2022 rural and 2024 rural surveys leave it out.
// Each answer matches LINZ's own capture area (shapely, 17 Oct 2026).
{const c=covering(at(174.7665719094466,-36.84361317577713));
  assert.deepEqual(c.filter(s=>s.scanned).map(s=>s.number),['SN146','SN583','SN2751','SN3800','SN5308','SN5783','SN8772','SN8772','SN11624','SN9283','SN9349','SN9907C','SN9938','SNC50347']);
  assert.deepEqual(c.filter(s=>!s.scanned).map(s=>s.label),['2010–11','2010–12','2012','2015–16','2017','2023','2024–25']);}
// A Parnell street tree (TAKPBMM6, pin oak): the same scanned surveys; the 2012 urban survey stops short of Parnell.
{const c=covering(at(174.78018555392376,-36.85481850928636));
  assert.equal(c.filter(s=>s.scanned).length,14);
  assert.deepEqual(c.filter(s=>!s.scanned).map(s=>s.label),['2010–11','2010–12','2015–16','2017','2023','2024–25']);}
// Out in the Hauraki Gulf: no survey.
assert.equal(covering(at(175.2,-36.62)).length,0);
// The answer is true only when both the capture area and the files hold the tree, null when either is unknown.
{const v=at(174.7665719094466,-36.84361317577713),s=S.find(s=>s.number==='SN146');
  assert.equal(X.covers(INDEX,s,v),true);
  assert.equal(X.covers({...INDEX,surveys:{...INDEX.surveys,[s.id]:{...INDEX.surveys[s.id],footprint:undefined}}},s,v),null);
  assert.equal(X.covers({...INDEX,surveys:{...INDEX.surveys,[s.id]:{...INDEX.surveys[s.id],sheets:{}}}},s,v),false,'no file at the tree');}

// A survey whose capture area leaves the tree out: "not covering", and nothing is asked of the archive.
(async()=>{
  const reqs=[],SN=S.find(s=>s.number==='SN139');
  globalThis.fetch=async url=>{reqs.push(String(url));
    if(String(url).includes('imagery-coverage.json'))return {status:200,ok:true,json:async()=>INDEX};
    return {status:404,ok:false,arrayBuffer:async()=>new ArrayBuffer(0)};};
  const kauri=at(174.7665719094466,-36.84361317577713);
  assert.equal(X.covers(INDEX,SN,kauri),false,'SN139 (1939–40) does not cover central Auckland');
  const r=await X.read(SN,kauri,{makeCanvas:()=>{throw new Error('no canvas for a survey that does not cover the tree');}});
  assert.deepEqual([r.status,r.reason],['none','footprint']);
  assert.deepEqual(reqs.map(u=>u.split('/').pop().split('?')[0]),['imagery-coverage.json'],'only the index: no header, no tile');
  // The same holds for a survey since 2010 (the 2010 urban survey stops about 1 km from the plaza).
  const r2=await X.read(X.SURVEYS[0],kauri,{makeCanvas:()=>{throw new Error('no canvas');}});
  assert.deepEqual([r2.status,r2.reason,reqs.length],['none','footprint',1]);

  // ---------- the page wiring ----------
  const mod=read('tree-imagery.js'),viewer=read('tree-imagery-viewer.js'),page=read('tree-page.js'),map=read('map-app.js'),css=read('tree-instrument-page.css');
  // The scanned surveys: a disclosure above the surveys since 2010, open on a desktop and closed on a phone.
  assert.ok(mod.includes('<details class="ti-ix-group ti-ix-hist" hidden><summary><span class="ti-ix-gt">Historic surveys (scanned)</span>'));
  assert.ok(mod.includes("const PHONE='(max-width: 759px)'")&&mod.includes('hist.open=!root.matchMedia?.(PHONE)?.matches;'));
  // Lazy and bounded: read after the surveys since 2010, two at a time, only while the group is open.
  assert.ok(mod.includes('await run(surveys.filter(s=>s.scanned).reverse(),2);'));
  assert.ok(mod.includes("hist.addEventListener('toggle',()=>{if(hist.open&&started)(modernDone||Promise.resolve()).then(readHistoric);});")&&mod.includes('if(groups.length&&hist.open)await readHistoric();'));
  // A survey number LINZ publishes twice is read once, at the finer pixel size.
  assert.ok(mod.includes('groups=[...byNumber.values()].map(g=>g.sort((a,b)=>a.gsd-b.gsd));'));
  // The positions caveat, once, in data-sheet words.
  assert.equal(X.SCANNED_NOTE,'Scanned from film and orthorectified to a lower positional standard than the surveys since 2010: features can be several metres from their true position, and the 2024 outline may sit beside the crown.');
  assert.equal(mod.split('SCANNED_NOTE').length-1,3,'declared, shown once, exported');
  // The 2024 outline is drawn on the scanned photographs as on the others (one draw for every card).
  assert.equal((mod.match(/draw\(c\.querySelector\('canvas'\),r,v,/g)||[]).length,1);
  // A scanned survey reads the coarser overview where that reads fewer tiles, on every screen.
  assert.ok(mod.includes('thumbLevel(files,v,survey.scanned||lite())'));
  // The tree page's section and the map's change view (the surveys since 2010 only).
  assert.ok(page.includes("mod('imagery','Aerial surveys of Auckland, 1939–2025'"));
  assert.ok(map.includes('historic: false, eager: true, marks'));
  assert.ok(css.includes('.ti-ix-hist > summary')&&css.includes('.ti-ix-caveat'));
  // The larger view: the scanned surveys first in the year strip, after the word "Scanned", with fades where it scrolls.
  assert.ok(viewer.includes('<span class="ixv-gl" aria-hidden="true">Scanned</span>')&&viewer.includes('X.stripLabels')&&viewer.includes("el.strip.addEventListener('scroll',more,{passive:true});"));
  assert.ok(read('imagery-viewer.css').includes('.ixv-strip[data-more~="end"]'));

  // ---------- Sources and credits: one row per scanned survey, from the same list ----------
  const cr=read('credits.html'),block=/<!-- scanned-surveys -->\n([\s\S]*?)\n\s*<!-- \/scanned-surveys -->/.exec(cr);
  assert.ok(block,'the scanned surveys block');
  const rows=[...block[1].matchAll(/<tr><th scope="row">([^<]+)<\/th><td>([^<]+)<\/td><td>([^<]+)<\/td><td>([^<]+)<\/td><\/tr>/g)];
  assert.equal(rows.length,85);
  rows.forEach((m,i)=>{const h=H[i];assert.equal(m[1],h.title.replace(/-/g,'–'));assert.equal(m[2],h.colour?'Colour':'Black and white');
    assert.ok(h.licensors.every(x=>m[3].includes(x))&&h.producers.every(x=>m[4].includes(x)),h.id);});
  assert.ok(cr.includes('accessed on 17 October 2026')&&cr.includes('https://nz-imagery.s3.ap-southeast-2.amazonaws.com/catalog.json'));
  console.log('scanned historical surveys: the list (85, 1939–2004), colour, dates, providers, footprints, the coverage skip, attribution, wiring and credits checked');
})().catch(e=>{console.error(e);process.exit(1);});
