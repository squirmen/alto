/* A small, local comparison workspace; saved IDs always load this release's records. */
(function(root) {
  'use strict';
  const KEY='alto.saved-tree-ids.v1', MAX=4;
  let ids=[], config, dialog, returnFocus;
  try{const stored=JSON.parse(localStorage.getItem(KEY)||'[]');if(Array.isArray(stored))ids=[...new Set(stored.filter(x=>typeof x==='string'&&x.length<200))].slice(0,MAX);}catch{}
  function download(text,type,filename){const url=URL.createObjectURL(new Blob([text],{type}));const a=document.createElement('a');a.href=url;a.download=filename;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
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
    const body=document.getElementById('comparisonBody'), csv=document.getElementById('comparisonCsv'),json=document.getElementById('comparisonJson');
    body.textContent='Loading saved trees from this release…';csv.disabled=json.disabled=true;
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
    csv.disabled=json.disabled=!records.length;
    csv.onclick=()=>download(ALTOEvidence.csv(records),'text/csv;charset=utf-8','alto-tree-comparison.csv');
    json.onclick=()=>download(JSON.stringify({exported_at:new Date().toISOString(),scope:'Explicitly saved individual trees; no area total. Source values and assumptions retained.',records},null,2),'application/json','alto-tree-comparison.json');
  }
  function bind(container,record){
    const details=container.querySelector('.tree-model-details'),modelHost=container.querySelector('.tree-model-host');
    details.addEventListener('toggle',async()=>{if(details.open){let model;try{model=await ALTOFuture.load(config.dataBase,config.version);}catch{}if(modelHost.isConnected)ALTOTreeModel.mount(modelHost,record,model);}});
    container.querySelector('[data-evidence-action="3d"]').addEventListener('click',()=>{details.open=true;details.scrollIntoView({block:'start',behavior:'smooth'});});
    const future=container.querySelector('.future-section');
    ALTOFuture.load(config.dataBase,config.version).then(model=>{if(future.isConnected)future.innerHTML=ALTOFuture.render(record,model);}).catch(()=>{if(future.isConnected)future.textContent='The longitudinal scenario model is unavailable. The stored history remains below.';});
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
  root.ALTOEvidenceWorkspace={init,bind};
})(window);
