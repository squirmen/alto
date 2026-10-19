// Offline checks for the map search (web/command-search.js): folding, intents, ranking, heights, places.
// Usage: node pipeline/tool/test_command_search.cjs
const assert=require('node:assert/strict');
const C=require(require('node:path').join(__dirname,'..','..','web','command-search.js'));

// Case, macrons and the two spellings of colour are ignored.
assert.equal(C.normalise('Pōhutukawa in KAIPĀTIKI'),'pohutukawa in kaipatiki');
assert.equal(C.normalise('Color by height'),'colour by height');
assert.equal(C.normalise('Ōrākei'),'orakei');

// "show", "hide" and "only" are the intent; filler words drop out.
assert.deepEqual(C.parse('show parcels'),{intent:'on',tokens:['parcels'],text:'show parcels'});
assert.equal(C.parse('hide the kauri dieback layer').intent,'off');
assert.deepEqual(C.parse('hide the kauri dieback layer').tokens,['kauri','dieback']);
assert.equal(C.parse('only protected trees').intent,'only');

// Scores: exact, prefix, words in order, one typo in a longer word, nothing.
assert.equal(C.phraseScore(['colour','by','height'],'Colour by height'),100);
assert.ok(C.phraseScore(['prot'],'protected')>=85);
assert.ok(C.phraseScore(['colour','by','heigth'],'colour by height')>=45,'a swapped pair of letters still matches');
assert.equal(C.phraseScore(['zzz'],'property boundaries'),0);
assert.ok(C.lev1('heigth','height')&&C.lev1('kauri','kaur')&&!C.lev1('kauri','kiwi'));

// Heights in metres from plain words.
for(const [t,n] of [['taller than 25 m',25],['trees over 20m',20],['30 m or more',30],['height 15+',15],['at least 12 metres',12]])assert.equal(C.parseHeight(t),n,t);
for(const t of ['12 Queen Street','colour by height','over 900 m'])assert.equal(C.parseHeight(t),null,t);

// "X in Y" splits at the last " in ".
assert.deepEqual(C.splitPlace('pōhutukawa in Kaipātiki'),{left:'pohutukawa',right:'kaipatiki'});
assert.equal(C.splitPlace('kauri dieback'),null);

// Ranking over a small context.
const items=intent=>[
  {id:'preset:protected',group:'Presets',label:'Protected & notable',words:['Protected & notable','protected','notable trees'],combinable:true,run:()=>'p'},
  {id:'m:parcels',group:'Map',label:intent==='off'?'Hide property boundaries':'Show property boundaries',words:['property boundaries','parcels','properties'],run:()=>'m'},
  {id:'m:colour-height',group:'Map',label:'Colour by height',words:['colour by height','heights'],run:()=>'c'},
  {id:'m:kauri',group:'Map',label:'Show kauri dieback surveillance',words:['kauri dieback surveillance','dieback'],run:()=>'k'}];
const ctx={items,
  species:()=>[['Kauri',15823,['Kauri']],['Pohutukawa',3800,['Pohutukawa','Pōhutukawa']],['Kauri grove',5,['Kauri grove']],['Norfolk Island Pine, Pohutukawa',2,['Norfolk Island Pine, Pohutukawa']]],
  places:()=>['Kaipātiki','Waitematā'].map(n=>({id:'place:'+n,group:'Places',label:n,words:[n,n+' local board'],run:()=>n})),
  height:n=>({id:'h'+n,group:'Filters',label:`Height ${n} m or more`,run:()=>n}),
  treeId:t=>/^(akl_tree_)?trp_/i.test(t.trim())?{id:'tree',label:'Open tree',run:()=>'t'}:null,
  speciesItem:(n,c,names)=>({meta:`Species · ${c}`,names}),
  combine:(l,p)=>({id:l.id+'@'+p.id,label:`${l.label} in ${p.label}`,run:()=>'x'})};
const top=(q)=>C.suggest(q,ctx).map(x=>x.label);
assert.equal(top('colour by height')[0],'Colour by height');
assert.equal(top('color by heigth')[0],'Colour by height');
assert.equal(top('show parcels')[0],'Show property boundaries');
assert.equal(C.suggest('hide parcels',ctx)[0].label,'Hide property boundaries','the label follows the intent');
assert.equal(top('pohutukawa in kaipatiki')[0],'Pohutukawa in Kaipātiki');
assert.equal(top('pōhutukawa in Kaipātiki')[0],'Pohutukawa in Kaipātiki');
assert.equal(C.suggest('pohutukawa',ctx).find(x=>x.group==='Species').names.length,2,'both spellings travel with the species');
assert.equal(top('trp_ACCT0245027')[0],'Open tree');
assert.equal(top('taller than 25 m')[0],'Height 25 m or more');
assert.equal(top('waitemata')[0],'Waitematā');
const k=C.suggest('kauri',ctx);
assert.equal(k[0].label,'Kauri');
assert.ok(!k.some(x=>x.label==='Kauri grove'),'an exact species keeps rare variants out');
assert.ok(k.some(x=>x.label==='Show kauri dieback surveillance'));
assert.deepEqual(C.suggest('',{...ctx,examples:()=>[{id:'e',group:'Examples',label:'colour by height'}]}).map(x=>x.group),['Examples']);
// Groups are ordered by their best match.
assert.deepEqual(C.grouped(C.suggest('kauri',ctx)).map(g=>g.name),['Species','Map']);

// The typed words are marked in the label, macrons or not.
assert.equal(C.mark('Pōhutukawa in Kaipātiki','pohutukawa kaipatiki'),'<mark>Pōhutukawa</mark> in <mark>Kaipātiki</mark>');
assert.equal(C.mark('Show property boundaries','prop'),'Show <mark>prop</mark>erty boundaries');
assert.equal(C.mark('<b>','b'),'&lt;<mark>b</mark>&gt;');

// ---- UX-03: what the search promises and finds, until a place index ships.
const fs=require('node:fs'),path=require('node:path');
const web=path.join(__dirname,'..','..','web')+'/';
const map=(fs.readFileSync(web+'index.html','utf8')+fs.readFileSync(web+'map-app.js','utf8'));
assert.ok(map.includes('placeholder="Search address, local board, species or tree number"'),'the placeholder names what can be searched');
assert.equal(C.NO_MATCH,'No match. Suburbs, parks and schools are not searchable yet. Try a street address, a tree number, a species or a local board.');
assert.ok(fs.readFileSync(web+'command-search.js','utf8').includes('render(text,empty?ctx.exampleNote?.():(!items.length?NO_MATCH:null));'),'nothing found: the no-match text');
// "species maxima", "maxima", "tallest", "notable trees" and "protected trees" reach the maxima rings, the height
// colours and the schedule filter: the map's own word lists (index.html), ranked against the presets and examples.
const words=re=>{const m=re.exec(map);assert.ok(m,String(re));return JSON.parse(`[${m[1]}]`);};
const maximaWords=words(/onLabel: `Show species maxima in \$\{state\.maximaArea\} \(rings\)`, offLabel: "Hide species maxima", words: \[([^\]]+)\]/);
const scheduleWords=words(/onLabel: "Only trees on the Notable Trees schedule", offLabel: "Clear the Notable Trees schedule filter", words: \[([^\]]+)\]/);
const heightWords=words(/height: \[("height", [^\]]+)\]/);
const mapItems=()=>[
  ...items(),
  {id:'f:maxima',group:'Filters',label:'Show species maxima in Auckland (rings)',words:maximaWords,run:()=>'mx'},
  {id:'f:protected',group:'Filters',label:'Only trees on the Notable Trees schedule',words:scheduleWords,run:()=>'sch'},
  {id:'colour:height',group:'Map',label:'Colour by height',words:['colour by height','height colour','colour height',...heightWords.map(w=>`colour by ${w}`),...heightWords],run:()=>'h'}];
const mctx={...ctx,items:mapItems};
const first=q=>C.suggest(q,mctx)[0]?.id;
for(const q of ['species maxima','maxima','Species maxima'])assert.equal(first(q),'f:maxima',q);
assert.equal(first('tallest'),'colour:height','tallest: the height view');
assert.equal(first('tallest trees'),'colour:height');
for(const q of ['notable trees','protected trees'])assert.ok(['f:protected','preset:protected'].includes(first(q))&&C.suggest(q,mctx).some(x=>x.id==='f:protected'),q);
// "Devonport Primary School": no species, command or board matches, and the address index has no such street: the
// search shows the no-match text (a place index is backlog UX-03-data).
assert.deepEqual(C.suggest('Devonport Primary School',mctx),[],'a school finds nothing');
// Streets from the address index (fixture: release 6.2's Grattan Place rows): a street with the wrong suburb falls back
// to where the street is; a street without a number is offered as a street; the house-number advice only without one.
(async()=>{
  const fx=JSON.parse(fs.readFileSync(path.join(__dirname,'fixtures','address-index-grattan.json'),'utf8'));
  global.fetch=async url=>{const u=String(url).replace(/\?.*$/,'');const body=u.endsWith('/address_index/meta.json')?fx.meta:(/\/address_index\/(\w+)\.json\.gz$/.exec(u)||[])[1] in fx.shards?fx.shards[/\/address_index\/(\w+)\.json\.gz$/.exec(u)[1]]:null;
    return body?{ok:true,status:200,arrayBuffer:async()=>new TextEncoder().encode(JSON.stringify(body)).buffer}:{ok:false,status:404,arrayBuffer:async()=>new ArrayBuffer(0)};};
  const P=require(web+'property.js');
  const wrong=await P.search('./data','t','Grattan Place, Parnell',5,{streets:true});
  assert.ok(wrong.suburbMismatch&&wrong.typedSuburb==='Parnell','Grattan Place, Parnell: not in Parnell');
  assert.deepEqual(wrong.streets.map(x=>`${x.street}, ${x.suburb}`),['Grattan Place, Freemans Bay'],'offers Grattan Place, Freemans Bay');
  assert.equal(wrong.streets[0].n,14);assert.equal(wrong.hasNumber,false);
  const street=await P.search('./data','t','Grattan Place',5,{streets:true});
  assert.ok(!street.suburbMismatch&&street.streets[0].street==='Grattan Place'&&street.streets[0].bbox.every(Number.isFinite),'a street without a number: the street and its extent');
  const one=await P.search('./data','t','15 Grattan Place',5,{streets:true});
  assert.ok(one.hasNumber&&!one.streets&&one.rows.length&&one.rows[0].number==='15','a house number: addresses, no street row');
  assert.equal((await P.search('./data','t','Devonport Primary School',5,{streets:true})).rows.length,0,'no street called Devonport Primary School');
  // The map's street row: the advice "add a house number" only when none was typed; "not in <suburb>" on a fallback.
  assert.ok(map.includes('${res.hasNumber ? "" : " · add a house number for one address"}')&&map.includes('const elsewhere = res.suburbMismatch ? ` · not in ${res.typedSuburb}` : "";'),'street row wording');
  console.log('command search: all checks passed (including UX-03: placeholder, no-match text, maxima, height and schedule words, Grattan Place, Devonport Primary School)');
})().catch(e=>{console.error(e);process.exit(1);});

