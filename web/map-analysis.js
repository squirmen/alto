/* Pure analysis helpers shared by the map and offline regression checks. */
(function (root) {
  const number = value => {
    if (value === null || value === undefined || value === "" || typeof value === "boolean") return null;
    const n = Number(value); return Number.isFinite(n) ? n : null;
  };
  const flag = value => value === true || value === 1 || value === "1";
  function uniqueTrees(features) {
    const seen = new Set();
    return features.filter(feature => {
      const id = feature.properties?.tree_id;
      if (!id || seen.has(id)) return false;
      seen.add(id); return true;
    });
  }
  function summarise(features) {
    const trees = uniqueTrees(features);
    const s = {count: trees.length, crownArea: 0, crownCount: 0, heightCount: 0,
      meanHeight: null, speciesCount: 0, protectedCount: 0, confirmedCount: 0,
      noPointcloudCount: 0, topSpecies: null};
    let heightSum = 0; const species = new Map(), labels = new Map(), commonTaxa = new Map();
    const name = v => typeof v==='string' && !/^(unknown|unidentified|not known|species not recorded|0 records found\.|n\/a|none|null)?$/i.test(v.trim()) ? v.trim().replace(/\s+/g,' ') : null;
    const key = v => v.toLocaleLowerCase('en-NZ');
    // A common-only record can join a botanical label only when its common
    // name maps to one botanical taxon among these records.
    for(const {properties:p} of trees){
      const latin=name(p.species_latin),common=name(p.species_common);
      if(latin&&common){const k=key(common);if(!commonTaxa.has(k))commonTaxa.set(k,new Set());commonTaxa.get(k).add(key(latin));}
    }
    for (const {properties: p} of trees) {
      const area = number(p.crown_area_m2);
      const height = number(p.height_max_m) ?? number(p.crown_max_chm_m);
      if (area !== null && area > 0) { s.crownArea += area; s.crownCount++; }
      if (height !== null && height >= 0) { heightSum += height; s.heightCount++; }
      if (flag(p.is_protected_notable)) s.protectedCount++;
      if (flag(p.pc_canopy_present)||p.crown_source==='v5') s.confirmedCount++;
      if (p.pointcloud_class === "no_data") s.noPointcloudCount++;
      const latin=name(p.species_latin),common=name(p.species_common);
      const candidates=common?commonTaxa.get(key(common)):null;
      const botanical=latin?key(latin):candidates?.size===1?[...candidates][0]:null;
      const taxon=botanical?'latin:'+botanical:common?'common:'+key(common):null;
      if(taxon){species.set(taxon,(species.get(taxon)||0)+1);const label=common||latin,previous=labels.get(taxon);
        if(!previous||common&&!previous.common||!!common===previous.common&&label.localeCompare(previous.label)<0)labels.set(taxon,{label,common:!!common});}
    }
    s.meanHeight = s.heightCount ? heightSum / s.heightCount : null;
    s.speciesCount = species.size;
    const top=[...species].sort((a,b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0];
    s.topSpecies = top ? labels.get(top).label : null;
    return s;
  }
  const api = {number, flag, uniqueTrees, summarise};
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.ALTOAnalysis = api;
})(globalThis);
