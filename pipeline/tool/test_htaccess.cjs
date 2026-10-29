// Checks for the site's Apache template (web/htaccess.example, FE-07): every plain-HTTP request answers 301 to the
// same https URL (path and query kept, before any other rewrite rule), and HTTPS responses carry HSTS for one year with
// no includeSubDomains or preload.
// With ALTO_TEST_APACHE=1 and a local Apache 2.4 (/usr/sbin/httpd on macOS), the template also runs for real: a
// throwaway server on 127.0.0.1 (one http and one https port, self-signed certificate, KYTE-like subfolders with their
// own .htaccess) answers /, /tree/<number>?query, /kyte/?tree=&task=, /kyte/api/ and /data/* with 301 on http and HSTS
// on https; on https, tree links in any case and copied with spaces, dashes or closing punctuation redirect to the tree
// page with an ID that reads as the number (UX-13), and an address that names no file gets ALTO's 404 page. Nothing
// leaves the machine.
// Usage: node pipeline/tool/test_htaccess.cjs   (ALTO_TEST_APACHE=1 node ... for the Apache run)
'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),cp=require('node:child_process');
const web=path.join(__dirname,'..','..','web')+'/';
const ht=fs.readFileSync(web+'htaccess.example','utf8');
const Id=require(web+'tree-id.js');
const rules=ht.split('\n').filter(l=>!/^\s*#/.test(l)).join('\n');

// ---- the template
{
  const redirect=rules.indexOf('RewriteRule ^ https://%{HTTP_HOST}%{REQUEST_URI} [R=301,L,NE]');
  assert.ok(redirect>0,'a 301 to the same host, path and query on https');
  assert.ok(/RewriteEngine On\n\s*RewriteCond %\{HTTPS\} !=on\n\s*RewriteCond %\{HTTP:X-Forwarded-Proto\} !=https\n\s*RewriteRule \^ https:/.test(rules),'only plain-HTTP requests, never one a TLS proxy already upgraded');
  const other=[...rules.matchAll(/RewriteRule\s+(\S+)/g)].map(m=>m.index);
  assert.equal(Math.min(...other),redirect,'the https rule comes before every other rewrite rule');
  assert.ok(!/RewriteRule[^\n]*\[[^\]]*QSD/.test(rules),'the query string is kept');
  const hsts=/Header always set Strict-Transport-Security "([^"]+)" "expr=%\{HTTPS\} == 'on'"/.exec(rules);
  assert.ok(hsts,'HSTS on HTTPS responses only, error responses included (always)');
  assert.equal(hsts[1],'max-age=31536000','one year');
  assert.ok(!/includeSubDomains|preload/i.test(rules),'no includeSubDomains or preload until every tfwelch.com subdomain is checked');
  assert.ok(ht.indexOf('# ---- HTTPS only')<ht.indexOf('# ---- MIME types'),'the HTTPS block opens the template');
  // UX-13: permanent tree links in any case, with whatever a copied link carries; ALTO's own 404 page
  assert.ok(rules.includes('RewriteRule ^tree/([^/]{1,190})/?$ /tree.html?id=$1 [NC,B,R=302,L,QSA]'),'/tree/<ID>: any case, any characters but /, escaped into ?id=');
  // Printed short links: temporary (302) so a code on paper can be repointed; every /go/ path lands somewhere.
  for(const [code,to] of [['dps','/kyte/?from=dps'],['dps-map','/?from=dps'],['leafy','/kyte/?from=leafylab'],['leafy-map','/?from=leafylab'],['flyer','/kyte/?from=flyer'],['flyer-map','/?from=flyer'],['kyte','/kyte/?from=go'],['map','/?from=go']])
    assert.ok(rules.includes(`RewriteRule ^go/${code}/?$ ${to} [NC,R=302,L]`),`/go/${code} -> ${to} (302)`);
  assert.ok(rules.includes('RewriteRule ^go(/.*)?$ / [NC,R=302,L]')&&!/R=301[^\n]*go\//.test(rules),'/go/<unknown> -> the map; no permanent go-links');
  assert.ok(/^ErrorDocument 404 \/404\.html$/m.test(rules)&&fs.existsSync(web+'404.html'),'ErrorDocument 404 /404.html, and the page exists');
  // FE-04: versioned files and a release's derived files are immutable; pages keep 10 minutes; the release metadata is
  // fresh for a minute and revalidated in the background; KYTE's folder is left to its own rules.
  assert.ok(rules.includes('<If "%{REQUEST_URI} !~ m#^/kyte/# && %{REQUEST_URI} !~ m#(\\.html|/)$# && (%{QUERY_STRING} =~ /(^|&)v=[^&]+/ || %{REQUEST_URI} =~ m#^/derived/[^/]+/.#)">\n    Header set Cache-Control "public, max-age=31536000, immutable"'),'?v= and /derived/<release>/: immutable');
  assert.ok(/<Files "release-metadata\.json">\s*Header set Cache-Control "public, max-age=60, stale-while-revalidate=600"/.test(rules),'release-metadata.json: a minute, then stale-while-revalidate');
  assert.ok(/<FilesMatch "\\\.html\$">\s*Header set Cache-Control "public, max-age=600, must-revalidate"/.test(rules),'pages: 10 minutes');
  for(const f of ['index.html','tree.html','maxima.html'])assert.ok(!/cache:\s*'no-store'|cache:\s*"no-store"/.test(fs.readFileSync(web+f,'utf8')),`${f}: no no-store fetch`);
  for(const f of ['tree-page.js','maxima-page.js'])assert.ok(!/no-store/.test(fs.readFileSync(web+f,'utf8')),`${f}: no no-store fetch`);
}

// ---- the 404 page: search, the three pages a lost reader wants, links that work at any depth (UX-13)
{
  const nf=fs.readFileSync(web+'404.html','utf8');
  assert.ok(/<form class="nf-search" action="\/" method="get" role="search">[\s\S]*?<input id="nfQuery" name="q" type="search"/.test(nf),'404: a search form that opens the map with ?q=');
  for(const [href,text] of [['/','Map'],['/maxima.html','Species maxima'],['/credits.html','Sources and credits']])
    assert.ok(nf.includes(`<li><a href="${href}">${text}</a><span class="meta">`),`404: links ${text}`);
  const refs=[...nf.matchAll(/(?:href|src)="([^"]+)"/g)].map(m=>m[1]).filter(u=>!/^(https?:|mailto:|#|data:)/.test(u));
  assert.ok(refs.length>10&&refs.every(u=>u.startsWith('/')),`404: every link and file from the site root (${refs.filter(u=>!u.startsWith('/')).join(', ')})`);
  assert.ok(nf.includes('<meta name="robots" content="noindex">')&&nf.includes('<title>Page not found · ALTO</title>'),'404: not indexed, titled');
  const map=(fs.readFileSync(web+'index.html','utf8')+fs.readFileSync(web+'map-app.js','utf8'));
  assert.ok(map.includes('const handed = new URL(window.location.href).searchParams.get("q")?.trim();')&&map.includes('input.value = handed;'),'map: ?q= opens the search with the text');
  const js=fs.readFileSync(web+'not-found.js','utf8');
  assert.ok(js.includes("Id.parseNumber(s).number")&&js.includes("a.href=`/tree/${number}`")&&!js.includes('innerHTML'),'404: a tree number in the address is linked (text only)');
}

// ---- the template on a local Apache (opt-in)
const HTTPD='/usr/sbin/httpd',MODS='/usr/libexec/apache2';
async function apacheRun(){
  const http=require('node:http'),https=require('node:https');
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'alto-htaccess-'));
  const root=path.join(dir,'root'),logs=path.join(dir,'logs');
  for(const d of [root,logs,path.join(root,'kyte','api'),path.join(root,'data','tree_ids')])fs.mkdirSync(d,{recursive:true});
  fs.writeFileSync(path.join(root,'.htaccess'),ht);
  // KYTE's folders carry their own .htaccess (headers only, no RewriteEngine): the root rule must still apply there.
  fs.writeFileSync(path.join(root,'kyte','.htaccess'),'<IfModule mod_headers.c>\n  Header always set X-Frame-Options "SAMEORIGIN"\n</IfModule>\n');
  fs.writeFileSync(path.join(root,'kyte','api','.htaccess'),'<IfModule mod_headers.c>\n  Header always set Cache-Control "no-store, private"\n</IfModule>\n');
  for(const f of ['index.html','kyte/index.html','tree.html'])fs.writeFileSync(path.join(root,f),'<!doctype html><title>t</title>');
  fs.mkdirSync(path.join(root,'derived','rel-1'),{recursive:true});
  for(const f of ['release-metadata.json','app.js','kyte/k.js','derived/rel-1/m.json'])fs.writeFileSync(path.join(root,f),f.endsWith('.js')?'1;':'{}');
  fs.copyFileSync(web+'404.html',path.join(root,'404.html'));
  fs.writeFileSync(path.join(root,'data','a.json'),'{}');
  const key=path.join(dir,'k.pem'),crt=path.join(dir,'c.pem');
  cp.execFileSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-keyout',key,'-out',crt,'-days','1','-subj','/CN=127.0.0.1'],{stdio:'ignore'});
  const port=18000+Math.floor(Math.random()*2000),sport=port+1;
  const mods=['mpm_prefork','authz_core','unixd','mime','dir','rewrite','headers','ssl','deflate','filter','expires','setenvif','env','log_config'];
  fs.writeFileSync(path.join(dir,'httpd.conf'),[`ServerRoot "${dir}"`,`PidFile "${logs}/httpd.pid"`,`ErrorLog "${logs}/error.log"`,'LogLevel warn','Mutex posixsem default',
    `DefaultRuntimeDir "${logs}"`,`Listen 127.0.0.1:${port}`,`Listen 127.0.0.1:${sport}`,...mods.map(m=>`LoadModule ${m}_module ${MODS}/mod_${m}.so`),
    'ServerName 127.0.0.1',`DocumentRoot "${root}"`,`<Directory "${root}">`,'  AllowOverride All','  Require all granted','</Directory>',
    `<VirtualHost 127.0.0.1:${sport}>`,'  SSLEngine on',`  SSLCertificateFile "${crt}"`,`  SSLCertificateKeyFile "${key}"`,'</VirtualHost>',''].join('\n'));
  const conf=path.join(dir,'httpd.conf');
  cp.execFileSync(HTTPD,['-f',conf,'-k','start'],{stdio:'ignore'});
  const get=(lib,url)=>new Promise((ok,no)=>lib.get(url,{headers:{'User-Agent':'Mozilla/5.0 (Macintosh) Chrome/141'},rejectUnauthorized:false},r=>{let body='';r.setEncoding('utf8');r.on('data',d=>body+=d);r.on('end',()=>ok({status:r.statusCode,headers:r.headers,body}));}).on('error',no));
  try{
    await new Promise(r=>setTimeout(r,800));
    for(const p of ['/','/tree/TZ69KK1G?x=1&y=%C5%8D','/kyte/?tree=TZ69KK1G&task=girth','/kyte/api/index.php?a=1','/data/a.json','/data/tree_ids/ab.json.gz']){
      const r=await get(http,`http://127.0.0.1:${port}${p}`);
      assert.equal(r.status,301,`http ${p}: 301`);
      assert.equal(r.headers.location,`https://127.0.0.1:${port}${p}`,`http ${p}: the same URL on https`);
      assert.equal(r.headers['strict-transport-security'],undefined,`http ${p}: no HSTS over http`);
    }
    for(const p of ['/','/kyte/','/data/a.json','/not-here']){
      const r=await get(https,`https://127.0.0.1:${sport}${p}`);
      assert.ok(r.status===200||(p==='/not-here'&&r.status===404),`https ${p}: served (${r.status})`);
      assert.equal(r.headers['strict-transport-security'],'max-age=31536000',`https ${p}: HSTS`);
    }
    // UX-13: tree links, however they were typed or copied, open the tree page with an ID that reads as the number
    for(const p of ['/tree/TMCTT6X4','/tree/TMCTT6X4.','/tree/TMCTT6X4)','/tree/TMCT%20T6X4','/Tree/TMCTT6X4','/TREE/tmct-t6x4/','/tree/tmct-t6x4',
      '/tree/TMCT%C2%A0T6X4','/tree/TMCT%E2%80%90T6X4','/tree/TMCT%E2%80%93T6X4','/tree/TMCT%E2%80%95T6X4','/tree/TMCTT6X4?from=mail']){
      const r=await get(https,`https://127.0.0.1:${sport}${p}`);
      assert.equal(r.status,302,`https ${p}: 302 (${r.status})`);
      const to=new URL(r.headers.location,`https://127.0.0.1:${sport}/`);
      assert.equal(to.pathname,'/tree.html',`https ${p}: to the tree page`);
      assert.equal(Id.normalise(to.searchParams.get('id')),'TMCTT6X4',`https ${p}: id=${to.searchParams.get('id')}`);
      if(p.includes('?from='))assert.equal(to.searchParams.get('from'),'mail',`https ${p}: the query kept`);
    }
    // FE-04: the cache policy, as served
    const cc=async p=>(await get(https,`https://127.0.0.1:${sport}${p}`)).headers['cache-control']||'';
    for(const p of ['/app.js?v=tool-0.2.9','/data/a.json?v=20261013-v6.2','/derived/rel-1/m.json'])assert.equal(await cc(p),'public, max-age=31536000, immutable',`${p}: immutable`);
    assert.equal(await cc('/release-metadata.json'),'public, max-age=60, stale-while-revalidate=600','release-metadata.json');
    for(const p of ['/tree.html','/tree.html?v=1','/'])assert.equal(await cc(p),'public, max-age=600, must-revalidate',`${p}: 10 minutes`);
    for(const p of ['/kyte/k.js?v=1','/app.js'])assert.ok(!/immutable/.test(await cc(p)),`${p}: not immutable`);
    // an address that names no file gets ALTO's 404 page (status 404)
    for(const p of ['/tree/','/tree/a/b','/not-here','/trees/TMCTT6X4']){
      const r=await get(https,`https://127.0.0.1:${sport}${p}`);
      assert.equal(r.status,404,`https ${p}: 404`);
      assert.ok(r.body.includes('<h1>Page not found</h1>')&&r.body.includes('action="/"'),`https ${p}: ALTO's 404 page`);
    }
  }finally{
    try{cp.execFileSync(HTTPD,['-f',conf,'-k','stop'],{stdio:'ignore'});}catch{}
    await new Promise(r=>setTimeout(r,300));
    fs.rmSync(dir,{recursive:true,force:true});
  }
}
(async()=>{
  const run=process.env.ALTO_TEST_APACHE==='1'&&fs.existsSync(HTTPD)&&fs.existsSync(`${MODS}/mod_rewrite.so`);
  if(run)await apacheRun();
  console.log(`htaccess: the http to https 301 (path and query kept, first rewrite rule) and one-year HSTS checked${run?', and run on a local Apache':' (set ALTO_TEST_APACHE=1 to run it on a local Apache)'}`);
})().catch(e=>{console.error(e);process.exit(1);});
