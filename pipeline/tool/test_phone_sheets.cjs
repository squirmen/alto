// Offline checks for the phone sheets (26 Oct 2026): minimised, the map panel and the tree or property panel are slim bars
// (56-96 px plus the safe area) that leave the map its height; each handle is its sheet's toggle (aria-expanded); the
// map's zoom, scale and attribution ride above whichever sheet shows; nothing changes above 760 px.
// Usage: node pipeline/tool/test_phone_sheets.cjs
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const web=path.join(__dirname,'..','..','web')+'/';
const read=f=>fs.readFileSync(web+f,'utf8');
const css=read('map.css'),app=read('map-app.js'),html=read('index.html'),tok=read('tokens.css');

// The block of map.css that holds the bars: a phone media query, closed where its braces balance.
function block(src,from){
  const at=src.indexOf(from);assert.ok(at>=0,`map.css: ${from}`);
  const open=src.indexOf('{',at);let depth=0;
  for(let i=open;i<src.length;i++){if(src[i]==='{')depth++;else if(src[i]==='}'&&--depth===0)return src.slice(at,i+1);}
  throw new Error('unbalanced braces after '+from);
}
const phone=block(css,'@media (max-width: 760px) {\n  :root { --sheet-safe:');

// 1. The bars are slim: 56-96 px before the safe area (0 on a page that does not reach under a home indicator).
{
  const vars={};
  for(const m of tok.matchAll(/(--[\w-]+): ([^;]+);/g))vars[m[1]]=m[2].trim();
  const root=/^@media \(max-width: 760px\) \{\n  :root \{ ([^}]+) \}/.exec(phone)[1];
  for(const m of root.matchAll(/(--[\w-]+): ([^;]+);/g))vars[m[1]]=m[2].trim();
  const coarse=/@media \(pointer: coarse\) \{ :root \{ --sheet-bar: ([^;]+); \} \}/.exec(phone);
  assert.ok(coarse,'a touch screen has its own map-panel bar height (44 px handle)');
  const px=expr=>{let e=expr;for(let n=0;n<20&&/var\(/.test(e);n++)e=e.replace(/var\((--[\w-]+)\)/g,(_,k)=>{assert.ok(k in vars,`token ${k}`);return vars[k];});
    e=e.replace(/env\([^)]*\)/g,'0px').replace(/calc\(/g,'(').replace(/px/g,'');assert.ok(/^[\d\s+\-*/().]+$/.test(e),e);return Function(`return ${e}`)();};
  const bars={'map panel, mouse':px(vars['--sheet-bar']),'map panel, touch':px(coarse[1]),'tree panel':px(vars['--tree-bar'])};
  for(const [k,v] of Object.entries(bars))assert.ok(v>=56&&v<=96,`${k} bar: ${v} px`);
  assert.equal(bars['map panel, touch'],96,'touch: a 44 px handle, the 44 px search box and 8 px');
  assert.ok(phone.includes('.tree-profile[data-sheet="peek"] { height: calc(var(--tree-bar) + var(--sheet-safe)); }'),'the tree sheet minimised is its bar, plus the safe area');
  assert.ok(phone.includes('.tree-profile { overflow: hidden; }'),'the bar clips the panel body');
  assert.ok(/\.tree-profile\[data-sheet="peek"\] \.sheet-title \{ display: block; max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;/.test(phone),'one line of title, cut with an ellipsis');
  assert.ok(phone.includes('.tree-profile[data-sheet="peek"] .profile-back { display: none; }'),'the bar holds only its title and the close button');
  // Half is where a panel opens (unchanged, 48 % of the screen); the bars before JavaScript measures them.
  assert.ok(css.includes('.tree-profile { width: 100%; height: 48dvh; top: auto; bottom: 0;'),'half stays 48dvh');
  assert.ok(css.includes('transform: translateY(var(--sheet-offset, calc(100% - var(--sheet-bar))));')&&!/168px/.test(css),'the map panel starts as its bar');
}

// 2. Nothing changes above 760 px: every new rule is inside the phone block; tokens only, no new colours.
{
  for(const s of ['--tree-bar','.sheet-chev','.sheet-title','.tree-profile[data-sheet="peek"]','.lp-handle:focus-visible'])
    assert.equal(css.split(s).length-1,phone.split(s).length-1,`${s}: only on phones`);
  assert.ok(!/#[0-9a-f]{3,8}\b/i.test(phone),'no hex colours in the phone sheets');
  assert.ok(css.includes('.sheet-handle .sheet-grip { width: 42px; height: 5px; border-radius: 3px; background: var(--color-border-strong); }')
    &&css.includes('.lp-handle span { width: 40px; height: 4px; border-radius: 2px; background: var(--color-border-strong); }'),'grips take the border token');
  assert.ok(phone.includes('.sheet-chev { position: absolute; left: var(--space-4); top: 50%; color: var(--color-text-muted);'),'the chevron in muted text');
  assert.ok(phone.includes('#explorer.lp .lp-handle:focus-visible, .sheet-handle:focus-visible { outline: 2px solid var(--color-focus); outline-offset: -3px; }'),'focus rings inside the clipped sheets');
  assert.ok(css.includes('@media (prefers-reduced-motion: reduce) { .sheet-chev { transition: none; } }'),'reduced motion: the chevron turns at once');
  assert.ok(/@media \(prefers-reduced-motion: reduce\) \{\s*\*, \*::before, \*::after \{ transition: none !important;/.test(read('observatory.css')),'reduced motion: the sheets move at once');
}

// 3. Markup: the tree panel opens at half; each handle is a toggle with a chevron; the bar's title slot.
{
  assert.ok(html.includes('<aside id="treeProfile" class="tree-profile" aria-label="Tree profile" aria-hidden="true" hidden inert data-sheet="half">'),'the tree panel starts at half');
  const tree=/<button id="sheetHandle"[^>]*>.*?<\/button>/.exec(html)?.[0]||'',map=/<button id="panelHandle"[^>]*>.*?<\/button>/.exec(html)?.[0]||'';
  assert.ok(tree.includes('aria-controls="treeProfileBody"')&&tree.includes('aria-expanded="true"')&&tree.includes('<span class="sheet-title" id="sheetTitle"></span>'),'tree handle: toggle and title');
  assert.ok(map.includes('aria-controls="explorer"')&&map.includes('aria-expanded="false"'),'map handle: toggle');
  for(const h of [tree,map])assert.ok(/<svg class="sheet-chev"[^>]*aria-hidden="true"><path d="M6 15l6-6 6 6"><\/path><\/svg>/.test(h),'a chevron, hidden from screen readers');
}

// 4. The map panel's bar: its handle and the search box; what lies below takes no focus; the status line keeps its Retry.
{
  assert.ok(app.includes('const anchor = state === "peek" ? document.getElementById("propertySearch") :'),'peek stops at the search box');
  assert.ok(app.includes('return Math.min(explorer.offsetHeight, bottom + 8 + sheetSafe());'),'plus 8 px and the safe area');
  const inert=/const SHEET_PEEK_INERT = "([^"]+)";/.exec(app)[1].split(', ');
  assert.ok(inert.includes('.lp-summary')&&!inert.includes('.status'),'the summary hides with the bar; the status line stays live');
  assert.ok(app.includes('if (hiding) handle.focus({ preventScroll: true });'),'focus in a part the bar hides goes to the handle');
  assert.ok(/for \(const el of \[explorer\.querySelector\("\.lp-summary"\), document\.getElementById\("status"\)\]\) restop\.observe\(el\);/.test(app),'the bar follows the status line');
}

// 5. The tree or property panel: a toggle, a title, controls above it, no layout read in the tap.
{
  assert.ok(app.includes('handle.setAttribute("aria-expanded", String(!bar));'),'aria-expanded: not the bar');
  assert.ok(app.includes('`${title || "Panel"}: expand the panel`'),'in the bar the handle is named by its title first');
  assert.ok(app.includes('const hide = bar && sheetLayout.matches, active = document.activeElement;')&&app.includes('profileBody.inert = hide;'),'the body takes no focus in the bar, on phones only');
  assert.ok(app.includes('sheetLayout.addEventListener("change", () => setSheet(profilePanel.dataset.sheet || "half"));'),'a resize to desktop frees the body');
  assert.equal(app.split('if (!wasOpen) setSheet("half");').length-1,2,'a tree or property opens at half; one already open keeps its stop');
  assert.ok(app.includes('[name, number].filter(Boolean).join(" · ")')&&app.includes('`Parcel ${currentProperty.pid}`'),'title: name and number, or the address or parcel');
  assert.ok(app.includes('if (document.body.dataset.profileOpen === "true") return;'),'the map panel leaves the controls to an open tree panel');
  assert.ok(/new ResizeObserver\(entries => \{\s*if \(!sheetLayout\.matches \|\| document\.body\.dataset\.profileOpen !== "true"\) return;[\s\S]{0,200}setProperty\("--sheet-clear", `\$\{Math\.round\(Math\.min\(h, window\.innerHeight \/ 2\)\)\}px`\);\s*\}\)\.observe\(profilePanel\);/.test(app),'controls ride above the tree sheet, up to half the screen');
  assert.ok(phone.includes('body[data-profile-open="true"] :is(.maplibregl-ctrl-bottom-right, .maplibregl-ctrl-bottom-left) { transition: none; }'),'and follow it frame by frame');
  const open=app.slice(app.indexOf('async function openProfile('),app.indexOf('await afterPaint();',app.indexOf('async function openProfile(')));
  assert.ok(!/\.focus\(|scrollTop\s*=|getBoundingClientRect|offsetHeight/.test(open),'FE-17: nothing measured inside the tap');
}

// 6. The handle's stops: a press toggles the bar and half (full steps down); a drag moves one stop, a long one two; down
// from the bar closes the panel.
{
  const from=app.indexOf('    (function bottomSheet() {'),to=app.indexOf('    })();',from)+'    })();'.length;
  const src=app.slice(from,to);assert.ok(from>0&&src.includes('STOPS = ["peek", "half", "full"]'));
  // The browser fires pointerup and then click for one press, before any timer set in between runs.
  function run(state,events){
    const on={},calls=[],timers=[],panel={dataset:{sheet:state}};
    const handle={addEventListener:(t,f)=>{on[t]=f;},setPointerCapture(){}};
    const doc={getElementById:id=>{assert.equal(id,'sheetHandle');return handle;}};
    new Function('document','profilePanel','setSheet','closeProfile','window','setTimeout',src)(doc,panel,s=>{calls.push(s);panel.dataset.sheet=s;},()=>calls.push('closed'),{innerHeight:812},f=>timers.push(f));
    for(const [t,y] of events){const e={clientY:y,pointerId:1};on[t](e);}
    timers.splice(0).forEach(f=>f());
    return calls.join(',')||'none';
  }
  const tap=[['click',0]],drag=dy=>[['pointerdown',500],['pointermove',500+dy],['pointerup',500+dy],['click',500+dy]];
  assert.equal(run('peek',tap),'half');assert.equal(run('half',tap),'peek');assert.equal(run('full',tap),'half');
  assert.equal(run('peek',drag(-100)),'half');assert.equal(run('peek',drag(-300)),'full');assert.equal(run('half',drag(-100)),'full');
  assert.equal(run('full',drag(100)),'half');assert.equal(run('full',drag(300)),'peek');assert.equal(run('half',drag(100)),'peek');
  assert.equal(run('peek',drag(50)),'closed');assert.equal(run('half',drag(50)),'none');assert.equal(run('half',drag(8)),'peek','a small wobble is a press');
}
console.log('phone sheet checks passed (slim bars 56-96 px, phone-only tokens, toggles and titles, controls above the sheets, stops)');
