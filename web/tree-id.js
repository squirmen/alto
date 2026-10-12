/* One way in for every tree link: the tree page (tree.html?id=), the map (?tree=) and search.
 *
 * Today a tree is addressed by its release tree_id (akl_tree_…), which is also the key of its detail
 * bucket. A tree-ID audit is defining permanent IDs and an alias table. When a release ships that table
 * its metadata lists it under derived_products.tree_ids (a schema.json next to hashed buckets, the same
 * FNV-1a layout as the tree details), and resolve() looks every input up there first:
 *
 *   bucket row: alias -> [canonical_id, detail_key, status, successor, note]
 *   status: "current" (alias of a live tree), "retired" (successor names the tree that replaced it),
 *           "merged" (successor is the surviving tree), "split" (note explains; successor is the main part)
 *
 * Without the table every well-formed id resolves to itself, so links made now keep working and are
 * upgraded, not broken, when permanent IDs arrive. */
(function(root){
  'use strict';
  const PREFIX='akl_tree_';
  const VALID=/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,190}$/;
  // "akl_tree_trp_ACCT0050811", "trp_ACCT0050811" and " AKL_TREE_trp_ACCT0050811 " all mean one tree.
  function normalise(raw){
    let s=String(raw??'').trim();
    try{s=decodeURIComponent(s);}catch{}
    s=s.replace(/^akl_tree_/i,PREFIX);
    if(!s||!VALID.test(s))return null;
    return s.startsWith(PREFIX)?s:PREFIX+s;
  }
  const short=id=>String(id||'').replace(/^akl_tree_/,'');
  const tables=new Map();
  async function json(url){
    const res=await fetch(url);
    if(!res.ok){const e=new Error(`ID table request failed (${res.status})`);e.status=res.status;throw e;}
    let bytes=new Uint8Array(await res.arrayBuffer());
    if(bytes[0]===31&&bytes[1]===139)bytes=new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer());
    return JSON.parse(new TextDecoder().decode(bytes));
  }
  function aliasTable(metadata){return metadata?.derived_products?.tree_ids||null;}
  async function lookup(id,{base,version,metadata}){
    const path=aliasTable(metadata);
    if(!path||!root.ALTOTreeDetails)return null;
    const dir=String(path).replace(/^data\//,'').replace(/\/schema\.json$/,''),q=`?v=${encodeURIComponent(version||'')}`;
    const key=`${base}/${dir}`;
    if(!tables.has(key))tables.set(key,json(`${key}/schema.json${q}`).catch(e=>{tables.delete(key);throw e;}));
    const schema=await tables.get(key);
    try{
      const pack=await json(`${key}/${root.ALTOTreeDetails.bucketPath(id,schema.bucket_algorithm)}${q}`);
      const row=pack[id];
      if(!row)return null;
      const [canonical,detail,status,successor,note]=row;
      return {canonical,detail,status,successor,note};
    }catch(e){if(e.status===404)return null;throw e;}
  }
  // -> {input, tree_id (detail key), canonical, status, successor, note, resolved_by}
  async function resolve(raw,options={}){
    const id=normalise(raw);
    if(!id)return {input:raw,tree_id:null,canonical:null,status:'invalid',note:'This is not a tree ID ALTO recognises.',resolved_by:'format'};
    let hit=null;
    try{hit=await lookup(id,options);}catch{hit=null;}
    if(hit){
      const target=hit.status==='current'?hit:{...hit,canonical:hit.successor||hit.canonical};
      return {input:raw,tree_id:target.detail||target.canonical,canonical:target.canonical,status:hit.status,successor:hit.successor||null,note:hit.note||null,resolved_by:'alias_table'};
    }
    return {input:raw,tree_id:id,canonical:id,status:'current',successor:null,note:null,resolved_by:'release_tree_id'};
  }
  // Canonical links: the tree page, or the map opened on the tree.
  function url(id,{page='tree',base=null}={}){
    const href=base||(typeof location!=='undefined'?location.href:'https://alto.tfwelch.com/');
    const u=new URL(page==='tree'?'./tree.html':'./',href);
    u.search='';u.hash='';
    u.searchParams.set(page==='tree'?'id':'tree',id);
    return u.href;
  }
  const looksLikeId=s=>/^(akl_tree_)?(trp|not|kau|osm|lid|pc4|pc5|lcp|pcm)_[A-Za-z0-9_]+$/i.test(String(s||'').trim());
  const api={PREFIX,normalise,short,resolve,url,looksLikeId,aliasTable};
  root.ALTOTreeId=api;
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof globalThis==='undefined'?window:globalThis);
