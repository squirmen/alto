/* KYTE tasks the tool links to.
 *
 * girthTask: false  Off by default. When true, a tree holding a species maximum on a street or in a park (never kauri;
 *                   maxima.json trees[...].kyte_girth) gets "Measure its girth (KYTE)" on its tree page and in the map
 *                   panel, linking to <site>/kyte/?tree=<tree number>&task=girth. Switch it on when the KYTE release
 *                   that reads task=girth is live.
 *
 * problemTask: false  Off until the KYTE release that reads task=problem is live. When true, the tree page and the map
 *                   panel show "Report a problem with this record", linking to
 *                   <site>/kyte/?tree=<tree number>&task=problem&release=<dataset version>. */
window.ALTO_KYTE_CONFIG = { girthTask: true, problemTask: false };
