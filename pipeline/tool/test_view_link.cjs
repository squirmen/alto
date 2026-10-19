// Offline checks for web/view-link.js (FTA-23): the map's view in its address (camera, colour mode, filters, layers,
// species maxima area), written with replaceState, read at start, and the "Copy link to this view" control.
// Usage: node pipeline/tool/test_view_link.cjs
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const web=path.join(__dirname,'..','..','web')+'/';
const V=require(web+'view-link.js');

const ALL={colour:'source',sources:['register_at','register_parks','register_other','notable','osm','kauri','lidar'],
  quality:['high','medium','low'],land:['street','park','institutional','private','other'],forms:['tree','shrub','palm'],status:['protected']};
const KNOWN={colours:['source','structure','height','change','quality','evidence','tenure'],...ALL};
const base={camera:null,colour:'source',sources:ALL.sources,statusOnly:[],quality:ALL.quality,land:ALL.land,forms:ALL.forms,species:[],
  showUnknown:true,showUncertain:true,minHeight:0,layers:{},showCrowns:true,showTrunk:false,maxima:null};

// ---- the default view writes nothing; the camera only when given
assert.deepEqual(V.encode(base,ALL),[]);
assert.equal(V.href('https://alto.example/?tree=TZ69KK1G',base,ALL),'/?tree=TZ69KK1G','other parameters stay as they are');

// ---- camera text: decimals follow the zoom; parse checks ranges
assert.equal(V.cameraText(16.4,-36.86012345,174.77123456),'16.4/-36.860123/174.771235');
assert.equal(V.cameraText(13.256,-36.856,174.762),'13.26/-36.856/174.762');
assert.equal(V.cameraText(9,-36.85612345,174.76212345),'9/-36.8561/174.7621');
assert.deepEqual(V.parseCamera('16.4/-36.8601/174.7712'),{zoom:16.4,lat:-36.8601,lon:174.7712});
for(const bad of ['', '23/-36/174', '16/-91/174', '16/-36/181', 'abc', '16/-36', '16/-36/174/2'])assert.equal(V.parseCamera(bad),null,bad);

// ---- a changed view round-trips
const view={...base,camera:{zoom:16.4,lat:-36.8601,lon:174.7712},colour:'height',sources:ALL.sources.filter(k=>k!=='register_parks'),statusOnly:['protected'],
  quality:['high'],land:[],forms:ALL.forms,species:['Pohutukawa','Metrosideros excelsa, var.'],showUnknown:false,showUncertain:false,minHeight:12,
  layers:{showKauri:true,showRootZone:true,showProperties:false},showCrowns:false,showTrunk:true,maxima:'Waitematā'};
const enc=V.encode(view,ALL);
assert.deepEqual(enc.map(([k])=>k),['map','colour','src','status','quality','land','species','species','named','uncertain','minh','layers','crowns','trunk','maxima']);
assert.equal(Object.fromEntries(enc).land,'none','no land group shown is written as none');
const h=V.href('https://alto.example/index.html?tree=TZ69KK1G&colour=evidence&change=cr%3A86#x',view,ALL);
assert.ok(h.startsWith('/index.html?tree=TZ69KK1G&change=cr:86&map=16.4/-36.8601/174.7712&colour=height&'),h);
assert.ok(h.endsWith('#x'));
assert.ok(!/%2C|%2F/.test(h),'commas and slashes unescaped');
const back=V.decode(new URL('https://alto.example'+h).searchParams,KNOWN);
assert.deepEqual(back.camera,view.camera);
assert.equal(back.colour,'height');
assert.deepEqual(back.sources,view.sources);
assert.deepEqual(back.statusOnly,['protected']);
assert.deepEqual(back.quality,['high']);
assert.deepEqual(back.land,[]);
assert.equal(back.forms,undefined,'every growth form shown is the default');
assert.deepEqual(back.species.sort(),[...view.species].sort(),'a species name with a comma survives');
assert.equal(back.showUnknown,false);assert.equal(back.showUncertain,false);assert.equal(back.minHeight,12);
assert.deepEqual(back.layers,{showKauri:true,showRootZone:true});
assert.equal(back.showCrowns,false);assert.equal(back.showTrunk,true);
assert.equal(new URL('https://alto.example'+h).searchParams.get('maxima'),'Waitematā','the maxima area is written; the map reads it once the maxima load');

// ---- what the map cannot show is dropped
const junk=V.decode(new URLSearchParams('colour=rainbow&src=nope,lidar&quality=&layers=lasers,kauri&minh=-3&named=yes&uncertain=1&crowns=1&trunk=0&map=99/0/0&species='+'x'.repeat(200)),KNOWN);
assert.deepEqual(junk,{sources:['lidar'],layers:{showKauri:true}});
assert.deepEqual(V.decode(new URLSearchParams('minh=250'),KNOWN),{});

// ---- every layer name maps back to its switch
for(const [key,name] of Object.entries(V.LAYERS))assert.deepEqual(V.decode(new URLSearchParams('layers='+name),KNOWN).layers,{[key]:true});
// replaceState-only: rewriting twice gives the same address
assert.equal(V.href('https://alto.example'+h,view,ALL),h);

// ---- the map page: loads the module, reads the link before the map exists, writes with replaceState, offers the copy control
const idx=(fs.readFileSync(web+'index.html','utf8')+fs.readFileSync(web+'map-app.js','utf8'));
assert.match(idx,/<script src="\.\/view-link\.js\?v=[^"]+"><\/script>/);
assert.ok(idx.indexOf('const VIEW_LINK = ALTOViewLink.decode(')<idx.indexOf('const map = new maplibregl.Map('),'the camera is read before the map is made');
assert.match(idx,/const START_CAMERA = VIEW_LINK\.camera \|\| CHANGE_CAMERA;/,'a view link\'s camera wins over a linked change\'s tile');
assert.match(idx,/center: START_CAMERA \? \[START_CAMERA\.lon, START_CAMERA\.lat\]/);
assert.match(idx,/function writeViewLink\(\)[\s\S]{0,400}history\.replaceState\(history\.state, "", next\)/);
assert.ok(!/function writeViewLink\(\)[\s\S]{0,400}pushState/.test(idx),'the view never adds a history entry');
assert.match(idx,/map\.on\("moveend", \(\) => \{ viewCameraSet = true; writeViewLink\(\); \}\)/);
assert.match(idx,/list\.innerHTML = html;\s*writeViewLink\(\);/,'filters and layers rewrite the address');
assert.match(idx,/renderLegend\(mode\);\s*writeViewLink\(\);/,'the colour mode rewrites the address');
assert.match(idx,/<button type="button" id="copyViewLink" class="lp-text-btn">Copy link to this view<\/button>/);
assert.match(idx,/id: "view:link", group: "Map", label: "Copy link to this view"/);
assert.match(idx,/want = VIEW_MAXIMA;/,'the maxima area is read from the address as it was at start');
assert.match(idx,/if \(ok && !VIEW_LINK\.camera\) map\.jumpTo/,'a linked tree keeps a linked camera');
console.log('view-link: ok');
