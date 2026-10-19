// Offline checks for web/property.js. Address normalisation has to match the build
// (norm_street and shard_key in the property build) or a search opens the wrong shard, and the
// panel must keep street trees outside a property's figures.
const assert=require('node:assert/strict');
const web=require('node:path').join(__dirname,'..','..','web');
globalThis.ALTOTreeDetails=require(web+'/tree-details.js');
const P=require(web+'/property.js');

assert.equal(P.normStreet('Bayswater Ave'),'bayswater avenue');
assert.equal(P.normStreet('St Heliers Bay Rd'),'saint heliers bay road');
assert.equal(P.normStreet('Ōnehunga Mall'),'onehunga mall');
assert.equal(P.normStreet("O'Brien Road"),'obrien road');
assert.equal(P.normStreet('St'),'st');
assert.equal(P.shardKey('onehunga mall'),'on');
assert.equal(P.shardKey('a'),'a_');
assert.deepEqual(P.parseQuery('1/110 Bayswater Ave, Bayswater'),{unit:'1',number:'110',street:'Bayswater Ave',suburb:'Bayswater'});
assert.deepEqual(P.parseQuery('Unit 2, 15a Queen St'),{unit:'2',number:'15A',street:'Queen St',suburb:''});
assert.deepEqual(P.parseQuery('Flat 3 7 Hill Rd'),{unit:'3',number:'7',street:'Hill Rd',suburb:''});
assert.deepEqual(P.parseQuery('Bayswater Avenue'),{unit:null,number:null,street:'Bayswater Avenue',suburb:''});
assert.equal(P.fullLabel({unit:'1',number:'110',street:'Bayswater Avenue',suburb:'Bayswater'}),'1/110 Bayswater Avenue, Bayswater');
assert.equal(ALTOTreeDetails.bucketPath('8542462','fnv1a_utf8_mod65536_hex4_split2'),'74/88.json.gz');

const schema={datasets:[{key:'property',multiple:false,fields:['pid','n_trees']},{key:'trees',multiple:true,fields:['tree_id','total_value_nzd_y']}]};
assert.deepEqual(P.decode(schema,{property:['1',2],trees:[['a',5],['b',null]]}),{property:{pid:'1',n_trees:2},trees:[{tree_id:'a',total_value_nzd_y:5},{tree_id:'b',total_value_nzd_y:null}]});
assert.equal(P.decode(schema,undefined),null);

const property={pid:'8542462',area_m2:294.6,tenure:'private',tenure_basis:'zone',zone:'Residential - Mixed Housing Suburban Zone',n_trees:2,n_confident:2,n_uncertain:0,
  n_earlier_not_counted:1,canopy_m2:28,canopy_cover_pct:9.5,canopy_own_m2:28,canopy_overhang_m2:0,total_value_nzd_y:62.453,total_value_nzd_y_low:24.981,
  total_value_nzd_y_high:99.925,stormwater_value_nzd_y:19.024,avoided_runoff_m3_y:5.435,stored_co2e_tonnes_est:0.287,annual_sequestration_tco2e_y_est:0.005,
  carbon_value_nzd_y:0.215,cooling_value_nzd_y:5.013,pm25_removed_kg_y:1.528,air_quality_value_nzd_y:38.2,total_value_confident_nzd_y:62.453,tallest_m:8.4,
  trees_truncated:0,n_street_nearby:1,street_nearby_value_nzd_y:40};
const html=P.render({property,trees:[{tree_id:'t1',total_value_nzd_y:56.5,height_m:8.4,species_common:'Kermadec pōhutukawa',evidence_tier:'very_likely'}],
  street_trees:[{tree_id:'s1',distance_m:3.1,total_value_nzd_y:40,height_m:7,species_common:null,evidence_tier:'very_likely'}]},
  {pid:'8542462',address:{unit:'1',number:'110',street:'Bayswater Avenue',suburb:'Bayswater',shared:1}});
assert.ok(html.includes('1/110 Bayswater Avenue'));
assert.ok(html.includes('$62/yr') && html.includes('$25 to $100'));
assert.ok(html.includes('not counted above') && html.includes('3.1 m outside'));
assert.ok(html.includes('no property valuation') && html.includes('ownership records not used'));
assert.ok(html.includes('LINZ') && html.includes('ODbL') && html.includes('Department of Conservation') && html.includes('golf courses'));
assert.ok(!html.includes('data-property-rings'),'a full tree list needs no ring note');
// The evidence tier names the tree ("tree very likely"), never a bare "very likely" (FTA-10).
assert.ok(html.includes('tree very likely')&&!/(^|[^e] )very likely/.test(html.replace(/tree very likely/g,'')),'tier wording');
const many=P.render({property:{...property,n_trees:418,trees_truncated:1},trees:Array.from({length:300},(_,i)=>({tree_id:'t'+i,total_value_nzd_y:1}))},{pid:'1'});
assert.ok(many.includes('data-property-rings') && many.includes('ring all 418'),'a truncated list says which trees the map rings');
assert.ok(!html.includes('$102'),'street trees are never added to the property total');
assert.ok(P.render(null,{pid:'8542463'}).includes('No counted trees'));
// The tree, crown and parcel tiles carry one credit (web/credits.js) naming the providers in their own words: the
// Council tree register with its retrieval date, OpenStreetMap (ODbL), LINZ's short form, the 2024 LiDAR licensors
// and DOC's Crown copyright line. It opens over the bottom of the map with the basemap credit, so it stays one string.
const page=(require('node:fs').readFileSync(web+'/index.html','utf8')+require('node:fs').readFileSync(web+'/map-app.js','utf8'));
const Credits=require(web+'/credits.js');
const credit=Credits.text(Credits.MAP.data);
assert.ok(credit.length<=420,`data credit is ${credit.length} characters`);
for(const name of ['Auckland Council','tree register','Auckland Transport','retrieved June 2026','Bio Info Team','© OpenStreetMap contributors','ODbL','Sourced from LINZ. CC BY 4.0','Regional Software Holdings Limited','Crown Copyright: Department of Conservation Te Papa Atawhai'])assert.ok(credit.includes(name),name);
assert.ok(Credits.MAP.data.includes('href="https://www.openstreetmap.org/copyright"'),'the OpenStreetMap credit links its copyright page');
assert.ok(page.includes('const DATA_CREDIT = ALTOCredits.MAP.data;'),'the map reads the credit from credits.js');
assert.equal((page.match(/attribution: DATA_CREDIT \}/g)||[]).length,3,'points, crowns and parcels carry the same credit');
// The property panel names each land dataset as its provider asks, and links Sources and credits.
for(const name of ['NZ Primary Land Parcels','licensed for reuse under CC BY 4.0','not for defining legal boundaries','Plans and Places, Auckland Council','Crown Copyright: Department of Conservation Te Papa Atawhai','may be out of date','https://www.openstreetmap.org/copyright','./credits.html'])assert.ok(html.includes(name),'property sources: '+name);
console.log('Property search normalisation, record decoding and panel checks passed.');
