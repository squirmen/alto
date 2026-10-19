// Offline checks for the tap path on the map (FE-17): the panel's header paints before the rest renders, a detail
// bucket is parsed one record at a time, and the viewport statistics run in idle time and only while shown.
// Usage: node pipeline/tool/test_tap_path.cjs
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const web=path.join(__dirname,'..','..','web')+'/';
const read=f=>fs.readFileSync(web+f,'utf8');
globalThis.window=globalThis;

// 1. Header first, then a yield, then the rest of the panel.
{for(const f of ['palette.js','version.js','tree-id.js','sources.js','growth-form.js','record-links.js','tree-summary.js','alto-viz.js'])require(web+f);
  const R=require(web+'tree-record.js');require(web+'tree-instrument.js');const P=require(web+'tree-panel.js');
  const FX=require('./fixtures/tree-records-v6dev.json');
  const META={release:{dataset_version:'metro-2026.10.11-pointcloud-v6-dev',dataset_last_updated_utc:'2026-10-11T00:00:00+00:00',status:'research_only_not_independently_validated'},assembly:{tile_version:'20261011-v6-dev'}};
  for(const id of Object.keys(FX.trees)){
    const rec=R.assemble({id,record:FX.trees[id].record,schema:FX.schema,members:FX.trees[id].members,memberCount:FX.trees[id].memberCount,metadata:META,env:{siteRoot:'.',dataBase:'./data',metadata:META}});
    const o={treeUrl:'tree.html?id=X',saved:false,savedCount:0,kyteBase:'./kyte'},head=P.header(rec,o),full=P.render(rec,o);
    assert.ok(head.startsWith('<article class="tp ti-scope"')&&head.endsWith('</article>')&&head.includes('id="tpName"'),`${id}: the header is a whole article with the tree's name`);
    assert.ok(full.startsWith(head.slice(0,-'</article>'.length)),`${id}: the full panel starts with the same header`);
    assert.ok(head.length<full.length/2&&!head.includes('id="tpMetrics"'),`${id}: the header leaves the measurements for later`);
  }
  const app=read('map-app.js'),open=app.slice(app.indexOf('async function openProfile('),app.indexOf('const full = await fullLoad;'));
  const at=s=>open.indexOf(s);
  assert.ok(at('profileBody.innerHTML = ALTOTreePanel.header(quick, panelOptions(quick));')>0,'tap: the header is written first');
  assert.ok(at('ALTOTreeRecord.load(props.tree_id')>at('ALTOTreePanel.header(')&&at('await afterPaint();')>at('ALTOTreeRecord.load(props.tree_id'),'tap: the record is asked for, then the handler yields');
  assert.ok(at('profileBody.innerHTML = panelHtml(quick);')>at('await afterPaint();')&&!open.slice(0,at('await afterPaint();')).includes('panelHtml('),'tap: the panel body (crown outline, figures) renders only after the yield');
  assert.ok(app.includes('const afterPaint = () => new Promise(resolve => requestAnimationFrame(() => setTimeout(resolve, 0)));'),'afterPaint waits for the frame to paint');
  // Nothing inside the tap forces a layout of the page: focus, the panel's scroll and the sheet and attribution
  // placements (MutationObservers on the body) wait for the frame to paint.
  const sync=open.slice(0,at('await afterPaint();')),after=app.slice(app.indexOf('await afterPaint();',app.indexOf('async function openProfile(')),app.indexOf('const full = await fullLoad;'));
  assert.ok(!/\.focus\(|scrollTop\s*=|getBoundingClientRect|offsetHeight/.test(sync),'tap: no focus, scroll or layout read before the paint');
  assert.ok(after.includes('document.getElementById("treeProfileClose").focus({preventScroll: true});')&&after.includes('profileBody.scrollTo({ top: 0, behavior: "instant" });'),'focus and scroll (at once, not smoothly) after the paint');
  assert.ok(app.includes('requestAnimationFrame(() => setTimeout(() => { sheetAfterPaint = false; if (sheetLayout.matches) placeSheet(sheetStop(panelSheet)); }, 0));')
    &&app.includes('requestAnimationFrame(() => setTimeout(() => { placeQueued = false; place(); }, 0)); })'),'sheet and attribution placed after the frame that shows the panel');
}

// 2. A bucket is kept as text; only the record asked for is parsed.
{const D=require(web+'tree-details.js');
  const bucket={akl_tree_a:{record:['x"}]',null,[1,[2,{}]]],services:[2.5]},akl_tree_trp_ACCT1:{record:['he said "akl_tree_b": no']},akl_tree_b:{record:[3]},akl_tree_n:null};
  for(const text of [JSON.stringify(bucket),JSON.stringify(bucket,null,1),JSON.stringify(bucket).replace(/,"akl/g,', "akl').replace(/":\{/g,'": {')]){
    let parsed=0;const realParse=JSON.parse;JSON.parse=(t,...r)=>{parsed+=t.length;return realParse(t,...r);};
    try{
      for(const id of Object.keys(bucket))assert.deepEqual(D.pick({text,parsed:null},id),bucket[id],`${id}: picked from the bucket text`);
      assert.equal(D.pick({text,parsed:null},'akl_tree_zzz'),undefined,'an absent record is absent');
    }finally{JSON.parse=realParse;}
    assert.ok(parsed<text.length,'never the whole bucket parsed for a record');
  }
  assert.deepEqual(D.pick({text:JSON.stringify({'tā_1':[1]}),parsed:null},'tā_1'),[1],'an id that is not plain ASCII: the bucket parsed whole');
  const src=read('tree-details.js');
  assert.ok(src.includes('const url=`${dir}/${bucketPath(id,schema.bucket_algorithm)}${q}`,bucket=await bucketText(url);')&&src.includes('packed=pick(bucket,id)'),'load() picks the record from the bucket text');
}

// 3. Viewport statistics: idle time, and only while a panel shows them.
{const app=read('map-app.js'),f=app.slice(app.indexOf('let statsTimer = null'),app.indexOf('map.on("moveend", scheduleViewportStats);'));
  assert.ok(f.includes('window.requestIdleCallback(fn, { timeout: 1000 })')&&f.includes('statsIdle = idle(() =>'),'statistics run in requestIdleCallback');
  assert.ok(f.includes('document.visibilityState !== "hidden"')&&f.includes('if (!statsShown()) { statsStale = true; return; }'),'statistics are skipped while hidden');
  assert.ok(f.includes('new ResizeObserver(')&&f.includes('document.addEventListener("visibilitychange"'),'and worked out when shown again');
}
console.log('tap path checks passed (header before the rest, one record parsed from a bucket, idle and visible-only viewport statistics)');
