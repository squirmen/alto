// Offline checks for tool 0.2.12, release 6.3 benefits (decision TS-05 B): the benefit value is stormwater plus carbon
// (benefits dataset, benefit_value_nzd_y); air-quality and cooling dollars appear only in the full record, labelled not
// release-eligible; PM2.5 removal and the cooling index stay hidden while the release metadata does not publish them
// (benefits.pm25_cooling_approved false in release 6.3). Release 6.2 records keep their four-service total.
// Usage: node pipeline/tool/test_benefits_v63.cjs
'use strict';
const assert=require('node:assert/strict');
const path=require('node:path');
const web=path.join(__dirname,'..','..','web')+'/';
globalThis.window=globalThis;
for(const f of ['alto-format.js','release-fields.js','palette.js','version.js','tree-id.js','sources.js','growth-form.js','record-links.js','tree-summary.js','alto-viz.js','tree-details.js','species-names.js'])require(web+f);
const D=globalThis.ALTOTreeDetails,FMT=globalThis.ALTOFormat;
const R=require(web+'tree-record.js'),I=require(web+'tree-instrument.js'),P=require(web+'tree-panel.js'),A=require(web+'area.js'),Pr=require(web+'property.js'),E=require(web+'tree-evidence.js');
const F62=require('./fixtures/tree-records-v62.json'),F63=require('./fixtures/tree-records-v63.json'),PR=require('./fixtures/property-v62-v63.json');
const build=(F,n,metadata=F.metadata)=>{const t=F.trees[n];return R.assemble({id:t.id,record:t.record,schema:F.schema,members:t.members,memberCount:t.memberCount,metadata,env:{siteRoot:'.',dataBase:'./data',metadata}});};
const visible=h=>h.replace(/<(svg|code)[\s\S]*?<\/\1>/g,' ').replace(/<[^>]+>/g,' ').replace(/&amp;/g,'&').replace(/\s+/g,' ');
const PAGE_KEYS=['height','crownArea','crownDiameter','crownSpread','dripline','rootZone','rootZoneColumnar','trunkDiameter','largestStem','rootProtection','lifeStage','benefits','carbonStored','replacementYears','crownReplacement','irreplaceability'];

// ---- Release 6.3: TZ69KK1G ----
{
  const rec=build(F63,'TZ69KK1G'),q=rec.measures.benefits,bd=F63.trees.TZ69KK1G.record.datasets.benefits;
  assert.equal(q.value,bd.benefit_value_nzd_y);
  assert.equal(q.text,`${FMT.money(bd.benefit_value_nzd_y)}/yr`);
  assert.deepEqual([q.provenance.dataset,q.provenance.field,q.provenance.method.id,q.provenance.method.href],['benefits','benefit_value_nzd_y','benefits_v63','./v63-methods.html#benefits']);
  assert.match(I.line(q),/^Stormwater and carbon · Range .+ · Sensitivity scenario · ±30% band set by confidence tier$/);
  assert.match(q.provenance.note,/^Stormwater and carbon\. Air-quality and cooling dollars are kept in the full record, not release-eligible from release 6\.3\./);
  assert.deepEqual(rec.benefits.rows.map(r=>r.key),['stormwater','carbon'],'two services');
  assert.ok(Math.abs(rec.benefits.rows.reduce((s,r)=>s+r.value,0)-bd.benefit_value_nzd_y)<0.01,'the rows add up to the benefit value');
  assert.deepEqual(rec.benefits.also,[],'PM2.5 and the cooling index hidden (release 6.3: not published)');
  assert.ok(rec.benefits.note.includes('PM2.5 removal and the cooling index are not published in this release.'));
  // No surface of the panel or the page names an air-quality, cooling or PM2.5 value.
  for(const h of [I.strip(rec,P.KEYS),I.strip(rec,PAGE_KEYS),I.lost(rec,{variant:'page'}),I.provenance(q,rec)]){
    const v=visible(h);assert.ok(!/air quality|air-quality value|cooling value|PM2\.5 removed|cooling index/i.test(v.replace(/Air-quality and cooling dollars are kept in the full record, not release-eligible[^.]*\./g,'')),v.slice(0,400));
  }
  // The full record keeps the air-quality and cooling dollars, labelled; PM2.5 removal and the cooling index are left out
  // of the view while the release does not publish them.
  const schema={datasets:[F63.trees.TZ69KK1G.record.datasets.services&&{key:'services',table:'tree_current_services_v6',title:'Services',evidence:'x',note:'x',
      retired_fields:{air_quality_value_nzd_y:'Kept for provenance; not release-eligible from v6.3. PM2.5 removal priced at NZ$25 per kg.',cooling_value_nzd_y:'Kept for provenance; not release-eligible from v6.3.'}},
    {key:'benefits',table:'tree_benefits_v63',title:'Benefit estimates (v6.3)',evidence:'x',note:'x',field_labels:{benefit_value_nzd_y:'Benefit value (stormwater and carbon), NZ$ a year',release_eligible:'PM2.5 removal and cooling index release-eligible (1) or kept in the record only (0)'}}]};
  const hide=globalThis.ALTOFields.pm25CoolingShown(F63.metadata)?[]:['benefits.pm25_removed_g_y','benefits.cooling_index'];
  const html=D.render(schema,{datasets:{services:F63.trees.TZ69KK1G.record.datasets.services,benefits:bd}},{hide});
  assert.ok(html.includes('title="tree_current_services_v6.air_quality_value_nzd_y"')&&html.includes('Kept for provenance; not release-eligible from v6.3. PM2.5 removal priced at NZ$25 per kg.'),'air-quality dollars, labelled');
  assert.ok(html.includes('title="tree_current_services_v6.cooling_value_nzd_y"'),'cooling dollars, labelled');
  assert.ok(!html.includes('tree_benefits_v63.pm25_removed_g_y')&&!html.includes('tree_benefits_v63.cooling_index'),'PM2.5 removal and the cooling index hidden');
  assert.ok(html.includes('Benefit value (stormwater and carbon), NZ$ a year')&&html.includes('No: kept in the record only'));
  // Published (a later release whose method and gate pass): listed apart, not priced.
  const M={...F63.metadata,benefits:{...F63.metadata.benefits,pm25_cooling_approved:true,pm25_cooling_published:true}};
  const shown=build(F63,'TZ69KK1G',M).benefits.also;
  assert.deepEqual(shown.map(x=>x.label),['PM2.5 removed','Cooling index']);
  assert.match(shown[0].text,/ g a year$/);assert.match(shown[1].text,/\(no unit\)$/);
  assert.ok(D.render(schema,{datasets:{benefits:bd}},{hide:[]}).includes('tree_benefits_v63.pm25_removed_g_y'));
}
// A withheld estimate (T6Z3DYC8): said as withheld, never a value from the services dataset.
{
  const rec=build(F63,'T6Z3DYC8');
  assert.deepEqual([rec.benefits.status,rec.benefits.withheld,rec.measures.benefits,rec.measures.carbonStored],['withheld','height_not_plausible',undefined,undefined]);
  assert.ok(I.strip(rec,PAGE_KEYS).includes('Benefits: none for this record (withheld: height not plausible)'));
}
// ---- Release 6.2: the four-service total, as before ----
{
  const rec=build(F62,'TZ69KK1G'),q=rec.measures.benefits;
  assert.equal(q.value,F62.trees.TZ69KK1G.record.datasets.services.total_value_nzd_y);
  assert.deepEqual([q.provenance.dataset,q.provenance.field],['services','total_value_nzd_y']);
  assert.match(I.line(q),/^Range .+ · Sensitivity scenario/);
  assert.deepEqual(rec.benefits.rows.map(r=>r.key),['stormwater','carbon','air','cooling']);
  assert.equal(rec.benefits.release63,false);
}
// ---- Area and property: what the value adds up ----
{
  const t63={markers:1,value:76731669.4,valueBasis:'stormwater_carbon'},t62={markers:1,value:295218754.5,valueBasis:'total_v62'};
  const r63=visible(A.render({count:0},{kind:'region',title:'Auckland',totals:t63})),r62=visible(A.render({count:0},{kind:'region',title:'Auckland',totals:t62}));
  assert.ok(r63.includes('about NZ$76.7 million a year')&&r63.includes('stormwater and carbon; sum of the markers’ yearly estimates'),r63);
  assert.ok(r62.includes('about NZ$295 million a year')&&!r62.includes('stormwater and carbon'),r62);
  const h63=visible(Pr.render(PR.v63,{pid:PR.pid})),h62=visible(Pr.render(PR.v62,{pid:PR.pid}));
  assert.ok(h63.includes('Benefits each year: stormwater and carbon')&&h63.includes('Benefit value (stormwater and carbon)'));
  assert.ok(h62.includes('Estimated services each year')&&h62.includes('Total'));
}
// ---- Saved-trees comparison: the PM2.5 row only where a record holds a release 6.2 value ----
{
  const c63=visible(E.comparison([F63.trees.TZ69KK1G.record,F63.trees.T6Z3DYC8.record]));
  assert.ok(!c63.includes('PM2.5')&&c63.includes('stormwater and carbon')&&c63.includes('withheld: height not plausible'),c63.slice(0,600));
  assert.ok(visible(E.comparison([F62.trees.TZ69KK1G.record])).includes('PM2.5 removed a year'));
}
console.log('benefit checks passed (tool 0.2.12, TS-05 B): stormwater plus carbon, retired dollars in the full record only, PM2.5 and cooling index hidden, releases 6.2 and 6.3');
