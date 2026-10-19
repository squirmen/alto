/* FE-03: the release metadata, then the two lookup schemas (tree numbers, tree details), start here, before the tree
 * page's scripts arrive; the page's lookups take them by URL from window.ALTO_PREFETCH. tree.html loads this file
 * straight after site-config.js (it ran inline until tool 0.2.9; FE-15). */
  (function(){
    var site=(window.ALTO_SITE_ROOT||'.').replace(/\/+$/,''),data=(window.AKL_DATA_BASE||'./data').replace(/\/+$/,''),got={};
    var meta=site+'/release-metadata.json';
    got[meta]=fetch(meta,{credentials:'same-origin'});  // the host keeps it fresh for a minute (FE-04)
    got[meta].then(function(r){return r.ok?r.clone().json():null;}).then(function(m){
      if(!m)return;
      var tv=window.AKL_TILE_VERSION,v=tv&&tv!=='auto'?tv:(m.assembly&&m.assembly.tile_version)||(m.release&&m.release.dataset_version);
      if(!v)return;
      var q='?v='+encodeURIComponent(v),ids=m.derived_products&&m.derived_products.tree_ids,urls=[data+'/tree_details/schema.json'+q];
      if(ids)urls.push(data+'/'+String(ids).replace(/^data\//,'').replace(/\/schema\.json$/,'')+'/schema.json'+q);
      urls.forEach(function(u){if(!got[u])got[u]=fetch(u);});
    }).catch(function(){});
    window.ALTO_PREFETCH={take:function(u){var p=got[u]||null;delete got[u];return p;}};
  })();
