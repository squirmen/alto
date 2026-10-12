/* One way in for every tree link: /tree/<number>, the tree page (tree.html?id=), the map (?tree=) and search.
 *
 * From data release v6.1 every map tree has a permanent number: "T" + 6 Crockford base-32 characters + a Luhn
 * mod 32 check character (e.g. T8K5P7T3). It may be typed in any case, with spaces or a hyphen (T8K5-P7T3); I and
 * L read as 1 and O as 0. Numbers are random and never reused. akl_tree_* stays the record ID (the key of a full
 * record); a tree's records all carry its number.
 *
 * The release's alias table (release-metadata derived_products.tree_ids -> data/tree_ids/schema.json, 65,536
 * shards hashed like the tree details) resolves every number, record ID and crown key ever published:
 *
 *   shard row: key -> [canonical number, detail key, status, successor, note, extra]   (trailing nulls omitted)
 *   status: current  the key is the tree, its marker record or its crown
 *           member   a record on the tree's crown without a marker of its own
 *           merged   joined into the tree named by successor (a reviewer correction)
 *           split    divided between the trees in successor (largest share first)
 *           retired  no tree carries it now; successor names a replacement if there is one; extra.p = last position
 *
 * resolve() returns the tree to show: its number (canonical), the record whose full record shows it (tree_id), and
 * what happened to the input. Without the table (releases before v6.1) a well-formed record ID resolves to itself,
 * as before, so links keep working through the change. */
(function(root){
  'use strict';
  const PREFIX='akl_tree_';
  const VALID=/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,190}$/;
  const ALPHABET='0123456789ABCDEFGHJKMNPQRSTVWXYZ';
  const NUMBER=/^T[0-9A-HJKMNP-TV-Z]{7}$/;
  const CROWN_V5=/^pc_[A-Z]{2}\d{2}_\d{4}_\d{4}:\d+\.\d+:\d+\.\d+$/;   // v5 and v5.2 record-seeded crown keys
  const CROWN_V4=/^\d{7}_\d{8}$/;                                     // v4 crown keys (2 x NZTM crown top)
  const FAMILY=/^(akl_tree_)?(trp|not|kau|osm|lid|pc4|pc5|lcp|pcm)_[A-Za-z0-9_]+$/i;
  const PUBLIC_ORIGIN='https://alto.tfwelch.com';

  // ---- numbers
  const value=c=>ALPHABET.indexOf(c);
  function luhn(chars,startFactor){
    let factor=startFactor,total=0;
    for(let i=chars.length-1;i>=0;i--){const a=factor*value(chars[i]);factor=factor===2?1:2;total+=Math.floor(a/32)+a%32;}
    return total;
  }
  const checkChar=payload=>ALPHABET[(32-luhn(payload,2)%32)%32];
  const validNumber=n=>NUMBER.test(n)&&luhn(n.slice(1),1)%32===0;
  // -> {number, problem}: any case, spaces and hyphens ignored, I/L read as 1 and O as 0, check character verified.
  function parseNumber(raw){
    const s=String(raw??'').replace(/[\s-]/g,'').toUpperCase();
    if(s.length!==8||s[0]!=='T')return {number:null,problem:'not a tree number'};
    const body=s.slice(1).replace(/[IL]/g,'1').replace(/O/g,'0');
    if(!/^[0-9A-HJKMNP-TV-Z]{7}$/.test(body))return {number:null,problem:'not a tree number'};
    const n='T'+body;
    return validNumber(n)?{number:n,problem:null}:{number:null,problem:'The check character does not match: is a character mistyped?'};
  }
  const isNumber=s=>!!parseNumber(s).number;
  // Typed like a number, valid or not: T and 7 letters or digits with at least one digit (spaces and hyphens
  // ignored), so 8-letter words such as Takapuna or Tanekaha are left to the place and species search.
  const isNumberShaped=s=>{const t=String(s??'').replace(/[\s-]/g,'').toUpperCase();return /^T[0-9A-Z]{7}$/.test(t)&&/\d/.test(t);};
  // The well-formed numbers one keystroke from a mistyped one: one character changed (exactly one per position
  // passes the check) or two neighbours swapped. Empty for a valid number or anything not typed like one.
  function nearNumbers(raw){
    const s=String(raw??'').replace(/[\s-]/g,'').toUpperCase();
    if(s.length!==8||s[0]!=='T')return [];
    const body=s.slice(1).replace(/[IL]/g,'1').replace(/O/g,'0');
    if(!/^[0-9A-HJKMNP-TV-Z]{7}$/.test(body)||validNumber('T'+body))return [];
    const out=new Set();
    for(let i=0;i<7;i++)for(const c of ALPHABET){if(c===body[i])continue;const n='T'+body.slice(0,i)+c+body.slice(i+1);if(validNumber(n))out.add(n);}
    for(let i=0;i<6;i++){if(body[i]===body[i+1])continue;const n='T'+body.slice(0,i)+body[i+1]+body[i]+body.slice(i+2);if(validNumber(n))out.add(n);}
    return [...out];
  }

  // ---- IDs
  // "akl_tree_trp_ACCT0050811", "trp_ACCT0050811" and " AKL_TREE_trp_ACCT0050811 " all mean one record; a number is
  // returned in its canonical form; crown keys pass through as published.
  function normalise(raw){
    let s=String(raw??'').trim();
    try{s=decodeURIComponent(s);}catch{}
    const p=parseNumber(s);
    if(p.number)return p.number;
    if(/^The check/.test(p.problem||''))return null;   // number-shaped but mistyped: never guess a record ID from it
    if(CROWN_V5.test(s)||CROWN_V4.test(s))return s;
    s=s.replace(/^akl_tree_/i,PREFIX);
    if(!s||!VALID.test(s))return null;
    return s.startsWith(PREFIX)?s:PREFIX+s;
  }
  const kindOf=key=>!key?null:NUMBER.test(key)?'number':CROWN_V5.test(key)?'crown_key':CROWN_V4.test(key)?'crown_key_v4':key.startsWith(PREFIX)?'record':'other';
  const short=id=>String(id||'').replace(/^akl_tree_/,'');

  // ---- the alias table
  function fnv(s){let h=0x811c9dc5;for(const b of new TextEncoder().encode(s)){h^=b;h=Math.imul(h,0x01000193)>>>0;}return h>>>0;}
  function bucketPath(key,algorithm){
    if(root.ALTOTreeDetails?.bucketPath)return root.ALTOTreeDetails.bucketPath(key,algorithm);
    const h=fnv(key)%65536;return `${(h>>8).toString(16).padStart(2,'0')}/${(h&255).toString(16).padStart(2,'0')}.json.gz`;
  }
  const tables=new Map(),packs=new Map();
  async function json(url){
    const res=await fetch(url);
    if(!res.ok){const e=new Error(`ID table request failed (${res.status})`);e.status=res.status;throw e;}
    let bytes=new Uint8Array(await res.arrayBuffer());
    if(bytes[0]===31&&bytes[1]===139)bytes=new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer());
    return JSON.parse(new TextDecoder().decode(bytes));
  }
  function aliasTable(metadata){return metadata?.derived_products?.tree_ids||null;}
  function tableDir(path,base){return `${String(base||'./data').replace(/\/+$/,'')}/${String(path).replace(/^data\//,'').replace(/\/schema\.json$/,'')}`;}
  async function table(options){
    const path=aliasTable(options.metadata);
    if(!path)return null;
    const dir=tableDir(path,options.base),q=`?v=${encodeURIComponent(options.version||'')}`;
    if(!tables.has(dir))tables.set(dir,json(`${dir}/schema.json${q}`).catch(e=>{tables.delete(dir);throw e;}));
    return {dir,q,schema:await tables.get(dir)};
  }
  async function row(t,key){
    const url=`${t.dir}/${bucketPath(key,t.schema.bucket_algorithm)}${t.q}`;
    if(!packs.has(url)){packs.set(url,json(url).catch(e=>{packs.delete(url);if(e.status===404)return {};throw e;}));if(packs.size>64)packs.delete(packs.keys().next().value);}
    const r=(await packs.get(url))[key];
    if(!r)return null;
    const [canonical=null,detail=null,status='current',successor=null,note=null,extra=null]=r;
    return {canonical,detail,status,successor,note,extra};
  }
  function noteText(note,schema){
    if(!note)return null;
    if(/^C\d{5}(\+C\d{5})*$/.test(note))return `Reviewer correction ${note.replace(/\+/g,', ')}.`;
    const t=String(schema?.notes?.[note]||note).trim();
    return t.charAt(0).toUpperCase()+t.slice(1)+(/[.!?]$/.test(t)?'':'.');   // shown as a sentence
  }
  // -> {input, key, kind, tree_id (detail key to load), canonical (the tree number, or the record ID before v6.1),
  //     number, status, relation, successor, successors, note, reason (the row's note key or extra.reason), position,
  //     last_release, source_id (tombstones), record, resolved_by}
  async function resolve(raw,options={}){
    const key=normalise(raw);
    const base={input:raw,key,kind:kindOf(key),tree_id:null,canonical:null,number:null,status:'invalid',relation:null,successor:null,successors:[],
      note:null,reason:null,position:null,last_release:null,source_id:null,record:null,resolved_by:'format'};
    if(!key){
      const p=parseNumber(String(raw??'').trim());
      return {...base,note:/^The check/.test(p.problem||'')?p.problem:'This is not a tree ID ALTO recognises.'};
    }
    let t=null;
    try{t=await table(options);}catch{t=null;}
    if(!t){
      // Releases before v6.1: a record ID is its own detail key; numbers and crown keys cannot be resolved here.
      if(base.kind==='record')return {...base,tree_id:key,canonical:key,status:'current',relation:'record',resolved_by:'release_tree_id'};
      return {...base,status:'unknown',note:'This release has no table of permanent tree numbers.',resolved_by:'none'};
    }
    let hit=null;
    try{hit=await row(t,key);}catch{hit=null;}
    if(!hit){
      if(base.kind==='record')return {...base,tree_id:key,canonical:key,status:'current',relation:'record',resolved_by:'release_tree_id'};
      return {...base,status:'unknown',note:base.kind==='number'?'No tree has this number.':'This ID is not in the release\'s ID table.',resolved_by:'alias_table'};
    }
    const out={...base,resolved_by:'alias_table',note:noteText(hit.note,t.schema),record:base.kind==='record'?key:null,
      reason:hit.extra?.reason||hit.note||null,last_release:hit.extra?.last_release||null,source_id:hit.extra?.source_tree_id||null,
      position:Array.isArray(hit.extra?.p)?{lon:hit.extra.p[0],lat:hit.extra.p[1]}:null};
    const succ=hit.successor==null?[]:Array.isArray(hit.successor)?hit.successor:[hit.successor];
    if(base.kind==='number')return {...out,number:key,canonical:key,tree_id:hit.detail,status:hit.status,relation:hit.extra?.k||'crown',successors:succ,successor:succ[0]||null};
    if(hit.status==='current'||hit.status==='member')
      return {...out,number:hit.canonical,canonical:hit.canonical,tree_id:hit.detail||key,status:'current',relation:hit.status==='member'?'member':base.kind==='record'?'marker':'crown'};
    if(hit.status==='merged')
      return {...out,number:hit.canonical||succ[0]||null,canonical:hit.canonical||succ[0]||null,tree_id:hit.detail||key,status:'merged',relation:'merged',successor:succ[0]||null,successors:succ};
    if(hit.status==='split'){
      // Show the largest part; the others are listed in successors.
      let first=null;try{first=succ[0]?await row(t,succ[0]):null;}catch{first=null;}
      return {...out,number:succ[0]||null,canonical:succ[0]||null,tree_id:first?.detail||null,status:'split',relation:'split',successor:succ[0]||null,successors:succ};
    }
    // retired: a successor when something replaced it, else a tombstone (no tree to load)
    return {...out,number:succ[0]||null,canonical:succ[0]||null,tree_id:succ.length?hit.detail:null,status:'retired',relation:'retired',successor:succ[0]||null,successors:succ};
  }
  // The number a mistyped one was meant to be: of the well-formed numbers one keystroke away, the only one the
  // alias table holds. null when none or several are there, or the release has no table.
  async function suggestNumber(raw,options={}){
    const near=nearNumbers(raw);
    if(!near.length)return null;
    let t=null;try{t=await table(options);}catch{t=null;}
    if(!t)return null;
    const found=(await Promise.all(near.map(n=>row(t,n).then(r=>r?n:null,()=>null)))).filter(Boolean);
    return found.length===1?found[0]:null;
  }

  // ---- words for a resolved input: the tree page and the map say the same thing
  // Releases are named in words, as on the methods pages ("release 4"), never "v4".
  const LABELS={number:'Tree number',record:'Record ID',crown_key:'Crown key',crown_key_v4:'Release 4 crown key'};
  const label=kind=>LABELS[kind]||'ID';
  const SHORT={deleted_pointcloud_false_positive:'no tree at this LiDAR detection',v4_not_continued:'no current crown continues this release 4 crown',
    seeded_crown_retired:'crown drawn from a record that a reviewer moved'};
  function shortReason(reason,parts=0){
    if(!reason)return null;
    if(/^C\d{5}(\+C\d{5})*$/.test(reason))return `reviewer correction ${reason.replace(/\+/g,', ')}`;
    if(reason==='v4_split')return `release 4 crown divided between ${parts>1?parts:'several'} current crowns`;
    return SHORT[reason]||null;
  }
  const MESSAGES={mistyped:n=>`Check character doesn’t match; did you mean ${n}?`,invalid:'Not a valid tree number'};
  // What the map's search offers for typed text that names a tree: {kind, key, label, meta}, or null.
  // kind: id (open the tree), mistyped (open the one correction), checking (the correction lookup is running) or
  // invalid. fix: that lookup's answer for a mistyped number (undefined while it runs, null for none).
  function searchEntry(text,fix){
    const t=String(text??'').trim();
    if(isNumberShaped(t)&&!isNumber(t)){
      const key=t.replace(/[\s-]/g,'').toUpperCase();
      if(fix===null||!nearNumbers(key).length)return {kind:'invalid',key,label:MESSAGES.invalid,meta:'Tree number'};
      if(fix===undefined)return {kind:'checking',key,label:'Checking the tree number…',meta:'Tree number'};
      return {kind:'mistyped',key:fix,label:MESSAGES.mistyped(fix),meta:'Tree number'};
    }
    if(!looksLikeId(t))return null;
    const key=normalise(t)||t;
    return {kind:'id',key,label:`Open tree ${key}`,meta:label(kindOf(key))};
  }
  // -> {status, heading (a page about the input: its status and the reason), note (one line beside the tree it opens)}
  function describe(r){
    if(!r)return null;
    const what=`${label(r.kind)} ${r.key||String(r.input??'').trim()}`,n=r.successors?.length||0,short=shortReason(r.reason,n);
    switch(r.status){
      case 'current':return {status:'current',heading:null,note:r.resolved_by==='alias_table'&&r.kind!=='number'&&r.number?`${what} is tree ${r.number}.`:null};
      case 'merged':return {status:'merged',heading:`Merged: ${short||'joined to another tree'}`,note:`${what} was merged into tree ${r.number}${short?` (${short})`:''}.`};
      case 'split':return {status:'split',heading:`Split: ${short||`divided between ${n} trees`}`,note:`${what} was split between ${n} trees; the largest part is tree ${r.successors[0]}.`};
      case 'retired':return {status:'retired',heading:`Retired: ${short||'no tree carries this ID'}`,
        note:r.successor?`${what} is retired (${short||'replaced'}); its successor is tree ${r.successor}.`:`${what} is retired: ${short||'no tree carries it now'}.`};
      case 'unknown':return {status:'unknown',heading:r.resolved_by==='none'?`${label(r.kind)} not in this release`:r.kind==='number'?'No tree has this number':'Unknown tree ID',note:r.note};
      default:return {status:'invalid',heading:isNumberShaped(r.input)?MESSAGES.invalid:'Not a tree ID',note:r.note};
    }
  }

  // ---- links
  // The tree page (relative to the current page, so a copy of the site under /beta/ keeps its own pages), or the map.
  function url(id,{page='tree',base=null}={}){
    const href=base||(typeof location!=='undefined'?location.href:PUBLIC_ORIGIN+'/');
    const u=new URL(page==='tree'?'./tree.html':'./',href);
    u.search='';u.hash='';
    u.searchParams.set(page==='tree'?'id':'tree',id);
    return u.href;
  }
  // The permanent public address: https://alto.tfwelch.com/tree/<number> (any ID works there; numbers are the ones to share).
  function permalink(id,{origin=null}={}){
    const key=normalise(id)||String(id||'');
    return `${String(origin||root.ALTO_PUBLIC_ORIGIN||PUBLIC_ORIGIN).replace(/\/+$/,'')}/tree/${encodeURIComponent(key)}`;
  }
  // The ID a page was opened with: /tree/<ID>, ?id= or ?tree=.
  function fromLocation(loc){
    const l=loc||(typeof location!=='undefined'?location:null);
    if(!l)return null;
    const u=new URL(l.href||String(l));
    const m=u.pathname.match(/\/tree\/([^/?#]+)\/?$/);
    if(m)return decodeURIComponent(m[1]);
    return u.searchParams.get('id')||u.searchParams.get('tree');
  }
  const looksLikeId=s=>{const t=String(s||'').trim();return FAMILY.test(t)||isNumber(t)||CROWN_V5.test(t)||CROWN_V4.test(t);};
  const api={PREFIX,ALPHABET,normalise,short,parseNumber,isNumber,isNumberShaped,nearNumbers,suggestNumber,checkChar,validNumber,kindOf,resolve,url,permalink,fromLocation,
    looksLikeId,aliasTable,bucketPath,label,shortReason,describe,searchEntry,MESSAGES};
  root.ALTOTreeId=api;
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof globalThis==='undefined'?window:globalThis);
