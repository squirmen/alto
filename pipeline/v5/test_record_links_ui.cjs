// Offline checks for web/record-links.js. V5.2 tiles and records carry link_class, link_evidence and
// crown_source "record_seeded_v52"; earlier ones carry none of them, and the page must then look as
// it did. The Council recorded positions layer is off until someone switches it on.
const assert=require('node:assert/strict');
const web=require('node:path').join(__dirname,'..','..','web');
const L=require(web+'/record-links.js');
const E=require(web+'/tree-evidence.js');

// Earlier tiles and records: nothing to show.
const v5={tree_id:'akl_tree_trp_ACCT0159885',source_primary:'tree_register_points',crown_pilot:0,crown_source:null,evidence_tier:'recorded'};
assert.equal(L.link(v5),null);
assert.equal(L.link({...v5,crown_source:'v5'},{datasets:{crown:{crown_source:'v5'}}}),null);
assert.equal(L.render(null),'');
assert.equal(L.render(L.link(v5)),'');

// A probable link from the map tile, and the same link composed when only the class and distance arrive.
const probable={...v5,crown_pilot:1,crown_source:'v5',link_class:'probable',link_evidence:'Probable match to this LiDAR crown (1.6 m from the crown edge)'};
assert.deepEqual(L.link(probable),{cls:'probable',text:'Probable match to this LiDAR crown (1.6 m from the crown edge)',edge:null,seeded:false});
assert.equal(L.link({...v5,link_class:'probable',link_edge_m:1.61}).text,'Probable match to this LiDAR crown (1.6 m from the crown edge)');
assert.equal(L.link({...v5,link_class:'linked',link_edge_m:0}).text,'Linked to its LiDAR crown by position (0.0 m from the crown edge)');
assert.equal(L.link({...v5,link_class:'linked'}).text,'Linked to its LiDAR crown by position');
assert.equal(L.link({...v5,link_class:'something_else'}),null,'an unknown class is ignored');
let html=L.render(L.link(probable));
assert.ok(html.includes('Probable crown match') && html.includes('1.6 m from the crown edge') && html.includes('Council recorded positions'));
assert.ok(!html.includes('awaiting confirmation'));

// The full record wins over the tile, and its own field names are read.
const record={tree_id:v5.tree_id,datasets:{record_link:{link_class:'linked',evidence_text:'Linked to its LiDAR crown by position (0.4 m from the crown edge)',edge_distance_m:0.4,crown_source:'v5'}}};
assert.deepEqual(L.link(probable,record),{cls:'linked',text:'Linked to its LiDAR crown by position (0.4 m from the crown edge)',edge:0.4,seeded:false});

// Record-seeded crowns: from the class, the crown source or the display style, with or without a link.
const seeded={...v5,crown_pilot:1,crown_source:'record_seeded_v52',display_style:'faint',link_class:'drawn_from_record',
  link_evidence:"Crown drawn from the LiDAR returns at this record's position; awaiting confirmation"};
assert.equal(L.link(seeded).seeded,true);
assert.equal(L.link({tree_id:'x',crown_source:'record_seeded_v52'}).seeded,true);
assert.equal(L.link({tree_id:'x',display_style:'faint'}).seeded,true);
assert.equal(L.link({tree_id:'x'},{datasets:{crown:{crown_source:'record_seeded_v52'}}}).seeded,true);
html=L.render(L.link(seeded));
assert.ok(html.includes('Crown drawn from the record') && html.includes('Drawn from the record, awaiting confirmation'));
assert.ok(html.includes('this record&#39;s position'),'evidence text is escaped');
assert.ok(!L.render(L.link({tree_id:'x',crown_source:'record_seeded_v52'})).includes('Council recorded positions'),'a crown without a record link has no recorded position');

// The hover note on a recorded position.
const tip=L.tip({tree_id:'akl_tree_trp_ACCT0257674',source:'tree_register_points',status:'linked_medium',distance_m:11.56,edge_distance_m:1.29});
assert.ok(tip.includes('The Council tree register recorded the tree here') && tip.includes('11.6 m away') && tip.includes('(probable match)'));
assert.ok(L.tip({source:'osm_natural_tree',status:'linked_new_crown'}).includes('OpenStreetMap recorded the tree here. ALTO joined it to a crown (crown drawn from the record).'));
assert.ok(L.tip({source:'unknown',status:'other',distance_m:2}).includes('The source recorded the tree here. ALTO joined it to the crown whose top is 2.0 m away.'));
assert.deepEqual(L.STATUS_CLASS,{linked_high:'linked',linked_medium:'probable',linked_new_crown:'drawn_from_record'});

// Layers start hidden, points and lines are told apart by geometry, and the ids are the ones toggled.
const layers=L.layers();
assert.deepEqual(layers.map(l=>l.id),L.LAYER_IDS);
for(const l of layers){assert.equal(l.layout.visibility,'none');assert.equal(l['source-layer'],'council_positions');assert.equal(l.minzoom,13);}
assert.deepEqual(layers.map(l=>l.filter[2]),['LineString','LineString','Point']);

// The switch appears only for a release whose metadata lists the layer.
assert.equal(L.shipped({artifacts:[{path:'data/trees_map_points.pmtiles'},{path:'data/council_positions.pmtiles',bytes:1278032}]}),true);
assert.equal(L.shipped({derived_products:{council_positions:'data/council_positions.pmtiles'}}),true);
assert.equal(L.shipped({artifacts:[{path:'data/trees_map_points.pmtiles'}],derived_products:{}}),false);
assert.equal(L.shipped(null),false);

// The evidence card names a record-seeded crown as such.
const ev=E.explain({tree_id:'x',datasets:{crown:{crown_source:'record_seeded_v52',crown_max_chm_m:5.3}}});
assert.equal(ev.heightBasis,'Crown drawn from the record, 2024 survey; awaiting confirmation');
assert.equal(E.explain({tree_id:'x',datasets:{crown:{crown_source:'v5'}}}).heightBasis,'V5 segmented canopy maximum, 2024 survey');

// The page: the switch is hidden until the release has the layer and unchecked when it appears;
// faint crowns use one expression on fill and outline; the profile shows the link once.
const page=require('node:fs').readFileSync(web+'/index.html','utf8');
assert.match(page,/<label class="check" for="showCouncilPositions" id="councilPositionsToggle" title="Where the Council or other source recorded the tree, joined to the crown ALTO found it on\." hidden>\s*<input id="showCouncilPositions" type="checkbox">/);
assert.ok(page.includes('showCouncilPositions: false'));
assert.equal((page.match(/\["case", faintCrownExpr\(\), /g)||[]).length,2);
assert.ok(page.includes('src="./record-links.js?v='));
assert.ok(page.includes('{recordLink:false}') && page.includes('ALTORecordLinks.mount(profileBody,record,props)'));
assert.ok(page.includes('ALTORecordLinks.release(metadata)'),'the release metadata decides whether the switch is offered');
assert.ok(!page.includes('council_positions.pmtiles`), probe'),'no request is made for the layer before it is switched on');
assert.ok(/PARCEL_CLICK_YIELDS = \[[^\]]*"council-positions"\]/.test(page));
console.log('Record link, recorded-position layer and seeded-crown checks passed.');
