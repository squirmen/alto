/* A small, local comparison workspace; saved IDs always load this release's records. */
(function(root) {
  'use strict';
  const KEY='alto.saved-tree-ids.v1', MAX=4;
  let ids=[], config, dialog, returnFocus, modelDispose;
  function dispose(){if(modelDispose){modelDispose();modelDispose=null;}}
  try{const stored=JSON.parse(localStorage.getItem(KEY)||'[]');if(Array.isArray(stored))ids=[...new Set(stored.filter(x=>typeof x==='string'&&x.length<200))].slice(0,MAX);}catch{}
  function persist(){try{localStorage.setItem(KEY,JSON.stringify(ids));return true;}catch{return false;}}
  function update(){const b=document.getElementById('compareSavedTrees');if(b)b.textContent=`Compare saved trees (${ids.length})`;}
  function init(options){
    config=options;dialog=document.getElementById('treeComparison');
    document.getElementById('compareSavedTrees').addEventListener('click',show);
    document.getElementById('comparisonClose').addEventListener('click',()=>dialog.close());
    dialog.addEventListener('close',()=>returnFocus?.focus({preventScroll:true}));
    update();
    const id=new URL(window.location.href).searchParams.get('tree');
    if(id&&id.length<=200)config.ready.then(async()=>{
      try{const {record}=await config.load(id);const r=record.datasets.record||{};if(Number.isFinite(Number(r.lon))&&Number.isFinite(Number(r.lat))&&r.lon!=null&&r.lat!=null)config.locate([Number(r.lon),Number(r.lat)]);config.open({tree_id:id,...r});}
      catch{const status=document.getElementById('treeLinkStatus');status.hidden=false;status.textContent='The linked tree could not load. Check the link or try reloading the map.';}
    });
  }
  async function show(){
    if(!dialog.open){returnFocus=document.activeElement;dialog.showModal();}
    const body=document.getElementById('comparisonBody');
    body.textContent='Loading saved trees from this release…';
    const version=ids.join('|');
    const results=await Promise.allSettled(ids.map(id=>config.load(id)));
    if(version!==ids.join('|'))return;
    const records=results.filter(r=>r.status==='fulfilled').map(r=>r.value.record);
    body.innerHTML=ALTOEvidence.comparison(records);
    if(results.some(r=>r.status==='rejected')){
      const p=document.createElement('p');p.textContent='Some saved trees could not load. Close and reopen to retry, or remove an unavailable tree: ';body.prepend(p);
      results.forEach((r,i)=>{if(r.status!=='rejected')return;const button=document.createElement('button');button.type='button';button.dataset.removeTree=ids[i];button.textContent='Remove '+ids[i];p.append(button);});
    }
    body.querySelectorAll('[data-remove-tree]').forEach(b=>b.addEventListener('click',()=>{ids=ids.filter(id=>id!==b.dataset.removeTree);persist();update();show();}));
  }
  function bind(container,record,groundPromise){
    dispose();
    const liveReady=groundPromise?Promise.race([groundPromise.catch(()=>null),new Promise(r=>setTimeout(()=>r(null),2500))]):Promise.resolve(null);
    const details=container.querySelector('.tree-model-details'),modelHost=container.querySelector('.tree-model-host');
    const future=container.querySelector('.future-section');
    const futureReady=ALTOFuture.load(config.dataBase,config.version).then(async model=>({model,record:await ALTOFuture.prepare(record,model,config.dataBase,config.version)}));
    details.addEventListener('toggle',async()=>{if(details.open){let model,prepared=record;try{const ready=await futureReady;model=ready.model;prepared=ready.record;}catch{}const live=await liveReady;if(modelHost.isConnected)modelDispose=ALTOTreeModel.mount(modelHost,prepared,model,live)||modelDispose;}});
    container.querySelector('[data-evidence-action="3d"]').addEventListener('click',()=>{details.open=true;details.scrollIntoView({block:'start',behavior:'smooth'});});
    futureReady.then(ready=>{if(future.isConnected)future.innerHTML=ALTOFuture.render(ready.record,ready.model);}).catch(()=>{if(future.isConnected)future.textContent='The height forecast could not load. Earlier canopy records are available below.';});
    const status=container.querySelector('.evidence-status'),save=container.querySelector('[data-evidence-action="save"]');
    if(ids.includes(record.tree_id))save.textContent='Saved for comparison';
    save.addEventListener('click',()=>{
      if(ids.includes(record.tree_id)){show();return;}
      if(ids.length>=MAX){status.textContent='Four trees are saved. Open comparison and remove one to make room.';return;}
      ids.push(record.tree_id);const stored=persist();update();save.textContent='Saved for comparison';status.textContent=stored?'Saved on this browser. Choose another tree, then compare.':'Saved for this session. Browser storage is unavailable.';
    });
    container.querySelector('[data-evidence-action="compare"]').addEventListener('click',show);
    container.querySelector('[data-evidence-action="share"]').addEventListener('click',async()=>{
      const url=new URL(window.location.href);url.searchParams.set('tree',record.tree_id);url.hash='';
      try{await navigator.clipboard.writeText(url.href);status.textContent='Tree link copied.';}
      catch{status.replaceChildren();const label=document.createElement('label');label.textContent='Copy this tree link: ';const input=document.createElement('input');input.readOnly=true;input.value=url.href;label.append(input);status.append(label);input.focus({preventScroll:true});input.select();}
    });
  }
  root.ALTOEvidenceWorkspace={init,bind,dispose};
})(window);
