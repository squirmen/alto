// Offline checks for tool 0.2.12, release 6.3 Schedule 10 entries and reviewer notes (P5): the entry whose Council point
// a tree holds is shown as the July 2026 schedule lists it, a multi-tree entry whose points ALTO maps on one crown says
// so (item 866), item 1186 reads its two trees and address; a reviewer's note from the ledger (tree_note, SKP-10 A) is
// shown in its own words and the field visit reads its history line; corrections read the receipt's public summary in
// tree numbers (FTA-09). Release 6.2 records carry none of these datasets.
// Usage: node pipeline/tool/test_schedule_v63.cjs
'use strict';
const assert=require('node:assert/strict');
const path=require('node:path');
const web=path.join(__dirname,'..','..','web')+'/';
globalThis.window=globalThis;
for(const f of ['alto-format.js','release-fields.js','palette.js','version.js','tree-id.js','sources.js','growth-form.js','record-links.js','tree-summary.js','alto-viz.js','tree-details.js','species-names.js','credits.js'])require(web+f);
const R=require(web+'tree-record.js'),I=require(web+'tree-instrument.js');
const F62=require('./fixtures/tree-records-v62.json'),F63=require('./fixtures/tree-records-v63.json');
const build=(F,n)=>{const t=F.trees[n];return R.assemble({id:t.id,record:t.record,schema:F.schema,members:t.members,memberCount:t.memberCount,metadata:F.metadata,env:{siteRoot:'.',dataBase:'./data',metadata:F.metadata}});};
const visible=h=>h.replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim();
const SCH10='https://unitaryplan.aucklandcouncil.govt.nz/images/Auckland%20Unitary%20Plan%20Operative/Chapter%20L%20Schedules/Schedule%2010%20Notable%20Trees%20Schedule.pdf';

{
  const rec=build(F63,'TZ69KK1G'),l=rec.lines.filter(x=>x.key==='schedule_entry');
  assert.equal(l.length,1);
  assert.deepEqual([l[0].label,l[0].text],['Schedule 10 entry','Item 866 lists 2 trees (pōhutukawa); both Council points for this item lie on this crown; ALTO maps one crown here.']);
  assert.deepEqual(l[0].links,[{text:'Schedule 10',href:SCH10}]);
  assert.ok(visible(I.releaseLines(rec)).includes('Schedule 10 entry · Item 866 lists 2 trees (pōhutukawa)'));
}
{
  const l=build(F63,'TMCTT6X4').lines.find(x=>x.key==='schedule_entry');
  assert.equal(l.text,'Item 1186: 2 trees (oak, coral tree), 18 Kerr Street, Devonport.');
}
// The reviewer note on T162DYHP (SKP-10 A): the note's text, its date, and the field visit's history line; no claim that a
// visit confirmed a notable tree.
{
  const rec=build(F63,'T162DYHP'),n=rec.lines.find(x=>x.key==='note');
  assert.equal(n.text,"Council's Notable Trees Overlay point for Schedule 10 item 1186 (2 trees: oak, coral tree) lies at this tree; ALTO links the entry to TMCTT6X4 (correction C00001). Whether this is the second scheduled tree has not been established. (17 Oct 2026)");
  // What the page shows: the lines and each review's summary (the ledger's own summary, which quotes the wording it
  // replaced, stays in the record and the receipt only).
  const all=JSON.stringify([rec.lines,rec.corrections.items.map(x=>[x.kind,x.summary])]);
  assert.ok(!/confirmed this notable tree/i.test(all),'the old wording is gone');
  assert.ok(rec.corrections.items.some(x=>x.kind==='ground visit'||/A field visit found a tree at the Council point\./.test(x.summary||'')),'the visit reads the history line');
  assert.ok(rec.corrections.items.some(x=>x.id==='C00355'),'the note’s correction');
  assert.ok(!/kyte_visit:/.test(all),'no visit identifiers');
}
// FTA-09: corrections in tree numbers and plain names (TMCTT6X4 cites T162DYHP by number).
{
  const items=build(F63,'TMCTT6X4').corrections.items.filter(x=>x.id);
  assert.ok(items.length>=3);
  assert.ok(items.some(x=>/T162DYHP/.test(x.summary)),'cites T162DYHP by number');
  for(const x of items){assert.ok(!/akl_tree_|\bDPS\b/.test(x.summary),`${x.id}: ${x.summary}`);assert.ok(x.summaryAsRecorded===null||typeof x.summaryAsRecorded==='string');}
}
// Release 6.2: no schedule entry, note or licence lines.
for(const n of Object.keys(F62.trees))assert.ok(!build(F62,n).lines.some(l=>['schedule_entry','note'].includes(l.key)),n);
console.log('schedule checks passed (tool 0.2.12, P5): Schedule 10 entries as the schedule lists them, the multi-tree note, reviewer notes, public summaries');
