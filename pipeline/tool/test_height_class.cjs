// Offline checks for decision TS-07 (16 Oct 2026, option A): the class the release stores as life_stage (height as a
// share of a class reference height) is shown as "Height class", named by size and marked Estimate, for example
// "Large · 84% of the 22 m evergreen-broadleaf reference height" (the share rounded down, tool 0.2.12). Checked on the tree panel and tree page cards, the
// provenance popover, the Area tab, the stored-field view and the interface sources: the life-stage words never show,
// and "veteran" is kept for field records. The stored field (assets.life_stage) and its values are unchanged.
// Usage: node pipeline/tool/test_height_class.cjs
'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const web=path.join(__dirname,'..','..','web')+'/';
globalThis.window=globalThis;
for(const f of ['palette.js','version.js','tree-id.js','sources.js','growth-form.js','record-links.js','tree-summary.js','alto-viz.js','tree-details.js'])require(web+f);
const T=globalThis.ALTOTreeSummary,V=globalThis.ALTOViz,D=globalThis.ALTOTreeDetails;
const R=require(web+'tree-record.js'),I=require(web+'tree-instrument.js'),P=require(web+'tree-panel.js'),A=require(web+'area.js');
// Visible text of a markup string (tags, SVG and code removed), and the words a tooltip or label reads out.
const visible=h=>h.replace(/<(svg|code)[\s\S]*?<\/\1>/g,' ').replace(/<[^>]+>/g,' ').replace(/&amp;/g,'&').replace(/\s+/g,' ');
const spoken=h=>[...h.matchAll(/(?:aria-label|title|data-label)="([^"]*)"/g)].map(m=>m[1]).join(' | ');
// Life-stage words, which a class from height alone must not use.
const STAGE_WORDS=/\b(life stage|juvenile|juv\.|young|semi-mature|semi|mature|veteran)(?![\w-])/i;
const clean=(h,what)=>{const t=`${visible(h)} | ${spoken(h)}`;assert.ok(!STAGE_WORDS.test(t),`${what}: "${(t.match(STAGE_WORDS)||[])[0]}" in ${t.slice(0,300)}`);};

// ---- One table: the stored keys, named by size, with their bands ----
assert.deepEqual(T.HEIGHT_CLASS.map(c=>c[0]),['very_small','small','medium','large','very_large'],'release 6.3 height_class keys');
assert.deepEqual(T.HEIGHT_CLASS.map(c=>c[4]),['juvenile','young','semi-mature','mature','veteran'],'the life_stage values release 6.2 stored are unchanged');
assert.deepEqual(['juvenile','mature','veteran','very_small','large'].map(k=>T.heightClass(k).key),['very_small','large','very_large','very_small','large'],'either key names one class');
assert.deepEqual(T.HEIGHT_CLASS.map(c=>c[1]),['Very small','Small','Medium','Large','Very large']);
assert.deepEqual(T.HEIGHT_CLASS.map(c=>T.bandText(T.heightClass(c[0]))),['under 18%','18–35%','35–60%','60–90%','90% or more']);
assert.equal(T.scaleText(),'very small under 18%, small 18–35%, medium 35–60%, large 60–90%, very large 90% or more');
assert.equal(T.heightClass('old'),null);
// A share prints in whole per cent rounded down, inside its class's band (84.86% of a large tree is 84%; 89.6% is 89%,
// never 90%); a share outside the stored band prints nothing, so a number never contradicts the class.
const large=T.heightClass('mature');
assert.deepEqual([84.86,84.8,89.6,89.99,60,59.9,90,null].map(x=>T.sharePct(x,large)),[84,84,89,89,60,null,null,null]);
assert.deepEqual([T.sharePct(17.6,T.heightClass('juvenile')),T.sharePct(363.2,T.heightClass('veteran')),T.sharePct(34.95,T.heightClass('small'))],[17,363,34]);
// The summary: the class by its size name, its band and, when the height is inside the band, the share.
{
  const s=T.lifeStage('mature',16.85,'deciduous_broadleaf');
  assert.deepEqual([s.key,s.label,s.band,s.detail],['large','Large','60–90%','16.9 m of 25 m (deciduous broadleaf): 67%']);
  assert.equal(T.lifeStage('veteran',15,'evergreen_broadleaf').detail,null,'15 m is not 90% of 22 m: no share beside "Very large"');
  assert.equal(T.lifeStage(null,15,'conifer'),null);
}

// ---- Release 6.2 records (fixtures/tree-records-v62.json) ----
const F62=require('./fixtures/tree-records-v62.json'),M62=F62.metadata;
const b62=(n,edit=null)=>{const t=F62.trees[n],record=edit?edit(structuredClone(t.record)):t.record;
  return R.assemble({id:t.id,record,schema:F62.schema,members:t.members,memberCount:t.memberCount,metadata:M62,env:{siteRoot:'.',dataBase:'./data',metadata:M62}});};
const PAGE_KEYS=JSON.parse(fs.readFileSync(web+'tree-page.js','utf8').match(/const KEYS=(\[[^\]]+\])/)[1].replace(/'/g,'"'));
assert.ok(PAGE_KEYS.includes('lifeStage')&&P.KEYS.includes('lifeStage'),'the panel and the page show the height class');
// The decision's example: TZ69KK1G, 18.7 m of the 22 m evergreen-broadleaf reference height.
{
  const rec=b62('TZ69KK1G'),q=rec.measures.lifeStage;
  assert.deepEqual([q.label,q.text,q.kind,q.share,q.band],['Height class','Large','model',84,'60–90%']);
  assert.equal(I.LABELS.lifeStage,'Height class');
  assert.equal(I.line(q),'84% of the 22 m evergreen-broadleaf reference height · Range not computed in release 6.2');
  const card=I.metric(rec,'lifeStage');
  assert.ok(card.includes('<span class="ti-m-l">Height class</span>')&&card.includes('<b>Large</b>')&&card.includes('badge-estimate'),'label, size name and Estimate');
  assert.ok(spoken(card).includes('Large: 84% of the 22 m evergreen-broadleaf reference height. Classes by share of the class reference height: very small under 18%, small 18–35%, medium 35–60%, large 60–90%, very large 90% or more.'),spoken(card));
  clean(card,'TZ69KK1G card');
  const p=q.provenance;
  assert.equal(p.note,'Height 18.7 m, 84% of the 22 m evergreen-broadleaf reference height. Classes by share of the class reference height: very small under 18%, small 18–35%, medium 35–60%, large 60–90%, very large 90% or more. From height only; age not estimated.');
  assert.equal(p.method.text,'Trunk diameter, height class and regrowth time from crown size and height (sensitivity model)');
  assert.deepEqual([p.dataset,p.field],['assets','life_stage'],'the stored field keeps its name, shown in the popover as stored');
  const pop=I.provenance(q,rec);
  assert.ok(pop.includes('<h3 id="tiPopT">Height class</h3>')&&pop.includes('<code>assets.life_stage</code>'));
  clean(pop,'TZ69KK1G provenance');
  assert.deepEqual(rec.lifeStage.scale.map(c=>[c.key,c.label,c.band,c.current]),[['very_small','Very small','under 18%',false],['small','Small','18–35%',false],
    ['medium','Medium','35–60%',false],['large','Large','60–90%',true],['very_large','Very large','90% or more',false]]);
  assert.equal(rec.lifeStage.definition,'Height as a share of the reference height for the tree class');
}
// A crown the release classed on another class names it; the scheduled plaque tree TMCTT6X4 reads Medium.
assert.equal(I.line(b62('TADY8HB7').measures.lifeStage),'125% of the 22 m evergreen-broadleaf reference height (this crown’s release 5.2 class) · Range not computed in release 6.2');
assert.equal(b62('TADY8HB7').measures.lifeStage.text,'Very large');
assert.equal(b62('TMCTT6X4').measures.lifeStage.text,'Medium');
assert.equal(b62('T5JM9VFQ').measures.lifeStage.text,'Small');
// Every record: the panel and page cards, the bar and the popover use the height-class words only.
let checked=0;
for(const n of Object.keys(F62.trees)){
  const rec=b62(n),q=rec.measures.lifeStage;
  for(const keys of [P.KEYS,PAGE_KEYS])clean(I.strip(rec,keys),`${n} cards`);
  if(!q)continue;
  checked++;
  assert.ok(T.HEIGHT_CLASS.some(c=>c[1]===q.text),`${n}: ${q.text}`);
  assert.match(I.line(q),/^(\d+%|Under \d+%|\d+–\d+%|\d+% or more) of the \d+ m [a-z-]+ reference height( \(this crown’s release 5\.2 class\))? · Range not computed in release 6\.2$/,`${n}: ${I.line(q)}`);
  clean(I.provenance(q,rec),`${n} provenance`);
}
assert.ok(checked>=18,`height classes checked: ${checked}`);
// A height shown outside the stored class's band prints the band, never a contradicting share.
{
  const q=b62('TZ69KK1G',r=>{r.datasets.assets.life_stage='veteran';return r;}).measures.lifeStage;
  assert.deepEqual([q.text,q.share],['Very large',null]);
  assert.equal(I.line(q),'90% or more of the 22 m evergreen-broadleaf reference height · Range not computed in release 6.2');
  assert.match(q.provenance.note,/^90% or more of the 22 m evergreen-broadleaf reference height\. Classes/);
  const edge=b62('TZ69KK1G',r=>{r.datasets.crown.crown_max_chm_m=19.7;r.datasets.assets.height_max_m=19.7;return r;});
  assert.deepEqual([edge.measures.lifeStage.text,edge.measures.lifeStage.share],['Large',89],'89.5% of a large tree prints 89%');
}

// ---- Release 6.3 records (fixtures/tree-records-v63.json): the class and its share as stored (size dataset), the
// crown replacement time in bands, and crowns that are not classed with their reason ----
const F63=require('./fixtures/tree-records-v63.json'),M63=F63.metadata;
const b63=n=>{const t=F63.trees[n];return R.assemble({id:t.id,record:t.record,schema:F63.schema,members:t.members,memberCount:t.memberCount,metadata:M63,env:{siteRoot:'.',dataBase:'./data',metadata:M63}});};
{
  // TZ69KK1G: 84.8% of the 22 m evergreen-broadleaf reference height, printed 84% (rounded down, never the next class).
  const rec=b63('TZ69KK1G'),q=rec.measures.lifeStage;
  assert.deepEqual([q.text,q.share,q.shareStored,q.provenance.dataset,q.provenance.field],['Large',84,84.8,'size','height_class']);
  assert.equal(I.line(q),'84% of the 22 m evergreen-broadleaf reference height · Range not computed in release 6.3');
  assert.match(q.provenance.note,/The share is rounded down, so it never reads as the next class\./);
  assert.ok(!('irreplaceability' in rec.measures),'release 6.3 has no irreplaceability class');
  const cr=rec.measures.crownReplacement;
  assert.deepEqual([cr.label,cr.text,cr.provenance.dataset,cr.provenance.field],['Crown replacement time','80 years or more','size','crown_replacement']);
  assert.equal(I.line(cr),'About 180 years to regrow this crown area · Band of the regrowth years · Range not computed in release 6.3');
  assert.deepEqual([rec.replacement.band.key,rec.replacement.tallTree,rec.replacement.bands.length,rec.replacement.classes.length],['80y_plus',false,5,0]);
  assert.ok(PAGE_KEYS.includes('crownReplacement'),'the page lists the crown replacement time');
  const lost=I.lost(rec,{variant:'page'});
  assert.ok(lost.includes('Crown replacement time')&&lost.includes('80 years or more')&&!lost.includes('Irreplaceability'),lost);
  assert.ok(!I.strip(rec,PAGE_KEYS).includes('Irreplaceability: none'),'the 6.2 class is never listed as missing on a 6.3 tree');
  assert.ok(I.metric(rec,'crownReplacement').includes('class="ti-cb ti-cb-eq"'),'the five bands, this crown’s marked');
}
{
  // A crown whose height is not plausible (T6Z3DYC8, 79.9 m): not classed, with its reason; nothing withheld is shown.
  const rec=b63('T6Z3DYC8');
  assert.deepEqual([rec.measures.lifeStage.text,I.line(rec.measures.lifeStage)],['Not classed','Height not plausible · values withheld']);
  assert.deepEqual([rec.measures.crownReplacement.text,I.line(rec.measures.crownReplacement)],['Not classed','Height not plausible']);
  assert.ok(!rec.measures.replacementYears&&!rec.measures.benefits,'withheld estimates are not shown');
  assert.equal(rec.lifeStage.status,'not_classed');
}
{
  // A crown under 5 m (TW3DESRB): its height class and regrowth years stay; the crown replacement time reads not classed.
  const rec=b63('TW3DESRB');
  assert.deepEqual([rec.measures.lifeStage.text,rec.measures.crownReplacement.text,I.line(rec.measures.crownReplacement)],['Small','Not classed','Crown under 5 m tall']);
  assert.ok(rec.measures.replacementYears);
  assert.ok(I.lost(rec,{variant:'page'}).includes('Not classed: crown under 5 m tall. Crowns under 5 m tall are not banded or compared.'));
}
{
  // 25 m or taller is its own fact (TWB0Q29B, 33.5 m): a row, never the band.
  const rec=b63('TWB0Q29B');
  assert.equal(rec.measures.crownReplacement.text,'40–80 years');
  assert.ok(I.lost(rec,{variant:'page'}).includes('<dt>Tall tree</dt><dd><b>25 m or taller</b>'));
}
// Every 6.3 record: the cards, the bar and the popover use the height-class words only; "veteran" stays for field records.
for(const n of Object.keys(F63.trees)){
  const rec=b63(n);
  for(const keys of [P.KEYS,PAGE_KEYS])clean(I.strip(rec,keys),`${n} 6.3 cards`);
  for(const k of ['lifeStage','crownReplacement'])if(rec.measures[k])clean(I.provenance(rec.measures[k],rec),`${n} 6.3 ${k} provenance`);
  clean(I.lost(rec,{variant:'page'}),`${n} 6.3 lost`);
}
// The full record names the size dataset's stored keys.
{
  const schema={datasets:[{key:'size',table:'tree_size_class_v63',title:'Height class and crown replacement time',evidence:'LiDAR',note:'x'}]};
  const html=D.render(schema,{datasets:{size:F63.trees.TW3DESRB.record.datasets.size}});
  assert.ok(html.includes('<span class="pp-value">Small</span>')&&html.includes('<span class="pp-value">Not classed</span>')&&html.includes('<span class="pp-value">Crown under 5 m tall</span>'),html);
  clean(html,'6.3 size dataset');
}

// ---- Area: the composition chart ----
{
  const feats=['juvenile','young','young','semi-mature','mature','mature','mature','veteran'].map((k,i)=>({properties:{tree_id:'akl_tree_x'+i,source_primary:'lidar_pointcloud_v5',crown_area_m2:10,crown_max_chm_m:12,life_stage:k},geometry:{type:'Point',coordinates:[174.7,-36.8]}}));
  const h=A.render(A.summarise(feats),{kind:'view',title:'x',sample:false});
  const cardHtml=h.split('<section class="area-card">').find(x=>x.includes('Map markers by height class'));
  assert.ok(cardHtml&&cardHtml.startsWith('<h3>Height class <span class="badge-estimate">Estimate</span></h3>'),'the card is "Height class", marked Estimate');
  assert.deepEqual([...cardHtml.matchAll(/text-anchor="middle">([^<]+)<\/text>/g)].map(m=>m[1]).filter(t=>!/^\d+$/.test(t)),['Very small','Small','Medium','Large','Very large']);
  assert.ok(cardHtml.includes('data-highlight="stage:large" data-label="Large height class (3)"'),'a column rings its trees, by the class key');
  assert.ok(cardHtml.includes('Height as a share of the class reference height: very small under 18%, small 18–35%, medium 35–60%, large 60–90%, very large 90% or more.'));
  clean(cardHtml,'Area card');
  assert.deepEqual(A.highlightExpr('stage','veteran'),['any',['==',['get','height_class'],'very_large'],['==',['get','life_stage'],'veteran']],'the map expression reads the field either release stores');
  assert.deepEqual(A.highlightExpr('stage','large'),['any',['==',['get','height_class'],'large'],['==',['get','life_stage'],'mature']]);
  const region=A.render({count:0},{kind:'region',title:'Auckland',totals:{markers:1}});
  assert.ok(region.includes('composition by source, height class and species'));
  clean(region,'Area region');
}

// ---- Every stored field: the stored value, named by its class ----
{
  const schema={datasets:[{key:'assets',table:'assets',title:'Size estimates',evidence:'Estimate',note:'x'},{key:'roots',table:'roots',title:'Root space',evidence:'Estimate',note:'x'}]};
  const html=D.render(schema,{datasets:{assets:{life_stage:'veteran'},roots:{life_stage:'semi-mature'}}});
  assert.ok(html.includes('<span class="pp-label">Height class</span><span class="pp-value">Very large <small class="pp-sub">(stored as veteran)</small></span>'),html);
  assert.ok(html.includes('Medium <small class="pp-sub">(stored as semi-mature)</small>'));
  assert.ok(html.includes('title="assets.life_stage"'),'the stored field name stays');
  assert.ok(D.render(schema,{datasets:{assets:{life_stage:'unknown_class'}}}).includes('<span class="pp-value">unknown_class</span>'),'an unknown stored value shows as stored');
}

// ---- Pictures and interface sources ----
assert.match(V.stageScale('veteran'),/aria-label="Height class scale; this tree: Very large"[\s\S]*aria-current="true"><b>Very large<\/b><span>90% or more/);
assert.ok(!('STAGES' in V),'one table: tree-summary.js HEIGHT_CLASS');
// No interface source names a life stage. Stored keys ('juvenile', 'semi-mature', 'veteran') appear only as the keys of
// tree-summary.js HEIGHT_CLASS; "life stage" (with a space), the capitalised class names and "Juv." appear nowhere.
for(const f of fs.readdirSync(web).filter(f=>/\.(js|mjs|html)$/.test(f))){
  const src=fs.readFileSync(web+f,'utf8');
  const hit=src.match(/[Ll]ife stage|Juvenile|Juv\.|Semi-mature|Veteran|'Mature'|'Young'/);
  assert.ok(!hit,`${f}: "${hit&&hit[0]}"`);
  if(f!=='tree-summary.js')assert.ok(!/['"`](juvenile|semi-mature|veteran)['"`]/.test(src),`${f}: a stored life_stage key outside tree-summary.js`);
}
console.log(`height class checks passed (TS-07): one table, ${checked} release 6.2 records, panel and page cards, provenance, Area, stored fields and sources`);
