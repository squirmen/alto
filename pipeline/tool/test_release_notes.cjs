'use strict';
// UX-08: About's "What changed" opens the per-release list of the methods index (data-sheet wording, one methods page per
// release), not the developer changelog; the changelog has every published release and its "Versioning" link reads as a
// word. Run: node pipeline/tool/test_release_notes.cjs
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const cp = require('child_process');

const REPO = path.join(__dirname, '..', '..');
const WEB = path.join(REPO, 'web');
const read = f => fs.readFileSync(path.join(WEB, f), 'utf8');

// ---- About: "What changed" is the methods index's release list, opened in the same tab
const map = (read('index.html')+read('map-app.js'));
assert.ok(map.includes('<a id="changelogLink" href="./methods.html#releases">What changed</a>'), 'About: What changed opens the release list');
assert.ok(!/changelogLink[^>]*target=/.test(map), 'About: What changed is a page of this site, not a new tab');
for (const f of fs.readdirSync(WEB).filter(f => /\.(html|js)$/.test(f))) assert.ok(!read(f).includes('ALTO_CHANGELOG'), `${f}: no changelog override`);
const build = fs.readFileSync(path.join(__dirname, 'build_web_beta.py'), 'utf8');
assert.ok(!build.includes('ALTO_CHANGELOG'), 'build: no changelog override in the page script');

// ---- the release list: one entry per methods page, data-sheet wording, no developer terms
const idx = read('methods.html');
const sec = /<section id="releases"[\s\S]*?<\/section>/.exec(idx);
assert.ok(sec, 'methods index: a Releases section with id="releases"');
const items = [...sec[0].matchAll(/<li class="mi-release[^"]*" data-release="([\d.]+)"[\s\S]*?<\/li>/g)];
const pages = fs.readdirSync(WEB).filter(f => /^v\d+-methods\.html$/.test(f)).sort();
assert.equal(items.length, pages.length, 'one release entry per methods page');
for (const [li, rel] of items) {
  const href = /<h3><a href="\.\/(v\d+-methods\.html)"/.exec(li);
  assert.ok(href && fs.existsSync(path.join(WEB, href[1])), `release ${rel}: links its methods page`);
  assert.equal(href[1], `v${rel.replace('.', '')}-methods.html`, `release ${rel}: the page of that release`);
  assert.ok(/<time datetime="\d{4}-\d{2}-\d{2}">/.test(li), `release ${rel}: dated`);
}
const text = sec[0].replace(/<[^>]+>/g, ' ');
for (const [re, term] of [[/\br15\b/, 'r15'], [/tombstone/i, 'tombstones'], [/\btn\b/, 'tn'], [/A2 \+ C1/, 'A2 + C1'], [/`/, 'code marks']])
  assert.ok(!re.test(text), `release list: no developer term (${term})`);
assert.ok(sec[0].includes('<a href="./changelog.html">changelog</a>'), 'release list: the developer changelog is one plain link below the list');

// ---- the changelog: every published release, none marked unpublished, "Versioning" as a word
const log = fs.readFileSync(path.join(REPO, 'CHANGELOG.md'), 'utf8');
const data = log.slice(log.indexOf('\n## Data'));
for (const rel of items.map(m => m[1])) assert.ok(new RegExp(`^### v${rel.replace('.', '\\.')} \\(`, 'm').test(data), `changelog: release ${rel} has an entry`);
assert.ok(!/not yet published/.test(data), 'changelog: no published release marked unpublished');
assert.ok(log.includes('[Versioning](VERSIONING.md)') && !log.includes('[VERSIONING.md]'), 'changelog: the Versioning link reads as a word');

// ---- the build renders it so, and a beta build sends What changed to the site root's release list
const py = `
import importlib.util, json, sys
spec = importlib.util.spec_from_file_location('bwb', sys.argv[1]); m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
page = m.site_links(m.changelog_html(open(sys.argv[2]).read(), '0.0.0').replace('href="VERSIONING.md"', 'href="versioning.html"'), '.')
beta = m.site_links('<a id="changelogLink" href="./methods.html#releases">What changed</a> <a href="./methods.html">Methods</a> <a href="./how-alto-is-made.html#records">x</a>', '..')
print(json.dumps({'page': page, 'beta': beta}))`;
const out = JSON.parse(cp.execFileSync('python3', ['-I', '-c', py, path.join(__dirname, 'build_web_beta.py'), path.join(REPO, 'CHANGELOG.md')], { encoding: 'utf8' }));
assert.ok(out.page.includes('See <a href="versioning.html">Versioning</a>.'), 'changelog page: the link reads Versioning');
assert.ok(/<h3>v6\.2 \(/.test(out.page) && /<h3>v6\.1 \(/.test(out.page), 'changelog page: releases 6.2 and 6.1');
assert.equal(out.beta, '<a id="changelogLink" href="../methods.html#releases">What changed</a> <a href="../methods.html">Methods</a> <a href="../how-alto-is-made.html#records">x</a>', 'beta build: What changed and section links read the site root');

console.log('release notes: What changed opens the release list; the changelog has every release and a Versioning link');
