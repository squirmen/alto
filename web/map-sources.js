/* ALTOMapSources: one factory for the sources of the map and of the tree page's inset map (FE-16): the basemaps
 * (the aerial imagery set in basemap-config.js and credited by credits.js, Esri's light grey canvas, OpenStreetMap)
 * and the release's versioned PMTiles archives, so both maps read the same files with the same cache stamp.
 *   const S = ALTOMapSources.create({ dataBase: './data', version: () => TILE_VERSION });
 *   S.archive('trees_map_points')        -> pmtiles://./data/trees_map_points.pmtiles?v=<stamp>
 *   S.archive('tree_change_v1', {rev})    -> ...?v=<stamp>&rev=<rev> (a file replaced within one release)
 *   S.versioned('./data/x.json')          -> ./data/x.json?v=<stamp> (other data files)
 *   S.raster.aerial({maxzoom: 20}), S.raster.lightBase(), S.basemaps() -> MapLibre source and basemap definitions.
 * The version may be a function: the map reads its stamp from the release metadata after it starts ("auto"). */
(function(root){
  'use strict';
  const ESRI='https://server.arcgisonline.com/ArcGIS/rest/services';
  const OSM_TILES='https://tile.openstreetmap.org/{z}/{x}/{y}.png';
  function create({dataBase='./data',version=null,credits=null}={}){
    const CR=credits||root.ALTOCredits||{},MAP=CR.MAP||{};
    const base=String(dataBase).replace(/\/+$/,'');
    const stamp=()=>String(typeof version==='function'?version():version);
    const versioned=u=>`${u}?v=${stamp()}`;
    const archive=(name,{rev=null}={})=>`${versioned(`pmtiles://${base}/${name}.pmtiles`)}${rev?`&rev=${rev}`:''}`;
    const raster={
      // The aerial imagery: Esri World Imagery (Auckland Council's imagery in Auckland) or LINZ Basemaps, as configured.
      aerial:(extra={})=>CR.aerialSource?CR.aerialSource(extra):{type:'raster',tiles:[`${ESRI}/World_Imagery/MapServer/tile/{z}/{y}/{x}`],tileSize:256,...extra},
      aerialLabels:()=>({type:'raster',tiles:[`${ESRI}/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}`],tileSize:256,attribution:MAP.esriLabels}),
      lightBase:()=>({type:'raster',tiles:[`${ESRI}/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}`],tileSize:256,maxzoom:16,attribution:MAP.esriLight}),
      lightLabels:()=>({type:'raster',tiles:[`${ESRI}/Canvas/World_Light_Gray_Reference/MapServer/tile/{z}/{y}/{x}`],tileSize:256,maxzoom:16,attribution:MAP.esriLabels}),
      // OpenStreetMap's own tile server only (OSMF tile usage policy).
      osm:(extra={})=>({type:'raster',tiles:[OSM_TILES],tileSize:256,maxzoom:19,attribution:MAP.osm,...extra}),
    };
    // The map's four basemaps, keyed as the basemap switcher and the address (?basemap=) name them.
    function basemaps(){
      return {
        hybrid:{label:'Hybrid',title:'Aerial imagery with street/place labels — best for crown validation.',
          sources:{'esri-imagery':raster.aerial(),'esri-labels':raster.aerialLabels()},
          layers:[{id:'basemap-imagery',type:'raster',source:'esri-imagery'},{id:'basemap-labels',type:'raster',source:'esri-labels',paint:{'raster-opacity':0.85}}]},
        satellite:{label:'Satellite',title:'Aerial only — cleanest view of canopy.',
          sources:{'esri-imagery':raster.aerial()},
          layers:[{id:'basemap-imagery',type:'raster',source:'esri-imagery'}]},
        light:{label:'Light',title:'Light grey background — highest contrast for analytical overlays.',
          sources:{'esri-light-base':raster.lightBase(),'esri-light-labels':raster.lightLabels(),'osm-street-names':raster.osm({minzoom:16})},
          layers:[{id:'basemap-light-base',type:'raster',source:'esri-light-base'},{id:'basemap-light-labels',type:'raster',source:'esri-light-labels'},
            // The Light basemap's labels stop at zoom 16: from 16.5 the map shows OpenStreetMap's streets, which name every
            // street at street zoom (the map's autoStreets), and says so.
            {id:'basemap-light-streets',type:'raster',source:'osm-street-names',minzoom:16,layout:{visibility:'none'}}]},
        streets:{label:'Streets',title:'OpenStreetMap streets and places.',
          sources:{osm:raster.osm()},
          layers:[{id:'basemap-osm',type:'raster',source:'osm'}]},
      };
    }
    return {dataBase:base,stamp,versioned,archive,raster,basemaps};
  }
  const api={create,ESRI,OSM_TILES};
  root.ALTOMapSources=api;
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof globalThis==='undefined'?window:globalThis);
