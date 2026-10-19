/* The 404 page (404.html): names the address that was asked for and, when it holds a tree number (/trees/TMCTT6X4,
 * /tree/TMCTT6X4/photos), links that tree's page. A mistyped number is offered no guess here: the tree page, which reads
 * the release's table, gives the one correction there is. */
(function(){
  'use strict';
  const Id=window.ALTOTreeId;
  let path=location.pathname;
  try{path=decodeURIComponent(path);}catch{}
  const where=document.getElementById('nfPath');
  if(where&&path&&path!=='/404.html'){where.append(': ');const c=document.createElement('code');c.textContent=path.slice(0,200);where.append(c);}
  if(!Id)return;
  const number=path.split('/').map(s=>Id.parseNumber(s).number).find(Boolean);
  const box=document.getElementById('nfTree');
  if(number&&box){
    const a=document.createElement('a');a.href=`/tree/${number}`;a.textContent=`Open tree ${number}`;
    box.append('This address holds a tree number: ',a,'.');box.hidden=false;
  }
})();
