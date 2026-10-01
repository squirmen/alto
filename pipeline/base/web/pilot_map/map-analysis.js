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
    let heightSum = 0; const species = new Map();
    for (const {properties: p} of trees) {
      const area = number(p.crown_area_m2);
      const height = number(p.height_max_m) ?? number(p.crown_max_chm_m);
      if (area !== null && area > 0) { s.crownArea += area; s.crownCount++; }
      if (height !== null && height >= 0) { heightSum += height; s.heightCount++; }
      if (flag(p.is_protected_notable)) s.protectedCount++;
      if (flag(p.pc_canopy_present)) s.confirmedCount++;
      if (p.pointcloud_class === "no_data") s.noPointcloudCount++;
      const name = p.species_common?.trim();
      if (name && name.toLowerCase() !== "unknown") species.set(name, (species.get(name) || 0) + 1);
    }
    s.meanHeight = s.heightCount ? heightSum / s.heightCount : null;
    s.speciesCount = species.size;
    s.topSpecies = [...species].sort((a,b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] || null;
    return s;
  }
  const api = {number, flag, uniqueTrees, summarise};
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.ALTOAnalysis = api;
})(globalThis);
