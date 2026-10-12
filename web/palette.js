/* Map colours: every colour-by mode and every colour-coded map layer, with its legend, from the ALTO design
 * system tokens (tokens.css v1.0.0; design system section 1.3). One place for the map, its legend, the
 * filter rows and the Area charts, so a category keeps its colour and its name in every view.
 *
 * In a browser each colour is read from tokens.css at run time; FALLBACK holds the same light-theme values
 * for Node (tests) and for a page without tokens.css. pipeline/tool/test_cvd_palettes.cjs checks FALLBACK
 * against web/tokens.css and checks every legend below under simulated protanopia, deuteranopia and
 * tritanopia (Machado et al. 2009): any two categories drawn with the same mark must differ by at least
 * ΔE2000 9 in every vision model.
 *
 * Two map choices go beyond the token table, so that every legend passes that check:
 *  - "Other" on the map is --neutral-600. The generic fold colour (--viz-other, neutral-400) is ΔE2000 5.7
 *    from slot 1 green under deuteranopia: Council Parks and "owner not recorded" would merge.
 *  - Height classes use sequential steps 300, 500, 700 and 900. Neighbouring steps 400–700 are ΔE2000 7.1–7.7
 *    apart for every viewer.
 * Categories that share a colour differ by mark: a ring (protected), a hollow marker (no crown linked), a
 * dashed ring (possible duplicate), a dashed crown outline (crown drawn from the record). */
(function(root){
  'use strict';
  const FALLBACK={
    '--viz-cat-1':'#3ca17b','--viz-cat-2':'#16558c','--viz-cat-3':'#ba7f14','--viz-cat-4':'#9e6ec0','--viz-cat-5':'#a74639',
    '--viz-cat-6':'#1d97a3','--viz-cat-7':'#bc662f',
    '--viz-seq-100':'#dff7eb','--viz-seq-200':'#bbe9d3','--viz-seq-300':'#94d7b9','--viz-seq-400':'#6ac19d','--viz-seq-500':'#45a983',
    '--viz-seq-600':'#27906b','--viz-seq-700':'#147656','--viz-seq-800':'#0c5d43','--viz-seq-900':'#044430',
    '--viz-div-loss-3':'#8b3906','--viz-div-loss-2':'#b55422','--viz-div-loss-1':'#d57f57','--viz-div-mid':'#e3e7e1',
    '--viz-div-gain-1':'#49a8b3','--viz-div-gain-2':'#04848f','--viz-div-gain-3':'#076169',
    '--viz-conf-4':'#194f81','--viz-conf-3':'#346ca3','--viz-conf-2':'#588abd','--viz-conf-1':'#81a9d2',
    '--neutral-0':'#ffffff','--neutral-200':'#d8ddd6','--neutral-400':'#8a938d','--neutral-600':'#5b655f','--neutral-700':'#45504a','--neutral-900':'#17201a',
    '--color-protected':'#b02e6f','--color-selection':'#17201a','--color-selection-halo':'#ffffff',
    '--viz-overlay-focus':'#ffe14d','--viz-mark-stroke':'rgb(23 32 26 / 55%)','--viz-mark-stroke-imagery':'#ffffff'
  };
  // Aliases in tokens.css, resolved here so Node needs no CSS.
  const ALIAS={'--viz-other':'--neutral-400','--viz-conf-none':'--neutral-400',
    '--viz-src-council-parks':'--viz-cat-1','--viz-src-auckland-transport':'--viz-cat-2','--viz-src-community':'--viz-cat-3',
    '--viz-src-lidar-detected':'--viz-cat-4','--viz-src-notable-schedule':'--viz-cat-5',
    '--viz-form-evergreen-broadleaf':'--viz-cat-1','--viz-form-conifer':'--viz-cat-2','--viz-form-deciduous-broadleaf':'--viz-cat-3',
    '--viz-form-palm-fern':'--viz-cat-4','--viz-form-broadleaf-undetermined':'--viz-cat-5',
    '--viz-land-park':'--viz-cat-1','--viz-land-street':'--viz-cat-2','--viz-land-institution':'--viz-cat-3','--viz-land-private':'--viz-cat-4'};
  const MAP_OTHER='--neutral-600';
  let css=null;
  function token(name){
    if(css===null){
      try{css=typeof document!=='undefined'&&typeof getComputedStyle==='function'?getComputedStyle(document.documentElement):false;}catch{css=false;}
    }
    if(css){const v=css.getPropertyValue(name).trim();if(v)return v;}
    if(FALLBACK[name])return FALLBACK[name];
    if(ALIAS[name])return token(ALIAS[name]);
    return null;
  }

  // mark: dot | ring | hollow | dashed-ring | triangle | diamond (point marks), crown | crown-dashed (a crown's
  // outline and light fill), fill (an area at `alpha` opacity), outline | dashed-outline (a parcel or board edge),
  // dashed-line (a link). kind: categorical | ordinal | diverging.
  const r=(key,label,tok,mark='dot',extra={})=>({key,label,token:tok,mark,...extra});
  const LEGENDS={
    source:{title:'Source',kind:'categorical',note:'The marker’s own record. A tree can have several sources.',rows:[
      r('register_parks','Council tree register · Parks','--viz-src-council-parks'),
      r('register_at','Council tree register · Auckland Transport','--viz-src-auckland-transport'),
      r('register_other','Council tree register · owner not recorded',MAP_OTHER),
      r('notable','Notable Trees schedule','--viz-src-notable-schedule'),
      r('community','Community records','--viz-src-community','dot',{keys:['osm','kauri'],detail:'OpenStreetMap, RŪRU kauri survey'}),
      r('lidar','LiDAR-detected tree','--viz-src-lidar-detected','dot',{detail:'Found in the 2024 LiDAR survey; no record describes it'})]},
    structure:{title:'Growth form',kind:'categorical',estimate:true,note:'Estimated from the 2024 LiDAR survey and aerial imagery. A recorded species takes precedence.',rows:[
      r('evergreen','Evergreen broadleaf','--viz-form-evergreen-broadleaf'),
      r('conifer','Conifer','--viz-form-conifer'),
      r('deciduous','Deciduous broadleaf','--viz-form-deciduous-broadleaf'),
      r('palm_type','Palm, cabbage tree or tree fern','--viz-form-palm-fern'),
      r('broadleaf','Broadleaf, leaf habit not determined','--viz-form-broadleaf-undetermined'),
      r('other','Not determined or not estimated',MAP_OTHER,'dot',{keys:['not_determined','none']})]},
    height:{title:'Height',kind:'ordinal',note:'Highest LiDAR return in the crown, 2024 LiDAR survey.',rows:[
      r('h0','Under 5 m','--viz-seq-300','dot',{from:0,to:5}),
      r('h5','5–15 m','--viz-seq-500','dot',{from:5,to:15}),
      r('h15','15–25 m','--viz-seq-700','dot',{from:15,to:25}),
      r('h25','25 m and over','--viz-seq-900','dot',{from:25,to:null}),
      r('none','No height: no crown linked',MAP_OTHER,'hollow')]},
    change:{title:'Change since 2013',kind:'diverging',note:'Earlier tree canopy and the 2024 crowns matched across the 2013, 2016 and 2024 LiDAR surveys by overlap and height, and checked in dated aerial photos. Removed: the top of an earlier crown is now open ground or a new structure. New: a 2024 crown at least 5 m tall where the earlier survey found no canopy. In a blind check of aerial photos about nine in ten shown changes were confirmed (13 Oct 2026). Partial losses, and young trees already growing in 2013, are not shown.',rows:[
      r('removed_to_open','Removed by 2024','--viz-div-loss-2'),
      r('established_since_2013','New since 2013','--viz-div-gain-2'),
      r('established_since_2016','New since 2016','--viz-div-gain-1')]},
    quality:{title:'Link status',kind:'ordinal',note:'How a record is tied to a crown found in the 2024 LiDAR survey.',rows:[
      r('linked','Linked','--viz-conf-4'),
      r('probable','Probable link','--viz-conf-2'),
      r('drawn','Crown drawn from the record','--viz-conf-1','dot',{detail:'Dashed crown outline'}),
      r('unlinked','No crown linked','--viz-conf-none','hollow')]},
    evidence:{title:'Detection evidence',kind:'ordinal',note:'How likely a LiDAR detection is a tree.',rows:[
      r('recorded','Recorded tree','--viz-conf-4'),
      r('very_likely','Very likely','--viz-conf-3'),
      r('probable','Probable','--viz-conf-2'),
      r('possible','Possible','--viz-conf-1'),
      r('unverified','Unverified or not yet checked','--viz-conf-none','dot',{keys:['unverified','not_assessed','location_unverified']}),
      r('possible_duplicate','Possible duplicate','--viz-conf-none','dashed-ring')]},
    tenure:{title:'Land type',kind:'categorical',inferred:true,note:'Inferred from zoning and parcel records.',rows:[
      r('park','Park & reserve','--viz-land-park'),
      r('street','Street','--viz-land-street'),
      r('institutional','Schools & institutions','--viz-land-institution'),
      r('private','Private property','--viz-land-private'),
      r('other','Other / unknown',MAP_OTHER,'dot',{keys:['other','unknown']})]},
    // Marks that mean the same in every colour mode.
    marks:{title:'In every mode',kind:'categorical',rows:[
      r('protected','Protected','--color-protected','ring',{detail:'Notable Trees schedule (Auckland Unitary Plan)'}),
      r('unlinked','No crown linked','--viz-conf-none','hollow',{detail:'Hollow marker, outlined in the tree’s colour'}),
      r('crown','Crown, 2024 LiDAR survey','--viz-seq-700','crown',{detail:'Outlined in the tree’s colour'}),
      r('drawn','Crown drawn from the record','--viz-seq-700','crown-dashed',{detail:'Dashed outline, awaiting confirmation'})]},
    // Colour-coded layers (Layers drawer).
    canopy:{title:'Canopy cover by local board',kind:'ordinal',note:'Earlier canopy assessment.',rows:[
      r('c0','Under 15%','--viz-seq-200','fill',{from:0,to:15,alpha:0.75}),
      r('c15','15–20%','--viz-seq-500','fill',{from:15,to:20,alpha:0.75}),
      r('c20','20–25%','--viz-seq-700','fill',{from:20,to:25,alpha:0.75}),
      r('c25','25% and over','--viz-seq-900','fill',{from:25,to:null,alpha:0.75}),
      r('partial','Partly outside the assessed area',MAP_OTHER,'dashed-outline',{detail:'Outline only; its share is not comparable'})]},
    kauri:{title:'Kauri dieback surveillance',kind:'diverging',note:'Auckland Council survey points.',rows:[
      r('pathogen_confirmed','Pathogen confirmed','--viz-div-loss-3','triangle',{detail:'At the point, or a confirmed case within 50 m'}),
      r('symptomatic','Symptoms, or a suspect case nearby','--viz-div-loss-1','triangle'),
      r('no_symptoms','No symptoms','--viz-div-gain-2','triangle'),
      r('other','Other or not recorded','--neutral-400','triangle')]},
    rootzone:{title:'Root space (earlier crowns)',kind:'diverging',note:'Scenario polygons for review; not a measured root area.',rows:[
      r('deficit','Space deficit, for review','--viz-div-loss-2','fill',{keys:['at_risk','space_deficit_review'],alpha:0.32}),
      r('adequate','Space available','--viz-div-gain-2','fill',{alpha:0.18})]},
    vegetation:{title:'Low canopy and vegetation',kind:'ordinal',note:'2024 LiDAR survey.',rows:[
      r('low_canopy','Low canopy, 2–3 m','--viz-seq-700','fill',{alpha:0.42}),
      r('sub_canopy','Low vegetation, under 2 m','--viz-seq-300','fill',{alpha:0.42})]},
    positions:{title:'Council recorded positions',kind:'categorical',rows:[
      r('position','Recorded position','--viz-cat-7','hollow'),
      r('link','Link to the crown','--viz-cat-7','dashed-line')]},
    candidates:{title:'Earlier low-canopy candidates',kind:'categorical',rows:[
      r('candidate','Candidate from an earlier pass','--viz-cat-6','diamond')]},
    // Parcel edges carry the land type (a pale tint inside is only a reading aid); other or unknown land has none.
    parcels:{title:'Land type of parcels',kind:'categorical',inferred:true,note:'Inferred from zoning. Other or unknown land is not outlined.',rows:[
      r('park','Park & reserve','--viz-land-park','outline'),
      r('street','Street','--viz-land-street','outline'),
      r('institutional','Schools & institutions','--viz-land-institution','outline'),
      r('private','Private property','--viz-land-private','outline')]}
  };
  const legend=k=>LEGENDS[k]||null;
  function rows(k){const L=LEGENDS[k];return L?L.rows.map(x=>({...x,colour:token(x.token)})):[];}
  function colour(k,key){
    const L=LEGENDS[k];if(!L)return null;
    const row=L.rows.find(x=>x.key===key)||L.rows.find(x=>(x.keys||[]).includes(key));
    return row?token(row.token):null;
  }
  // A MapLibre "match" from input values to this legend's colours (each row's key and its extra keys).
  function match(k,input,fallbackKey){
    const e=['match',input];
    for(const x of LEGENDS[k].rows)for(const v of [x.key,...(x.keys||[])].filter((v,i,a)=>a.indexOf(v)===i))e.push(v,token(x.token));
    e.push(fallbackKey?colour(k,fallbackKey):token(MAP_OTHER));
    return e;
  }
  // A MapLibre "step" over a numeric input for an ordinal legend whose rows carry from/to.
  function step(k,input){
    const rs=LEGENDS[k].rows.filter(x=>x.from!=null);
    const e=['step',input,token(rs[0].token)];
    for(const x of rs.slice(1))e.push(x.from,token(x.token));
    return e;
  }
  const other=()=>token(MAP_OTHER);
  // The marks shown with a colour mode: a mode that already has a "no crown linked" row keeps one row for it;
  // "Change since 2013" fades the tree markers, so it shows only its own rows.
  function marksFor(mode){
    if(mode==='change')return [];
    const hollow=LEGENDS[mode]?.rows.some(x=>x.mark==='hollow');
    return rows('marks').filter(x=>!(hollow&&x.key==='unlinked'));
  }
  const MODES=['source','structure','height','change','quality','evidence','tenure'];
  // Layers drawn over the tree markers, and area fills. Area fills are one at a time (index.html turns the
  // others off), and canopy cover by local board draws only below zoom 12, where the others do not.
  const OVERLAYS=['kauri','candidates','positions','parcels','rootzone','vegetation','canopy'];
  // The zooms each layer draws at (index.html layer minzoom/maxzoom; tree markers from 10).
  const ZOOMS={markers:[10,24],kauri:[10,24],candidates:[12,24],positions:[13,24],parcels:[14,24],rootzone:[14,24],vegetation:[12,24],canopy:[0,12]};
  const FILL_THEMES=['parcels','rootzone','vegetation','canopy'];
  // A colour MapLibre's parser takes: CSS Color 4 "rgb(r g b / a%)" becomes "rgba(r, g, b, a)".
  function map(name){
    const v=token(name);if(!v)return v;
    const m=/^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)\s*(?:[\/,]\s*([\d.]+)(%?))?\s*\)$/i.exec(v);
    if(!m)return v;
    const a=m[4]===undefined?1:m[5]?Number(m[4])/100:Number(m[4]);
    return `rgba(${m[1]}, ${m[2]}, ${m[3]}, ${a})`;
  }
  const api={FALLBACK,ALIAS,MAP_OTHER,LEGENDS,MODES,OVERLAYS,FILL_THEMES,ZOOMS,token,map,legend,rows,colour,match,step,other,marksFor,reset:()=>{css=null;}};
  root.ALTOPalette=api;
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof globalThis==='undefined'?window:globalThis);
