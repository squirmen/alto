/* ALTOFormat: the one set of number formatters for the map's tree panel, the tree page, the Area tab and the
 * property card (FE-16), so a value prints one way wherever it appears.
 * - Precision follows the method (design system 4.7): LiDAR heights to 0.1 m, crown area to the whole m² (under
 *   10 m²: 0.1), crown diameter to the whole m, a trunk estimate to the whole cm (a tape measure as measured, 0.1 cm),
 *   one tree's benefits, carbon and runoff to 2 significant figures, totals over an area or a property to 3, cover to
 *   the whole %, counts exact with thousands separators.
 * - A missing value is an en dash (2.8); a range uses an en dash with the unit once (6.2: "36–38 cm", "$380–$700/yr").
 * - Money is "$" (NZD is said in the method); under $10 it shows cents ("$4.60/yr").
 * Load it before every module that formats a value; in Node those modules require it. */
(function(root){
  'use strict';
  const MISSING='–';
  const num=v=>v===null||v===undefined||v===''||typeof v==='boolean'?null:(Number.isFinite(Number(v))?Number(v):null);
  const CACHE=new Map();
  const NF=o=>{const k=JSON.stringify(o);let f=CACHE.get(k);if(!f){f=new Intl.NumberFormat('en-NZ',o);CACHE.set(k,f);}return f;};
  // Up to d decimals with thousands separators ("1,058", "4.5").
  const nf=(v,d=0)=>NF({maximumFractionDigits:d,minimumFractionDigits:0}).format(v);
  // Exactly d decimals: a 0.1 m height reads "7.0 m", never "7 m".
  const fixed=(v,d=1)=>NF({minimumFractionDigits:d,maximumFractionDigits:d}).format(v);
  // Counts: exact, with thousands separators ("13,154").
  const count=v=>{const n=num(v);return n===null?MISSING:nf(Math.round(n));};
  // n significant figures as a number (sums, comparisons) ...
  function sig(v,n=2){const x=num(v);if(x===null||x===0)return x;const p=10**(n-1-Math.floor(Math.log10(Math.abs(x))));return Math.round(x*p)/p;}
  // ... and as printed: "540", "1,200", "3.0", "0.55" (2 figures, one tree's value); "118,000", "21.7", "5" (3 figures,
  // a total: no trailing zeros, which would claim a precision the sum does not have).
  function sigText(v,n=2){const x=num(v);if(x===null)return MISSING;if(x===0)return '0';return NF({minimumSignificantDigits:n>2?1:n,maximumSignificantDigits:n}).format(x);}
  // Precision per quantity: significant figures for a model value of one tree and for a total (area, property).
  const SIG={tree:2,total:3};
  const sigOf=o=>o&&o.sig?o.sig:o&&o.total?SIG.total:SIG.tree;

  // Money: "$540", "$118,000", "$4.60". {sig} or {total:true} for a sum over several trees.
  // From $10 up never finer than the dollar: 3 figures of $62.45 is "$62", not "$62.5" read as "$63".
  function money(v,o){
    const n=num(v);if(n===null)return MISSING;
    const s=sigOf(o),a=Math.abs(n);
    const r=a>=10&&a<10**(s-1)?Math.round(n):sig(n,s);
    return '$'+(Math.abs(r)<10&&r!==Math.round(r)?NF({minimumFractionDigits:2,maximumFractionDigits:2}).format(r):nf(r));
  }
  // Carbon stored: "1.2 t CO₂e", "550 kg CO₂e"; {unit:false} leaves the unit to a heading ("1.2 t", "550 kg").
  function co2(t,o={}){
    const n=num(t);if(n===null)return MISSING;
    const s=sigOf(o),u=o.unit===false?'':' CO₂e';
    if(n>0&&n<0.0005)return `under 1 kg${u}`;
    return n<1?`${sigText(n*1000,s)} kg${u}`:`${sigText(n,s)} t${u}`;
  }
  // Carbon taken up each year, in kg: "430 kg CO₂e/yr".
  const co2Rate=t=>{const n=num(t);return n===null?MISSING:n<1?`${sigText(n*1000,2)} kg CO₂e/yr`:`${sigText(n,2)} t CO₂e/yr`;};
  // Volumes of water a year (runoff avoided, rainfall intercepted): "22 m³/yr".
  const volume=(m3,o)=>{const n=num(m3);return n===null?MISSING:`${sigText(n,sigOf(o))} m³/yr`;};
  const metres=(v,d=1)=>{const n=num(v);return n===null?MISSING:`${fixed(n,d)} m`;};
  // Crown area and other areas of one tree: whole m², under 10 m² to 0.1 ("316 m²", "4.5 m²").
  const areaValue=n=>n<10?nf(n,1):nf(Math.round(n));
  const area=m2=>{const n=num(m2);return n===null?MISSING:`${areaValue(n)} m²`;};
  // A summed area (a parcel, the crowns in a view): whole m² below a hectare, then ha to 3 figures ("1,964 m²",
  // "1.12 ha", "123 ha"), as [value, unit] (viewArea) or as text (land).
  const viewArea=m2=>{const n=num(m2);if(n===null)return null;return n>=10000?[nf(sig(n/10000,3),2),'ha']:[nf(Math.round(n)),'m²'];};
  const land=m2=>{const a=viewArea(m2);return a?`${a[0]} ${a[1]}`:MISSING;};
  const pct=v=>{const n=num(v);return n===null?MISSING:`${nf(Math.round(n))}%`;};
  // Release totals in words, never to the dollar: "about NZ$295 million", "about 20.5 million m³".
  function about(v,{prefix='',unit=''}={}){
    const n=num(v);if(n===null)return MISSING;
    const big=n>=1e9?[n/1e9,'billion']:n>=1e6?[n/1e6,'million']:null;
    return big?`about ${prefix}${nf(sig(big[0],3),2)} ${big[1]}${unit?` ${unit}`:''}`:`about ${prefix}${nf(sig(n,3))}${unit?` ${unit}`:''}`;
  }

  // One key measurement as [value, unit] by the rule for its quantity, or null for a quantity without a rule.
  const METRES=/^survey|^height$|crownMax|meanHeight|canopyTop|liveCrownBase|rootProtection|^dripline$|^rootZone|^crownSpread$/;
  function quantity(key,v,{measuredTape=false,total=false}={}){
    const n=num(v);if(n===null)return null;
    if(METRES.test(key))return [fixed(n,1),'m'];
    const s=total?SIG.total:SIG.tree;
    switch(key){
      case 'crownArea':case 'crownOutline':return [areaValue(n),'m²'];
      case 'crownDiameter':return [nf(Math.round(n)),'m'];
      case 'trunkDiameter':case 'largestStem':return [measuredTape?nf(n,1):nf(Math.round(n)),'cm'];
      case 'benefits':return [money(n,{sig:s}),'/yr'];
      case 'carbonStored':return n<1?[sigText(n*1000,s),'kg CO₂e']:[sigText(n,s),'t CO₂e'];
      case 'stormwater':return [sigText(n,s),'m³/yr'];
      case 'replacementYears':return [nf(Math.round(n)),'years'];
      default:return null;
    }
  }
  const tight=u=>u.startsWith('/')||u==='%';                                                // "$540/yr", "93%"
  const joined=([v,u])=>u?(tight(u)?`${v}${u}`:`${v} ${u}`):v;
  const quantityText=(key,v,o)=>{const f=quantity(key,v,o);return f?joined(f):MISSING;};
  // A range as printed ("$380–$700/yr", "36–38 cm", "550 kg–1.2 t CO₂e"), or null when its ends print the same.
  function range(key,lo,hi,o){
    const a=quantity(key,lo,o),b=quantity(key,hi,o);if(!a||!b||a[0]===b[0]&&a[1]===b[1])return null;
    return b[1].startsWith('/')?`${a[0]}–${b[0]}${b[1]}`:a[1]===b[1]?`${a[0]}–${b[0]} ${b[1]}`:`${a[0]} ${a[1]}–${b[0]} ${b[1]}`;
  }

  const api={MISSING,SIG,num,nf,fixed,count,sig,sigText,money,co2,co2Rate,volume,metres,area,areaValue,land,viewArea,pct,about,quantity,quantityText,range,joined};
  root.ALTOFormat=api;
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof globalThis==='undefined'?window:globalThis);
