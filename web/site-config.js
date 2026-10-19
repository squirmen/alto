/* Site settings for the map, the tree page and Species maxima: where the data release is (AKL_DATA_BASE) and the
 * tiles' cache stamp (AKL_TILE_VERSION; "auto" reads assembly.tile_version from release-metadata.json). The tool build
 * (pipeline/tool/build_web_beta.py) writes this file for the site it is built for and stamps its URL with a hash of
 * its content, so a rebuilt setting is never served from a cache. A file, not an inline script, so the site's
 * Content-Security-Policy needs no 'unsafe-inline' (FE-15). */
window.AKL_DATA_BASE="./data";window.AKL_TILE_VERSION="20261010-v5.2";
