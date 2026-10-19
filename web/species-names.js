/* Species names as ALTO shows them: one display form per species on every surface (tree page H1 and title, map panel,
 * Area, search, Species maxima, Recognition), with the source's own text kept verbatim under "Species as supplied".
 * KYTE reads this file too (UMD: window.ALTOSpeciesNames, or require()).
 *
 *  - Te reo Māori names with their macrons (Pōhutukawa, Tītoki, Pūriri, Tōtara, Kōwhai, Nīkau, Mānuka, Kānuka, Kāpuka);
 *    marked lang="mi" in markup (nameHtml).
 *  - Everything else in sentence case, proper nouns kept (London plane, Indian bead tree, Norfolk Island pine,
 *    Southern magnolia).
 *  - Latin names: genus and epithets in italics; a cultivar epithet in roman between single quotes ('Kanzan'); the
 *    hybrid sign × in roman, never the letter x; rank words (subsp., var., f.) and sp./spp. in roman.
 *  - Survey result codes that an earlier build appended to the kauri survey's names ("Kauri (PA+ PC+ soil:Nil)") are
 *    not part of the name: parse() returns them separately.
 *  - A source string naming several species ("Oak, Coral tree", "Pohutukawa, Oak", a schedule entry's list) is not a
 *    species: parse() marks it multi, and pages show it as "Recorded as: …". */
(function(root){
  'use strict';
  const fold=s=>String(s??'').normalize('NFD').replace(/[̀-ͯ]/g,'').toLowerCase().trim();
  // Te reo Māori names, folded -> with macrons. Single names and the common two-word ones.
  const MI={'pohutukawa':'pōhutukawa','titoki':'tītoki','puriri':'pūriri','totara':'tōtara','kowhai':'kōwhai','nikau':'nīkau','manuka':'mānuka',
    'kanuka':'kānuka','kapuka':'kāpuka','matai':'mātai','mahoe':'māhoe','hinau':'hīnau','tanekaha':'tānekaha','karamu':'karamū','kotukutuku':'kōtukutuku',
    'ti kouka':'tī kōuka','houhere':'houhere','karaka':'karaka','kauri':'kauri','rimu':'rimu','miro':'miro','kahikatea':'kahikatea','rewarewa':'rewarewa',
    'tawa':'tawa','taraire':'taraire','puka':'puka','whau':'whau','pukatea':'pukatea','kohekohe':'kohekohe','kawakawa':'kawakawa','ngaio':'ngaio',
    'akeake':'akeake','koromiko':'koromiko','rangiora':'rangiora','horopito':'horopito','toatoa':'toatoa','wharangi':'wharangi','kanono':'kanono',
    'raurekau':'raurekau','tarata':'tarata','karo':'karo','kohuhu':'kōhūhū','houpara':'houpara','horoeka':'horoeka','mamaku':'mamaku','ponga':'ponga',
    'whekī':'whekī','wheki':'whekī','harakeke':'harakeke','kiekie':'kiekie','maire':'maire','tītoki':'tītoki','kōwhai':'kōwhai','makamaka':'makamaka',
    'kaikomako':'kaikōmako','kaikōmako':'kaikōmako','tawapou':'tawāpou','hangehange':'hangehange','mapou':'māpou','mingimingi':'mingimingi','neinei':'neinei',
    'patete':'patē','pate':'patē','putaputaweta':'putaputāwētā','tutu':'tutu','turepo':'tūrepo','titoki tree':'tītoki','pohutukawa tree':'pōhutukawa',
    'rata':'rātā'};
  const MI_WORDS=new Set(Object.values(MI).flatMap(v=>v.split(' ')).map(fold));
  // Source spellings of one species that differ by more than case or macrons, folded -> the name ALTO shows, so a tree's
  // H1, the Species filter, Area, Species maxima and Recognition all say one name ("London Plane Tree" and "London Plane"
  // are both London plane, as Species maxima names Platanus × acerifolia; "Magnolia Grandiflora", a Latin name in the
  // common-name field, is Southern magnolia; "Lebanon Cedar" is cedar of Lebanon).
  const ALIAS={'london plane tree':'london plane','london plane trees':'london plane','london planes':'london plane',
    'monkey apple tree':'monkey apple','magnolia grandiflora':'southern magnolia','magnolia grandiflora little gem':'southern magnolia',
    'lebanon cedar':'cedar of lebanon'};
  // A common name that only names the genus ("Cherry", "Lime") is several species, so it takes a species' name only beside
  // that species' Latin name: "Cherry" with Prunus serrulata (any cultivar) is Japanese flowering cherry and "Lime" with
  // Tilia × europaea is common lime, as Species maxima and Recognition name them; "Cherry" with Prunus sp. or Prunus
  // serrula stays Cherry. Genus and species, folded, the hybrid sign as x -> the name ALTO shows (see bySpecies).
  const BY_LATIN={'prunus serrulata':'japanese flowering cherry','tilia x europaea':'common lime','magnolia grandiflora':'southern magnolia',
    'cedrus libani':'cedar of lebanon'};
  // Words kept with a capital inside a name (places, peoples, people).
  const PROPER=new Set(['london','indian','norfolk','island','queensland','moreton','bay','port','jackson','chinese','japanese','english','himalayan','monterey',
    'mexican','australian','canary','lombardy','turkey','algerian','atlas','lebanon','bhutan','brazilian','california','californian','chilean','cook','dutch',
    'fijian','french','hong','kong','illawarra','lawson','leyland','mediterranean','nz','new','zealand','norway','persian','peruvian','portuguese','sydney',
    'tasmanian','washington','wollemi','victorian','hill','hills','bangalow','cootamundra','douglas','scots','european','american','oriental','caucasian',
    'kentia','smith','swamp','holm','spanish','italian','irish','scottish','siberian','korean','taiwan','formosan','camden','cape','natal','senegal',
    'brisbane','tuckeroo','lilly','pilly','wilson','arizona','japan','china','india','canadian','dawn','turkish','tibetan','manchurian','oregon','sitka',
    'weymouth','austrian','corsican','aleppo','torrey','bishop','coulter','jeffrey','macrocarpa','christmas','easter','canterbury','auckland','waitakere','kermadec','chatham','three','kings','poor','knights']);
  const NOT_PROPER=new Set(['dawn','swamp','macrocarpa','tuckeroo','lilly','pilly']);   // in the list for matching only
  // To the last closing bracket: a soil result can hold its own brackets ("soil:Phyt sp. (P. multivora?)").
  const CODES=/\s*\(((?:PA\+|PC\+|soil:).*)\)\s*$/i;
  const cap=s=>s?s.charAt(0).toUpperCase()+s.slice(1):s;

  // The display form of a common name: macrons, sentence case, proper nouns kept. lower: for use inside a sentence
  // ("recorded here as a pin oak"): the first letter stays lower case unless it starts a proper noun.
  // latin: the record's Latin name, when it has one (bySpecies).
  function display(name,opts){
    const {lower=false,latin=null}=opts||{};
    let s=String(name??'').replace(/\s+/g,' ').trim();
    if(!s)return null;
    s=s.replace(CODES,'');
    let f=fold(s);
    if(ALIAS[f]){s=ALIAS[f];f=s;}
    const sp=bySpecies(f,latin);if(sp){s=sp;f=sp;}
    if(MI[f])return lower?MI[f]:cap(MI[f]);
    const proper=fw=>{const b=fw.replace(/['’]s$/,'');return PROPER.has(b)&&!NOT_PROPER.has(b);};
    const out=s.split(' ').map((w,i)=>{
      const fw=fold(w).replace(/[^a-z'’-]/g,'');
      if(MI[fw]&&!/[A-Z]{2}/.test(w))return MI[fw];
      if(/^[A-Z]{2,}$/.test(w)&&w.length<=4)return w;                       // NZ, USA
      if(proper(fw))return cap(w.toLowerCase());
      if(/^[A-Z][a-z]+'s$/.test(w))return w;                                 // Hill's, Smith's
      return w.toLowerCase();
    }).join(' ');
    if(lower){const first=fold(out.split(' ')[0]).replace(/[^a-z'’-]/g,'');return proper(first)?out:out.charAt(0).toLowerCase()+out.slice(1);}
    return cap(out);
  }
  // A source name -> {display, codes, multi, raw}. codes: survey result codes an earlier build appended; multi: a list of
  // several species ("Oak, Coral tree").
  // Several species run together without a comma: "Holm Oak. Karaka. Puriri", "Pohutukawa and Rata", "Puriri (2) Karaka
  // (2)", two te reo names ("Rimu Puriri"), or a te reo name beside an exotic tree's head noun ("London Plane Pohutukawa").
  const MI_ONE=new Set(Object.keys(MI).filter(k=>!/\s/.test(k)).map(fold));
  const EXOTIC=/\b(oak|plane|pine|palm|gum|elm|ash|maple|birch|cedar|cypress|beech|poplar|willow|magnolia|fig|lime|redwood|liquidambar|jacaranda|camphor)s?\b/;
  function joined(base){
    if(/\.\s+\S/.test(base)||/\s(and|with)\s/i.test(base)||/\(\d+\)\s+\S/.test(base))return true;
    const f=fold(base),mi=new Set(f.split(/[^a-z]+/).filter(w=>MI_ONE.has(w)).map(w=>MI[w]));
    return mi.size>=2||mi.size>=1&&EXOTIC.test(f);
  }
  function parse(name,opts){
    const raw=String(name??'').trim(),flat=raw.replace(/\s+/g,' ');
    if(!raw)return {display:null,codes:null,multi:false,raw:null};
    const m=CODES.exec(flat),base=flat.replace(CODES,'').trim();
    const multi=/,|\s&\s|\s\+\s|;/.test(base)||joined(base);
    return {display:multi?null:display(base,{latin:opts&&opts.latin||null}),codes:m?m[1].trim():null,multi,raw};
  }
  const isMulti=name=>parse(name).multi;
  const codes=name=>parse(name).codes;
  // Folded key for grouping spellings and survey-code variants of one species ("Pohutukawa", "Pōhutukawa", "Kauri (PA+ …)").
  // Whitespace first: some source names carry a line break inside the codes ("soil:P. cinnamomi\r\n)").
  // latin, when the record has one: "Cherry" beside Prunus serrulata groups with Japanese flowering cherry (bySpecies).
  const key=(name,opts)=>{const k=fold(String(name??'').replace(/\s+/g,' ').replace(CODES,'')).replace(/[^a-z0-9 ]+/g,' ').replace(/\s+/g,' ').trim(),a=ALIAS[k]||k;
    return bySpecies(a,opts&&opts.latin||null)||a;};
  // A common name that a Latin name can turn into a BY_LATIN species ("Cherry", "Lime", "Magnolia", "Cedar", with or
  // without "tree"): a list of trees by that name needs each record's Latin name too to pick out one species.
  const HEADS=new Set(Object.values(BY_LATIN).map(sp=>{const of=/^(\S+) of /.exec(sp);return of?of[1]:sp.split(' ').pop();}));
  const splits=name=>{const k=key(name);return HEADS.has(k)||HEADS.has(k.replace(/ tree$/,''));};
  const isMaori=name=>{const f=fold(String(name??'').replace(/\s+/g,' ').replace(CODES,''));return !!MI[f]||f.split(' ').every(w=>MI_WORDS.has(w));};

  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  // The display name as markup: lang="mi" on a te reo Māori name.
  function nameHtml(name,opts={}){
    const d=opts.display??display(name,opts);if(!d)return '';
    return isMaori(name)?`<span lang="mi">${esc(d)}</span>`:esc(d);
  }
  // A Latin name as markup: genus and epithets in italics; cultivar in roman single quotes; × and rank words in roman.
  const RANK=/^(subsp\.?|ssp\.?|var\.?|f\.|forma|cv\.?|sp\.?|spp\.?|agg\.?|aff\.?|cf\.?|sect\.?|nothosubsp\.?|group)$/i;
  function latinParts(latin){
    let s=String(latin??'').replace(/\s+/g,' ').trim();
    if(!s)return [];
    const parts=[];
    // Cultivars: 'Kanzan', "Kanzan", ‘Kanzan’, or cv. Kanzan.
    const re=/(['"‘’“”])([^'"‘’“”]+)\1|['"‘’“”]([^'"‘’“”]+)['"‘’“”]/g;
    let last=0,m;
    while((m=re.exec(s))){if(m.index>last)parts.push(...words(s.slice(last,m.index)));parts.push({t:'cultivar',v:(m[2]||m[3]).trim()});last=re.lastIndex;}
    if(last<s.length)parts.push(...words(s.slice(last)));
    return parts;
    function words(t){
      const out=[];
      for(const w of t.trim().split(' ').filter(Boolean)){
        if(w==='x'||w==='X'||w==='×')out.push({t:'hybrid',v:'×'});
        else if(/^×\S/.test(w)){out.push({t:'hybrid',v:'×'});out.push({t:'name',v:w.slice(1)});}
        else if(RANK.test(w))out.push({t:'rank',v:w});
        else out.push({t:'name',v:w});
      }
      return out;
    }
  }
  // Genus and species of a Latin name, folded, the hybrid sign as x: "Prunus serrulata 'Kanzan'" -> "prunus serrulata",
  // "Tilia x europaea" -> "tilia x europaea", "Prunus sp." -> "prunus".
  function binomial(latin){
    const out=[];
    for(const p of latinParts(latin)){
      if(p.t==='cultivar'||p.t==='rank')break;
      out.push(p.t==='hybrid'?'x':fold(p.v));
      if(out.filter(w=>w!=='x').length===2)break;
    }
    return out.join(' ');
  }
  // The species name (BY_LATIN) a folded common name stands for beside its Latin name, or null: the common name is that
  // name's head word ("cherry", "lime"; "cedar" of "cedar of lebanon"), with or without "tree", or the Latin name itself,
  // with or without the cultivar ("magnolia grandiflora little gem").
  function bySpecies(f,latin){
    if(!latin||!f)return null;
    const b=binomial(latin),sp=BY_LATIN[b];if(!sp)return null;
    const of=/^(\S+) of /.exec(sp),head=of?of[1]:sp.split(' ').pop();
    return f===head||f===head+' tree'||f===b||f.startsWith(b+' ')?sp:null;
  }
  function latinText(latin){
    return latinParts(latin).map(p=>p.t==='cultivar'?`‘${p.v}’`:p.v).join(' ');
  }
  function latinHtml(latin){
    const ps=latinParts(latin);if(!ps.length)return '';
    const out=[];let run=[];
    const flush=()=>{if(run.length){out.push(`<i>${esc(run.join(' '))}</i>`);run=[];}};
    for(const p of ps){if(p.t==='name')run.push(p.v);else{flush();out.push(p.t==='cultivar'?`‘${esc(p.v)}’`:esc(p.v));}}
    flush();
    return out.join(' ');
  }

  const api={fold,key,display,parse,isMulti,codes,isMaori,nameHtml,latinParts,latinText,latinHtml,binomial,splits,MI,ALIAS,BY_LATIN};
  root.ALTOSpeciesNames=api;
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof globalThis==='undefined'?window:globalThis);
