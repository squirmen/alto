// Offline checks for growth-form.js. V6 tiles carry gf6 and full records the growth_form dataset; earlier
// tiles and records carry neither, and the page must then look as it did. A recorded species stays the
// species; the model's growth form is always labelled as a model estimate.
// Usage: node test_growth_form_ui.cjs [path/to/growth-form.js]
const assert=require('node:assert/strict');
const path=require('node:path');
const G=require(process.argv[2]?path.resolve(process.argv[2]):path.join(__dirname,"..","..","web","growth-form.js"));

// Earlier tiles and records: nothing to show, no filter, no row.
assert.equal(G.key({tree_id:'a'}),null);
assert.equal(G.key({tree_id:'a',gf6:'something_else'}),null,'an unknown key is ignored');
assert.equal(G.render({tree_id:'a',datasets:{}},{tree_id:'a'}),'');
assert.equal(G.row({tree_id:'a'}),null);
assert.equal(G.shipped({derived_products:{}}),false);
assert.equal(G.shipped({derived_products:{growth_form:'data/growth-form-v6.json'}}),true);
assert.equal(G.shipped(null),false);

// Every wording says model (or names its evidence), and none reads as an identified species.
for(const [k,text] of Object.entries(G.WORDING)){
  assert.ok(text==='Growth form not yet determined'||/\(model|LiDAR\)|aerial imagery\)/.test(text),k);
  assert.ok(G.group(k)!=='none',k);
}
assert.equal(Object.keys(G.WORDING).length,12);
assert.equal(G.group('palm_c1'),'palm_type');
assert.equal(G.group(null),'none');

// Tile only: the key and the row for the quick profile.
const tile={tree_id:'akl_tree_lid_1',source_primary:'lidar_pointcloud_v5',gf6:'conifer'};
assert.equal(G.key(tile),'conifer');
assert.deepEqual(G.row(tile),{label:'Growth form (model)',value:'Likely conifer (model)',note:'model estimate'});

// The full record wins over the tile and its scores are shown as percentages.
const rec={tree_id:'akl_tree_lid_1',datasets:{growth_form:{display_key:'possibly_palm_type',band:'medium',p_evergreen_broadleaf:.1,p_deciduous_broadleaf:.02,
  p_conifer:.03,p_palm:.15,p_palm_like:.2,p_tree_fern:.5,c1_override:0,lidar_flight_date:'2024-05-19'},record:{species_common:'Unknown'}}};
let html=G.render(rec,tile);
assert.ok(html.includes('Possibly palm, cabbage tree or tree fern (model)'));
assert.ok(html.includes(G.NOTE)&&html.includes('Tree fern</span><span class="pp-value">50%')&&html.includes('2024-05-19'));
assert.ok(!html.includes('stays its species'),'"Unknown" is not a recorded species');

// A recorded species is kept, and a disagreeing model call is shown beside it without a warning.
const council={datasets:{growth_form:{display_key:'conifer'},record:{species_common:'Phoenix Palm',species_latin:'Phoenix canariensis'}}};
html=G.render(council,{tree_id:'akl_tree_trp_1',species_common:'Phoenix Palm'});
assert.ok(html.includes('Likely conifer (model)')&&html.includes('The species recorded for this tree, Phoenix Palm, stays its species.'));
assert.ok(!/wrong|conflict|disagree/i.test(html));

// Undetermined crowns say what the service estimate assumes; text is escaped.
html=G.render({datasets:{growth_form:{display_key:'not_determined'},services:{growth_form_default:1}}},{});
assert.ok(html.includes('Growth form not yet determined')&&html.includes('assumes an evergreen broadleaf tree'));
assert.ok(html.includes('could not yet tell')&&!html.includes(G.NOTE),'an undetermined crown is not called a model estimate');
assert.ok(G.render({datasets:{growth_form:{display_key:'conifer'},record:{species_common:'<b>x</b>'}}},{}).includes('&lt;b&gt;x&lt;/b&gt;'));
// A set-aside palm detection on a wide crown is explained.
assert.ok(G.render({datasets:{growth_form:{display_key:'evergreen_high',c1_override:1,guard_v2:1,p_evergreen_broadleaf:.9}}},{}).includes('set aside'));

// Map expressions: every display key maps to its group; no filter when all groups are on.
const all=new Set(G.GROUP_KEYS);
assert.equal(G.filter(all),null);
assert.deepEqual(G.filter(new Set()),['==',['get','tree_id'],'__none__']);
const f=G.filter(new Set(['conifer','none']));
assert.equal(f[0],'match');assert.deepEqual(f[2],['conifer','none']);
const ge=G.groupExpr();
const keys=ge.slice(2,-1).filter((x,i)=>i%2===0).flat();
assert.deepEqual(keys.sort(),Object.keys(G.WORDING).sort());
assert.equal(ge[ge.length-1],'none');
const ce=G.colour();
assert.equal(ce.length,2+2*(G.GROUPS.length-1)+1);
assert.equal(G.legend().length,G.GROUPS.length);
html=G.toggles(new Set(['evergreen']));
assert.equal((html.match(/data-growth-form=/g)||[]).length,G.GROUPS.length);
assert.ok(html.includes('data-growth-form="evergreen" aria-pressed="true"')&&html.includes('data-growth-form="conifer" aria-pressed="false"'));

// The one-line summary, and mount: the line under the heading (after the place line when there is one),
// the section under the record link, else under the evidence summary.
assert.equal(G.line(rec,tile),'<p class="growth-form-line"><span>Growth form (model)</span> Possibly palm, cabbage tree or tree fern (model)</p>');
assert.equal(G.line({datasets:{}},{}),'');
const calls=[];
const el=cls=>({insertAdjacentHTML:(where,h)=>calls.push([cls,where,h.slice(0,40)])});
const q=map=>({querySelector:s=>map[s]?el(map[s]):null});
G.mount(q({'.evidence-summary .evidence-place':'place','.evidence-summary .evidence-id':'id','.record-link':'link','.evidence-summary':'summary'}),rec,tile);
G.mount(q({'.evidence-summary .evidence-id':'id','.evidence-summary':'summary'}),rec,tile);
G.mount({querySelector:()=>el('x')},{datasets:{}},{});
assert.deepEqual(calls.map(c=>c.slice(0,2)),[['place','afterend'],['link','afterend'],['id','afterend'],['summary','afterend']]);
assert.ok(calls[0][2].startsWith('<p class="growth-form-line">'));
console.log('growth-form.js: all checks passed');
