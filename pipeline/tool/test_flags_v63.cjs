// Offline checks for tool 0.2.12, release 6.3 flags (DB-04 height checks, FTA-01 record-and-crown checks): each is
// labelled on the tree page and panel in the data's own words; flagged crowns stay out of rankings ("largest, tallest,
// highest benefit in this view", the mean height, comparisons, the saved-trees comparison's ranking note) while their
// counted values follow the data. Release 6.2 keeps the page's 55 m rule.
// Usage: node pipeline/tool/test_flags_v63.cjs
'use strict';
const assert=require('node:assert/strict');
const path=require('node:path');
const web=path.join(__dirname,'..','..','web')+'/';
globalThis.window=globalThis;
for(const f of ['alto-format.js','release-fields.js','palette.js','version.js','tree-id.js','sources.js','growth-form.js','record-links.js','tree-summary.js','alto-viz.js','tree-details.js','species-names.js'])require(web+f);
const R=require(web+'tree-record.js'),I=require(web+'tree-instrument.js'),P=require(web+'tree-panel.js'),A=require(web+'area.js'),E=require(web+'tree-evidence.js'),MA=require(web+'map-analysis.js');
const F62=require('./fixtures/tree-records-v62.json'),F63=require('./fixtures/tree-records-v63.json');
const build=(F,n)=>{const t=F.trees[n];return R.assemble({id:t.id,record:t.record,schema:F.schema,members:t.members,memberCount:t.memberCount,metadata:F.metadata,env:{siteRoot:'.',dataBase:'./data',metadata:F.metadata}});};
const visible=h=>h.replace(/<(svg|code)[\s\S]*?<\/\1>/g,' ').replace(/<[^>]+>/g,' ').replace(/&amp;/g,'&').replace(/\s+/g,' ');
const line=(rec,key)=>(rec.lines||[]).find(l=>l.key===key)||null;

// ---- Tree pages and panels: the lines, in the data's words ----
{
  const rec=build(F63,'TWB0Q29B'),h=line(rec,'height_check'),l=line(rec,'link_check');
  assert.deepEqual([h.label,h.tone,h.href],['Height to check','warn','./v63-methods.html#height-checks']);
  assert.equal(h.text,'Counted in totals; left out of comparisons, maxima and property tallest tree. Measured height 33.5 m. More than 10 % taller than the credible maximum height for Cordyline australis (20 m).');
  assert.equal(l.label,'Record and crown may be different trees');
  assert.match(l.text,/^LiDAR height at the recorded point 3\.4 m against 33\.5 m for the crown; .*conifer \(91 %\)\.$/);
  const page=visible(I.releaseLines(rec)),panel=visible(P.header?P.header(rec,{treeUrl:'./tree.html?id=TWB0Q29B'}):I.releaseLines(rec,{cls:'ti-lines tp-lines'}));
  assert.ok(page.includes('Height to check · Counted in totals')&&page.includes('Record and crown may be different trees · LiDAR height at the recorded point'),page);
  assert.ok(panel.includes('Record and crown may be different trees'),panel.slice(0,300));
  assert.ok(I.releaseLines(rec).includes('data-tone="warn"'),'a check is marked by its label and a rule, never colour alone');
}
{
  const rec=build(F63,'T6Z3DYC8'),h=line(rec,'height_check');
  assert.deepEqual([h.label,h.text],['Height not plausible','Left out of comparisons, maxima, property tallest tree, estimates and totals. Measured height 79.9 m. Height 55 m or more (Auckland height ceiling); Highest point more than 3 times the crown\'s mean vegetation height.']);
  const q=rec.measures.height;
  assert.deepEqual([q.flag,q.check,q.caution],['tall','implausible',R.HEIGHT_IMPLAUSIBLE_TEXT]);
  assert.equal(I.line(q),'Height 79.9 m · height not plausible (height check): left out of rankings, maxima, estimates and totals');
}
{
  // A height to check keeps its estimates, each carrying the caution (T7GNAD02, 30.4 m on 19 m² of crown).
  const rec=build(F63,'T7GNAD02');
  assert.equal(rec.measures.height.caution,R.HEIGHT_CHECK_TEXT);
  assert.equal(rec.measures.benefits.caution,R.HEIGHT_CHECK_TEXT,'estimates computed from a flagged height say so');
  assert.ok(visible(I.metric(rec,'benefits')).includes('Height 30.4 m · height to check (height check): left out of rankings and maxima'));
  // TTSJF0D9 (35.9 m, no vegetation returns): not plausible below 55 m, from the data's own rule.
  assert.equal(build(F63,'TTSJF0D9').measures.height.check,'implausible');
}
{
  // A record to check (T6WZXT45, kauri survey record: conifer recorded, broadleaf read by the model).
  const l=line(build(F63,'T6WZXT45'),'link_check');
  assert.deepEqual([l.label,l.text],['Record and crown to check','Recorded species is conifer (i-Tree); the growth-form model reads the crown as evergreen broadleaf (85 %).']);
  // No line where the release's checks passed (TZ69KK1G: link ok).
  assert.deepEqual(build(F63,'TZ69KK1G').lines.filter(l=>/check/.test(l.key)),[]);
}
{
  // Release 6.2: no flag in the data; the page's 55 m rule as before (T6Z3DYC8, 79.9 m).
  const rec=build(F62,'T6Z3DYC8');
  assert.deepEqual(rec.lines,[]);
  assert.equal(rec.measures.height.caution,R.TALL_TEXT);
}

// ---- Area: flagged markers never rank; their counted values follow the data ----
{
  const pt=(id,p)=>({properties:{tree_id:id,source_primary:'lidar_pointcloud_v5',...p},geometry:{type:'Point',coordinates:[174.7,-36.8]}});
  const feats=[pt('a',{crown_area_m2:100,crown_max_chm_m:20,benefit_value_nzd_y:50,height_class:'large'}),
    pt('b',{crown_area_m2:300,crown_max_chm_m:33.5,benefit_value_nzd_y:90,hchk:'check',lchk:'likely_different'}),
    pt('c',{crown_area_m2:250,crown_max_chm_m:24,benefit_value_nzd_y:80,lchk:'check'}),
    pt('d',{crown_area_m2:12,crown_max_chm_m:57.2,hchk:'implausible'})];
  const a=A.summarise(feats);
  assert.deepEqual([a.largest.id,a.tallest.id,a.topValue.id],['a','a','a'],'only the unflagged marker ranks');
  assert.equal(a.value,220,'every counted value is summed (a height not plausible carries none)');
  assert.equal(a.crownArea,662);
  assert.deepEqual([a.heightCount,a.meanHeight],[2,22],'flagged heights left out of the mean; a record check keeps its height');
  assert.deepEqual(a.tall.map(t=>[t.id,t.check]),[['d','implausible'],['b','check']]);
  assert.equal(a.flagged,3);
  const h=visible(A.render(a,{kind:'view',title:'x',sample:false}));
  assert.ok(h.includes('Heights flagged by the height check 57.2 m · height not plausible 33.5 m · height to check')&&h.includes('3 markers flagged by the height or record check not ranked'),h.slice(0,900));
  // The map headline's mean height leaves them out the same way.
  const s=MA.summarise(feats,{tallM:55});
  assert.deepEqual([s.heightCount,s.tallCount,s.meanHeight],[2,2,22]);
}
// ---- Saved-trees comparison: a flagged height, said with its check ----
{
  const c=visible(E.comparison([F63.trees.T7GNAD02.record,F63.trees.TZ69KK1G.record]));
  assert.ok(c.includes('height to check (height check)')&&c.includes('flagged height')&&c.includes('A flagged height is one the release’s height check marks not plausible or to check'),c.slice(0,700));
}
console.log('flag checks passed (tool 0.2.12, DB-04 and FTA-01): lines in the data\'s words, out of rankings, values follow the data, release 6.2 unchanged');
