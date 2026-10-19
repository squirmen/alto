/* Methods index (methods.html, UX-01): marks the release the site serves now, read from its release-metadata.json
 * (dataset_version "...-v6.2" -> release 6.2). Until then, or if the file does not load, the page keeps the mark it
 * was published with. */
(function(){
  'use strict';
  const root=String(window.ALTO_SITE_ROOT||'.').replace(/\/+$/,'')||'.';
  fetch(`${root}/release-metadata.json`).then(r=>r.ok?r.json():null).then(m=>{
    const hit=/-v(\d+(?:\.\d+)?)$/.exec(String(m?.release?.dataset_version||''));if(!hit)return;
    const items=[...document.querySelectorAll('.mi-release[data-release]')];
    if(!items.some(li=>li.dataset.release===hit[1]))return;
    for(const li of items){
      const cur=li.dataset.release===hit[1],a=li.querySelector('h3 a'),mark=li.querySelector('.mi-current');
      li.classList.toggle('is-current',cur);
      if(cur)a.setAttribute('aria-current','true');else a.removeAttribute('aria-current');
      if(mark)mark.hidden=!cur;
    }
  }).catch(()=>{});
})();
