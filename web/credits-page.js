/* Sources and credits (credits.html): the page names the aerial basemap this build shows. credits.js decides it (Esri
 * World Imagery, or LINZ Basemaps where basemap-config.js switches it on for the build's channel and holds LINZ's key);
 * the entry for the other one is hidden. Without scripts the page names Esri World Imagery, the public site's. */
(function(root){
  'use strict';
  const provider=root.ALTOCredits?.AERIAL?.provider||'esri';
  for(const li of root.document?.querySelectorAll?.('[data-aerial]')||[])li.hidden=li.dataset.aerial!==provider;
  // A source a data release first uses (data-from-release="6.3") is listed once that release is live: the page reads the
  // site's release metadata and hides the row while an earlier release is live. Without scripts, or when the metadata
  // cannot be read, every row stays listed.
  const rows=[...(root.document?.querySelectorAll?.('[data-from-release]')||[])];
  if(rows.length&&typeof root.fetch==='function'){
    const site=String(root.ALTO_SITE_ROOT||'.').replace(/\/$/,'');
    root.fetch(`${site}/release-metadata.json`,{credentials:'same-origin'}).then(r=>r.ok?r.json():null).then(m=>{
      const r=m?.release||{},v=/v(\d+(?:\.\d+)?)\s*$/.exec(String(r.data_release||r.dataset_version||''));if(!v)return;
      for(const li of rows)li.hidden=Number(v[1])<Number(li.dataset.fromRelease);
    }).catch(()=>{});
  }
})(typeof globalThis==='undefined'?window:globalThis);
