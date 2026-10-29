'use strict';
// The tree-number vectors shared with KYTE (its tests/fixtures/tree_number_vectors.json and tests/numbers.test.js):
// what web/tree-id.js answers for each input, resolved against the trimmed alias table in fixtures/tree_ids (the rows
// these inputs look up, copied from the release's data/tree_ids; nothing else). KYTE's resolver must give the same
// answers, so a change here is copied to KYTE's fixture.
// Usage: node pipeline/tool/tree_number_vectors.cjs           (rewrites fixtures/tree_number_vectors.json)
//        node pipeline/tool/tree_number_vectors.cjs --check   (exit 1 when the file is not what tree-id.js answers)
const fs = require('node:fs'), path = require('node:path');
const Id = require(path.join(__dirname, '..', '..', 'web', 'tree-id.js'));
const FIX = path.join(__dirname, 'fixtures');
const OUT = path.join(FIX, 'tree_number_vectors.json');

const INPUTS = [
  // numbers: typed, copied and mistyped
  'TMCTT6X4', 'tmct-t6x4', ' TMCT T6X4 ', 'TMCTT6X5', 'TMCTTX64', 'TMCT T6XA', 'Takapuna', 'Tanekaha', 'T1234567', 'TIL0O0OO',
  // record IDs, crown keys and the alias statuses
  'akl_tree_not_336', 'not_336', 'AKL_TREE_not_336', 'akl_tree_lid_1097624', 'akl_tree_pc4_3493682_11851994', 'akl_tree_lid_0001873',
  '3503762_11855514', '3481214_11826658', '3480992_11791538', 'pc_BA32_1000_3310:1760474.75:5922651.75', 'akl_tree_lid_1128531',
  'TKYTE01R', 'TKYTE02P', 'T162DYHP', 'T162-DYHP', 'akl_tree_lid_9999999', 'TZZZZZZZ', '', 'hello world', 'akl_tree_a b',
  'field:0b5e2c1a-1d2b-4c3d-8e4f-5a6b7c8d9e0f',
  // UX-13: a link copied from a sentence, %-escaped, typed with other dashes and spaces
  'TMCTT6X4.', 'TMCTT6X4)', '(TMCTT6X4)', 'TMCT%20T6X4', 'TMCT T6X4', 'TMCT‐T6X4', 'TMCT‑T6X4', 'TMCT‒T6X4',
  'TMCT–T6X4', 'TMCT—T6X4', 'TMCT―T6X4', 'TMCT​T6X4', 'akl_tree_not_336.',
  // UX-13: every 8-character input starting with T is shaped like a number; record IDs the table does not hold
  'TATFKBGX', 'TANEKAHA', 'akl_tree_does_not_exist', 'AKL_TREE_NOT_336',
];
// The address a link opens with (/tree/<ID> in any case, ?id= or ?tree=) -> the ID the page reads.
const LINKS = [
  'https://alto.org.nz/tree/TMCTT6X4', 'https://alto.org.nz/Tree/TMCTT6X4', 'https://alto.org.nz/TREE/tmct-t6x4/',
  'https://alto.org.nz/tree/TMCT%20T6X4', 'https://alto.org.nz/tree/TMCTT6X4.', 'https://alto.org.nz/tree/TMCTT6X4)',
  'https://alto.org.nz/tree.html?id=TMCT%E2%80%93T6X4', 'https://alto.org.nz/?tree=TMCT%C2%A0T6X4',
];
const CHECKS = ['000000', 'KYTE01', 'MCTT6X', '162DYH', 'ZZZZZZ', 'A1B2C3'];

function fetchFixture(url) {
  const p = path.join(FIX, String(url).replace(/^\.\/fixture-data\//, '').replace(/\?.*$/, ''));
  if (!fs.existsSync(p)) return Promise.resolve({ ok: false, status: 404 });
  const b = fs.readFileSync(p);
  return Promise.resolve({ ok: true, status: 200, arrayBuffer: async () => b.buffer.slice(b.byteOffset, b.byteOffset + b.length) });
}
async function build() {
  const saved = global.fetch;
  global.fetch = fetchFixture;
  try {
    const opts = { base: './fixture-data', version: 'fixture', metadata: { derived_products: { tree_ids: 'data/tree_ids/schema.json' } } };
    const cases = [];
    for (const input of INPUTS) {
      const r = await Id.resolve(input, opts);
      cases.push({
        input, parse: Id.parseNumber(input), normalise: Id.normalise(input), isNumberShaped: Id.isNumberShaped(input),
        typedAsNumber: Id.typedAsNumber(input), near: Id.nearNumbers(input).sort(), suggest: await Id.suggestNumber(input, opts),
        resolve: { key: r.key, kind: r.kind, status: r.status, number: r.number, tree_id: r.tree_id, relation: r.relation, successors: r.successors, note: r.note },
      });
    }
    return {
      source: 'ALTO web/tree-id.js (tool-v0.2) against pipeline/tool/fixtures/tree_ids; written by pipeline/tool/tree_number_vectors.cjs',
      cases, links: LINKS.map(url => ({ url, id: Id.fromLocation(url), normalise: Id.normalise(Id.fromLocation(url)) })),
      check_chars: CHECKS.map(payload => ({ payload, check: Id.checkChar(payload) })),
    };
  } finally { global.fetch = saved; }
}
const text = v => JSON.stringify(v, null, 1) + '\n';
module.exports = { build, text, OUT, INPUTS };
if (require.main === module) {
  build().then(v => {
    if (process.argv.includes('--check')) {
      const same = fs.existsSync(OUT) && fs.readFileSync(OUT, 'utf8') === text(v);
      console.log(same ? 'tree_number_vectors.json: current' : 'tree_number_vectors.json: out of date (run without --check)');
      process.exit(same ? 0 : 1);
    }
    fs.writeFileSync(OUT, text(v));
    console.log(`wrote ${path.relative(process.cwd(), OUT)}: ${v.cases.length} cases, ${v.links.length} links`);
  }).catch(e => { console.error(e); process.exit(1); });
}
