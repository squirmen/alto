/* V5.2 record-to-crown links: where a source recorded a tree, and the crown ALTO joined it to.
 *
 * The Council recorded positions layer reads data/council_positions.pmtiles (layer
 * council_positions): a point at each linked record's original source position and a line from it
 * to the top of its crown. It is off by default and is added to the map the first time it is
 * switched on. Its switch appears only when release-metadata.json lists the file, so a release
 * without it looks exactly as before.
 *
 * Tree tiles and full records carry the link from v5.2 on: link_class (linked, probable,
 * drawn_from_record), link_evidence (one sentence, with the distance from the crown edge),
 * link_edge_m, and crown_source "record_seeded_v52" with display_style "faint" for crowns drawn
 * from a record. Records and tiles without these fields render nothing here. */
(function(root){
  'use strict';
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const num=v=>v===null||v===undefined||v===''?null:(Number.isFinite(Number(v))?Number(v):null);
  const metres=v=>new Intl.NumberFormat('en-NZ',{minimumFractionDigits:1,maximumFractionDigits:1}).format(v);

  const SEEDED='record_seeded_v52';
  const SOURCE='akl-council-positions';
  const LAYER_IDS=['council-position-lines-casing','council-position-lines','council-positions'];
  const NOTE='Where the Council or other source recorded the tree, joined to the crown ALTO found it on.';
  const COLOUR='#c46a12';
  // The package's evidence sentences, so a tile that carries only the class reads the same.
  const edgeText=d=>d===null?'':` (${metres(d)} m from the crown edge)`;
  const CLASS={
    linked:{title:'Linked to a LiDAR crown',short:'linked',
      text:d=>`Linked to its LiDAR crown by position${edgeText(d)}`,
      note:'ALTO matched this record to the crown from its recorded position, the size expected for its species and the other records nearby.'},
    probable:{title:'Probable crown match',short:'probable match',
      text:d=>`Probable match to this LiDAR crown${edgeText(d)}`,
      note:'The most likely crown on the same evidence, with less certainty than a linked match.'},
    drawn_from_record:{title:'Crown drawn from the record',short:'crown drawn from the record',
      text:()=>'Crown drawn from the LiDAR returns at this record\'s position; awaiting confirmation',note:null}
  };
  const STATUS_CLASS={linked_high:'linked',linked_medium:'probable',linked_new_crown:'drawn_from_record'};
  const SOURCE_LABEL={tree_register_points:'The Council tree register',notable_trees_overlay:'The Notable Trees overlay',
    ruru_obskauri_tiaki_public:'The kauri survey (RŪRU)',osm_natural_tree:'OpenStreetMap'};

  // The link a tree carries, from its full record when loaded and otherwise from its map tile.
  function link(props,record){
    const d=record?.datasets||{},r=d.record_link||{},p=props||{};
    const raw=r.link_class||p.link_class||null,cls=CLASS[raw]?raw:null;
    const style=r.display_style||d.crown?.display_style||p.display_style||null;
    const seeded=(r.crown_source||d.crown?.crown_source||p.crown_source)===SEEDED||style==='faint'||cls==='drawn_from_record';
    if(!cls&&!seeded)return null;
    const edge=num(r.edge_distance_m??p.link_edge_m);
    const text=r.link_evidence||r.evidence_text||p.link_evidence||(cls?CLASS[cls].text(edge):null);
    return {cls,text,edge,seeded};
  }
  function render(l){
    if(!l)return '';
    const c=CLASS[l.cls]||CLASS.drawn_from_record;
    let html=`<section class="pp-section record-link" data-link-class="${esc(l.cls||'drawn_from_record')}"><div class="pp-section-title">${esc(c.title)}</div>`;
    if(l.text)html+=`<p class="record-link-evidence">${esc(l.text)}</p>`;
    if(l.seeded)html+='<p class="record-link-note"><strong>Drawn from the record, awaiting confirmation.</strong> No v5 crown covered this tree, so ALTO drew one from the 2024 laser returns at the recorded position. The map shows it faintly until it is confirmed.</p>';
    else if(c.note)html+=`<p class="record-link-note">${esc(c.note)}</p>`;
    if(l.cls)html+='<p class="pp-note">The source’s own position is kept: switch on Council recorded positions in Layers to see it.</p>';
    return html+'</section>';
  }
  // After the full record loads the link sits directly under the evidence summary.
  function mount(container,record,props){
    const html=render(link(props,record)),summary=container.querySelector('.evidence-summary');
    if(html&&summary)summary.insertAdjacentHTML('afterend',html);
  }
  function tip(p){
    const c=CLASS[STATUS_CLASS[p.status]],d=num(p.distance_m),kind=c?` (${esc(c.short)})`:'';
    const joined=d===null?` ALTO joined it to a crown${kind}.`:` ALTO joined it to the crown whose top is ${metres(d)} m away${kind}.`;
    return `<div class="popup-title">Recorded position</div><p>${esc(SOURCE_LABEL[p.source]||'The source')} recorded the tree here.${joined}</p>`+
      '<p class="pp-note">Click or tap for the tree’s profile.</p>';
  }
  function layers(){
    const base={source:SOURCE,'source-layer':'council_positions',minzoom:13,layout:{visibility:'none'}};
    const lines=['==',['geometry-type'],'LineString'],width=['interpolate',['linear'],['zoom'],13,0.8,18,1.7];
    return [
      {...base,id:'council-position-lines-casing',type:'line',filter:lines,layout:{visibility:'none','line-cap':'round'},
        paint:{'line-color':'#ffffff','line-width':['interpolate',['linear'],['zoom'],13,2,18,3.6],'line-opacity':0.55}},
      {...base,id:'council-position-lines',type:'line',filter:lines,layout:{visibility:'none','line-cap':'round'},
        paint:{'line-color':COLOUR,'line-width':width,'line-dasharray':[2,1.6],'line-opacity':0.95}},
      {...base,id:'council-positions',type:'circle',filter:['==',['geometry-type'],'Point'],
        paint:{'circle-radius':['interpolate',['linear'],['zoom'],13,2,16,3.5,18,5.5],'circle-color':'rgba(255,255,255,0.3)',
          'circle-stroke-color':COLOUR,'circle-stroke-width':['interpolate',['linear'],['zoom'],13,1,18,1.8]}}
    ];
  }

  let opts=null,popup=null;
  // The release metadata lists the layer among its artifacts (or derived products) once a release
  // ships it; only then does the switch appear. No request is made for a file that is not there.
  const FILE='data/council_positions.pmtiles';
  function shipped(metadata){
    return !!metadata&&((metadata.artifacts||[]).some(a=>a?.path===FILE)||metadata.derived_products?.council_positions===FILE);
  }
  function release(metadata){if(opts&&shipped(metadata))opts.toggle.hidden=false;}
  // opts: map, url (pmtiles:// source url), before (layer id the overlay sits under), yieldTo
  // (layers that keep a click), open(properties), toggle, note.
  function init(o){
    opts=o;const map=o.map;
    const clear=()=>popup?.remove();
    map.on('mousemove','council-positions',e=>{
      const f=e.features?.[0];if(!f)return;
      map.getCanvas().style.cursor='pointer';
      if(!root.maplibregl)return;
      popup=popup||new root.maplibregl.Popup({closeButton:false,closeOnClick:false,offset:10,maxWidth:'260px',className:'council-position-tip'});
      popup.setLngLat(f.geometry.coordinates).setHTML(tip(f.properties));
      if(!popup.isOpen())popup.addTo(map);
    });
    map.on('mouseleave','council-positions',()=>{map.getCanvas().style.cursor='';clear();});
    map.on('click','council-positions',e=>{
      const f=e.features?.[0];if(!f?.properties?.tree_id)return;
      clear();
      // A tree marker at the same spot keeps the click.
      const yields=(o.yieldTo||[]).filter(id=>map.getLayer(id));
      if(yields.length&&map.queryRenderedFeatures(e.point,{layers:yields}).length)return;
      o.open(f.properties);
    });
  }
  // Adds the source and layers on first use (again after a basemap change) and sets visibility.
  function apply(map,on){
    if(!opts)return;
    opts.note.hidden=!on;
    if(on&&!map.getSource(SOURCE)){
      try{
        map.addSource(SOURCE,{type:'vector',url:opts.url});
        const before=map.getLayer(opts.before)?opts.before:undefined;
        for(const layer of layers())map.addLayer(layer,before);
      }catch(err){return;}// the style is still loading; the next apply adds them
    }
    for(const id of LAYER_IDS)if(map.getLayer(id))map.setLayoutProperty(id,'visibility',on?'visible':'none');
    if(!on&&popup)popup.remove();
  }
  const api={SEEDED,NOTE,FILE,LAYER_IDS,CLASS,STATUS_CLASS,link,render,mount,tip,layers,shipped,release,init,apply};
  root.ALTORecordLinks=api;
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof globalThis==='undefined'?window:globalThis);
