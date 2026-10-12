/* Tool and data versions are separate things.
 *
 * The tool (this interface: the map, the tree page, their modules) has its own semantic version, set
 * here and nowhere else. The data release (v5.2, v6, ...) is described by release-metadata.json, which
 * ships with the data. Both are shown together as "Data v6 · Tool v0.2.0". See VERSIONING.md. */
(function(root){
  'use strict';
  const TOOL={name:'ALTO',version:'0.2.1',released:null,status:'prototype',
    repository:'https://github.com/squirmen/alto'};
  const LAB={name:'Better Places Lab',url:'https://betterplaces.blogs.auckland.ac.nz',
    affiliation:'Te Pare School of Architecture and Planning, Waipapa Taumata Rau | University of Auckland'};

  // The data release a metadata file describes, e.g. "v6" or "v5.2". A future release_tool can write
  // release.data_release; until then the label is read from dataset_version
  // ("metro-2026.10.10-pointcloud-v5.2" -> v5.2, "...-pointcloud-v6-dev" -> v6 dev).
  function data(metadata){
    const r=metadata?.release||{};
    if(r.data_release)return {label:String(r.data_release).replace(/^v?/,'v'),dev:/dev/i.test(r.data_release),raw:r.dataset_version||null};
    const s=String(r.dataset_version||'');
    const m=s.match(/-v(\d+(?:\.\d+)?)(-dev)?$/i)||s.match(/v(\d+(?:\.\d+)?)/i);
    return m?{label:'v'+m[1],dev:!!m[2]||/dev/i.test(s),raw:s}:{label:null,dev:false,raw:s||null};
  }
  function label(metadata,{long=false}={}){
    const d=data(metadata);
    const dataText=d.label?`Data ${d.label}${d.dev?(long?' (development build)':' dev'):''}`:'Data release unknown';
    return `${dataText} · Tool v${TOOL.version}`;
  }
  // The release as the public interface names it: by its date ("Release 11 Oct 2026"). Its number (5.2, 6)
  // appears only in provenance, About and the methods pages; a development build adds a Preview badge.
  function releaseDate(metadata){
    const r=metadata?.release||{};
    const m=String(r.dataset_version||'').match(/(\d{4})\.(\d{2})\.(\d{2})/);
    const iso=m?`${m[1]}-${m[2]}-${m[3]}`:String(r.dataset_last_updated_utc||'').slice(0,10);
    if(!/^\d{4}-\d{2}-\d{2}$/.test(iso))return null;
    return new Date(iso+'T12:00:00Z').toLocaleDateString('en-NZ',{day:'numeric',month:'short',year:'numeric',timeZone:'UTC'});
  }
  function publicLabel(metadata){
    const date=releaseDate(metadata);
    return {text:`${date?`Release ${date}`:'Release date unknown'} · Tool ${TOOL.version}`,preview:!!data(metadata).dev};
  }
  // One citation string for a tree, a view or the whole map.
  function citation({title='ALTO: Aotearoa Long-term Tree Observatory',treeId=null,url=null,metadata=null,accessed=new Date()}={}){
    const d=data(metadata),year=(metadata?.release?.dataset_last_updated_utc||'').slice(0,4)||String(accessed.getFullYear());
    const day=accessed.toLocaleDateString('en-NZ',{day:'numeric',month:'long',year:'numeric'});
    const what=treeId?`Tree ${treeId}. In ${title}`:title;
    // The release by its date, with its number for exactness (design system: the number belongs in provenance).
    const date=releaseDate(metadata),num=d.label?String(d.label).replace(/^v/,''):null;
    const rel=date?`Release ${date}${num?` (release ${num}${d.dev?', preview':''})`:''}`:num?`Release ${num}${d.dev?' (preview)':''}`:'Release unknown';
    return `Welch, T. F. (${year}). ${what}. ${rel}, tool ${TOOL.version}. ${LAB.name}, University of Auckland.${url?` ${url}`:''} (accessed ${day}).`;
  }
  const api={TOOL,LAB,data,label,releaseDate,publicLabel,citation};
  root.ALTOVersion=api;
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof globalThis==='undefined'?window:globalThis);
