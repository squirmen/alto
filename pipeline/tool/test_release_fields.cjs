// Offline checks for tool 0.2.12: the tool reads data release 6.3's new and renamed fields and still reads release 6.2's
// (the tool goes live before the 6.3 data, and serves 6.2 again after a rollback). Map features, parcel records, full
// records and the release metadata of both releases, from real release data (fixtures/tree-records-v62.json,
// fixtures/tree-records-v63.json from the v6.3 preview, fixtures/property-v62-v63.json; the map features below are
// lines of the two releases' point streams, cut to the fields read).
// Usage: node pipeline/tool/test_release_fields.cjs
'use strict';
const assert=require('node:assert/strict');
const path=require('node:path');
const web=path.join(__dirname,'..','..','web')+'/';
globalThis.window=globalThis;
for(const f of ['alto-format.js','release-fields.js','palette.js','version.js','tree-id.js','sources.js','growth-form.js','record-links.js','tree-summary.js','alto-viz.js','tree-details.js','species-names.js'])require(web+f);
const FD=globalThis.ALTOFields,T=globalThis.ALTOTreeSummary,D=globalThis.ALTOTreeDetails;
const A=require(web+'area.js'),Pr=require(web+'property.js'),E=require(web+'tree-evidence.js');
const F62=require('./fixtures/tree-records-v62.json'),F63=require('./fixtures/tree-records-v63.json'),PR=require('./fixtures/property-v62-v63.json');

// ---- Map features: TA94PV1P in release 6.3 (trees_map_points), T51734H5 in release 6.2 ----
const P63={tn:'TA94PV1P',tree_id:'akl_tree_lid_1533191',source_primary:'lidar_inferred_canopy',crown_area_m2:281.0,crown_max_chm_m:19.49,species_class:'deciduous_broadleaf',
  avoided_runoff_m3_y:18.128,stormwater_value_nzd_y:95.172,stored_co2e_tonnes_est:1.847,carbon_value_nzd_y:1.385,benefit_value_nzd_y:96.557,valuation_confidence:'modelled_low',
  dbh_cm_crown_est:29.765,height_class:'large',replacement_years_canopy:108.077,crown_replacement:'80y_plus',tenure:'street',grp:1382};
const P62={tn:'T51734H5',tree_id:'akl_tree_pc5_91e7059c27f2ff059744',source_primary:'lidar_pointcloud_v5',crown_area_m2:29.25,crown_max_chm_m:33.45,species_class:'conifer',
  avoided_runoff_m3_y:3.7,stormwater_value_nzd_y:12.948,stored_co2e_tonnes_est:9.312,carbon_value_nzd_y:6.984,cooling_value_nzd_y:3.071,air_quality_value_nzd_y:17.772,
  pm25_removed_kg_y:0.711,total_value_nzd_y:40.776,valuation_confidence:'modelled_low',dbh_cm_crown_est:54.325,life_stage:'veteran',replacement_years_canopy:13.295,
  irreplaceability_class:'effectively_irreplaceable',tenure:'private'};
// A 6.3 marker whose height is not plausible carries no estimates (TTSJF0D9), and one whose height is to check (T7GNAD02).
const P63X={tn:'TTSJF0D9',tree_id:'akl_tree_pc5_b9e9686be19b2b072bd6',source_primary:'lidar_pointcloud_v5',crown_area_m2:12,crown_max_chm_m:57.2,species_class:'conifer',crown_replacement:'not_classed',hchk:'implausible'};
const P63C={tn:'T7GNAD02',tree_id:'akl_tree_pc5_a7bb80c696e679beccf6',source_primary:'lidar_pointcloud_v5',crown_area_m2:19.25,crown_max_chm_m:30.38,species_class:'conifer',
  avoided_runoff_m3_y:2.435,stormwater_value_nzd_y:8.522,stored_co2e_tonnes_est:6.889,carbon_value_nzd_y:5.167,benefit_value_nzd_y:13.689,height_class:'large',
  replacement_years_canopy:9.625,crown_replacement:'5_15y',hchk:'check'};

{
  assert.deepEqual(FD.benefit(P63),{value:96.557,low:null,high:null,confident:null,basis:'stormwater_carbon'});
  assert.equal(FD.benefitValue(P63),Math.round((95.172+1.385)*1000)/1000,'release 6.3: stormwater plus carbon');
  assert.deepEqual(FD.benefit(P62),{value:40.776,low:null,high:null,confident:null,basis:'total_v62'});
  assert.equal(FD.benefitValue(P63X),null,'withheld: no estimate, and never a fallback to another field');
  assert.equal(FD.benefitValue({...P63X,total_value_nzd_y:5}),5,'a 6.2-shaped feature reads its total');
  assert.equal(FD.benefitValue({benefit_value_nzd_y:null,total_value_nzd_y:5}),null,'6.3 field present but null (withheld): null');
  assert.deepEqual([FD.heightClassKey(P63),FD.heightClassKey(P62),FD.heightClassKey(P63X),FD.heightClassKey({life_stage:'semi-mature'})],['large','very_large',null,'medium']);
  assert.deepEqual([FD.crownReplacement(P63),FD.crownReplacement(P62),FD.crownReplacement(P63X)],['80y_plus',null,'not_classed']);
  assert.deepEqual([FD.heightCheck(P63X),FD.heightCheck(P63C),FD.heightCheck(P63),FD.linkCheck({lchk:'likely_different'}),FD.linkCheck({lchk:'x'})],['implausible','check',null,'likely_different',null]);
  assert.deepEqual([FD.flagged(P63X),FD.flagged(P63C),FD.flagged(P63),FD.flagged(P62),FD.flagged({lchk:'check'})],[true,true,false,false,true]);
  assert.deepEqual([FD.groupItem(P63),FD.groupItem(P62),FD.groupItem({grp:'0'})],[1382,null,null]);
}

// ---- Release metadata: 6.3 (headline benefitValueNzdY; PM2.5 and cooling index not published) and 6.2 ----
{
  const M63=F63.metadata,M62=F62.metadata;
  assert.deepEqual(FD.release(M63),{label:'v6.3',number:6.3});
  assert.deepEqual(FD.release(M62),{label:'v6.2',number:6.2});
  assert.deepEqual(FD.release({release:{dataset_version:'metro-2026.10.17-pointcloud-v6.3'}}),{label:'v6.3',number:6.3},'from the dataset_version');
  assert.ok(FD.atLeast(M63,6.3)&&!FD.atLeast(M62,6.3));
  assert.equal(FD.headlineBenefit(M63.dataset.headline_totals).basis,'stormwater_carbon');
  assert.ok(Math.abs(FD.headlineBenefit(M63.dataset.headline_totals).value-76731669)<1,'NZ$76.7 million a year');
  assert.deepEqual(FD.headlineBenefit(M62.dataset.headline_totals).basis,'total_v62');
  assert.ok(Math.abs(FD.headlineBenefit(M62.dataset.headline_totals).value-295218755)<1,'NZ$295 million a year on the 6.2 basis');
  assert.equal(FD.pm25CoolingShown(M63),false,'release 6.3: PM2.5 and the cooling index hidden');
  assert.equal(FD.pm25CoolingShown(M62),false,'release 6.2: no switch, hidden');
  assert.equal(FD.pm25CoolingShown({benefits:{pm25_cooling_approved:true,pm25_cooling_published:true}}),true);
  assert.equal(FD.pm25CoolingShown({benefits:{pm25_cooling_approved:true,pm25_cooling_published:false}}),false,'either one false keeps them hidden');
  assert.equal(FD.pm25CoolingShown({dataset:{benefits:{pm25_cooling_approved:true}}}),true,'under dataset too');
}

// ---- The summary: one tree in both releases (TZ69KK1G) ----
{
  const t63=F63.trees.TZ69KK1G,t62=F62.trees.TZ69KK1G;
  const s63=T.from({},t63.record),s62=T.from({},t62.record);
  const b63=t63.record.datasets.benefits;
  assert.equal(s63.benefits.total,b63.benefit_value_nzd_y,'release 6.3: the benefits dataset');
  assert.equal(s63.benefits.basis,'stormwater_carbon');
  assert.ok(Math.abs(s63.benefits.total-(s63.benefits.stormwaterValue+s63.benefits.carbonValue))<0.01,'headline = stormwater + carbon');
  assert.deepEqual([s63.benefits.airValue,s63.benefits.coolingValue,s63.benefits.pm25],[null,null,null],'air-quality and cooling dollars only in the full record');
  assert.equal(s62.benefits.total,t62.record.datasets.services.total_value_nzd_y,'release 6.2: the services total');
  assert.equal(s62.benefits.basis,'total_v62');
  assert.ok(s62.benefits.airValue>0&&s62.benefits.coolingValue>0);
  assert.ok(t63.record.datasets.services.total_value_nzd_y>s63.benefits.total,'the retired 6.2-basis total stays in the services dataset, never read as the headline');
  // Height class: 6.3 from the size dataset (84.8% of 22 m, read as stored); 6.2 from life_stage.
  assert.deepEqual([s63.lifeStage.key,s63.lifeStage.label,s63.lifeStage.share,s63.lifeStage.release63],['large','Large',84,true]);
  assert.deepEqual([s62.lifeStage.key,s62.lifeStage.label,s62.lifeStage.share,s62.lifeStage.release63],['large','Large',84,false]);
  // Crown replacement: 6.3 band from years (179.5 years: 80 years or more); 6.2 irreplaceability class.
  assert.deepEqual([s63.replacement.band.key,s63.replacement.years,s63.replacement.irreplaceability,s63.replacement.tallTree],['80y_plus',179.545,null,false]);
  assert.equal(s62.replacement.band,null);
  assert.ok(s62.replacement.irreplaceability);
}
// A 6.3 tree whose height is not plausible (T6Z3DYC8, 79.9 m): estimates withheld, not classed with its reason.
{
  const s=T.from({},F63.trees.T6Z3DYC8.record);
  assert.deepEqual([s.benefits.total,s.benefits.withheld,s.benefits.stormwaterValue,s.benefits.carbonStored],[null,'height_not_plausible',null,null]);
  assert.equal(s.lifeStage,null);
  assert.deepEqual([s.replacement.band,s.replacement.notClassed.key,s.replacement.years],[null,'height_not_plausible',null]);
  assert.equal(s.benefits.scenarioOnly,false,'a withheld estimate is never replaced by a scenario');
}
// A 6.3 crown under 5 m (TW3DESRB): its height class and regrowth years stay; no band.
{
  const s=T.from({},F63.trees.TW3DESRB.record);
  assert.deepEqual([s.lifeStage.key,s.replacement.band,s.replacement.notClassed.key,s.replacement.notClassed.label],['small',null,'under_5m','crown under 5 m tall']);
  assert.ok(s.replacement.years>0);
}
// From the map feature alone (the panel's first paint): both releases.
{
  const a=T.from(P63),b=T.from(P62),x=T.from(P63X);
  assert.deepEqual([a.benefits.total,a.lifeStage.key,a.replacement.band.key,a.replacement.years],[96.557,'large','80y_plus',108.077]);
  assert.deepEqual([b.benefits.total,b.lifeStage.key,b.replacement.irreplaceability],[40.776,'very_large','effectively_irreplaceable']);
  assert.deepEqual([x.benefits.total,x.benefits.withheld,x.replacement.notClassed.key],[null,'height_not_plausible','height_not_plausible']);
  assert.equal(T.from({...P63,crown_replacement:'not_classed',crown_max_chm_m:4.2,height_class:'small'}).replacement.notClassed.key,'under_5m');
}

// ---- Full record overview: the map's field names, never a retired value (6.3) ----
{
  const r=F63.trees.TZ69KK1G.record,o=D.overviewProps(r,{});
  assert.equal(o.benefit_value_nzd_y,r.datasets.benefits.benefit_value_nzd_y);
  for(const k of ['total_value_nzd_y','air_quality_value_nzd_y','cooling_value_nzd_y','pm25_removed_kg_y','life_stage','irreplaceability_class'])assert.ok(!(k in o),`6.3 overview has no ${k}`);
  assert.deepEqual([o.height_class,o.crown_replacement,o.replacement_years_canopy],['large','80y_plus',r.datasets.size.regrowth_years]);
  const o2=D.overviewProps(F62.trees.TZ69KK1G.record,{});
  assert.ok(o2.total_value_nzd_y>0&&o2.life_stage==='mature'&&!('benefit_value_nzd_y' in o2),'6.2 overview as before');
}

// ---- Area: sums and classes from either release's features ----
{
  const feat=(p,i)=>({properties:{...p,tree_id:`${p.tree_id}_${i}`},geometry:{type:'Point',coordinates:[174.7,-36.8]}});
  const a63=A.summarise([P63,P63C,P63X].map(feat)),a62=A.summarise([P62].map(feat));
  assert.ok(Math.abs(a63.value-(96.557+13.689))<1e-9,'release 6.3: benefit_value_nzd_y summed; a withheld estimate adds nothing');
  assert.equal(a63.valueCount,2);
  assert.deepEqual(a63.stages,{large:2},'height_class counted');
  assert.equal(a62.value,40.776);
  assert.deepEqual(a62.stages,{very_large:1},'life_stage counted by its class');
}

// ---- Property: release 6.3 and 6.2 parcel records (pid 4756368) ----
{
  const h63=Pr.render(PR.v63,{pid:PR.pid}),h62=Pr.render(PR.v62,{pid:PR.pid});
  const money=v=>globalThis.ALTOFormat.money(v,{total:true});
  assert.ok(h63.includes(money(PR.v63.property.benefit_value_nzd_y)),'6.3 parcel: its benefit total');
  assert.ok(!h63.includes('Air quality')&&!h63.includes('PM2.5'),'6.3 parcel: no air-quality or cooling row');
  assert.ok(h62.includes(money(PR.v62.property.total_value_nzd_y))&&h62.includes('Air quality')&&h62.includes('Cooling'),'6.2 parcel as before');
  assert.ok(PR.v63.trees.every(t=>h63.includes(globalThis.ALTOFormat.money(t.benefit_value_nzd_y))),'6.3 parcel trees: their benefit values');
}

// ---- Saved-trees comparison: the benefit value of either release ----
{
  const x63=E.explain(F63.trees.TZ69KK1G.record),x62=E.explain(F62.trees.TZ69KK1G.record);
  assert.equal(x63.annualValue,F63.trees.TZ69KK1G.record.datasets.benefits.benefit_value_nzd_y);
  assert.equal(x63.pm25,null);
  assert.equal(x62.annualValue,F62.trees.TZ69KK1G.record.datasets.services.total_value_nzd_y);
  const w=E.explain(F63.trees.T6Z3DYC8.record);
  assert.deepEqual([w.annualValue,w.runoff,w.carbonStored],[null,null,null],'withheld: no estimate from the services dataset');
}
console.log('release field checks passed (tool 0.2.12): map features, metadata, summaries, overview, Area, property and comparison, releases 6.2 and 6.3');
