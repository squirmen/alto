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

console.log('command search: all checks passed');
