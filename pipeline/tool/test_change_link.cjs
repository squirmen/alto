// Offline checks for web/change-link.js and the map's canopy-change popup (FTA-16): "Aerial photos of this spot" opens
// the imagery viewer on the change with the surveys before and after it marked, and each change has a permalink
// (?change=<change_id>).
// Usage: node pipeline/tool/test_change_link.cjs
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const web=path.join(__dirname,'..','..','web')+'/';
const C=require(web+'change-link.js');
globalThis.window=globalThis;
require(web+'tree-imagery.js');
const X=globalThis.ALTOImagery;
const V=require(web+'view-link.js');

// IDs: a 2013 or 2016 crown on a LINZ 1:1000 tile (canopy gone by 2024), or a 2024 crown (canopy grown since).
assert.deepEqual(C.parseId('16:BA31_1000_3040:28'),{id:'16:BA31_1000_3040:28',kind:'gone',year:2016,tile:'BA31_1000_3040',n:28});
assert.deepEqual(C.parseId(' 13:BA32_1000_0101:7 '),{id:'13:BA32_1000_0101:7',kind:'gone',year:2013,tile:'BA32_1000_0101',n:7});
assert.deepEqual(C.parseId('cr:5848'),{id:'cr:5848',kind:'grown',n:5848});
for(const bad of ['','x:1','14:BA31_1000_3040:1','16:BA31_1000_3040','cr:','cr:1;alert(1)','16:BA31_1000_3040:28<b>',null,undefined])assert.equal(C.parseId(bad),null,String(bad));

// The tile grid: BA31_1000_3040 is 480 x 720 m and holds the change released at 174.690603, -36.8088692.
const b=C.tileBounds('BA31_1000_3040');
assert.deepEqual(b,{e0:1750720,e1:1751200,n0:5924400,n1:5925120});
const [e,n]=X.nztm(174.690603,-36.8088692);
assert.ok(e>=b.e0&&e<=b.e1&&n>=b.n0&&n<=b.n1,'the released change lies on its tile');
assert.deepEqual(C.tileCentre('BA31_1000_3040'),[1750960,5924760]);
assert.equal(C.tileBounds('BA31_1000_9999'),null);assert.equal(C.tileBounds('nonsense'),null);

// Before and after: the last sharp survey by the end of the year the canopy was last seen (or last absent), and the
// first sharp survey from 2024 (the 2024 LiDAR); never the coarse 25 cm rural survey.
const S=X.SURVEYS,ids=new Set(S.map(s=>s.id));
const gone16=C.surveysFor({fate:'removed_to_open',h_2013:6,h_2016:6.5},S,X.COARSE);
assert.deepEqual([gone16.before,gone16.after],['auckland_2015-2016_0.075m','auckland_2024_0.075m']);
const gone13=C.surveysFor({fate:'removed_to_open',h_2013:6,h_2016:null},S,X.COARSE);
assert.deepEqual([gone13.before,gone13.after],['auckland_2012_0.075m','auckland_2024_0.075m']);
assert.equal(C.surveysFor({fate:'established_since_2013'},S,X.COARSE).before,'auckland_2012_0.075m');
assert.equal(C.surveysFor({fate:'established_since_2016'},S,X.COARSE).before,'auckland_2015-2016_0.075m');
for(const r of [gone16,gone13])assert.ok(ids.has(r.before)&&ids.has(r.after));
assert.deepEqual(C.surveysFor({fate:'removed_to_open',h_2016:5},[],X.COARSE),{before:null,after:null,years:{before:2016,after:2024}});

// The permalink: the page's path, the change, the camera on it at zoom 18 (view-link's precision), Colour by change;
// nothing else of the current address.
const h=C.href('https://alto.tfwelch.com/index.html?tree=T6ABC&src=osm#x','16:BA31_1000_3040:28',174.690603,-36.8088692,{cameraText:V.cameraText});
assert.equal(h,'/index.html?change=16:BA31_1000_3040:28&map=18/-36.808869/174.690603&colour=change');
assert.equal(C.href('https://alto.tfwelch.com/','cr:86',174.69,-36.81),'/?change=cr:86&map=18/-36.810000/174.690000&colour=change');
assert.equal(C.href('https://alto.tfwelch.com/','<script>',174.69,-36.81),null);
const back=new URL('https://alto.tfwelch.com'+h).searchParams;
assert.equal(back.get('change'),'16:BA31_1000_3040:28');
assert.deepEqual(V.parseCamera(back.get('map')),{zoom:18,lat:-36.808869,lon:174.690603});

// The map: the module loads after view-link.js; ?change= sets Colour by change and, without ?map=, the change's tile;
// the popup offers the photos and the link; the viewer and its styles load on first use with the build's stamp.
const idx=(fs.readFileSync(web+'index.html','utf8')+fs.readFileSync(web+'map-app.js','utf8'));
assert.ok(idx.indexOf('change-link.js?v=')>idx.indexOf('view-link.js?v='),'change-link.js loads after view-link.js');
assert.match(idx,/const LINKED_CHANGE = ALTOChangeLink\.parseId\(new URL\(window\.location\.href\)\.searchParams\.get\("change"\)\);/);
assert.ok(idx.indexOf('const LINKED_CHANGE')<idx.indexOf('const map = new maplibregl.Map('),'the change is read before the map is made');
assert.match(idx,/if \(LINKED_CHANGE\) document\.getElementById\("colourBy"\)\.value = "change";/);
assert.match(idx,/<button type="button" class="popup-act" data-change-photos aria-haspopup="dialog">Aerial photos of this spot<\/button>/);
assert.match(idx,/<a class="popup-act" data-change-link href="#">Link to this change<\/a>/);
assert.equal((idx.match(/\$\{changeActionsHtml\(p\)\}/g)||[]).length,2,'both kinds of change offer the photos and the link');
assert.match(idx,/link\.href = ALTOChangeLink\.href\(window\.location\.href, p\.change_id, pos\[0\], pos\[1\], \{ cameraText: ALTOViewLink\.cameraText \}\)/);
assert.match(idx,/asset\("\.\/imagery-viewer\.css"\)/);assert.match(idx,/asset\("\.\/tree-imagery\.js"\)/);assert.match(idx,/asset\("\.\/tree-imagery-viewer\.js"\)/);
assert.match(idx,/const asset = path => ALTOVersion\.asset\(path\);/);
assert.match(idx,/X\.timeline\(document\.createElement\("div"\), \{ lon, lat, area: [^}]*eager: true, marks \}\)/);
assert.match(idx,/window\.ALTOImageryViewer\.open\(tl, marks\.before \|\| marks\.after/);
assert.match(idx,/querySourceFeatures\("akl-change", \{ sourceLayer: "tree_change", filter: \["==", \["get", "change_id"\], id\] \}\)/);
assert.match(idx,/history\.replaceState\(history\.state, "", u\.pathname \+ u\.search/,'the open change is written to the address without a new history entry');
assert.ok(!/Compare dated aerial photos to check what changed\./.test(idx),'the note points at the photos it now links');
// The viewer marks the surveys before and after the change in words (never colour alone), and the timeline passes them on.
const viewer=fs.readFileSync(web+'tree-imagery-viewer.js','utf8'),tl=fs.readFileSync(web+'tree-imagery.js','utf8');
assert.match(viewer,/side=id=>id===mk\.before\?'Before':id===mk\.after\?'After':''/);
assert.match(viewer,/<span class="ixv-mark">\$\{m\}<\/span>/);
assert.match(viewer,/, \$\{m\.toLowerCase\(\)\} the change/,'the year button says before or after the change');
assert.match(viewer,/'Before the change':cur\.id===mk\.after\?'After the change'/,'the caption names it too');
assert.match(tl,/marks:\(\)=>opt\.marks\|\|null/);
console.log('change-link: ok');
