/* ALTO map: the page's own script (it ran inline in index.html until tool 0.2.9; FE-15). It runs where index.html
 * loads it, after the libraries (map-libs.js, MapLibre, PMTiles, tile-cache.js) and before the comparison dialog,
 * About and the elements that follow it in the page, exactly as the inline script did. Kept byte for byte, with its
 * indentation, so the history of every line stays readable. */
    // The libraries (map-libs.js: unpkg, or this site's vendor copies): without them the map cannot start.
    if (!window.maplibregl || !window.pmtiles) {
      const st = document.getElementById("status"); if (st) { st.textContent = window.ALTOLibs?.MESSAGE || "Map library could not be loaded."; st.dataset.error = "libraries"; }
      throw new Error("Map library could not be loaded");
    }
    // Release totals come from the release metadata (dataset.headline_totals) and the species list from the release's
    // species_options.json; nothing is baked into the page.
    let SPECIES_OPTIONS = [];
    // Species options as people see them: one option per species (spellings, macrons and the kauri survey's result codes
    // folded: "Kauri (PA+ PC+ soil:Nil)" is a kauri), each with every source spelling it covers; a source string naming
    // several species is its own option, labelled "Recorded as: …", and is never offered by the search as a species.
    let SPECIES_GROUPS = [];
    // Release 6.3 (species_options.json version 2): options keyed by species (sp on the map: the accepted binomial, or
    // the common name where no Latin name is recorded), grouped by common name with each Latin name as a sub-option; the
    // filter reads sp. Release 6.2: one option per common name, filtering on species_common. keys: the filter values a
    // group selects (species keys, or its source spellings).
    let SPECIES_KEYED = false, SPECIES_V2 = null;
    function buildSpeciesGroups() {
      const r = ALTOFields.speciesGroups(SPECIES_KEYED ? SPECIES_V2 : { options: SPECIES_OPTIONS }, window.ALTOSpeciesNames);
      SPECIES_GROUPS = r.groups;
    }
    const groupOn = grp => grp.keys.length > 0 && grp.keys.every(n => state.selectedSpecies.has(n));
    const selectedGroups = () => SPECIES_GROUPS.filter(grp => grp.keys.some(n => state.selectedSpecies.has(n)));
    // A Latin sub-option as text ("Prunus serrulata"; a key with no Latin name says so).
    const subLabel = s => s.latin ? (window.ALTOSpeciesNames?.latinText(s.latin) || s.latin) : `${s.key} (no Latin name recorded)`;
    // The Species group's value: one species; release 6.3, where only some of its Latin names are chosen, which ones
    // ("Cherry: Prunus serrulata", "Cherry (2 of 4)"); or how many species.
    function speciesValue() {
      const sel = selectedGroups();
      if (sel.length !== 1) return sel.length ? `${sel.length} species` : "All species";
      const g = sel[0];
      if (groupOn(g) || !SPECIES_KEYED) return g.label;
      const on = g.subs.filter(s => state.selectedSpecies.has(s.key));
      return on.length === 1 ? `${g.label}: ${subLabel(on[0])}` : `${g.label} (${on.length} of ${g.subs.length})`;
    }

    // Sources, status and data quality are separate filters (sources.js); a tree can have several sources.
    const SOURCE_KEYS = ALTOSources.SOURCE_KEYS, QUALITY_KEYS = ALTOSources.QUALITY_KEYS;
    // Land chips over the inferred "tenure" tile field (zoning, designations, park extents and
    // parcels; not ownership). Coastal or water land and unknown land share one chip.
    const LAND_GROUPS = [["street", ["street"]], ["park", ["park"]], ["institutional", ["institutional"]], ["private", ["private"]], ["other", ["other", "unknown"]]];
    // Colours: palette.js (design system tokens). Every map colour below comes from it.
    const PAL = ALTOPalette, tok = name => PAL.map(name);
    const LAND_COLOURS = Object.fromEntries(["street", "park", "institutional", "private", "other", "unknown"].map(k => [k, PAL.colour("tenure", k)]));
    // The tree, crown and parcel tiles carry tree records, LiDAR crowns and land data: one credit (credits.js) on
    // all three sources, so the attribution control shows it once. It names the sources and licensors the
    // providers ask for; Sources and credits (credits.html) lists every dataset with its licence and link.
    const DATA_CREDIT = ALTOCredits.MAP.data;
    const DETECTION_SOURCES = ["lidar_inferred_canopy", "lidar_pointcloud_v4", "lidar_pointcloud_v5", "low_canopy_promoted", "pointcloud_missed_promoted"];
    const UNCERTAIN_TIERS = ["location_unverified", "earlier_detection","possible", "unverified", "possible_duplicate"];
    function isDetection(props) { return DETECTION_SOURCES.includes(props.source_primary); }
    const LOW_CANOPY_HIDDEN_FILTER = ["==", ["get", "candidate_id"], "__hidden__"];
    const MISSED_HIDDEN_FILTER = ["==", ["get", "candidate_id"], "__hidden__"];
    const CHANGE_HIDDEN_FILTER = ["==", ["get", "fate"], "__hidden__"];
    const ROOTZONE_HIDDEN_FILTER = ["==", ["get", "constraint"], "__hidden__"];

    // Canopy-growth quick filter buckets (2016→2024 change detection).
    // [key, label, glyph, baked-in count]. "new" keys off tree_status;
    // the rest key off growth_velocity_class. Counts are from
    // tree_change_pilot and shown as a subtle hint, like the species menu.
    const GROWTH_BUCKETS = [];
    function growthBucketExpr(key) {
      return key === "new"
        ? ["==", ["get", "tree_status"], "newly_established"]
        : ["==", ["get", "growth_velocity_class"], key];
    }

    // Numbers print by the one shared rule set (alto-format.js, FE-16): counts exact, with thousands separators.
    const FMT = window.ALTOFormat;
    const formatNumber = { format: (v) => FMT.count(v) };

    const mobileLayout = window.matchMedia("(max-width: 760px), (max-height: 500px)");
    const controlsBesidePanel = window.matchMedia("(min-width: 1101px)");
    // On a phone the panel is a bottom sheet (peek, half, full) rather than a card that hides.
    const sheetLayout = window.matchMedia("(max-width: 760px)");
    const coarsePointer = window.matchMedia("(pointer: coarse)");
    const explorer = document.getElementById("explorer");
    let panelMapReady = false, panelDrawer = null, panelSheet = "peek";
    function setSidebarCollapsed(next, focus = false) {
      const sheet = sheetLayout.matches;
      document.body.dataset.asideCollapsed = String(next);
      explorer.inert = next && !sheet;
      explorer.setAttribute("aria-hidden", String(next && !sheet));
      document.getElementById("collapseAside").setAttribute("aria-expanded", String(!next));
      document.getElementById("revealAside").setAttribute("aria-expanded", String(!next));
      if (sheet) setPanelSheet(next ? "peek" : panelDrawer ? "full" : "half");
      if (focus) document.getElementById(next ? (sheet ? "panelHandle" : "revealAside") : "collapseAside").focus({preventScroll: true});
    }
    document.getElementById("collapseAside").addEventListener("click", () => setSidebarCollapsed(true, true));
    document.getElementById("revealAside").addEventListener("click", () => {
      if (mobileLayout.matches) closeProfile();
      setSidebarCollapsed(false, !sheetLayout.matches);
      if (panelMapReady) scheduleViewportStats();
    });

    // Drawers: Filters, Layers and Area open below the "Colour by" control; one at a time, and a
    // second press closes it again. With none open the panel shows only the essentials.
    function setDrawer(name, { scroll = true } = {}) {
      panelDrawer = name || null;
      explorer.dataset.openDrawer = panelDrawer || "";
      for (const b of document.querySelectorAll(".lp-drawers [data-drawer]")) {
        const on = b.dataset.drawer === panelDrawer;
        b.setAttribute("aria-expanded", String(on));
        document.getElementById(b.getAttribute("aria-controls")).hidden = !on;
      }
      if (sheetLayout.matches) setPanelSheet(panelDrawer ? "full" : panelSheet === "full" ? "half" : panelSheet);
      if (scroll) document.getElementById("panelBody").scrollTop = 0;
      if (panelMapReady) scheduleViewportStats();
    }
    // Earlier code and links name the old tabs; they map onto the drawers.
    function selectTab(id) { setDrawer({ tabExplore: "filters", tabLayers: "layers", tabView: "area" }[id] || null); }
    document.querySelector(".lp-drawers").addEventListener("click", event => {
      const b = event.target.closest("[data-drawer]");
      if (b) setDrawer(panelDrawer === b.dataset.drawer ? null : b.dataset.drawer);
    });
    // Groups of three or more options fold under a row that states their current value.
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    function setGroup(name, open, { focus = false, reveal = false } = {}) {
      const t = explorer.querySelector(`[data-group-toggle="${name}"]`);
      if (!t) return null;
      t.setAttribute("aria-expanded", String(open));
      document.getElementById(t.getAttribute("aria-controls")).hidden = !open;
      if (open && name === "species" && focus && !coarsePointer.matches) document.getElementById("speciesSearch").focus({ preventScroll: true });
      // An opened group scrolls fully into view (as far as it fits), so its last option is not left below the fold.
      if (open && reveal) requestAnimationFrame(() => t.closest(".lp-group").scrollIntoView({ block: "nearest", behavior: reducedMotion.matches ? "auto" : "smooth" }));
      return t.closest(".lp-group");
    }
    explorer.addEventListener("click", event => {
      const t = event.target.closest("[data-group-toggle]");
      if (t) setGroup(t.dataset.groupToggle, t.getAttribute("aria-expanded") !== "true", { focus: true, reveal: true });
    });
    // Open the drawer and group that hold a control (from a chip), and bring it into view.
    function revealControl(drawer, group) {
      if (sheetLayout.matches && document.body.dataset.asideCollapsed === "true") setSidebarCollapsed(false);
      if (panelDrawer !== drawer) setDrawer(drawer);
      const el = group ? setGroup(group, true) || explorer.querySelector(`[data-group="${group}"]`) : null;
      const target = el || document.getElementById({ filters: "paneExplore", layers: "paneLayers", area: "paneView" }[drawer]);
      requestAnimationFrame(() => {
        target?.scrollIntoView({ block: "nearest" });
        (target?.querySelector("[data-group-toggle], button, input, select") || target)?.focus?.({ preventScroll: true });
      });
    }

    // Phone: a bottom sheet. Peek is a slim bar, the handle and the search box, so the map keeps its height; half adds
    // the summary and the chips, "Colour by", the colour key and the drawer buttons; full shows an open drawer. Drag or
    // tap the handle. The map's own controls sit above the visible part of the sheet (--sheet-clear).
    // On a phone the Filters, Layers and Area tabs sit above the legend, which starts folded under its own "Legend"
    // button; half shows the sheet down to that button.
    // A stop is measured to the bottom of the last part it shows (through its offset parents: the search box sits in
    // .property-search), plus the safe area under a home indicator (--sheet-safe in map.css; 0 on most pages). The
    // status line above the search box is part of the bar while it has something to say (its Retry button works there).
    const SHEET_PEEK_INERT = ".lp-summary, .lp-colour, .lp-legend, .lp-legend-toggle, .lp-drawers, .panel-foot";
    const sheetSafe = () => parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--sheet-safe")) || 0;
    function sheetStop(state) {
      if (state === "full") return explorer.offsetHeight;
      const toggle = document.getElementById("sheetLegendToggle");
      const anchor = state === "peek" ? document.getElementById("propertySearch") : toggle && toggle.offsetParent ? toggle : explorer.querySelector(".lp-drawers");
      let bottom = anchor.offsetHeight;
      for (let el = anchor; el && el !== explorer; el = el.offsetParent) bottom += el.offsetTop;
      return Math.min(explorer.offsetHeight, bottom + 8 + sheetSafe());
    }
    document.getElementById("sheetLegendToggle").addEventListener("click", e => {
      const open = e.currentTarget.getAttribute("aria-expanded") !== "true";
      e.currentTarget.setAttribute("aria-expanded", String(open)); explorer.dataset.sheetLegend = open ? "open" : "";
      if (open && sheetLayout.matches && panelSheet !== "full") setPanelSheet("full");
    });
    function placeSheet(visible) {
      explorer.style.setProperty("--sheet-offset", `${Math.max(0, explorer.offsetHeight - visible)}px`);
      // Map controls ride above the sheet up to its half stop; over a full sheet they stay behind it. While a tree or
      // property panel is open, its own sheet places them (see setSheet).
      if (document.body.dataset.profileOpen === "true") return;
      const hidden = explorer.dataset.sheet === "full" && !explorer.classList.contains("is-dragging");
      const clear = hidden ? 0 : Math.min(visible, sheetStop("half"));
      document.documentElement.style.setProperty("--sheet-clear", `${Math.round(clear)}px`);
    }
    function setPanelSheet(state) {
      if (!sheetLayout.matches) return;
      panelSheet = state;
      explorer.dataset.sheet = state;
      document.body.dataset.asideCollapsed = String(state === "peek");
      const handle = document.getElementById("panelHandle");
      handle.setAttribute("aria-expanded", String(state !== "peek"));
      handle.setAttribute("aria-label", state === "peek" ? "Show more of the panel" : "Show more of the map");
      // What lies below the visible part of the sheet takes no focus; a control that had it as the sheet went down to its
      // bar hands it to the handle.
      document.getElementById("panelBody").inert = state !== "full";
      const hiding = state === "peek" && explorer.contains(document.activeElement) && !!document.activeElement.closest(SHEET_PEEK_INERT);
      for (const el of explorer.querySelectorAll(SHEET_PEEK_INERT)) el.inert = state === "peek";
      if (hiding) handle.focus({ preventScroll: true });
      // A full sheet covers the map: its controls take no focus underneath it.
      document.getElementById("map").inert = state === "full";
      if (state !== "full" && panelDrawer) { panelDrawer = null; setDrawer(null, { scroll: false }); return; }
      requestAnimationFrame(() => placeSheet(sheetStop(state)));
      if (panelMapReady) scheduleViewportStats();
    }
    (function bottomSheetPanel() {
      const handle = document.getElementById("panelHandle");
      let drag = null;
      handle.addEventListener("pointerdown", e => {
        if (!sheetLayout.matches) return;
        drag = { y: e.clientY, start: explorer.offsetHeight - (parseFloat(getComputedStyle(explorer).getPropertyValue("--sheet-offset")) || 0), moved: false };
        handle.setPointerCapture(e.pointerId);
      });
      handle.addEventListener("pointermove", e => {
        if (!drag) return;
        const dy = e.clientY - drag.y;
        if (Math.abs(dy) > 6) { drag.moved = true; explorer.classList.add("is-dragging"); }
        if (drag.moved) placeSheet(Math.max(sheetStop("peek"), Math.min(explorer.offsetHeight, drag.start - dy)));
      });
      // A press (tap, click, Enter or Space) steps down from a full sheet and otherwise switches
      // between peek and half; a drag moves the sheet with the finger and snaps when released.
      let dragged = false;
      handle.addEventListener("click", () => {
        if (dragged) { dragged = false; return; }
        if (panelSheet === "full") setDrawer(null); else setSidebarCollapsed(panelSheet !== "peek");
      });
      handle.addEventListener("pointerup", e => {
        if (!drag) return;
        const moved = drag.moved, dy = e.clientY - drag.y, visible = drag.start - dy;
        drag = null; explorer.classList.remove("is-dragging");
        if (!moved) return;
        dragged = true; setTimeout(() => { dragged = false; }, 0);
        // A drag snaps to the nearest stop, leaning the way it went. Full is the stop of an open drawer.
        const stops = (panelDrawer ? ["peek", "half", "full"] : ["peek", "half"]).map(s => [s, sheetStop(s)]);
        const lean = visible + (dy < 0 ? 60 : -60);
        const [best] = stops.reduce((a, b) => Math.abs(b[1] - lean) < Math.abs(a[1] - lean) ? b : a);
        if (best === "full") { setPanelSheet("full"); return; }
        if (best === "half" && panelDrawer) { setDrawer(null); return; }
        setSidebarCollapsed(best === "peek");
      });
      handle.addEventListener("pointercancel", () => { drag = null; explorer.classList.remove("is-dragging"); setPanelSheet(panelSheet); });
      // A sheet raised by the keyboard moves at once, not in a 260 ms slide, so the next Tab already lands on a control
      // in view (WCAG 2.4.11); a tap or a drag keeps the slide.
      let tabbing = false;
      document.addEventListener("keydown", e => { if (e.key === "Tab") tabbing = true; }, true);
      document.addEventListener("pointerdown", () => { tabbing = false; }, true);
      function raiseNow() {
        explorer.classList.add("is-instant"); placeSheet(sheetStop(panelSheet));
        requestAnimationFrame(() => requestAnimationFrame(() => explorer.classList.remove("is-instant")));
      }
      // Typing an address needs the room below the search box for its suggestions.
      const search = document.getElementById("propertySearch");
      search.addEventListener("focus", () => {
        if (!sheetLayout.matches || panelSheet !== "peek") return;
        panelSheet = "full"; explorer.dataset.sheet = "full"; document.body.dataset.asideCollapsed = "false";
        for (const el of explorer.querySelectorAll(SHEET_PEEK_INERT)) el.inert = false;
        document.getElementById("map").inert = true;
        if (tabbing) raiseNow(); else requestAnimationFrame(() => placeSheet(explorer.offsetHeight));
      });
      // Keyboard focus never rests below the visible part of the sheet (WCAG 2.4.11): Tab onto a control the sheet hides
      // (the Filters row, the legend, the release line, the ALTO pages menu in its foot) raises the sheet to full, where
      // the panel shows it. Measured from the sheet's own top, so a sheet still moving reads the same.
      explorer.addEventListener("focusin", e => {
        if (!sheetLayout.matches || panelSheet === "full" || explorer.classList.contains("is-dragging")) return;
        const el = e.target;
        if (!(el instanceof Element) || el.closest("#panelHandle, .property-search")) return;
        const bottom = el.getBoundingClientRect().bottom - explorer.getBoundingClientRect().top;
        if (bottom > sheetStop(panelSheet)) { setPanelSheet("full"); if (tabbing) raiseNow(); }
      });
      // Back to peek when the search is left for the map; a drawer opened meanwhile keeps the sheet.
      search.addEventListener("blur", () => {
        if (!sheetLayout.matches || panelDrawer || panelSheet !== "full") return;
        setTimeout(() => { if (!panelDrawer && panelSheet === "full" && !explorer.contains(document.activeElement)) setPanelSheet("peek"); }, 150);
      });
      // The sheet steps aside while a tree or property panel is open, and its height follows its content. When a panel
      // opens or closes, it is measured after the frame that shows the panel (FE-17): measured inside the tap, it forced
      // a layout of the whole page there (about 90 ms at 4x CPU) and a second one for the frame.
      let sheetAfterPaint = false;
      new MutationObserver(() => {
        if (!sheetLayout.matches || sheetAfterPaint) return;
        sheetAfterPaint = true;
        requestAnimationFrame(() => setTimeout(() => { sheetAfterPaint = false; if (sheetLayout.matches) placeSheet(sheetStop(panelSheet)); }, 0));
      }).observe(document.body, { attributes: true, attributeFilter: ["data-profile-open"] });
      // The stops move when the summary changes height, and the bar when the status line above the search box comes or goes.
      const restop = new ResizeObserver(() => { if (sheetLayout.matches && !explorer.classList.contains("is-dragging")) placeSheet(sheetStop(panelSheet)); });
      for (const el of [explorer.querySelector(".lp-summary"), document.getElementById("status")]) restop.observe(el);
      window.addEventListener("resize", () => { if (sheetLayout.matches) placeSheet(sheetStop(panelSheet)); });
    })();
    function applyPanelLayout() {
      if (sheetLayout.matches) { explorer.dataset.sheet = panelSheet; }
      else {
        explorer.style.removeProperty("--sheet-offset"); document.documentElement.style.removeProperty("--sheet-clear");
        for (const el of explorer.querySelectorAll(`#panelBody, ${SHEET_PEEK_INERT}`)) el.inert = false;
        document.getElementById("map").inert = false;
      }
      setSidebarCollapsed(mobileLayout.matches);
    }
    applyPanelLayout();
    mobileLayout.addEventListener("change", applyPanelLayout);
    sheetLayout.addEventListener("change", applyPanelLayout);
    document.getElementById("floatingStats").addEventListener("click", () => {
      if (mobileLayout.matches) closeProfile();
      setSidebarCollapsed(false); setDrawer("area"); document.getElementById("drawerArea").focus({preventScroll: true});
    });
    // "/" moves to the search box when focus is in the map panel or on the map itself (A11Y-15: a single-key shortcut
    // for the whole page took "/" from anyone typing it elsewhere); Ctrl or Cmd K does so anywhere. Escape inside the
    // panel closes the open drawer.
    document.addEventListener("keydown", event => {
      const typing = event.target.closest?.("input, select, textarea, [contenteditable=true]");
      const onMap = explorer.contains(event.target) || !!event.target.matches?.("#map .maplibregl-canvas");
      const slash = event.key === "/" && onMap && !typing && !event.metaKey && !event.ctrlKey && !event.altKey;
      const commandK = (event.metaKey || event.ctrlKey) && !event.altKey && event.key.toLowerCase() === "k";
      if ((slash || commandK) && !document.getElementById("aboutBackdrop")?.hasAttribute("data-open") && !document.getElementById("treeComparison")?.open) {
        event.preventDefault();
        if (document.body.dataset.asideCollapsed === "true" && !sheetLayout.matches) setSidebarCollapsed(false);
        const box = document.getElementById("propertySearch");
        box.focus(); box.select();
      }
      if (event.key === "Escape" && panelDrawer && !pickMode && explorer.contains(event.target) && !event.target.closest(".property-search")) {
        event.stopPropagation();
        const button = document.querySelector(`.lp-drawers [data-drawer="${panelDrawer}"]`);
        setDrawer(null); button.focus({ preventScroll: true });
      }
    }, true);
    window.ALTOPanel = { open: name => setDrawer(name), sheet: state => setSidebarCollapsed(state === "peek") || setPanelSheet(state), group: setGroup, reveal: revealControl };

    // Register the PMTiles protocol so MapLibre can fetch range requests. Versioned archives (?v=) read through this
    // device's tile cache (tile-cache.js, FE-05), so a second visit does not download the same ranges again.
    const tileCache = window.ALTOTileCache ? window.ALTOTileCache.protocol(pmtiles) : null;
    const protocol = tileCache ? tileCache.protocol : new pmtiles.Protocol();

    // Where the .pmtiles live. Local dev serves the repo root, so tiles are two
    // levels up in data/processed; a deployed build sets window.AKL_DATA_BASE
    // to its own bundled tile folder (see build_web_deploy.sh).
    const DATA_BASE = (window.AKL_DATA_BASE || "../../data/processed").replace(/\/+$/, "");
    // Tile cache-busting: tiles are rebuilt wholesale and cached hard for a year,
    // so a deploy stamps AKL_TILE_VERSION to force browsers off the stale copies.
    // A deployed build stamps AKL_TILE_VERSION. A build that reads the site's live data from a
    // sub-path (the beta) sets it to "auto" and takes the stamp from the live release's metadata, so
    // it follows the data from v5.2 to v6 without a rebuild and never reuses a stale cached tile.
    // SITE_ROOT is where the live site's own files (release metadata, KYTE, release notes) are.
    const SITE_ROOT = (window.ALTO_SITE_ROOT || ".").replace(/\/+$/, "");
    const AUTO_VERSION = window.AKL_TILE_VERSION === "auto";
    let TILE_VERSION = AUTO_VERSION ? "__auto__" : (window.AKL_TILE_VERSION || "2");
    const dataMetadataUrl = new URL(`${SITE_ROOT}/release-metadata.json`, window.location.href).href;
    // The release metadata: found, or not loaded (and why), never silently absent. The host caches it for a minute.
    let releaseMetadataError = null;
    const dataMetadataReady = fetch(dataMetadataUrl, { credentials: "same-origin" })
      .then(async r => { if (!r.ok) { releaseMetadataError = `HTTP ${r.status}`; return null; } try { return await r.json(); } catch { releaseMetadataError = "could not be read"; return null; } })
      .catch(() => { releaseMetadataError = "network error"; return null; })
      .then(m => { if (AUTO_VERSION) TILE_VERSION = m?.assembly?.tile_version || m?.release?.dataset_version || `session-${Date.now()}`; return m; });
    // The sources of this map and of the tree page's inset map come from one factory (map-sources.js, FE-16): the
    // basemaps and the release's archives, each URL with the tiles' cache stamp.
    const MAP_SOURCES = ALTOMapSources.create({ dataBase: DATA_BASE, version: () => TILE_VERSION });
    const vq = MAP_SOURCES.versioned;
    // Revision of the change tiles (v1, 13 Oct 2026: tree_change_v1.pmtiles); bump it whenever that file is replaced.
    const CHANGE_TILES_REV = "v1-20261013";
    // PMTiles requests made before the stamp is known wait for it. While a shared tree link's record loads (?tree=, below),
    // tile reads wait for it, for 8 s at most, so on a slow connection the record is not queued behind the map's first
    // megabytes of tiles (UX-18).
    let tilesHeld = null;
    maplibregl.addProtocol("pmtiles", async (params, abort) => {
      if (tilesHeld) await tilesHeld;
      if (params.url.includes("v=__auto__")) { await dataMetadataReady; params = { ...params, url: params.url.replace("v=__auto__", `v=${encodeURIComponent(TILE_VERSION)}`) }; }
      if (tileCache) { window.ALTOTileCache.version(TILE_VERSION); return tileCache.tile(params, abort); }
      return protocol.tile(params, abort);
    });

    const basemaps = MAP_SOURCES.basemaps();

    let activeBasemapKey = "light";

    function noCrownInventoryExpr() {
      return [
        "all",
        ["has", "crown_pilot"],
        ["!", ["in", ["get", "source_primary"], ["literal", DETECTION_SOURCES]]],
        ["!=", ["coalesce", ["to-number", ["get", "crown_pilot"], 0], 0], 1]
      ];
    }

    // V5.2 crowns drawn from a source record's laser returns await confirmation, so they are drawn
    // faintly. Earlier tiles carry neither field and draw as before.
    function faintCrownExpr() {
      return ["any", ["==", ["get", "crown_source"], "record_seeded_v52"], ["==", ["get", "display_style"], "faint"]];
    }

    function pointOpacityExpr() {
      return ["case",
        ["in", ["get", "source_primary"], ["literal", DETECTION_SOURCES]], ["match", ["coalesce", ["get", "evidence_tier"], ""],
          "very_likely", 0.82, "probable", 0.66, "possible", 0.46, "unverified", 0.32, "possible_duplicate", 0.24, "not_assessed", 0.7, 0.7],
        0.94];
    }

    function protectedExpr() {
      return ["==", ["coalesce", ["to-number", ["get", "is_protected_notable"], 0], 0], 1];
    }

    // Marker style: the fill is the marker's own source (sources.js), a magenta ring marks a protected
    // tree and an orange ring a record with no crown linked. Status and data quality are rings, not
    // fill categories, so a protected Auckland Transport tree is still blue and still protected.
    // A record with no crown linked is drawn hollow, outlined in its own colour; protected adds a ring.
    // Points on the light basemaps carry a dark hairline, on imagery a white one (design system 1.3).
    const onImagery = (key = activeBasemapKey) => key === "hybrid" || key === "satellite";
    const markStroke = (key = activeBasemapKey) => tok(onImagery(key) ? "--viz-mark-stroke-imagery" : "--viz-mark-stroke");
    function markerFill(colour) { return ["case", noCrownInventoryExpr(), tok("--neutral-0"), colour]; }
    function markerStrokeColour(colour = ALTOSources.colourExpr(), key = activeBasemapKey) {
      return ["case", protectedExpr(), tok("--color-protected"), noCrownInventoryExpr(), colour, markStroke(key)];
    }
    function markerStrokeWidth() {
      const isDet = ["in", ["get", "source_primary"], ["literal", DETECTION_SOURCES]];
      return ["interpolate", ["linear"], ["zoom"],
        12, ["case", protectedExpr(), 1.4, noCrownInventoryExpr(), 1.3, isDet, 0.3, 0.6],
        18, ["case", protectedExpr(), 3, noCrownInventoryExpr(), 2.6, isDet, 0.6, 1]];
    }

    // One crown colour in Source mode; the colour modes recolour crowns like their trees.
    const CROWN_FILL = () => tok("--viz-seq-400"), CROWN_LINE = () => tok("--viz-seq-700");
    const PARCEL_COLOUR = () => ["match", ["coalesce", ["get", "tn"], "unknown"], ...["park", "street", "institutional", "private"].flatMap(k => [k, PAL.colour("parcels", k)]), "rgba(0,0,0,0)"];
    // A ring layer pair: the white halo under the ink ring. Filters are set on both (setRings).
    function ringLayers(id, radius, width) {
      const base = { type: "circle", source: "akl-points", "source-layer": "trees", filter: ["==", ["get", "tree_id"], "__none__"] };
      return [
        { ...base, id: id + "-halo", paint: { "circle-radius": radius, "circle-color": "rgba(0,0,0,0)", "circle-stroke-color": tok("--color-selection-halo"), "circle-stroke-width": width + 2.5, "circle-stroke-opacity": 0.95 } },
        { ...base, id, paint: { "circle-radius": radius, "circle-color": "rgba(0,0,0,0)", "circle-stroke-color": tok("--color-selection"), "circle-stroke-width": width } }
      ];
    }
    function setRings(id, filter) {
      for (const layer of [id + "-halo", id]) if (map.getLayer(layer)) map.setFilter(layer, filter);
    }
    // Map icons for marks circles cannot draw (triangle, diamond, dashed ring), drawn on demand in a colour:
    // "alto-<shape>-<hex>". The style asks for them by name; styleimagemissing draws them.
    const mapIcon = (shape, colour) => `alto-${shape}-${String(colour).replace("#", "")}`;
    function drawIcon(id) {
      const m = /^alto-(triangle|diamond|dashed-ring)-([0-9a-f]{6})$/i.exec(id);
      if (!m) return null;
      const [, shape, hex] = m, size = 24, ratio = 2, canvas = document.createElement("canvas");
      canvas.width = canvas.height = size * ratio;
      const g = canvas.getContext("2d"); g.scale(ratio, ratio);
      g.fillStyle = "#" + hex; g.strokeStyle = "rgba(23, 32, 26, 0.6)"; g.lineWidth = 1.5; g.lineJoin = "round";
      if (shape === "triangle") { g.beginPath(); g.moveTo(12, 3); g.lineTo(21.5, 19.5); g.lineTo(2.5, 19.5); g.closePath(); g.fill(); g.strokeStyle = "#ffffff"; g.lineWidth = 2.2; g.stroke(); g.strokeStyle = "rgba(23, 32, 26, 0.6)"; g.lineWidth = 1; g.stroke(); }
      else if (shape === "diamond") { g.beginPath(); g.moveTo(12, 3); g.lineTo(21, 12); g.lineTo(12, 21); g.lineTo(3, 12); g.closePath(); g.fill(); g.strokeStyle = "#ffffff"; g.lineWidth = 2.2; g.stroke(); g.strokeStyle = "rgba(23, 32, 26, 0.6)"; g.lineWidth = 1; g.stroke(); }
      else { g.beginPath(); g.arc(12, 12, 9, 0, Math.PI * 2); g.setLineDash([3.4, 2.4]); g.strokeStyle = "#ffffff"; g.lineWidth = 3.4; g.stroke(); g.strokeStyle = "#" + hex; g.lineWidth = 2; g.stroke(); }
      return g.getImageData(0, 0, size * ratio, size * ratio);
    }

    // FE-04: the archives a first view does not draw (near canopy, low-canopy candidates, canopy change, root shapes and
    // parcels) join the style when their layer is first switched on (ensureSource, from applyFilters and when a property
    // opens), so the first map view reads only the points' and the crowns' headers. Once added, an archive stays in
    // every style (a basemap change keeps it).
    const DEFERRED_SOURCES = ["akl-near-canopy", "akl-low-canopy", "akl-change", "akl-rootshape", "akl-properties"];
    const activeSources = new Set();
    function styleFor(key) {
      const style = fullStyleFor(key), drop = new Set(DEFERRED_SOURCES.filter(id => !activeSources.has(id)));
      for (const id of drop) delete style.sources[id];
      style.layers = style.layers.filter(layer => !drop.has(layer.source));
      return style;
    }
    function ensureSource(id) {
      if (!DEFERRED_SOURCES.includes(id) || activeSources.has(id) && map.getSource(id)) return;
      activeSources.add(id);
      if (map.getSource(id)) return;
      try {
        const full = fullStyleFor(activeBasemapKey), order = full.layers.map(layer => layer.id);
        map.addSource(id, full.sources[id]);
        // Each layer goes where the full style has it: before the next of its layers already on the map.
        for (const layer of full.layers.filter(l => l.source === id)) {
          map.addLayer(layer, order.slice(order.indexOf(layer.id) + 1).find(next => map.getLayer(next)));
        }
      } catch (e) { /* the style is still loading: it carries the archive from now on (styleFor) */ }
    }
    function fullStyleFor(key) {
      const bm = basemaps[key];
      return {
        version: 8,
        sources: Object.assign({}, bm.sources, {
          "akl-near-canopy": {type:"vector",url:MAP_SOURCES.archive("near_canopy"),attribution:ALTOCredits.MAP.lidar2024},
          "akl-points": { type: "vector", url: MAP_SOURCES.archive("trees_map_points"), attribution: DATA_CREDIT },
          // Species maxima rings, at each tree number's map position from maxima.json (drawn at every zoom).
          "maxima-rings": { type: "geojson", data: { type: "FeatureCollection", features: [] } },
          "akl-crowns": { type: "vector", url: MAP_SOURCES.archive("tree_crowns_pilot"), attribution: DATA_CREDIT },
          "akl-properties": { type: "vector", url: MAP_SOURCES.archive("properties"), attribution: DATA_CREDIT },
          "akl-low-canopy": { type: "vector", url: MAP_SOURCES.archive("low_canopy_candidates"), attribution: ALTOCredits.MAP.lidar2024 },
          // The change tiles have a file name of their own for v1 (tree_change.pmtiles, the screened file, stays on
          // the host for rollback; it is served as immutable, so a file swapped under its URL could mix old and new byte
          // ranges in a browser) and a revision on top of the release stamp.
          "akl-change": { type: "vector", url: MAP_SOURCES.archive("tree_change_v1", { rev: CHANGE_TILES_REV }), attribution: ALTOCredits.MAP.change },
          "akl-rootshape": { type: "vector", url: MAP_SOURCES.archive("tree_root_shapes"), attribution: ALTOCredits.MAP.lidar2024 },
          "akl-canopy": { type: "geojson", data: {type: "FeatureCollection", features: []}, attribution: ALTOCredits.MAP.boards },
          "akl-kauri": { type: "geojson", data: {type: "FeatureCollection", features: []}, attribution: ALTOCredits.MAP.kauri },
          // Release 6.3: Council's Notable Group of Trees areas (data/notable_group_areas.geojson), read when switched on.
          "akl-group-areas": { type: "geojson", data: {type: "FeatureCollection", features: []}, attribution: ALTOCredits.MAP.groupAreas }
        }),
        layers: [
          ...bm.layers,
          {
            // Canopy cover by local board (choropleth, drawn under the trees).
            id: "canopy-fill",
            type: "fill",
            source: "akl-canopy",
            maxzoom: 12,
            layout: { visibility: "none" },
            paint: {
              "fill-color": ["case", ["has", "canopy_cover_pct"], PAL.step("canopy", ["get", "canopy_cover_pct"]), tok("--neutral-200")],
              // A board partly outside the assessed area is outlined only (canopy-partial): its share is not comparable.
              "fill-opacity": ["case", ["==", ["get", "fully_assessed"], 1], PAL.legend("canopy").rows[0].alpha, 0]
            }
          },
          {
            id: "canopy-partial",
            type: "line",
            source: "akl-canopy",
            maxzoom: 12,
            filter: ["!=", ["get", "fully_assessed"], 1],
            layout: { visibility: "none" },
            paint: { "line-color": PAL.colour("canopy", "partial"), "line-width": 1.6, "line-dasharray": [2, 1.5] }
          },
          {
            id: "canopy-line",
            type: "line",
            source: "akl-canopy",
            layout: { visibility: "none" },
            paint: { "line-color": tok("--neutral-0"), "line-opacity": 0.85, "line-width": ["interpolate", ["linear"], ["zoom"], 8, 0.6, 13, 2] }
          },
          {
            // Notable Group of Trees areas (release 6.3): a dashed outline under the trees, in the schedule's colour; the
            // dash and the legend carry the meaning, never the colour alone.
            id: "group-areas-line",
            type: "line",
            source: "akl-group-areas",
            layout: { visibility: "none", "line-join": "round" },
            paint: { "line-color": tok("--color-protected"), "line-width": ["interpolate", ["linear"], ["zoom"], 10, 1, 16, 2.4], "line-dasharray": [2.5, 1.5] }
          },
          {
            // Parcels coloured by inferred land type (tile field tn), off by default, from z14.
            id: "properties-landtype",
            type: "fill",
            source: "akl-properties",
            "source-layer": "properties",
            minzoom: 14,
            layout: { visibility: "none" },
            // A pale tint inside the parcel; its edge (properties-landtype-line) carries the land type.
            filter: ["in", ["coalesce", ["get", "tn"], "unknown"], ["literal", ["park", "street", "institutional", "private"]]],
            paint: { "fill-color": PARCEL_COLOUR(), "fill-opacity": 0.1 }
          },
          {
            id: "properties-landtype-line",
            type: "line",
            source: "akl-properties",
            "source-layer": "properties",
            minzoom: 14,
            filter: ["in", ["coalesce", ["get", "tn"], "unknown"], ["literal", ["park", "street", "institutional", "private"]]],
            layout: { visibility: "none", "line-join": "round" },
            paint: { "line-color": PARCEL_COLOUR(), "line-width": ["interpolate", ["linear"], ["zoom"], 14, 1, 18, 2.4], "line-opacity": 0.9 }
          },
          {
            id: "crowns-fill",
            type: "fill",
            source: "akl-crowns",
            "source-layer": "crowns",
            minzoom: 12,
            layout: { visibility: "visible" },
            paint: {
              "fill-color": CROWN_FILL(),
              "fill-opacity": ["case", faintCrownExpr(), 0.1,
                ["match", ["coalesce", ["get", "evidence_tier"], ""], "unverified", 0.07, "possible_duplicate", 0.07, "possible", 0.16, 0.3]]
            }
          },
          {
            id: "crowns-outline",
            type: "line",
            source: "akl-crowns",
            "source-layer": "crowns",
            minzoom: 12,
            filter: ["!", faintCrownExpr()],
            layout: { visibility: "visible" },
            paint: {
              "line-color": CROWN_LINE(),
              "line-width": ["interpolate", ["linear"], ["zoom"], 12, 0.5, 18, 1.5],
              "line-opacity": ["match", ["coalesce", ["get", "evidence_tier"], ""], "unverified", 0.35, "possible_duplicate", 0.35, "possible", 0.6, 0.95]
            }
          },
          {
            // A crown drawn from a record (awaiting confirmation) has a dashed outline in every colour mode.
            id: "crowns-outline-drawn",
            type: "line",
            source: "akl-crowns",
            "source-layer": "crowns",
            minzoom: 12,
            filter: faintCrownExpr(),
            layout: { visibility: "visible" },
            paint: {
              "line-color": CROWN_LINE(),
              "line-width": ["interpolate", ["linear"], ["zoom"], 12, 0.8, 18, 1.8],
              "line-dasharray": [2, 1.5],
              "line-opacity": 0.9
            }
          },
          {
            // LINZ parcels from z16, off by default. The fill is transparent and only takes clicks.
            id: "properties-fill",
            type: "fill",
            source: "akl-properties",
            "source-layer": "properties",
            minzoom: 16,
            layout: { visibility: "none" },
            paint: { "fill-color": tok("--neutral-0"), "fill-opacity": 0 }
          },
          {
            id: "properties-line",
            type: "line",
            source: "akl-properties",
            "source-layer": "properties",
            minzoom: 16,
            layout: { visibility: "none" },
            paint: { "line-color": tok("--neutral-700"), "line-width": ["interpolate", ["linear"], ["zoom"], 16, 0.6, 19, 1.4], "line-opacity": 0.75 }
          },
          {
            // Root-space scenario (v3): foraging circle ∩ Voronoi cell − mapped buildings.
            // Below markers, z14+, off by default. Red = modelled space deficit for review;
            // this is not a measured root footprint or windthrow-risk prediction.
            id: "tree-rootzone",
            type: "fill",
            source: "akl-rootshape",
            "source-layer": "tree_root_shapes",
            minzoom: 14,
            layout: { visibility: "none" },
            paint: {
              "fill-color": PAL.match("rootzone", ["get", "constraint"], "adequate"),
              "fill-opacity": ["match", ["get", "constraint"], ["at_risk", "space_deficit_review"], 0.32, 0.18],
              "fill-outline-color": PAL.match("rootzone", ["get", "constraint"], "adequate")
            }
          },
          {
            // The selected property, outlined under the tree markers. Hidden until a property is
            // chosen so the parcel tiles load only for people who use them.
            id: "property-selected-casing",
            type: "line",
            source: "akl-properties",
            "source-layer": "properties",
            filter: ["==", ["get", "pid"], "__none__"],
            layout: { visibility: "none" },
            paint: { "line-color": tok("--color-selection-halo"), "line-width": ["interpolate", ["linear"], ["zoom"], 14, 4, 19, 7], "line-opacity": 0.9 }
          },
          {
            id: "property-selected",
            type: "line",
            source: "akl-properties",
            "source-layer": "properties",
            filter: ["==", ["get", "pid"], "__none__"],
            layout: { visibility: "none" },
            paint: { "line-color": tok("--color-selection"), "line-width": ["interpolate", ["linear"], ["zoom"], 14, 2, 19, 3.5] }
          },
          {
            id: "points",
            type: "circle",
            source: "akl-points",
            "source-layer": "trees",
            minzoom: 10,
            paint: {
              "circle-radius": [
                "interpolate", ["linear"], ["zoom"],
                10, 1.2,
                14, 2.2,
                17, 4,
                20, 7
              ],
              // Fill by the marker's own source; rings for protected and crown-unlinked records.
              "circle-color": markerFill(ALTOSources.colourExpr()),
              "circle-stroke-color": markerStrokeColour(ALTOSources.colourExpr(), key),
              "circle-stroke-width": markerStrokeWidth(),
              "circle-opacity": pointOpacityExpr()
            }
          },
          {
 id:"near-canopy",type:"fill",source:"akl-near-canopy","source-layer":"near_canopy",minzoom:12,layout:{visibility:"none"},paint:{"fill-color":PAL.match("vegetation",["get","canopy_class"],"sub_canopy"),"fill-opacity":0.42,"fill-outline-color":tok("--viz-seq-800")}
 },
           {
            // Earlier low-canopy candidates: diamonds, a mark no tree marker uses.
            id: "low-candidates",
            type: "symbol",
            source: "akl-low-canopy",
            "source-layer": "low_canopy",
            minzoom: 12,
            layout: { visibility: "none", "icon-image": mapIcon("diamond", PAL.colour("candidates", "candidate")),
              "icon-size": ["interpolate", ["linear"], ["zoom"], 12, 0.32, 15, 0.5, 18, 0.8], "icon-allow-overlap": true, "icon-ignore-placement": true },
            paint: { "icon-opacity": 0.9 }
          },
          {
            // Canopy change since 2013 (v1): canopy gone by 2024 (brick orange) and grown into canopy (teal).
            id: "tree-change",
            type: "circle",
            source: "akl-change",
            "source-layer": "tree_change",
            minzoom: 11,
            // Only the changes the legend names. The v1 file (13 Oct 2026) holds only the shown changes and has no
            // artefact field; the artefact clause still hides the points the 12 Oct screen flagged if the older file is served.
            filter: ["all", ["in", ["get", "fate"], ["literal", PAL.rows("change").map(r => r.key)]], ["!=", ["get", "artefact"], 1]],
            layout: { visibility: "none" },
            paint: {
              "circle-radius": ["interpolate", ["linear"], ["zoom"], 11, 1.5, 15, 3.2, 18, 6],
              // Diverging palette (brick-orange loss, teal gain): never red against green.
              "circle-color": PAL.match("change", ["get", "fate"]),
              "circle-stroke-color": markStroke(key),
              "circle-stroke-width": ["interpolate", ["linear"], ["zoom"], 11, 0.4, 18, 1.2],
              "circle-opacity": 0.85
            }
          },
          {
            // Kauri dieback surveillance (Auckland Council public layer): triangles, a mark no tree marker
            // uses, in the diverging palette (brick-orange for the pathogen and symptoms, teal for none).
            id: "kauri-dieback",
            type: "symbol",
            source: "akl-kauri",
            minzoom: 10,
            layout: { visibility: "none",
              "icon-image": ["match", ["get", "status"], ...["pathogen_confirmed", "symptomatic", "no_symptoms"].flatMap(k => [k, mapIcon("triangle", PAL.colour("kauri", k))]), mapIcon("triangle", PAL.colour("kauri", "other"))],
              "icon-size": ["interpolate", ["linear"], ["zoom"], 10, 0.3, 14, 0.5, 18, 0.8],
              "symbol-sort-key": ["match", ["get", "status"], "pathogen_confirmed", 3, "symptomatic", 2, 1],
              "icon-allow-overlap": true, "icon-ignore-placement": true },
            paint: { "icon-opacity": 0.95 }
          },
          {
            // Possible duplicates add a dashed ring in Detection evidence (switched on with that mode).
            id: "points-duplicate",
            type: "symbol",
            source: "akl-points",
            "source-layer": "trees",
            filter: ["==", ["get", "evidence_tier"], "possible_duplicate"],
            layout: { visibility: "none", "icon-image": mapIcon("dashed-ring", tok("--neutral-700")),
              "icon-size": ["interpolate", ["linear"], ["zoom"], 10, 0.35, 14, 0.5, 17, 0.75, 20, 1.15], "icon-allow-overlap": true, "icon-ignore-placement": true },
            paint: {}
          },
          // Rings on the trees picked in the Area tab (a segment, a column, a species), on the trees counted
          // in the selected property, and on the selected tree: one treatment, an ink ring with a white halo.
          ...ringLayers("points-area", ["interpolate", ["linear"], ["zoom"], 12, 3.5, 18, 10], 2),
          ...ringLayers("points-property", ["interpolate", ["linear"], ["zoom"], 12, 4, 18, 11], 2),
          // Species maxima: a hollow 2 px ink ring with a white halo around the marker ("ring = species maximum").
          { id: "maxima-rings-halo", type: "circle", source: "maxima-rings", paint: { "circle-radius": ["interpolate", ["linear"], ["zoom"], 9, 5, 13, 7, 18, 14], "circle-color": "rgba(0,0,0,0)", "circle-stroke-color": tok("--color-selection-halo"), "circle-stroke-width": 4.5, "circle-stroke-opacity": 0.95 } },
          { id: "maxima-rings", type: "circle", source: "maxima-rings", paint: { "circle-radius": ["interpolate", ["linear"], ["zoom"], 9, 5, 13, 7, 18, 14], "circle-color": "rgba(0,0,0,0)", "circle-stroke-color": tok("--color-selection"), "circle-stroke-width": 2 } },
          ...ringLayers("points-highlight", ["interpolate", ["linear"], ["zoom"], 12, 6, 18, 16], 3)
        ]
      };
    }

    // A shared link to a tree (?tree=): its record is read first, before the map's tiles, so the map can centre on it as
    // soon as its position is known and the panel opens without waiting for the map (UX-18). The status line says so.
    const LINKED_TREE = (() => { const t = new URL(window.location.href).searchParams.get("tree"); return t && t.length <= 200 ? t : null; })();
    const linkedTree = LINKED_TREE ? dataMetadataReady.then(async metadata => {
      ALTOTreeDetails.prefetch(DATA_BASE, TILE_VERSION);   // the record files' schema, alongside the number lookup
      const options = { base: DATA_BASE, version: TILE_VERSION, metadata, ...(metadata ? {} : { metadataError: { file: "release-metadata.json", reason: releaseMetadataError || "error" } }) };
      const resolved = await ALTOTreeId.resolve(LINKED_TREE, options);
      let detail = resolved.tree_id;
      if (resolved.status === "retired" && resolved.successor) detail = (await ALTOTreeId.resolve(resolved.successor, options)).tree_id || detail;
      if (!detail) throw Object.assign(new Error(ALTOTreeId.describe(resolved)?.note || resolved.note || "Unknown tree number or record ID"), { resolved });
      return { ...(await ALTOTreeDetails.load(DATA_BASE, TILE_VERSION, detail)), resolved };
    }) : null;
    if (LINKED_TREE) document.getElementById("status").textContent = `Opening tree ${LINKED_TREE}…`;
    if (linkedTree) tilesHeld = Promise.race([linkedTree.catch(() => null), new Promise(r => setTimeout(r, 8000))]).then(() => { tilesHeld = null; });

    // FTA-23: a view link (?map=…&colour=…&…, view-link.js) opens the map on that view; its filters and layers are set
    // once the controls exist (restoreViewLink below). An explicit ?map= camera wins over a linked tree's or the maxima's.
    const VIEW_LINK = ALTOViewLink.decode(new URL(window.location.href).searchParams, {
      colours: [...document.querySelectorAll("#colourBy option")].map(o => o.value),
      sources: SOURCE_KEYS, status: ALTOSources.STATUS.filter(x => !x.soon).map(x => x.key), quality: QUALITY_KEYS,
      land: LAND_GROUPS.map(([key]) => key), forms: ALTOGrowthForm.GROUP_KEYS
    });
    // ?maxima=<area> is read once the maxima load; the address may be rewritten before then.
    const VIEW_MAXIMA = new URL(window.location.href).searchParams.get("maxima");
    // FTA-16: ?change=<change_id> (change-link.js) opens a canopy change: Colour by change, and the change's popup once
    // its tiles are in (openLinkedChange). A link without ?map= starts on the change's LINZ tile when its ID names one.
    const LINKED_CHANGE = ALTOChangeLink.parseId(new URL(window.location.href).searchParams.get("change"));
    const CHANGE_CAMERA = (() => {
      const c = !VIEW_LINK.camera && LINKED_CHANGE?.tile ? ALTOChangeLink.tileCentre(LINKED_CHANGE.tile) : null;
      if (!c) return null;
      const [lon, lat] = ALTOTreeRecord.fromNztm(c[0], c[1]);
      return { lon, lat, zoom: 16 };
    })();
    const START_CAMERA = VIEW_LINK.camera || CHANGE_CAMERA;
    let viewCameraSet = !!START_CAMERA, viewWriteTimer = null;
    const map = new maplibregl.Map({
      container: "map",
      style: styleFor(activeBasemapKey),
      center: START_CAMERA ? [START_CAMERA.lon, START_CAMERA.lat] : [174.762, -36.856],
      zoom: START_CAMERA ? START_CAMERA.zoom : 13,
      hash: false,
      // Disable the built-in attribution; we add a single compact one below.
      // (Leaving this on duplicated the attribution control.)
      attributionControl: false
    });

    // Icons for marks circles cannot draw, drawn when the style first asks for them (and again after a basemap change).
    map.on("styleimagemissing", event => {
      if (map.hasImage(event.id)) return;
      const image = drawIcon(event.id);
      if (image) map.addImage(event.id, image, { pixelRatio: 2 });
    });
    map.addControl(new maplibregl.AttributionControl({ compact: true, customAttribution: ALTOCredits.MAP.page }), "bottom-right");
    // A11Y-03: the canvas names its keys for screen readers.
    map.getCanvas().setAttribute("aria-describedby", "mapKeys");
    // On phones the attribution starts folded to its (i) button (design system 3.2): from the start, not at "load", so
    // it never opens and grows over the map while the archives arrive (FE-09: on a slow phone it opened, grew by
    // 180 px as credits arrived and folded again at load, moving the zoom buttons each time). Folded until the reader
    // opens it.
    {
      const a = map.getContainer().querySelector(".maplibregl-ctrl-attrib");
      let opened = false;
      a?.querySelector(".maplibregl-ctrl-attrib-button")?.addEventListener("click", () => { opened = true; });
      const fold = () => {
        if (opened || !a || !window.matchMedia("(max-width: 760px)").matches) return;
        if (a.classList.contains("maplibregl-compact-show") || a.hasAttribute("open")) { a.classList.remove("maplibregl-compact-show"); a.removeAttribute("open"); }
      };
      fold();
      map.on("styledata", fold); map.on("sourcedata", fold); map.on("resize", fold);
      map.once("load", () => { fold(); map.off("styledata", fold); map.off("sourcedata", fold); map.off("resize", fold); });
    }
    const zoomControl = new maplibregl.NavigationControl({ showCompass: false });
    const placeZoom = () => { if (map.hasControl?.(zoomControl)) map.removeControl(zoomControl); map.addControl(zoomControl, window.matchMedia("(max-width: 760px)").matches ? "bottom-right" : "top-right"); };
    placeZoom();
    window.matchMedia("(max-width: 760px)").addEventListener("change", placeZoom);
    map.addControl(new maplibregl.ScaleControl({ unit: "metric" }), "bottom-left");

    // The compact attribution opens over the bottom of the map until the first drag, and its height
    // follows the credits of the visible layers and the screen width. Publish how far its top sits
    // above the bottom of the screen, so the basemap switch stays above it, and lift the scale bar
    // over the attribution or the switch when it would otherwise sit under them.
    (function keepClearOfAttribution() {
      const root = document.documentElement, container = map.getContainer();
      const attrib = container.querySelector(".maplibregl-ctrl-attrib");
      const scale = container.querySelector(".maplibregl-ctrl-scale");
      const basemapSwitch = document.getElementById("basemapSwitch");
      if (!attrib || !scale || !basemapSwitch) return;
      const shown = (el) => {
        const r = el.getBoundingClientRect();
        return r.width && r.height && getComputedStyle(el).visibility !== "hidden" ? r : null;
      };
      function place() {
        const a = shown(attrib);
        root.style.setProperty("--attrib-clear", `${a ? Math.ceil(window.innerHeight - a.top) : 0}px`);
        root.style.setProperty("--scale-lift", "0px");
        const s = scale.getBoundingClientRect(), gap = 6;
        let lift = 0;
        for (const r of [a, shown(basemapSwitch)]) {
          if (r && r.left < s.right + 2 && r.right > s.left - 2 && r.top < s.bottom - lift + gap && r.bottom > s.top - lift - gap) lift = Math.ceil(s.bottom - r.top + gap);
        }
        root.style.setProperty("--scale-lift", `${lift}px`);
      }
      const watch = new ResizeObserver(place);
      for (const el of [attrib, scale, basemapSwitch]) watch.observe(el);
      // A panel opening or closing: placed after the frame that shows it (FE-17), never inside the tap (a forced layout
      // of the whole page there, about 90 ms at 4x CPU).
      let placeQueued = false;
      new MutationObserver(() => { if (placeQueued) return; placeQueued = true; requestAnimationFrame(() => setTimeout(() => { placeQueued = false; place(); }, 0)); })
        .observe(document.body, { attributes: true, attributeFilter: ["data-aside-collapsed", "data-profile-open"] });
      container.querySelector(".maplibregl-ctrl-bottom-right")?.addEventListener("transitionend", place);
      window.addEventListener("resize", place);
      place();
    })();

    // Loading: tiles that take more than 300 ms are reported in the panel's scope line (design system 2.19),
    // never in a pill over the map's controls; the line returns to its count when the map is idle.
    let loadingShown = false, loadingTimer = null;
    const scopeLine = document.getElementById("viewScope");
    map.on("dataloading", () => {
      if (loadingShown || loadingTimer) return;
      loadingTimer = setTimeout(() => { loadingTimer = null; if (!map.areTilesLoaded()) { loadingShown = true; scopeLine.dataset.text = scopeLine.textContent; scopeLine.textContent = "Loading map tiles…"; } }, 300);
    });
    map.on("idle", () => {
      clearTimeout(loadingTimer); loadingTimer = null;
      if (loadingShown) { loadingShown = false; if (scopeLine.textContent === "Loading map tiles…") scopeLine.textContent = scopeLine.dataset.text || ""; }
    });
    // One tile failing on a weak connection is retried the next time the view changes, so it gets a
    // passing note that clears itself rather than a warning that stays on screen for the whole visit.
    let mapNoteTimer = null, pointsError = null;
    // A map that has not started within 20 s, or whose tree tiles failed, says so with a way to try again (never
    // "Loading tree inventory…" for ever).
    function mapNotLoaded(reason) {
      const st = document.getElementById("status");
      clearTimeout(mapNoteTimer); delete st.dataset.mapNote; delete st.dataset.previous;
      st.dataset.error = "tiles";
      st.innerHTML = `Not loaded: the tree map (${escapeHtml(reason)}). <button type="button" class="link-button" data-map-retry>Retry</button>`;
      st.querySelector("[data-map-retry]").addEventListener("click", () => location.reload());
    }
    setTimeout(() => { if (!panelMapReady || pointsError) mapNotLoaded(pointsError || "no response from the map tiles"); }, 20000);
    map.on("error", (event) => {
      clearTimeout(loadingTimer); loadingTimer = null; loadingShown = false;
      const message = event?.error?.message || "A map resource could not be loaded.";
      if (event?.sourceId === "akl-points" && !map.isSourceLoaded?.("akl-points")) { pointsError = /fetch|network|load failed/i.test(message) ? "network error" : message.slice(0, 80); if (!panelMapReady) mapNotLoaded(pointsError); }
      const status = document.getElementById("status");
      console.warn("Map resource error", event?.sourceId || "", message);
      if (document.getElementById("status").dataset.error === "tiles") return;
      if (event?.tile || event?.sourceId || /failed to fetch|networkerror|load failed|network connection/i.test(message)) {
        const previous = status.dataset.mapNote ? status.dataset.previous : status.textContent;
        const note = "Some map tiles did not load. Move or zoom the map to try again.";
        status.dataset.previous = previous; status.dataset.mapNote = "1"; status.textContent = note;
        clearTimeout(mapNoteTimer);
        mapNoteTimer = setTimeout(() => {
          if (status.textContent === note) status.textContent = status.dataset.previous || "";
          delete status.dataset.mapNote; delete status.dataset.previous;
        }, 6000);
        return;
      }
      status.textContent = `Map warning: ${message}`;
    });

    // ---- Street names at street zoom on the Light basemap: from zoom 16.5 the OpenStreetMap streets layer (native tiles
    // to zoom 19) replaces the Light layers, with a note; below zoom 16 Light returns.
    let autoStreets = false;
    function autoStreetNames() {
      if (activeBasemapKey !== "light" || !map.getLayer("basemap-light-streets")) { document.getElementById("basemapNote").hidden = true; return; }
      const z = map.getZoom(), want = autoStreets ? z >= 16 : z >= 16.5;
      if (want === autoStreets && map.getLayoutProperty("basemap-light-streets", "visibility") === (want ? "visible" : "none")) return;
      autoStreets = want;
      map.setLayoutProperty("basemap-light-streets", "visibility", want ? "visible" : "none");
      for (const id of ["basemap-light-base", "basemap-light-labels"]) if (map.getLayer(id)) map.setLayoutProperty(id, "visibility", want ? "none" : "visible");
      document.getElementById("basemapNote").hidden = !want;
    }
    map.on("zoom", autoStreetNames);
    map.on("styledata", () => { if (map.isStyleLoaded()) autoStreetNames(); });

    // ---- Basemap switcher.
    function setBasemap(key) {
      if (!basemaps[key] || key === activeBasemapKey) return;
      activeBasemapKey = key; autoStreets = false;
      map.setStyle(styleFor(key), { diff: false });
      // Re-apply filters as soon as the new style is ready. We listen to
      // both styledata (early — fires when the style spec is parsed) and
      // idle (late — fires when tiles finish loading) so the user's
      // visible/hidden categories are restored without flicker even on
      // slow connections.
      const reapply = () => {
        applyFilters(); applyChangeEmphasis(); applyTrunkScaling(); applyColourMode(); applyPropertySelection();
        if (profileHighlightId && map.getLayer("points-highlight")) setRings("points-highlight", ["==", ["get", "tree_id"], profileHighlightId]);
      };
      map.once("styledata", reapply);
      map.once("idle", reapply);
      for (const button of document.querySelectorAll("#basemapSwitch button, #basemapChoice button")) {
        button.classList.toggle("active", button.dataset.basemap === key);
        button.setAttribute("aria-pressed", String(button.dataset.basemap === key));
      }
    }
    document.getElementById("basemapSwitch").addEventListener("click", event => {
      const b = event.target.closest("button[data-basemap]"), sw = event.currentTarget;
      if (!b || !sheetLayout.matches) return;
      const open = b.dataset.basemap === activeBasemapKey && !sw.classList.contains("is-open");
      sw.classList.toggle("is-open", open);
      sw.querySelector("button.active")?.setAttribute("aria-expanded", String(open));
    }, true);
    (function buildBasemapControl() {
      // The floating switch on the map and the Basemap group in Layers are the same control.
      for (const container of [document.getElementById("basemapSwitch"), document.getElementById("basemapChoice")]) {
        for (const key of ["light", "streets", "hybrid", "satellite"]) {
          const config = basemaps[key];
          const button = document.createElement("button");
          button.type = "button";
          button.dataset.basemap = key;
          button.textContent = config.label;
          button.title = config.title;
          button.className = key === activeBasemapKey ? "active" : "";
          button.setAttribute("aria-pressed", String(key === activeBasemapKey));
          button.addEventListener("click", () => setBasemap(key));
          container.appendChild(button);
        }
      }
    })();

    // ---- Filter state.
    const state = {
      visibleSources: new Set(SOURCE_KEYS),
      statusOnly: new Set(),
      visibleQuality: new Set(QUALITY_KEYS),
      showLandType: false,
      visibleLand: new Set(LAND_GROUPS.map(([key]) => key)),
      visibleGrowthForms: new Set(ALTOGrowthForm.GROUP_KEYS),
      showProperties: false,
      showLowCanopy: false,
      showLowBand:false, showSubBand:false, wideCrownOnly:false, showEarlierDetections:false,
      showMissed: false,
      showChange: false,
      showRootZone: false,
      showTrunk: false,
      showCanopy: false,
      showKauri: false,
      showCouncilPositions: false,
      showGroupAreas: false,
      showUnknown: true,
      showUncertain: true,
      selectedSpecies: new Set(),
      speciesSearch: "",
      showCrowns: true,
      growthFilters: new Set(),
      minHeight: 0,
      onlyMaxima: false,
      maximaArea: "Auckland"
    };
    // A view link's filters and layers (VIEW_LINK, above); the controls follow in restoreViewLink once they exist.
    (function viewLinkState(v) {
      if (v.sources) state.visibleSources = new Set(v.sources);
      if (v.statusOnly) state.statusOnly = new Set(v.statusOnly);
      if (v.quality) state.visibleQuality = new Set(v.quality);
      if (v.land) state.visibleLand = new Set(v.land);
      if (v.forms) state.visibleGrowthForms = new Set(v.forms);
      if (v.species) state.selectedSpecies = new Set(v.species);
      for (const key of ["showUnknown", "showUncertain", "minHeight", "showCrowns", "showTrunk"]) if (v[key] !== undefined) state[key] = v[key];
      for (const key of Object.keys(v.layers || {})) state[key] = true;
    })(VIEW_LINK);
    // The release's species maxima (species-maxima.js), once loaded; null when the release has none.
    let maxima = null;

    function buildGrowthFilter() {
      const active = Array.from(state.growthFilters);
      if (!active.length) return null;
      return ["any", ...active.map(growthBucketExpr)];
    }

    // Sources: shown when any of the marker's sources is on. Status: show only. Data quality: shown
    // when its link class is on. An empty selection matches nothing, in expression syntax (the
    // legacy ["==", 1, 0] is rejected by setFilter and would leave the previous filter in place).
    function buildCategoryFilter() {
      const parts = [ALTOSources.sourceFilter(state.visibleSources), ALTOSources.statusFilter(state.statusOnly), ALTOSources.qualityFilter(state.visibleQuality)].filter(Boolean);
      return parts.length ? (parts.length === 1 ? parts[0] : ["all", ...parts]) : null;
    }

    function buildLandFilter() {
      if (state.visibleLand.size === LAND_GROUPS.length) return null;
      const values = LAND_GROUPS.filter(([key]) => state.visibleLand.has(key)).flatMap(([, tenures]) => tenures);
      if (!values.length) return ["==", ["get", "tree_id"], "__none__"];
      return ["match", ["coalesce", ["get", "tenure"], "unknown"], values, true, false];
    }

    function buildFilter() {
      const conditions = ["all"];
      if(!state.showEarlierDetections)conditions.push(["!=",["get","display_role"],"earlier_detection"]);
      const categoryFilter = buildCategoryFilter();
      if (categoryFilter) conditions.push(categoryFilter);
      const landFilter = buildLandFilter();
      if (landFilter) conditions.push(landFilter);
      const growthFormFilter = ALTOGrowthForm.filter(state.visibleGrowthForms);
      if (growthFormFilter) conditions.push(growthFormFilter);
      if (!state.showUnknown) {
        conditions.push(["!=", ["get", "species_confidence"], "unknown"]);
        conditions.push(["!=", ["get", "species_confidence"], "lidar_inferred_no_species"]);
        conditions.push(["!=", ["get", "species_confidence"], "pointcloud_v4_no_species"]);
        conditions.push(["!=",["get","species_confidence"],"pointcloud_v5_no_species"]);
        conditions.push(["!=", ["get", "species_confidence"], "pointcloud_promoted_no_species"]);
      }
      if (!state.showUncertain) {
        conditions.push(["!", ["in", ["coalesce", ["get", "evidence_tier"], "recorded"], ["literal", UNCERTAIN_TIERS]]]);
      }
      if (state.selectedSpecies.size) {
        conditions.push(ALTOFields.speciesExpr(state.selectedSpecies, SPECIES_KEYED));
      }
      const growthFilter = buildGrowthFilter();
      if (growthFilter) conditions.push(growthFilter);
      // Height: the highest point of the 2024 LiDAR canopy height model within the crown (as the Height colour mode); a tree with no height is left out.
      if (state.minHeight) conditions.push([">=", ["coalesce", ["get", "height_max_m"], ["get", "crown_max_chm_m"], -1], state.minHeight]);
      // Species maxima: only the trees holding a clear-lead maximum in the chosen area, by tree number (species-maxima.js).
      if (state.onlyMaxima && maxima) conditions.push(["in", ["coalesce", ["get", "tn"], "__none__"], ["literal", ALTOMaxima.mapSet(maxima, state.maximaArea).trees]]);
      if (conditions.length === 1) return null;
      return conditions;
    }

    const loadedOverlays = new WeakSet();
    // Release 6.3 and later ship the Notable Group of Trees areas (set when the release metadata says so).
    let groupAreasShipped = false;
    function loadOverlay(id, file) {
      const source = map.getSource(id);
      if (source && !loadedOverlays.has(source)) {
        loadedOverlays.add(source); source.setData(vq(`${DATA_BASE}/${file}`));
      }
    }
    // Layers that change what the map shows, by drawer group, for the chips and the group values.
    const LAYER_TOGGLES = [
      ["showProperties", "Property boundaries", "overlays", "Parcels"], ["showLandType", "Land type of parcels", "overlays", "Parcel land type"],
      ["showCouncilPositions", "Council recorded positions", "overlays", "Recorded positions"], ["showGroupAreas", "Notable Group of Trees areas", "overlays", "Group areas"],
      ["showCanopy", "Canopy cover by local board", "overlays", "Canopy by board"],
      ["showKauri", "Kauri dieback surveillance", "risk", "Kauri dieback"], ["showRootZone", "Root space (earlier crowns)", "risk", "Root space"],
      ["showLowBand", "Low canopy, 2–3 m", "vegetation", "Low canopy 2–3 m"], ["showSubBand", "Low vegetation, under 2 m", "vegetation", "Low vegetation < 2 m"],
      ["wideCrownOnly", "Patches 5 m wide or more", "vegetation", "Patches ≥ 5 m"], ["showEarlierDetections", "Earlier unmatched detections", "vegetation", "Earlier detections"],
      ["showLowCanopy", "Earlier low-canopy candidates", "vegetation", "Earlier low canopy"]
    ];
    const LAND_LABELS = { street: "Street", park: "Park & reserve", institutional: "Schools & institutions", private: "Private property", other: "Other / unknown" };
    // A multi-choice filter in a few words: the ones shown when few are, the ones hidden when few are.
    function selectionLabel(items, visible) {
      const on = items.filter(([k]) => visible.has(k)), off = items.filter(([k]) => !visible.has(k));
      if (!on.length) return "none";
      if (on.length <= 2) return on.map(([, l]) => l).join(", ");
      if (off.length <= 2) return `${off.map(([, l]) => l).join(", ")} off`;
      return `${on.length} of ${items.length}`;
    }
    const groupValue = (id, text, active) => { const el = document.getElementById(id); el.textContent = text; el.dataset.active = String(!!active); };
    // Everything that differs from the default view, as removable chips: filters, then layers.
    // Each chip says where its control is (drawer and group), so its label opens that control.
    let panelActions = null;
    function activeChips() {
      const chips = [], A = panelActions;
      if (!A) return chips;
      const add = (kind, label, remove, drawer, group, title = label) => chips.push({ kind, label, title, remove, drawer, group });
      for (const grp of selectedGroups()) {
        if (groupOn(grp) || !SPECIES_KEYED) add("filter", grp.label, () => A.toggleSpecies(grp.key), "filters", "species");
        else for (const s of grp.subs.filter(s => state.selectedSpecies.has(s.key))) add("filter", `${grp.label}: ${subLabel(s)}`, () => A.toggleSpeciesKey(s.key), "filters", "species");
      }
      for (const name of state.selectedSpecies) if (!SPECIES_GROUPS.some(grp => grp.keys.includes(name))) add("filter", name, () => { state.selectedSpecies.delete(name); A.sync(); applyFilters(); }, "filters", "species");
      if (!state.showUnknown) add("filter", "Recorded species only", () => A.setCheck("onlyNamed", false), "filters", "species");
      if (state.minHeight) add("filter", `Height: ${state.minHeight} m or more`, () => { state.minHeight = 0; applyFilters(); }, "filters", null);
      if (state.onlyMaxima) add("filter", `Species maxima: ${state.maximaArea}`, () => A.setCheck("onlyMaxima", false), "filters", "maxima");
      if (state.statusOnly.has("protected")) add("filter", "Notable Trees schedule only", () => A.reset("status"), "filters", "status");
      const sources = ALTOSources.ACTIVE.map(s => [s.key, s.short]);
      if (state.visibleSources.size !== SOURCE_KEYS.length) add("filter", `Sources: ${selectionLabel(sources, state.visibleSources)}`, () => A.reset("sources"), "filters", "sources");
      if (state.visibleQuality.size !== QUALITY_KEYS.length) add("filter", `Link status: ${selectionLabel(ALTOSources.QUALITY.map(q => [q.key, q.label]), state.visibleQuality)}`, () => A.reset("quality"), "filters", "quality");
      if (!state.showUncertain) add("filter", "Possible detections hidden", () => A.setCheck("showUncertain", true), "filters", "quality", "Possible & unverified detections hidden");
      if (state.visibleGrowthForms.size !== ALTOGrowthForm.GROUP_KEYS.length) add("filter", `Growth form: ${selectionLabel(ALTOGrowthForm.GROUPS.map(g => [g[0], g[1]]), state.visibleGrowthForms)}`, () => A.reset("growth"), "filters", "growth");
      if (state.visibleLand.size !== LAND_GROUPS.length) add("filter", `Land: ${selectionLabel(LAND_GROUPS.map(([k]) => [k, LAND_LABELS[k]]), state.visibleLand)}`, () => A.reset("land"), "filters", "land");
      for (const [id, label, group, short] of LAYER_TOGGLES) if (state[id]) add("layer", short, () => A.setCheck(id, false), "layers", group, label);
      if (!state.showCrowns) add("layer", "Outlines off", () => A.setCheck("showCrowns", true), "layers", "display", "Crown outlines off");
      if (state.showTrunk) add("layer", "Size by trunk", () => A.setCheck("showTrunk", false), "layers", "display", "Size markers by trunk");
      if (areaHighlight) add("highlight", `Ringed: ${areaHighlight.label}`, () => { areaHighlight = null; applyAreaHighlight(); renderArea(); }, "area", null);
      return chips;
    }
    let chipsExpanded = false, chipList = [];
    function renderChips() {
      chipList = activeChips();
      const list = document.getElementById("activeChips"), MAX = 5;
      const filters = chipList.filter(c => c.kind === "filter").length;
      const shown = chipsExpanded || chipList.length <= MAX + 1 ? chipList : chipList.slice(0, MAX);
      let html = filters ? "" : `<li class="lp-chips-empty">All trees shown</li>`;
      html += shown.map(c => `<li class="lp-chip" data-kind="${c.kind}"><button type="button" class="lp-chip-label" data-chip-edit="${chipList.indexOf(c)}" title="${escapeHtml(c.title)}. Select to change." aria-label="${escapeHtml(c.title)}: change">${escapeHtml(c.label)}</button><button type="button" class="lp-chip-x" data-chip-remove="${chipList.indexOf(c)}" aria-label="Remove ${escapeHtml(c.title)}"><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M7 7l10 10M17 7 7 17"></path></svg></button></li>`).join("");
      if (shown.length < chipList.length) html += `<li><button type="button" class="lp-chip-more" data-chip-more>${chipList.length - shown.length} more</button></li>`;
      if (chipList.length >= 2) html += `<li><button type="button" class="lp-text-btn lp-chip-clear" data-chip-clear>Clear all</button></li>`;
      list.innerHTML = html;
      writeViewLink();
      return chipList;
    }
    document.getElementById("activeChips").addEventListener("click", event => {
      const t = event.target.closest("button"); if (!t) return;
      if (t.dataset.chipMore !== undefined) { chipsExpanded = true; renderChips(); document.querySelector("#activeChips .lp-chip-label")?.focus(); return; }
      if (t.dataset.chipClear !== undefined) { panelActions?.clearAll(); document.getElementById("propertySearch").focus({ preventScroll: true }); return; }
      const c = chipList[Number(t.dataset.chipRemove ?? t.dataset.chipEdit)];
      if (!c) return;
      if (t.dataset.chipRemove !== undefined) {
        const index = Number(t.dataset.chipRemove);
        c.remove();
        // Keep the keyboard in the chip row: the next chip, or the search box when none is left.
        const next = document.querySelectorAll("#activeChips .lp-chip-x")[Math.min(index, chipList.length - 1)];
        (next || document.getElementById("propertySearch")).focus({ preventScroll: true });
      } else revealControl(c.drawer, c.group);
    });
    function updateFilterControls() {
      const count = selectedGroups().length + state.growthFilters.size + (SOURCE_KEYS.length - state.visibleSources.size) + state.statusOnly.size + (QUALITY_KEYS.length - state.visibleQuality.size) + (LAND_GROUPS.length - state.visibleLand.size) + (ALTOGrowthForm.GROUP_KEYS.length - state.visibleGrowthForms.size) + (state.showUnknown ? 0 : 1) + (state.showUncertain ? 0 : 1) + (state.minHeight ? 1 : 0) + (state.onlyMaxima ? 1 : 0);
      const chips = renderChips(), layers = chips.filter(c => c.kind === "layer").length, all = count + layers;
      const badge = (id, n, label) => { const b = document.getElementById(id); b.hidden = !n; b.textContent = String(n); b.setAttribute("aria-label", label); };
      badge("filterCount", count, `${count} active ${count === 1 ? "filter" : "filters"}`);
      badge("layerCount", layers, `${layers} ${layers === 1 ? "layer" : "layers"} changed`);
      badge("dockFilterCount", all, `${all} active ${all === 1 ? "filter or layer" : "filters and layers"}`);
      document.getElementById("resetFilters").disabled = !count;
      const selected = selectedGroups();
      groupValue("speciesTriggerText", speciesValue() + (state.showUnknown ? "" : ", recorded only"), selected.length || !state.showUnknown);
      const shownOf = (n, total) => n === total ? "All shown" : `${n} of ${total} shown`;
      groupValue("sourceSelection", shownOf(state.visibleSources.size, SOURCE_KEYS.length), state.visibleSources.size !== SOURCE_KEYS.length);
      groupValue("maximaSelection", state.onlyMaxima ? state.maximaArea : "Off", state.onlyMaxima);
      renderMaximaList();
      groupValue("statusSelection", state.statusOnly.size ? "Notable Trees schedule" : "Any", state.statusOnly.size);
      groupValue("qualitySelection", shownOf(state.visibleQuality.size, QUALITY_KEYS.length) + (state.showUncertain ? "" : ", possible hidden"), state.visibleQuality.size !== QUALITY_KEYS.length || !state.showUncertain);
      groupValue("landSelection", shownOf(state.visibleLand.size, LAND_GROUPS.length), state.visibleLand.size !== LAND_GROUPS.length);
      const gfTotal = ALTOGrowthForm.GROUP_KEYS.length;
      groupValue("growthFormSelection", shownOf(state.visibleGrowthForms.size, gfTotal), state.visibleGrowthForms.size !== gfTotal);
      for (const [id, group] of [["overlaySelection", "overlays"], ["vegetationSelection", "vegetation"]]) {
        const on = LAYER_TOGGLES.filter(([key, , g]) => g === group && state[key]).length;
        groupValue(id, on ? `${on} on` : "None on", on);
      }
    }
    function applyFilters() {
      updateFilterControls();
      if (state.showLowBand || state.showSubBand) ensureSource("akl-near-canopy");
      if (state.showLowCanopy) ensureSource("akl-low-canopy");
      if (state.showChange) ensureSource("akl-change");
      if (state.showRootZone) ensureSource("akl-rootshape");
      if (state.showProperties || state.showLandType) ensureSource("akl-properties");
      if (state.showCanopy) loadOverlay("akl-canopy", "canopy_cover_by_board.geojson");
      if (state.showKauri) loadOverlay("akl-kauri", "kauri_dieback.geojson");
      if (state.showGroupAreas && groupAreasShipped) loadOverlay("akl-group-areas", "notable_group_areas.geojson");
      const filter = buildFilter();
      if(map.getLayer('near-canopy')){
        const bands=[];if(state.showLowBand)bands.push('low_canopy');if(state.showSubBand)bands.push('sub_canopy');
        map.setLayoutProperty('near-canopy','visibility',bands.length?'visible':'none');
        map.setFilter('near-canopy',['all',['in',['get','canopy_class'],['literal',bands]],...(state.wideCrownOnly?[[">=",["get","crown_diameter_m"],5]]:[])]);
      }
      for (const layerId of ["points", "points-records", "crowns-fill"]) {
        if (!map.getLayer(layerId)) continue;
        if (filter) map.setFilter(layerId, filter);
        else map.setFilter(layerId, null);
      }
      // Outlines of crowns drawn from a record are dashed (their own layer); the duplicate rings follow the filters.
      const withFilter = extra => filter ? ["all", filter, extra] : extra;
      if (map.getLayer("crowns-outline")) map.setFilter("crowns-outline", withFilter(["!", faintCrownExpr()]));
      if (map.getLayer("crowns-outline-drawn")) map.setFilter("crowns-outline-drawn", withFilter(faintCrownExpr()));
      if (map.getLayer("points-duplicate")) map.setFilter("points-duplicate", withFilter(["==", ["get", "evidence_tier"], "possible_duplicate"]));
      if (map.getLayer("low-candidates")) {
        map.setLayoutProperty("low-candidates", "visibility", state.showLowCanopy ? "visible" : "none");
      }
      if (map.getLayer("missed-candidates")) {
        map.setLayoutProperty("missed-candidates", "visibility", state.showMissed ? "visible" : "none");
      }
      if (map.getLayer("tree-change")) {
        map.setLayoutProperty("tree-change", "visibility", state.showChange ? "visible" : "none");
        showChangeExtent(state.showChange);
      }
      if (map.getLayer("tree-rootzone")) {
        map.setLayoutProperty("tree-rootzone", "visibility", state.showRootZone ? "visible" : "none");
      }
      if (map.getLayer("canopy-fill")) {
        const cv = state.showCanopy ? "visible" : "none";
        map.setLayoutProperty("canopy-fill", "visibility", cv);
        map.setLayoutProperty("canopy-line", "visibility", cv);
        if (map.getLayer("canopy-partial")) map.setLayoutProperty("canopy-partial", "visibility", cv);
      }
      if (map.getLayer("kauri-dieback")) {
        map.setLayoutProperty("kauri-dieback", "visibility", state.showKauri ? "visible" : "none");
      }
      if (map.getLayer("group-areas-line")) map.setLayoutProperty("group-areas-line", "visibility", state.showGroupAreas ? "visible" : "none");
      for (const id of ["properties-fill", "properties-line"]) {
        if (map.getLayer(id)) map.setLayoutProperty(id, "visibility", state.showProperties ? "visible" : "none");
      }
      for (const id of ["properties-landtype", "properties-landtype-line"]) if (map.getLayer(id)) map.setLayoutProperty(id, "visibility", state.showLandType ? "visible" : "none");
      ALTORecordLinks.apply(map, state.showCouncilPositions);
      if (map.getLayer("points-property")) applyPropertySelection();
      applyAreaHighlight();
      applyMaximaRings();
      scheduleViewportStats();
      renderLegend();
    }
    // Species maxima (tool 0.2.8): maxima.json from the release's derived folder (species-maxima.js). The filter shows
    // only the trees holding a clear-lead maximum in the chosen area (Auckland or a local board), rings them and zooms
    // to them; the panel shows the tree's "Maximum · …" line. A release without the file shows no control.
    function applyMaximaRings() {
      const src = map.getSource("maxima-rings");
      if (!src) return;
      const set = state.onlyMaxima && maxima ? ALTOMaxima.mapSet(maxima, state.maximaArea) : null;
      src.setData({ type: "FeatureCollection", features: (set?.trees || []).map(t => ({ type: "Feature", properties: { tn: t },
        geometry: { type: "Point", coordinates: [maxima.trees[t].lon, maxima.trees[t].lat] } })) });
    }
    // The ringed trees, listed in Species maxima (species, measure and value), for the chosen area; an area with near-ties
    // only says why nothing is ringed.
    function renderMaximaList() {
      const el = document.getElementById("maximaList");
      if (!el) return;
      if (!state.onlyMaxima || !maxima) { el.hidden = true; el.textContent = ""; return; }
      const set = ALTOMaxima.mapSet(maxima, state.maximaArea), href = `./maxima.html${state.maximaArea === ALTOMaxima.AUCKLAND ? "" : `?area=${encodeURIComponent(state.maximaArea)}`}`;
      const list = `<a href="${escapeHtml(href)}">Species maxima in ${escapeHtml(state.maximaArea)}</a>`;
      el.hidden = false;
      el.innerHTML = set.trees.length
        ? `${set.trees.length} ${set.trees.length === 1 ? "tree is" : "trees are"} ringed. Each one’s species, measure and value: ${list}.`
        : `Near-ties only in ${escapeHtml(state.maximaArea)}: no tree leads its species by more than the margin, so none is ringed. ${list}.`;
    }
    function zoomToMaxima() {
      const set = maxima ? ALTOMaxima.mapSet(maxima, state.maximaArea) : null;
      if (!set?.bounds) return;
      const [[w, s], [e, n]] = set.bounds;
      // Clear of the left panel (and the tree panel when it is open), as a property is framed.
      const pad = propertyPadding();
      // On a phone, clear of the brand row and of the bottom sheet as it will stand over the map (its half stop when the
      // full sheet is open), so no ring sits under the sheet.
      const sheet = sheetLayout.matches ? Math.min(explorer.offsetHeight, sheetStop(panelSheet === "full" ? "half" : panelSheet)) : 0;
      const padding = mobileLayout.matches ? { top: 96, right: 28, bottom: Math.max(200, sheet + 24), left: 28 }
        : { ...pad, top: 60, right: document.body.dataset.profileOpen === "true" ? pad.right : 60, bottom: Math.max(60, pad.bottom) };
      map.fitBounds([[w - 0.002, s - 0.0015], [e + 0.002, n + 0.0015]], { padding, maxZoom: 16.5, duration: reducedMotion.matches ? 0 : 900 });
    }
    // The tree markers thin out below zoom 16, so a ring may stand alone: selecting it opens its tree.
    map.on("click", "maxima-rings", async event => {
      if (pickMode || map.queryRenderedFeatures(event.point, { layers: ["points", "points-records"].filter(id => map.getLayer(id)) }).length) return;
      const tn = event.features?.[0]?.properties?.tn;
      if (!tn) return;
      try {
        const { record, resolved } = await loadTree(tn), r = record.datasets.record || {};
        if (Number.isFinite(Number(r.lon)) && Number.isFinite(Number(r.lat))) map.flyTo({ center: [Number(r.lon), Number(r.lat)], zoom: Math.max(map.getZoom(), 18) });
        openProfile({ ...r, tree_id: record.tree_id, tn: record.datasets.tree_number?.number }, { resolved });
      } catch (error) { console.warn("Species maxima: could not open", tn, error); }
    });
    map.on("mouseenter", "maxima-rings", () => { map.getCanvas().style.cursor = "pointer"; });
    map.on("mouseleave", "maxima-rings", () => { map.getCanvas().style.cursor = ""; });

    function applyLayerToggles() {
      // Crowns hide while the change view is on, so removals/establishments aren't buried.
      const crownVis = (state.showCrowns && !state.showChange) ? "visible" : "none";
      if (map.getLayer("crowns-fill")) map.setLayoutProperty("crowns-fill", "visibility", crownVis);
      if (map.getLayer("crowns-outline")) map.setLayoutProperty("crowns-outline", "visibility", crownVis);
      if (map.getLayer("crowns-outline-drawn")) map.setLayoutProperty("crowns-outline-drawn", "visibility", crownVis);
    }

    // When the change view is on, fade the base trees right down so the red/green
    // change dots stand out instead of drowning among 300k base markers.
    function applyChangeEmphasis() {
      if (map.getLayer("points")) {
        map.setPaintProperty("points", "circle-opacity", state.showChange
          ? 0.1
          : pointOpacityExpr());
        // Rings fade with the markers, so only the change layer's colours read in that mode.
        map.setPaintProperty("points", "circle-stroke-opacity", state.showChange ? 0.15 : 1);
      }
      applyLayerToggles();
    }

    // Base (flat) vs trunk-diameter-scaled marker radius. dbh_cm_crown_est is
    // crown-allometry *modelled* (indicative, not measured); coalesce a small
    // default so trees lacking an estimate stay visible rather than vanishing.
    const BASE_POINT_RADIUS = ["interpolate", ["linear"], ["zoom"], 10, 1.2, 14, 2.2, 17, 4, 20, 7];
    const TRUNK_POINT_RADIUS = [
      "interpolate", ["linear"], ["zoom"],
      12, ["interpolate", ["linear"], ["coalesce", ["get", "dbh_cm_crown_est"], 12], 5, 0.8, 30, 2.0, 70, 4.2, 150, 7],
      16, ["interpolate", ["linear"], ["coalesce", ["get", "dbh_cm_crown_est"], 12], 5, 1.6, 30, 4.2, 70, 9, 150, 16],
      20, ["interpolate", ["linear"], ["coalesce", ["get", "dbh_cm_crown_est"], 12], 5, 3, 30, 7.5, 70, 16, 150, 28]
    ];
    function applyTrunkScaling() {
      if (map.getLayer("points")) {
        map.setPaintProperty("points", "circle-radius", state.showTrunk ? TRUNK_POINT_RADIUS : BASE_POINT_RADIUS);
      }
    }

    // One "Colour by" control. "Canopy change since 2013" shows the gone/grew-into-canopy layer and fades the other markers;
    // every other mode recolours markers and crowns. Colours, labels and marks: palette.js.
    function colourExpression(mode) {
      if (mode === "height") return ["case", ["any", ["has", "height_max_m"], ["has", "crown_max_chm_m"]],
        PAL.step("height", ["coalesce", ["get", "height_max_m"], ["get", "crown_max_chm_m"], 0]), PAL.colour("height", "none")];
      if (mode === "structure") return ALTOGrowthForm.colour();
      if (mode === "evidence") return PAL.match("evidence", ["coalesce", ["get", "evidence_tier"], "recorded"], "unverified");
      if (mode === "tenure") return PAL.match("tenure", ["coalesce", ["get", "tenure"], "unknown"], "other");
      if (mode === "quality") return ALTOSources.qualityColourExpr();
      return ALTOSources.colourExpr();
    }
    // The legend's category for one map feature, so each row can show how many trees in view it covers.
    function legendKey(mode, p) {
      if (mode === "source") { const k = ALTOSources.classify(p).primary; return k === "osm" || k === "kauri" ? "community" : k; }
      if (mode === "structure") { const g = ALTOGrowthForm.group(ALTOGrowthForm.key(p)); return g === "not_determined" || g === "none" ? "other" : g; }
      if (mode === "height") { const h = Number(p.height_max_m ?? p.crown_max_chm_m); return p.height_max_m == null && p.crown_max_chm_m == null || !Number.isFinite(h) ? "none" : h < 5 ? "h0" : h < 15 ? "h5" : h < 25 ? "h15" : "h25"; }
      if (mode === "quality") return ALTOSources.classify(p).quality;
      if (mode === "evidence") { const t = p.evidence_tier || "recorded"; return PAL.legend("evidence").rows.find(r => r.key === t || (r.keys || []).includes(t))?.key || "unverified"; }
      if (mode === "tenure") { const t = p.tenure || "unknown"; return ["street", "park", "institutional", "private"].includes(t) ? t : "other"; }
      return null;
    }
    const swatch = (colour, mark = "dot") => `<i class="sw sw-${mark}" style="--sw:${escapeHtml(colour)}" aria-hidden="true"></i>`;
    const ESTIMATE = '<span class="badge-estimate">Estimate</span>';
    // Colour-coded layers that add a legend section while they are on.
    const LEGEND_LAYERS = [["showKauri", "kauri"], ["showCanopy", "canopy"], ["showRootZone", "rootzone"], ["showLandType", "parcels"],
      ["showCouncilPositions", "positions"], ["showLowCanopy", "candidates"]];
    function legendSections(mode) {
      const sections = [], counts = new Map();
      if (mode !== "change") for (const f of viewportFeatures) { const k = legendKey(mode, f.properties || {}); if (k) counts.set(k, (counts.get(k) || 0) + 1); }
      const L = PAL.legend(mode) || PAL.legend("source");
      sections.push({ id: mode, title: `Colour: ${L.title.toLowerCase()}`, estimate: L.estimate, inferred: L.inferred, note: L.note,
        rows: [...PAL.rows(mode).map(r => ({ ...r, count: mode === "change" || (state.onlyMaxima && maxima) ? null : counts.get(r.key) || 0 })),
          ...(mode === "change" ? [{ key: "extent", label: "Extent of the 2013 and 2016 surveys", colour: tok("--neutral-700"), mark: "dashed-line", count: null }] : [])] });
      // Marks that mean the same in every mode (none with "Canopy change since 2013", which fades the markers).
      const marks = PAL.marksFor(mode);
      if (marks.length) sections.push({ id: "marks", title: "Marks", rows: marks });
      for (const [flag, key] of LEGEND_LAYERS) if (state[flag]) {
        const L2 = PAL.legend(key);
        sections.push({ id: key, title: L2.title, inferred: L2.inferred, note: key === "canopy" ? `${L2.note} Drawn at local-board scale, to zoom 12.` : L2.note, rows: PAL.rows(key) });
      }
      // Release 6.3: the Notable Group of Trees areas, said as Council's indicative layer; inside is not scheduled.
      if (state.showGroupAreas) sections.push({ id: "groupAreas", title: "Notable Group of Trees areas", rows: [{ key: "group", label: "Schedule 10 group area", colour: tok("--color-protected"), mark: "dashed-line", count: null }],
        note: "Auckland Unitary Plan Notable Group of Trees Overlay, Plans and Places, Auckland Council (retrieved 4 Jun 2026; CC BY 4.0). The overlay is indicative; a tree inside an area is not thereby one of the scheduled trees." });
      if (state.onlyMaxima && maxima) {
        const set = ALTOMaxima.mapSet(maxima, state.maximaArea);
        sections.push({ id: "maxima", title: "Species maxima", rows: [{ key: "maximum", label: "ring = species maximum", colour: tok("--color-selection"), mark: "ring", count: null }],
          note: `${set.trees.length} ${set.trees.length === 1 ? "tree holds" : "trees hold"} the largest measured height, crown spread or crown area of their species in ${set.area} (2024 LiDAR; clear leads only).` });
      }
      if (state.showLowBand || state.showSubBand) {
        const L2 = PAL.legend("vegetation");
        sections.push({ id: "vegetation", title: L2.title, note: L2.note, rows: PAL.rows("vegetation").filter(r => r.key === "low_canopy" ? state.showLowBand : state.showSubBand) });
      }
      return sections;
    }
    const nfCount = n => formatNumber.format(n);
    // Legend rows that name a filter category show or hide it (from concept B): source, link status, land
    // type and growth form. The filter state is the Filters drawer's; chips show what is hidden.
    const LEGEND_FILTERS = {
      source: { set: () => state.visibleSources, keys: r => r.keys || [r.key] },
      quality: { set: () => state.visibleQuality, keys: r => [r.key] },
      tenure: { set: () => state.visibleLand, keys: r => [r.key] },
      structure: { set: () => state.visibleGrowthForms, keys: r => r.keys || [r.key] }
    };
    const legendRowOn = (mode, r) => LEGEND_FILTERS[mode].keys(r).every(k => LEGEND_FILTERS[mode].set().has(k));
    function legendRow(sec, r) {
      const inner = `${swatch(r.colour, r.mark)}<span class="ml-label">${escapeHtml(r.label)}${r.detail ? `<small>${escapeHtml(r.detail)}</small>` : ""}</span>${r.count != null ? `<span class="ml-count">${nfCount(r.count)}</span>` : ""}`;
      if (!LEGEND_FILTERS[sec.id] || sec.id === "structure" && document.getElementById("growthFormFilter").hidden) return `<li>${inner}</li>`;
      const on = legendRowOn(sec.id, r);
      return `<li><button type="button" class="ml-row" data-legend-toggle="${sec.id}:${escapeHtml(r.key)}" aria-pressed="${on}" title="${on ? "Hide" : "Show"} ${escapeHtml(r.label)}">${inner}</button></li>`;
    }
    function legendHtml(sections, { idPrefix }) {
      return sections.map(sec => `<div class="ml-section" role="group" aria-labelledby="${idPrefix}-${sec.id}">
        <p class="ml-title" id="${idPrefix}-${sec.id}">${escapeHtml(sec.title)}${sec.estimate ? ` ${ESTIMATE}` : ""}${sec.inferred ? ' <span class="ml-kind">inferred</span>' : ""}</p>
        <ul class="ml-rows">${sec.rows.map(r => legendRow(sec, r)).join("")}</ul>
        ${sec.note ? `<p class="ml-note">${escapeHtml(sec.note)}${LEGEND_FILTERS[sec.id] && sec.rows.some(() => true) && !(sec.id === "structure" && document.getElementById("growthFormFilter").hidden) ? " Select a row to show or hide it." : ""}</p>` : ""}</div>`).join("");
    }
    for (const box of [document.getElementById("legendBody"), document.getElementById("colourLegend")]) box.addEventListener("click", event => {
      const b = event.target.closest("[data-legend-toggle]"); if (!b) return;
      const [mode, key] = b.dataset.legendToggle.split(":"), F = LEGEND_FILTERS[mode];
      const row = PAL.legend(mode)?.rows.find(r => r.key === key); if (!F || !row) return;
      const on = legendRowOn(mode, row), set = F.set();
      for (const k of F.keys(row)) on ? set.delete(k) : set.add(k);
      panelActions?.sync(); applyFilters();
      // Keep the keyboard on the row that was pressed (the legend redraws).
      requestAnimationFrame(() => box.querySelector(`[data-legend-toggle="${CSS.escape(b.dataset.legendToggle)}"]`)?.focus({ preventScroll: true }));
    });
    // The legend is docked under the left panel (desktop) and sits in the bottom sheet under "Colour by"
    // (phones). Open by default; the visitor's open or closed choice holds for the visit.
    let legendOpen = true;
    function renderLegend(mode = document.getElementById("colourBy").value) {
      const sections = legendSections(mode);
      document.getElementById("colourLegend").innerHTML = legendHtml(sections, { idPrefix: "sheetleg" });
      const title = document.querySelector(`#colourBy option[value="${mode}"]`)?.textContent || "Source";
      document.getElementById("legendMode").textContent = title;
      document.getElementById("legendBody").innerHTML = legendHtml(sections, { idPrefix: "leg" });
      placeLegend();
    }
    function setLegendOpen(open) {
      legendOpen = open;
      placeLegend();
    }
    // When an open drawer leaves no room, the legend folds to its header; opening it then closes the drawer.
    document.getElementById("legendToggle").addEventListener("click", () => {
      if (legendOpen && document.getElementById("mapLegend").dataset.folded === "space") { setDrawer(null); placeLegend(); return; }
      setLegendOpen(!legendOpen);
    });
    // Docked: the legend's left edge and width follow the panel (or the dock when the panel is hidden), its
    // top sits 8 px under it, and it never reaches the scale bar; the panel leaves room for the legend's header.
    function placeLegend() {
      const el = document.getElementById("mapLegend");
      if (!el || sheetLayout.matches) return;
      const collapsed = document.body.dataset.asideCollapsed === "true";
      const anchor = collapsed ? document.querySelector(".map-dock") : document.getElementById("explorer");
      if (!anchor) return;
      const left = anchor.offsetLeft, top = anchor.offsetTop + anchor.offsetHeight + 8, width = anchor.offsetWidth;
      const bottom = window.innerHeight - 40, room = bottom - top, fits = room >= 44 + 72;
      el.style.left = `${left}px`; el.style.top = `${top}px`; el.style.width = `${width}px`;
      el.style.maxHeight = `${Math.max(44, room)}px`;
      const open = legendOpen && fits;
      document.getElementById("legendToggle").setAttribute("aria-expanded", String(open));
      document.getElementById("legendBody").hidden = !open;
      el.dataset.folded = legendOpen && !fits ? "space" : "";
    }
    new ResizeObserver(placeLegend).observe(document.getElementById("explorer"));
    new ResizeObserver(placeLegend).observe(document.querySelector(".map-dock"));
    new MutationObserver(placeLegend).observe(document.body, { attributes: true, attributeFilter: ["data-aside-collapsed"] });
    window.addEventListener("resize", placeLegend);
    function applyColourMode() {
      const mode = document.getElementById("colourBy").value;
      const change = mode === "change";
      if (state.showChange !== change) { state.showChange = change; applyFilters(); applyChangeEmphasis(); }
      const expression = colourExpression(change ? "source" : mode);
      if (map.getLayer("points")) {
        map.setPaintProperty("points", "circle-color", markerFill(expression));
        map.setPaintProperty("points", "circle-stroke-color", markerStrokeColour(expression));
        // Detection evidence is drawn in colour, so every marker is opaque there; elsewhere uncertain detections fade.
        if (!change) map.setPaintProperty("points", "circle-opacity", mode === "evidence" ? 0.94 : pointOpacityExpr());
      }
      // Crowns: one crown colour in Source mode; the colour of their tree in the other modes.
      const fill = mode === "source" || change ? CROWN_FILL() : expression, line = mode === "source" || change ? CROWN_LINE() : expression;
      if (map.getLayer("crowns-fill")) map.setPaintProperty("crowns-fill", "fill-color", fill);
      for (const id of ["crowns-outline", "crowns-outline-drawn"]) if (map.getLayer(id)) map.setPaintProperty(id, "line-color", line);
      if (map.getLayer("points-duplicate")) map.setLayoutProperty("points-duplicate", "visibility", mode === "evidence" ? "visible" : "none");
      renderLegend(mode);
      writeViewLink();
    }
    document.getElementById("colourBy").addEventListener("change", applyColourMode);
    for(const key of ['showLowBand','showSubBand','wideCrownOnly','showEarlierDetections'])document.getElementById(key).addEventListener('change',event=>{state[key]=event.target.checked;exclusiveFill(key);applyFilters();});
    // Area fills are one theme at a time, so each fill colour keeps one meaning (palette.js FILL_THEMES; the
    // colour test checks each theme with every colour mode). Turning one on turns the others off and says so.
    const FILL_THEME_FLAGS = { parcels: ["showLandType"], rootzone: ["showRootZone"], vegetation: ["showLowBand", "showSubBand"], canopy: ["showCanopy"] };
    function exclusiveFill(flag) {
      const theme = Object.keys(FILL_THEME_FLAGS).find(t => FILL_THEME_FLAGS[t].includes(flag));
      if (!theme || !state[flag]) return;
      const off = [];
      for (const [t, flags] of Object.entries(FILL_THEME_FLAGS)) if (t !== theme) for (const f of flags) if (state[f]) {
        state[f] = false; const box = document.getElementById(f); if (box) box.checked = false;
        off.push(LAYER_TOGGLES.find(([id]) => id === f)?.[1] || f);
      }
      if (off.length) {
        const name = LAYER_TOGGLES.find(([id]) => id === flag)?.[1] || flag;
        const status = document.getElementById("status");
        status.textContent = `${name} is on; ${off.join(" and ")} turned off. One area colour shows at a time.`;
        clearTimeout(exclusiveFill.timer); exclusiveFill.timer = setTimeout(() => { if (status.textContent.endsWith("One area colour shows at a time.")) status.textContent = ""; }, 6000);
      }
    }
    map.on('click','near-canopy',event=>{const f=event.features?.[0];if(!f)return;const p=f.properties;new maplibregl.Popup({closeButton:true}).setLngLat(event.lngLat).setHTML(`<strong>${p.canopy_class==='low_canopy'?'Low canopy · 2–3 m':'Low vegetation · under 2 m'}</strong><p>Height ${Number(p.height_m).toFixed(1)} m · crown ${Number(p.crown_area_m2).toFixed(1)} m²</p><p>Vegetation candidate; excluded from tree service totals.</p>`).addTo(map);});

    // Drawn features are a sample at low zoom, never an area-wide census.
    let viewportFeatures = [];
    let identityReady = false;
    let areaScope = "view";
    function updateViewportStats() {
      if (!map.getLayer("points")) return;
      try {
        const bounds = map.getBounds();
        viewportFeatures = ALTOAnalysis.uniqueTrees(map.queryRenderedFeatures({ layers: [map.getLayer("points-records") ? "points-records" : "points"] }))
          .filter(f => f.geometry?.type === "Point" && bounds.contains(f.geometry.coordinates));
        const grouped = identityReady ? ALTOIdentity.update(viewportFeatures) : {markers:viewportFeatures.length,records:viewportFeatures.length,groups:[]};
        const summary = ALTOAnalysis.summarise(viewportFeatures);
        const value = (id, text) => { document.getElementById(id).textContent = text; };
        // Below zoom 16 the tiles hold a sample of the markers: it is counted as drawn, never summed as a total.
        const sample = map.getZoom() < 16;
        // UX-06: with the Species maxima filter on, the headline counts the rings, which show at every zoom.
        const rings = state.onlyMaxima && maxima ? ALTOMaxima.mapSet(maxima, state.maximaArea) : null;
        // One marker or maximum reads in the singular ("1 marker in view").
        const shownCount = rings ? rings.trees.length : grouped.markers, one = shownCount === 1;
        const countLabel = rings ? `species ${one ? "maximum" : "maxima"} in ${state.maximaArea} (${one ? "ring" : "rings"})` : sample ? `${one ? "marker" : "markers"} drawn (a sample at this zoom)` : `${one ? "marker" : "markers"} in view`;
        value("viewportCount", formatNumber.format(shownCount));
        value("viewportCountLabel", countLabel);
        value("floatingTrees", formatNumber.format(shownCount));
        value("floatingLabel", countLabel);
        const crownArea = summary.crownCount ? summary.crownArea : null;
        // Crown area under a hectare is printed in m² (alto-format.js viewArea).
        const canopy = sample || crownArea === null ? null : FMT.viewArea(crownArea);
        value("viewCanopy", canopy ? canopy[0] : FMT.MISSING); value("viewCanopyUnit", canopy ? canopy[1] : "");
        value("floatingCanopy", canopy ? `${canopy[0]} ${canopy[1]}` : FMT.MISSING);
        document.getElementById("floatingCanopyPart").hidden = sample;
        value("viewHeight", !sample && summary.heightCount ? FMT.fixed(summary.meanHeight, 1) : FMT.MISSING); value("viewHeightUnit", !sample && summary.heightCount ? "m" : "");
        document.querySelector(".view-summary").dataset.sample = String(sample);
        const noSource = !state.visibleSources.size || !state.visibleQuality.size;
        value("viewScope", noSource ? "Every source or link status is off. Turn one on in Filters." : !summary.count ? (map.areTilesLoaded?.() === false ? "Loading markers in this view…" : state.onlyMaxima && maxima ? "Species maxima are ringed. Zoom in to see their markers, or select a ring to open its tree." : "No markers in view. Move the map or clear filters.") : rings ? "Each ring is a tree holding a species maximum. Select a ring to open its tree." : sample ? "Zoom in to 16 to total this view: crown area and height are not summed over a sample." : `All markers in view · ${grouped.groups.length.toLocaleString("en-NZ")} crowns with several records${summary.tallCount ? ` · mean height leaves out ${formatNumber.format(summary.tallCount)} flagged ${summary.tallCount === 1 ? "height" : "heights"} of ${summary.tallM} m or more` : ""}`);
        updateSourceCounts(bounds);
        renderArea();
        renderLegend();
      } catch (error) {
        document.getElementById("viewScope").textContent = "Map updating…";
      }
    }
    // Live counts beside each source, status and quality chip: every tree in the loaded tiles within the
    // view, whatever the filters (so a source that is off still shows what it would add).
    function updateSourceCounts(bounds) {
      if (document.getElementById("paneExplore").hidden || document.body.dataset.asideCollapsed === "true") return;
      const counts = {}, seen = new Set();
      for (const f of map.querySourceFeatures("akl-points", { sourceLayer: "trees" })) {
        const p = f.properties, id = p.tree_id;
        if (!id || seen.has(id) || p.display_role === "earlier_detection" && !state.showEarlierDetections) continue;
        const c = f.geometry?.coordinates;
        if (!c || !bounds.contains(c)) continue;
        seen.add(id);
        const k = ALTOSources.classify(p);
        for (const s of k.sources) counts[s] = (counts[s] || 0) + 1;
        if (k.protected) counts.s_protected = (counts.s_protected || 0) + 1;
        counts["q_" + k.quality] = (counts["q_" + k.quality] || 0) + 1;
      }
      const sample = map.getZoom() < 16, ringsOnly = state.onlyMaxima && !!maxima;
      document.querySelectorAll("[data-count-key]").forEach(el => {
        // Counts of every tree in view by source say nothing about the ringed species maxima: hidden while that filter is on.
        el.hidden = ringsOnly;
        const n = counts[el.dataset.countKey] || 0;
        el.textContent = formatNumber.format(n || 0); // exact, with thousands separators (design system 2.5)
        el.title = `${formatNumber.format(n)} in this view${sample ? " (map sample)" : ""}`;
      });
    }
    // The Area tab: nested places that follow the map (region › local board › view) and a selected property.
    let areaTimer = null, areaBoard = null, areaBoards = null, areaHighlight = null, boardFeatures = [];
    // Auckland's figures: the release metadata's headline totals (dataset.headline_totals), never figures baked into the page.
    function areaTotals() {
      const m = releaseMetadata, ds = m?.dataset || {}, h = ds.headline_totals || {};
      // Benefits: release 6.3's benefitValueNzdY (stormwater and carbon), else release 6.2's totalValueNzdY (release-fields.js).
      const b = ALTOFields.headlineBenefit(h);
      return { markers: h.trees ?? ds.current_map_markers ?? null, crowns: h.crowns ?? ds.crown_records ?? null, schedule: h.protected ?? null, lidar: h.lidarInferred ?? null,
        value: b ? b.value : null, valueBasis: b ? b.basis : null, runoff: h.runoffM3Y ?? null, carbon: h.carbonTco2e ?? null };
    }
    // The active filters in a few words, for the Area subtitles ("no filters" when none).
    function filterWords() {
      const f = chipList.filter(c => c.kind === "filter").map(c => c.label);
      return f.length ? `filters: ${f.join("; ")}` : "no filters";
    }
    function insideBoard(pt, geom) {
      const inRing = (ring) => { let ok = false; for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) { const [xi, yi] = ring[i], [xj, yj] = ring[j]; if ((yi > pt[1]) !== (yj > pt[1]) && pt[0] < (xj - xi) * (pt[1] - yi) / (yj - yi) + xi) ok = !ok; } return ok; };
      for (const poly of geom.type === "Polygon" ? [geom.coordinates] : geom.coordinates) if (inRing(poly[0]) && !poly.slice(1).some(inRing)) return true;
      return false;
    }
    function boardOutline(feature) {
      const data = feature ? { type: "FeatureCollection", features: [feature] } : { type: "FeatureCollection", features: [] };
      if (!map.getSource("area-boundary")) {
        try { map.addSource("area-boundary", { type: "geojson", data }); map.addLayer({ id: "area-boundary", type: "line", source: "area-boundary", paint: { "line-color": tok("--color-selection"), "line-width": 2, "line-dasharray": [3, 2], "line-opacity": 0.8 } }, "points"); } catch { return; }
      } else map.getSource("area-boundary").setData(data);
    }
    function renderArea() {
      const pane = document.getElementById("paneView");
      if (pane.hidden || document.body.dataset.asideCollapsed === "true") return;
      clearTimeout(areaTimer);
      areaTimer = setTimeout(() => {
        const body = document.getElementById("areaBody");
        if (areaScope === "property" && !currentProperty?.record) areaScope = "view";
        const crumbs = document.querySelectorAll("[data-area-scope]");
        crumbs.forEach(b => b.setAttribute("aria-pressed", String(b.dataset.areaScope === areaScope)));
        const boardButton = document.querySelector('[data-area-scope="board"]'), propertyButton = document.querySelector('[data-area-scope="property"]');
        boardButton.hidden = !areaBoard; if (areaBoard) boardButton.textContent = areaBoard.properties.board_name;
        propertyButton.hidden = !currentProperty?.record;
        if (currentProperty?.record) propertyButton.textContent = currentProperty.address ? ALTOProperty.label(currentProperty.address) : `Parcel ${currentProperty.pid}`;
        boardOutline(areaScope === "board" ? areaBoard : null);
        if (areaScope === "region") {
          const d = ALTOVersion.data(releaseMetadata);
          body.innerHTML = ALTOArea.render({ count: 0 }, { kind: "region", title: "Auckland", subtitle: "Metropolitan Auckland, mapped extent", totals: areaTotals(), maxima, base: SITE_ROOT,
            error: releaseMetadataError ? `Release metadata not loaded (${releaseMetadataError}).` : null,
            release: d.label ? `release ${d.label.replace(/^v/, "")}${d.dev ? " (preview)" : ""}` : null });
          return;
        }
        if (areaScope === "property") {
          const rec = currentProperty.record, tiles = new Map();
          for (const f of map.querySourceFeatures("akl-points", { sourceLayer: "trees" })) if (!tiles.has(f.properties.tree_id)) tiles.set(f.properties.tree_id, f);
          const features = (rec.trees || []).map(t => { const f = tiles.get(t.tree_id); return { properties: { ...(f?.properties || {}), ...t }, geometry: f?.geometry || null }; });
          const a = ALTOArea.summarise(features);
          body.innerHTML = ALTOArea.render(a, { kind: "property", title: currentProperty.address ? ALTOProperty.fullLabel(currentProperty.address) : `LINZ parcel ${currentProperty.pid}`,
            subtitle: [ALTOProperty.TENURE[rec.property?.tenure] || null, rec.property?.zone || null].filter(Boolean).join(" · "), property: rec });
          areaLast = a; return;
        }
        if (areaScope === "board" && areaBoard) {
          boardFeatures = viewportFeatures.filter(f => insideBoard(f.geometry.coordinates, areaBoard.geometry));
          const a = ALTOArea.summarise(boardFeatures);
          body.innerHTML = ALTOArea.render(a, { kind: "board", title: `${areaBoard.properties.board_name} local board`, subtitle: `Markers drawn inside the board in this view · zoom ${map.getZoom().toFixed(1)} · ${filterWords()}`, board: areaBoard.properties, sample: map.getZoom() < 16, maxima, base: SITE_ROOT,
            empty: "No markers drawn inside the board in this view." });
          areaLast = a; return;
        }
        const a = ALTOArea.summarise(viewportFeatures);
        body.innerHTML = ALTOArea.render(a, { kind: "view", title: "Current map view", subtitle: `${areaBoard ? `${areaBoard.properties.board_name} local board · ` : ""}zoom ${map.getZoom().toFixed(1)} · ${map.getZoom() < 16 ? "a sample of the markers" : "every marker in view"} · ${filterWords()}`, sample: map.getZoom() < 16 });
        areaLast = a;
      }, 60);
    }
    let areaLast = null, areaPlaceKey = "", boardPin = null;
    // The local boards file, fetched once; a failed fetch is tried again next time instead of being kept.
    function loadLocalBoards() {
      if (!areaBoards) areaBoards = fetch(`${DATA_BASE}/local_boards.json`).then(r => r.ok ? r.json() : null).catch(() => null)
        .then(fc => { if (!fc?.features) { areaBoards = null; return null; } return fc; });
      return areaBoards;
    }
    // A local board chosen in the search stays the Area's board until the map is moved by hand.
    map.on("movestart", event => { if (event.originalEvent) boardPin = null; });
    function updateAreaPlace() {
      const c = map.getCenter(), key = `${c.lng.toFixed(3)},${c.lat.toFixed(3)}`;
      if (boardPin || key === areaPlaceKey) return;
      areaPlaceKey = key;
      loadLocalBoards().then(fc => {
        if (!fc) return;
        const next = fc.features.find(f => insideBoard([c.lng, c.lat], f.geometry)) || null;
        if (next?.properties.board_name !== areaBoard?.properties.board_name) { areaBoard = next; if (!areaBoard && areaScope === "board") areaScope = "view"; renderArea(); }
      });
    }
    // Area highlights: a click on a segment, column or list item rings those trees on the map.
    function applyAreaHighlight() {
      renderChips();
      if (!map.getLayer("points-area")) return;
      const chip = document.getElementById("areaHighlight");
      if (!areaHighlight) { setRings("points-area", ["==", ["get", "tree_id"], "__none__"]); chip.hidden = true; return; }
      const visible = buildFilter();
      setRings("points-area", visible ? ["all", visible, areaHighlight.expr] : areaHighlight.expr);
      chip.hidden = false;
      chip.innerHTML = `Ringed on the map: <b>${escapeHtml(areaHighlight.label)}</b> <button type="button" class="link-button" id="clearAreaHighlight">Clear</button>`;
      document.getElementById("clearAreaHighlight").onclick = () => { areaHighlight = null; applyAreaHighlight(); renderArea(); };
    }
    function areaClick(target) {
      const hl = target.closest("[data-highlight]"), go = target.closest("[data-area-go]");
      if (go && areaLast) {
        const t = go.dataset.areaGo === "tall" ? areaLast.tall?.[0] : areaLast[go.dataset.areaGo];
        if (t?.coords) { map.flyTo({ center: t.coords, zoom: Math.max(map.getZoom(), 18.5), duration: 900 }); openProfile({ ...t.props, lon: t.coords[0], lat: t.coords[1] }); }
        return;
      }
      // Species maxima (Auckland and a local board): a tree opens in the panel; "Ring them on the map" turns the
      // Species maxima filter on for that area.
      const mt = target.closest("[data-area-tree]"), ma = target.closest("[data-area-maxima]");
      if (mt) { openTreeByNumber(mt.dataset.areaTree, Number(mt.dataset.lon), Number(mt.dataset.lat)); return; }
      if (ma && maxima) {
        state.maximaArea = ma.dataset.areaMaxima; state.onlyMaxima = true; document.getElementById("onlyMaxima").checked = true;
        const sel = document.getElementById("maximaArea"); if ([...sel.options].some(o => o.value === state.maximaArea)) sel.value = state.maximaArea;
        applyFilters(); zoomToMaxima(); return;
      }
      if (!hl) return;
      const [kind, ...rest] = hl.dataset.highlight.split(":"), value = rest.join(":");
      if (areaHighlight?.key === hl.dataset.highlight) { areaHighlight = null; applyAreaHighlight(); return; }
      const expr = ALTOArea.highlightExpr(kind, value);
      if (!expr) return;
      const label = (hl.dataset.label || hl.querySelector("span")?.textContent || value).trim();
      areaHighlight = { key: hl.dataset.highlight, expr, label };
      applyAreaHighlight();
    }
    document.getElementById("areaBody").addEventListener("click", event => areaClick(event.target));
    document.getElementById("areaBody").addEventListener("keydown", event => { if ((event.key === "Enter" || event.key === " ") && event.target.closest("[data-highlight],[data-area-go]")) { event.preventDefault(); areaClick(event.target); } });
    // A tree named by its number (Area's Species maxima): fly to it when its position is known, then open its panel.
    function openTreeByNumber(number, lon, lat) {
      if (Number.isFinite(lon) && Number.isFinite(lat)) map.flyTo({ center: [lon, lat], zoom: Math.max(map.getZoom(), 18), duration: 900 });
      loadTree(number).then(({ record, resolved }) => openProfile({ ...(record.datasets.record || {}), tree_id: record.tree_id, tn: record.datasets.tree_number?.number }, { resolved }))
        .catch(err => showTreeLinkProblem(number, err));
    }
    // Select a property from the Area tab: parcels on, zoom to where they draw, then the next tap picks one.
    let pickMode = false;
    function setPickMode(on) {
      pickMode = on;
      document.body.dataset.pickProperty = String(on);
      map.getCanvas().style.cursor = on ? "crosshair" : "";
      const banner = document.getElementById("pickBanner");
      banner.hidden = !on;
      document.getElementById("pickProperty").setAttribute("aria-pressed", String(on));
    }
    document.getElementById("pickProperty").addEventListener("click", () => {
      if (pickMode) { setPickMode(false); return; }
      if (!state.showProperties) { state.showProperties = true; document.getElementById("showProperties").checked = true; applyFilters(); }
      if (map.getZoom() < 16) map.easeTo({ zoom: 16.5, duration: 600 });
      setPickMode(true);
      if (mobileLayout.matches) setSidebarCollapsed(true);
    });
    map.on("click", (event) => {
      if (!pickMode) return;
      const f = map.queryRenderedFeatures(event.point, { layers: ["properties-fill"] })[0];
      if (!f?.properties?.pid) { document.getElementById("pickBanner").textContent = "No parcel here. Tap inside a parcel outline, or press Esc."; return; }
      setPickMode(false);
      document.getElementById("pickBanner").textContent = "Tap a parcel to select it · Esc to cancel";
      openProperty(f.properties.pid, null, { tile: f.properties, fly: false });
    });
    document.addEventListener("keydown", e => { if (e.key === "Escape" && pickMode) setPickMode(false); });
    map.on("moveend", updateAreaPlace);
    document.getElementById("areaScope").addEventListener("click", event => {
      const b = event.target.closest("[data-area-scope]");
      if (!b || b.disabled) return;
      areaScope = b.dataset.areaScope;
      if (areaScope === "board" && areaBoard) {
        const pts = (areaBoard.geometry.type === "Polygon" ? [areaBoard.geometry.coordinates] : areaBoard.geometry.coordinates).flat(2);
        const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
        map.fitBounds([[Math.min(...xs), Math.min(...ys)], [Math.max(...xs), Math.max(...ys)]], { padding: propertyPadding(), duration: 800 });
      }
      renderArea();
    });
    // moveend and idle fire back-to-back after a pan/zoom; debounce so the
    // (potentially thousands of features) queryRenderedFeatures runs once —
    // trailing edge, so the last event (final rendered state) always wins.
    // FE-17: the statistics then wait for an idle moment (requestIdleCallback, at most 1 s), and are skipped while nobody
    // can see them: the page hidden, or the panel that shows them (the summary, the floating count, Area, the legend)
    // not displayed. They are worked out when the page or the panel shows again.
    let statsTimer = null, statsIdle = null, statsStale = false;
    const idle = window.requestIdleCallback ? (fn) => window.requestIdleCallback(fn, { timeout: 1000 }) : (fn) => setTimeout(fn, 1);
    const shown = (id) => { const el = document.getElementById(id); return !!el && el.getClientRects().length > 0; };
    const statsShown = () => document.visibilityState !== "hidden" && ["viewportCount", "floatingStats", "areaBody", "legendBody"].some(shown);
    function scheduleViewportStats() {
      if (statsTimer) clearTimeout(statsTimer);
      statsTimer = setTimeout(() => {
        statsTimer = null;
        if (!statsShown()) { statsStale = true; return; }
        if (statsIdle) return;
        statsIdle = idle(() => { statsIdle = null; statsStale = false; if (statsShown()) updateViewportStats(); else statsStale = true; });
      }, 120);
    }
    document.addEventListener("visibilitychange", () => { if (statsStale && document.visibilityState === "visible") scheduleViewportStats(); });
    // A panel that shows the statistics changes size when it is shown (from display: none): bring them up to date then.
    if (window.ResizeObserver) {
      const statsPanels = new ResizeObserver(() => { if (statsStale && statsShown()) scheduleViewportStats(); });
      for (const id of ["viewportCount", "floatingStats", "areaBody", "legendBody"]) { const el = document.getElementById(id); if (el) statsPanels.observe(el); }
    }
    map.on("moveend", scheduleViewportStats);
    map.on("resize", scheduleViewportStats);
    map.on("idle", scheduleViewportStats);

    // ---- Sidebar controls.
    (function bindSidebarControls() {
      const speciesTriggerText = document.getElementById("speciesTriggerText");
      const speciesSearch = document.getElementById("speciesSearch");
      const speciesOptions = document.getElementById("speciesOptions");
      const growthToggles = document.getElementById("growthToggles");
      const showCrowns = document.getElementById("showCrowns");
      const showRootZone = document.getElementById("showRootZone");
      const showTrunk = document.getElementById("showTrunk");
      const onlyNamed = document.getElementById("onlyNamed");
      const sourceToggles = document.getElementById("sourceToggles");
      const statusToggles = document.getElementById("statusToggles");
      const qualityToggles = document.getElementById("qualityToggles");

      // A row per option: the colour dot shows on or off, the label, and the live count for this view.
      // Sources come grouped Council / Community & surveys / Detected; planned sources are named under them.
      const chip = (attr, item, pressed, countKey) => `<button class="legend-row" type="button" ${attr}="${item.key}" aria-pressed="${pressed}" title="${escapeHtml(item.note || "")}"><span class="dot${item.mark === "ringed-dot" ? " dot-ringed" : ""}" style="background:${item.colour}"></span> <span class="chip-label">${escapeHtml(item.label)}</span> <span class="chip-count" data-count-key="${countKey}">·</span></button>`;
      function renderSourceChips() {
        sourceToggles.innerHTML = ALTOSources.GROUPS.map(([g, label]) => `<div class="source-group"><h4 class="lp-eyebrow">${escapeHtml(label)}</h4><div class="lp-rows">${ALTOSources.SOURCES.filter(x => x.group === g && !x.soon).map(x => chip("data-source", x, state.visibleSources.has(x.key), x.key)).join("")}</div></div>`).join("");
        statusToggles.innerHTML = ALTOSources.STATUS.filter(x => !x.soon).map(x => chip("data-status", x, state.statusOnly.has(x.key), "s_" + x.key).replace('class="dot"', 'class="dot dot-ring"')).join("");
        document.getElementById("statusHelp").textContent = "Shows only map markers linked to an entry of the Notable Trees schedule (Auckland Unitary Plan, Schedule 10). ALTO checks this schedule only.";
        qualityToggles.innerHTML = ALTOSources.QUALITY.map(x => chip("data-quality", x, state.visibleQuality.has(x.key), "q_" + x.key)).join("");
      }
      renderSourceChips();
      sourceToggles.addEventListener("click", event => {
        const b = event.target.closest("button[data-source]"); if (!b) return;
        const k = b.dataset.source;
        if (state.visibleSources.has(k)) state.visibleSources.delete(k); else state.visibleSources.add(k);
        b.setAttribute("aria-pressed", String(state.visibleSources.has(k))); applyFilters();
      });
      statusToggles.addEventListener("click", event => {
        const b = event.target.closest("button[data-status]"); if (!b) return;
        const k = b.dataset.status;
        if (state.statusOnly.has(k)) state.statusOnly.delete(k); else state.statusOnly.add(k);
        b.setAttribute("aria-pressed", String(state.statusOnly.has(k))); applyFilters();
      });
      qualityToggles.addEventListener("click", event => {
        const b = event.target.closest("button[data-quality]"); if (!b) return;
        const k = b.dataset.quality;
        if (state.visibleQuality.has(k)) state.visibleQuality.delete(k); else state.visibleQuality.add(k);
        b.setAttribute("aria-pressed", String(state.visibleQuality.has(k))); applyFilters();
      });
      onlyNamed.addEventListener("change", () => { state.showUnknown = !onlyNamed.checked; applyFilters(); });
      document.getElementById("showLandType").addEventListener("change", event => { state.showLandType = event.target.checked; exclusiveFill("showLandType"); applyFilters(); });
      // The Data quality group offers the recorded-positions layer too; both switches are one state.
      document.getElementById("qualityPositions").addEventListener("click", () => {
        const box = document.getElementById("showCouncilPositions");
        box.checked = !box.checked; box.dispatchEvent(new Event("change"));
      });

      function renderGrowthToggles() {
        // No growth-velocity data (e.g. the metro build) — hide the whole section.
        if (!GROWTH_BUCKETS.length) { growthToggles.parentElement.style.display = "none"; return; }
        growthToggles.innerHTML = "";
        for (const [key, label, icon, count] of GROWTH_BUCKETS) {
          const button = document.createElement("button");
          button.type = "button";
          button.className = "growth-row";
          button.dataset.growth = key;
          button.setAttribute("aria-pressed", state.growthFilters.has(key) ? "true" : "false");
          button.title = `Show only ${label.toLowerCase()} canopies (${formatNumber.format(count)})`;
          button.innerHTML = `<span class="gicon">${icon}</span><span class="glabel">${label}</span><span class="gcount">${formatNumber.format(count)}</span>`;
          growthToggles.appendChild(button);
        }
        growthToggles.dataset.active = state.growthFilters.size ? "true" : "false";
      }
      renderGrowthToggles();

      growthToggles.addEventListener("click", (event) => {
        const button = event.target.closest("button[data-growth]");
        if (!button) return;
        const key = button.dataset.growth;
        if (state.growthFilters.has(key)) state.growthFilters.delete(key);
        else state.growthFilters.add(key);
        renderGrowthToggles();
        applyFilters();
      });

      // Species: the list opens with its group; selected species lead the list and show as chips. One option per species
      // (buildSpeciesGroups), its count covering every spelling. Release 6.3: a common name with several Latin names lists
      // each as a sub-option (Cherry: Prunus sp., Prunus serrulata, Prunus serrula, Prunus × yedoensis).
      function renderSpeciesOptions() {
        const query = ALTOCommand.normalise(state.speciesSearch);
        speciesOptions.innerHTML = "";
        let matches = 0;
        const sel = new Set(selectedGroups()), options = [...SPECIES_GROUPS].sort((a, b) => sel.has(b) - sel.has(a));
        const N = window.ALTOSpeciesNames;
        for (const grp of options) {
          if (query && !ALTOCommand.normalise(grp.label).includes(query) && !grp.names.some(n => ALTOCommand.normalise(n).includes(query)) && !grp.subs.some(s => ALTOCommand.normalise(s.key).includes(query))) continue;
          const button = document.createElement("button");
          button.type = "button";
          const on = groupOn(grp);
          button.className = `species-option${on ? " active" : ""}`;
          button.dataset.species = grp.key;
          button.setAttribute("aria-pressed", String(on));
          matches++;
          const mi = N?.isMaori(grp.names[0]) && !grp.multi;
          // One Latin name: shown beside the common name; several: listed below it, each its own option.
          const one = SPECIES_KEYED && grp.subs.length === 1 && grp.subs[0].latin ? ` <i class="species-latin">${escapeHtml(subLabel(grp.subs[0]))}</i>` : "";
          button.innerHTML = `<span${mi ? ' lang="mi"' : ""}>${escapeHtml(grp.label)}</span>${one} <span class="count">${formatNumber.format(grp.count)}</span>`;
          if (grp.names.length > 1) button.title = `${formatNumber.format(grp.names.length)} spellings in the source records`;
          speciesOptions.appendChild(button);
          if (SPECIES_KEYED && grp.subs.length > 1) for (const s of grp.subs) {
            const sub = document.createElement("button"), son = state.selectedSpecies.has(s.key);
            sub.type = "button"; sub.className = `species-option species-sub${son ? " active" : ""}`; sub.dataset.speciesKey = s.key; sub.setAttribute("aria-pressed", String(son));
            sub.setAttribute("aria-label", `${grp.label}: ${subLabel(s)}, ${formatNumber.format(s.count)}`);
            sub.innerHTML = `<span>${s.latin ? `<i>${escapeHtml(subLabel(s))}</i>` : escapeHtml(subLabel(s))}</span> <span class="count">${formatNumber.format(s.count)}</span>`;
            speciesOptions.appendChild(sub);
          }
          if (matches >= 400 && !query) break;
        }
        if (!matches) {
          const empty = document.createElement("p"); empty.className = "species-empty"; empty.setAttribute("role", "status");
          empty.textContent = "No species match this search. Try a shorter name."; speciesOptions.appendChild(empty);
        }
      }

      function renderSpeciesState() {
        speciesTriggerText.textContent = speciesValue();
        renderSpeciesOptions();
      }

      // A species option selects every species key (release 6.3) or source spelling (release 6.2) it covers.
      function toggleSpecies(key) {
        const grp = SPECIES_GROUPS.find(x => x.key === key);
        const names = grp ? grp.keys : [key];
        if (names.every(n => state.selectedSpecies.has(n))) for (const n of names) state.selectedSpecies.delete(n);
        else for (const n of names) state.selectedSpecies.add(n);
        renderSpeciesState();
        applyFilters();
      }
      // Release 6.3: one Latin sub-option.
      function toggleSpeciesKey(k) {
        if (state.selectedSpecies.has(k)) state.selectedSpecies.delete(k); else state.selectedSpecies.add(k);
        renderSpeciesState();
        applyFilters();
      }
      // A shared view from release 6.2 names common names; on release 6.3 each becomes the species keys filed under it.
      function speciesSelectionToKeys() {
        const cn = SPECIES_V2?.common_names || {}, keys = new Set(SPECIES_V2.options.map(o => o.key)), out = new Set();
        for (const v of state.selectedSpecies) {
          if (keys.has(v)) { out.add(v); continue; }
          const grp = SPECIES_GROUPS.find(g => g.names.includes(v) || g.label === v);
          for (const k of (cn[v] || []).map(([k]) => k).concat(cn[v] ? [] : grp ? grp.keys : [])) out.add(k);
          if (!cn[v] && !grp) out.add(v);
        }
        state.selectedSpecies = out;
      }

      renderSpeciesState();
      // The list above is only a fallback. The release publishes every species name on the map with its
      // count, so rarer ones (privet, Phoenix palm) can be found too.
      // The release's species list (data/species_options.json): every name on the map with its count; from release 6.3
      // (version 2) every species key with its common and Latin names.
      dataMetadataReady.then(() => fetch(vq(`${DATA_BASE}/species_options.json`))).then((r) => { if (r.ok) return r.json(); if (r.status === 404) return null; throw Object.assign(new Error(`HTTP ${r.status}`), { status: r.status }); }).then((d) => {
        if (d && d.version === 2 && Array.isArray(d.options) && d.options.length && d.common_names) {
          SPECIES_KEYED = true; SPECIES_V2 = d; SPECIES_OPTIONS = d.options; buildSpeciesGroups(); speciesSelectionToKeys(); renderSpeciesState();
          if (state.selectedSpecies.size) applyFilters();
        }
        else if (d && Array.isArray(d.options) && d.options.length) { SPECIES_OPTIONS = d.options; buildSpeciesGroups(); renderSpeciesState(); }
      }).catch((e) => {
        const reason = e?.status ? `HTTP ${e.status}` : e instanceof SyntaxError ? "could not be read" : "network error";
        speciesOptions.innerHTML = `<p class="species-empty" role="status">Not loaded: data/species_options.json (${reason}). <button type="button" class="link-button" data-species-retry>Retry</button></p>`;
        speciesOptions.querySelector("[data-species-retry]").addEventListener("click", () => location.reload());
      });

      speciesSearch.addEventListener("input", () => {
        state.speciesSearch = speciesSearch.value;
        renderSpeciesOptions();
      });

      speciesOptions.addEventListener("click", (event) => {
        const sub = event.target.closest("button[data-species-key]");
        if (sub) {
          toggleSpeciesKey(sub.dataset.speciesKey);
          speciesOptions.querySelector(`button[data-species-key="${CSS.escape(sub.dataset.speciesKey)}"]`)?.focus({ preventScroll: true });
          return;
        }
        const button = event.target.closest("button[data-species]");
        if (!button) return;
        toggleSpecies(button.dataset.species);
        speciesOptions.querySelector(`button[data-species="${CSS.escape(button.dataset.species)}"]`)?.focus({ preventScroll: true });
      });

      const growthFormToggles = document.getElementById("growthFormToggles");
      growthFormToggles.innerHTML = ALTOGrowthForm.toggles(state.visibleGrowthForms).replaceAll("<span>", '<span class="chip-label">');
      growthFormToggles.addEventListener("click", (event) => {
        const button = event.target.closest("button[data-growth-form]");
        if (!button) return;
        const key = button.dataset.growthForm;
        if (state.visibleGrowthForms.has(key)) state.visibleGrowthForms.delete(key);
        else state.visibleGrowthForms.add(key);
        button.setAttribute("aria-pressed", String(state.visibleGrowthForms.has(key)));
        applyFilters();
      });
      const landToggles = document.getElementById("landToggles");
      landToggles.querySelectorAll("[data-land]").forEach(b => { const d = b.querySelector(".dot"); if (d) d.style.background = PAL.colour("tenure", b.dataset.land); });
      landToggles.addEventListener("click", (event) => {
        const button = event.target.closest("button[data-land]");
        if (!button) return;
        const key = button.dataset.land;
        if (state.visibleLand.has(key)) state.visibleLand.delete(key);
        else state.visibleLand.add(key);
        button.setAttribute("aria-pressed", String(state.visibleLand.has(key)));
        applyFilters();
      });

      document.getElementById("showLowCanopy").addEventListener("change", event => {
        state.showLowCanopy = event.target.checked; applyFilters();
      });
      function resetFilterState() {
        state.visibleSources = new Set(SOURCE_KEYS); state.statusOnly.clear(); state.visibleQuality = new Set(QUALITY_KEYS);
        state.visibleLand = new Set(LAND_GROUPS.map(([key]) => key)); state.selectedSpecies.clear(); state.visibleGrowthForms = new Set(ALTOGrowthForm.GROUP_KEYS);
        state.growthFilters.clear(); state.showEarlierDetections=false;document.getElementById('showEarlierDetections').checked=false; state.showUnknown = true; onlyNamed.checked = false; state.showUncertain = true; document.getElementById("showUncertain").checked = true;
        state.speciesSearch = ""; speciesSearch.value = ""; state.minHeight = 0; state.onlyMaxima = false; document.getElementById("onlyMaxima").checked = false;
        for (const group of [landToggles, growthFormToggles]) group.querySelectorAll("button").forEach(button => button.setAttribute("aria-pressed", "true"));
        renderSourceChips(); renderSpeciesState(); renderGrowthToggles();
      }
      document.getElementById("resetFilters").addEventListener("click", () => { resetFilterState(); applyFilters(); scheduleViewportStats(); });
      showCrowns.addEventListener("change", () => {
        state.showCrowns = showCrowns.checked;
        applyLayerToggles(); updateFilterControls();
      });
      document.getElementById("showProperties").addEventListener("change", event => {
        state.showProperties = event.target.checked;
        applyFilters();
      });

      document.getElementById("showUncertain").addEventListener("change", event => {
        state.showUncertain = event.target.checked;
        applyFilters();
      });
      document.getElementById("onlyMaxima").addEventListener("change", event => {
        state.onlyMaxima = event.target.checked;
        applyFilters();
        if (state.onlyMaxima) zoomToMaxima();
      });
      document.getElementById("maximaArea").addEventListener("change", event => {
        state.maximaArea = event.target.value;
        if (!state.onlyMaxima) { document.getElementById("onlyMaxima").checked = true; state.onlyMaxima = true; }
        applyFilters(); zoomToMaxima();
      });


      showRootZone.addEventListener("change", () => {
        state.showRootZone = showRootZone.checked;
        exclusiveFill("showRootZone");
        applyFilters();
      });

      showTrunk.addEventListener("change", () => {
        state.showTrunk = showTrunk.checked;
        applyTrunkScaling(); updateFilterControls();
      });

      const showCanopy = document.getElementById("showCanopy");
      showCanopy.addEventListener("change", () => {
        state.showCanopy = showCanopy.checked;
        exclusiveFill("showCanopy");
        applyFilters();
      });

      const showKauri = document.getElementById("showKauri");
      showKauri.addEventListener("change", () => {
        state.showKauri = showKauri.checked;
        applyFilters();
      });
      const showGroupAreas = document.getElementById("showGroupAreas");
      showGroupAreas.addEventListener("change", () => {
        state.showGroupAreas = showGroupAreas.checked;
        applyFilters();
      });

      const qualityPositions = document.getElementById("qualityPositions");
      document.getElementById("showCouncilPositions").addEventListener("change", event => {
        state.showCouncilPositions = event.target.checked;
        qualityPositions.setAttribute("aria-pressed", String(state.showCouncilPositions));
        qualityPositions.textContent = state.showCouncilPositions ? "Hide Council recorded positions" : "Show Council recorded positions";
        applyFilters();
      });

      // What the chips need: undo one group, set one switch, and clear everything at once.
      const setCheck = (id, value) => { const box = document.getElementById(id); if (box.checked !== value) { box.checked = value; box.dispatchEvent(new Event("change")); } };
      panelActions = {
        toggleSpecies, toggleSpeciesKey, setCheck,
        // The search changes the state directly; the controls follow it.
        sync() {
          renderSourceChips(); renderSpeciesState();
          landToggles.querySelectorAll("[data-land]").forEach(b => b.setAttribute("aria-pressed", String(state.visibleLand.has(b.dataset.land))));
          growthFormToggles.querySelectorAll("[data-growth-form]").forEach(b => b.setAttribute("aria-pressed", String(state.visibleGrowthForms.has(b.dataset.growthForm))));
          onlyNamed.checked = !state.showUnknown; document.getElementById("showUncertain").checked = state.showUncertain; document.getElementById("onlyMaxima").checked = state.onlyMaxima;
          for (const id of [...LAYER_TOGGLES.map(([key]) => key), "showCrowns", "showTrunk"]) { const box = document.getElementById(id); if (box) box.checked = !!state[id]; }
        },
        resetFilters: () => resetFilterState(),
        reset(group) {
          if (group === "sources") state.visibleSources = new Set(SOURCE_KEYS);
          if (group === "quality") state.visibleQuality = new Set(QUALITY_KEYS);
          if (group === "status") state.statusOnly.clear();
          if (group === "growth") { state.visibleGrowthForms = new Set(ALTOGrowthForm.GROUP_KEYS); growthFormToggles.querySelectorAll("button").forEach(b => b.setAttribute("aria-pressed", "true")); }
          if (group === "land") { state.visibleLand = new Set(LAND_GROUPS.map(([key]) => key)); landToggles.querySelectorAll("button").forEach(b => b.setAttribute("aria-pressed", "true")); }
          renderSourceChips(); applyFilters();
        },
        clearAll() {
          resetFilterState();
          for (const [id] of LAYER_TOGGLES) { state[id] = false; document.getElementById(id).checked = false; }
          state.showCrowns = true; showCrowns.checked = true; state.showTrunk = false; showTrunk.checked = false;
          qualityPositions.setAttribute("aria-pressed", "false"); qualityPositions.textContent = "Show Council recorded positions";
          areaHighlight = null; chipsExpanded = false;
          applyLayerToggles(); applyTrunkScaling(); applyFilters(); renderArea();
        }
      };
    })();

    // ---- The view in the address (FTA-23, view-link.js): rewritten with replaceState as the view changes (never a new
    // history entry), read once at start (VIEW_LINK above), copied by "Copy link to this view". The camera is written once
    // the map has moved or came from a link, so an untouched map keeps a bare address.
    const VIEW_ALL = { colour: "source", sources: SOURCE_KEYS, quality: QUALITY_KEYS, land: LAND_GROUPS.map(([key]) => key),
      forms: ALTOGrowthForm.GROUP_KEYS, status: ALTOSources.STATUS.filter(x => !x.soon).map(x => x.key) };
    function currentView() {
      const c = map.getCenter();
      return {
        camera: viewCameraSet ? { zoom: map.getZoom(), lat: c.lat, lon: c.lng } : null,
        colour: document.getElementById("colourBy").value,
        sources: [...state.visibleSources], statusOnly: [...state.statusOnly], quality: [...state.visibleQuality],
        land: [...state.visibleLand], forms: [...state.visibleGrowthForms], species: [...state.selectedSpecies],
        showUnknown: state.showUnknown, showUncertain: state.showUncertain, minHeight: state.minHeight,
        layers: Object.fromEntries(Object.keys(ALTOViewLink.LAYERS).map(key => [key, !!state[key]])),
        showCrowns: state.showCrowns, showTrunk: state.showTrunk,
        // A linked area waits for the maxima to load; until then the address keeps it.
        maxima: state.onlyMaxima ? state.maximaArea : (!maxima && VIEW_MAXIMA ? VIEW_MAXIMA : null)
      };
    }
    const viewHref = () => ALTOViewLink.href(window.location.href, currentView(), VIEW_ALL);
    function writeViewLink() {
      clearTimeout(viewWriteTimer);
      viewWriteTimer = setTimeout(() => {
        try {
          const next = viewHref(), now = window.location.pathname + window.location.search + window.location.hash;
          if (next !== now) history.replaceState(history.state, "", next);
        } catch { /* the address stays as it was */ }
      }, 300);
    }
    (function restoreViewLink(v) {
      if (v.colour) document.getElementById("colourBy").value = v.colour;
      if (!Object.keys(v).some(key => key !== "camera" && key !== "colour")) return;
      // One area fill at a time (FILL_THEME_FLAGS): a link naming two keeps the first.
      Object.values(FILL_THEME_FLAGS).filter(flags => flags.some(f => state[f])).slice(1).forEach(flags => flags.forEach(f => { state[f] = false; }));
      panelActions.sync();
      const positions = document.getElementById("qualityPositions");
      if (state.showCouncilPositions) { positions.setAttribute("aria-pressed", "true"); positions.textContent = "Hide Council recorded positions"; }
      updateFilterControls();
    })(VIEW_LINK);
    // A linked change is drawn only in Colour by change.
    if (LINKED_CHANGE) document.getElementById("colourBy").value = "change";
    map.on("moveend", () => { viewCameraSet = true; writeViewLink(); });
    window.addEventListener("popstate", writeViewLink);
    // "Copy link to this view" (the summary's button and the search command): the address with the camera, copied; where
    // the clipboard is refused, the link in a box under the button, selected.
    async function copyViewLink() {
      const button = document.getElementById("copyViewLink"), live = document.getElementById("viewLinkStatus"), slot = document.getElementById("viewLinkCopy");
      viewCameraSet = true;
      const path = viewHref(), url = new URL(path, window.location.href).href;
      try { history.replaceState(history.state, "", path); } catch { /* copied all the same */ }
      slot.hidden = true; slot.innerHTML = "";
      try {
        await navigator.clipboard.writeText(url);
        button.textContent = "Link copied"; live.textContent = "Link to this view copied.";
        setTimeout(() => { button.textContent = "Copy link to this view"; live.textContent = ""; }, 1600);
        return "Link to this view copied.";
      } catch {
        slot.innerHTML = `<label>Copy this link <input readonly value="${escapeHtml(url)}"></label>`; slot.hidden = false;
        slot.querySelector("input")?.select();
        return "The link to this view is in the box under the filters.";
      }
    }
    document.getElementById("copyViewLink").addEventListener("click", () => { copyViewLink(); });

    // ---- Popups for trees + crowns.
    function escapeHtml(value) {
      return String(value)
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
    }
    function safe(value) {
      return (value === null || value === undefined || value === "") ? "Unknown" : escapeHtml(value);
    }
    function fmt(value, digits, suffix) {
      if (value === null || value === undefined || value === "") return "Unknown";
      const n = Number(value);
      if (!Number.isFinite(n)) return "Unknown";
      return `${n.toFixed(digits ?? 1)}${suffix ?? ""}`;
    }



    function lowCanopyPopupHtml(props) {
      return `
        <div class="popup-title">Low-canopy candidate</div>
        <div class="popup-row"><span>Height</span><span>${fmt(props.height_m, 1, " m")}</span></div>
        <div class="popup-row"><span>Greenness</span><span>${fmt(props.gli, 2, "")}</span></div>
        <div class="popup-row"><span>Nearest tree</span><span>${fmt(props.nearest_tree_m, 1, " m")}</span></div>
        <div class="popup-row"><span>Score</span><span>${fmt(props.confidence_score, 2, "")}</span></div>
        <div class="popup-row"><span>Benefits</span><span>Not estimated</span></div>
      `;
    }

    function missedPopupHtml(props) {
      return `
        <div class="popup-title">Possible missed tree</div>
        <div class="popup-row"><span>Canopy height</span><span>${fmt(props.canopy_height_m, 1, " m")}</span></div>
        <div class="popup-row"><span>Crown patch</span><span>${fmt(props.patch_area_m2, 0, " m²")}</span></div>
        <div class="popup-row"><span>Penetration</span><span>${props.multireturn_fraction != null ? Math.round(props.multireturn_fraction*100)+"% multi-return" : "—"}</span></div>
        <div class="popup-row"><span>Greenness</span><span>${fmt(props.gli, 2, "")}</span></div>
        <div class="popup-row"><span>Status</span><span>Candidate — not in inventory</span></div>
        <div class="popup-note">Point-cloud canopy not matched to any inventory tree. High-confidence tier; review before adding.</div>
      `;
    }

    map.on("click", "points", (event) => {
      if (pickMode) return;
      const f = event.features[0];
      if (!f) return;
      const [lon, lat] = f.geometry?.coordinates || [];
      openProfile({ ...f.properties, lon, lat });
    });
    map.on("click", "crowns-fill", (event) => {
      if (pickMode) return;
      // Don't double-fire if a point or a recorded position was clicked at the same spot.
      const points = map.queryRenderedFeatures(event.point, { layers: ["points", "council-positions"].filter(id => map.getLayer(id)) });
      if (points.length) return;
      const f = event.features[0];
      if (!f) return;
      openProfile(f.properties);
    });
    map.on("click", "missed-candidates", (event) => {
      const f = event.features[0];
      if (!f) return;
      new maplibregl.Popup({ closeButton: true, maxWidth: "300px" })
        .setLngLat(event.lngLat)
        .setHTML(missedPopupHtml(f.properties))
        .addTo(map);
    });
    map.on("mouseenter", "missed-candidates", () => { map.getCanvas().style.cursor = "pointer"; });
    map.on("mouseleave", "missed-candidates", () => { map.getCanvas().style.cursor = ""; });
    map.on("click", "canopy-fill", (event) => {
      const p = event.features[0] && event.features[0].properties;
      if (!p) return;
      const cover = (p.canopy_cover_pct == null) ? "–" : `${Math.round(+p.canopy_cover_pct)}%`;
      const note = (+p.fully_assessed === 1) ? ""
        : `<div class="popup-note">Partly inside the assessed area (${Math.round(p.coverage_fraction * 100)}%); canopy cover is a lower bound.</div>`;
      new maplibregl.Popup({ closeButton: true, maxWidth: "280px" })
        .setLngLat(event.lngLat)
        .setHTML(`<div class="popup-title">${p.board_name}</div>
          <div class="popup-row"><span>Canopy cover</span><span>${cover}</span></div>
          <div class="popup-row"><span>Canopy area</span><span>${(+p.canopy_km2).toFixed(1)} km²</span></div>
          <div class="popup-row"><span>Map markers (Sep 2026 map)</span><span>${formatNumber.format(p.tree_count || 0)}</span></div>
          ${note}`)
        .addTo(map);
    });
    map.on("mouseenter", "canopy-fill", () => { map.getCanvas().style.cursor = "pointer"; });
    map.on("mouseleave", "canopy-fill", () => { map.getCanvas().style.cursor = ""; });
    map.on("click", "kauri-dieback", (event) => {
      const p = event.features[0] && event.features[0].properties;
      if (!p) return;
      const labels = { pathogen_confirmed: "Pathogen confirmed", symptomatic: "Dieback symptoms",
                       no_symptoms: "No symptoms recorded", other: "Other / not assessed" };
      new maplibregl.Popup({ closeButton: true, maxWidth: "280px" })
        .setLngLat(event.lngLat)
        .setHTML(`<div class="popup-title">Kauri dieback survey</div>
          <div class="popup-row"><span>Status</span><span>${labels[p.status] || p.status}</span></div>
          <div class="popup-row"><span>Field assessment</span><span>${p.field_status}</span></div>
          <div class="popup-row"><span>Soil sample</span><span>${p.pathogen}</span></div>
          <div class="popup-row"><span>Surveyed</span><span>${p.survey_year || "—"}</span></div>
          <div class="popup-note">Auckland Council kauri dieback public surveillance.</div>`)
        .addTo(map);
    });
    map.on("mouseenter", "kauri-dieback", () => { map.getCanvas().style.cursor = "pointer"; });
    map.on("mouseleave", "kauri-dieback", () => { map.getCanvas().style.cursor = ""; });

    // The change layer's survey extent, outlined whenever the layer is on: the 2013 and 2016 LiDAR height models cover
    // the central isthmus only. From the release metadata's tree_change extent ("1749-1766 kE x 5907-5925 kN (NZTM)"),
    // or those bounds when the metadata does not say.
    const CHANGE_EXTENT_KM = [1749, 1766, 5907, 5925];
    function changeExtentKm() {
      const text = (releaseMetadata?.models || []).find(x => x?.component === "tree_change")?.extent || "";
      const k = /(\d+(?:\.\d+)?)\s*[-–]\s*(\d+(?:\.\d+)?)\s*kE\s*[x×]\s*(\d+(?:\.\d+)?)\s*[-–]\s*(\d+(?:\.\d+)?)\s*kN/.exec(text);
      return k ? k.slice(1, 5).map(Number) : CHANGE_EXTENT_KM;
    }
    function changeExtentFeature() {
      const [e0, e1, n0, n1] = changeExtentKm().map(v => v * 1000), ring = [];
      const edge = (a, b) => { for (let i = 0; i < 12; i++) { const t = i / 12; ring.push(ALTOTreeRecord.fromNztm(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t)); } };
      edge([e0, n0], [e1, n0]); edge([e1, n0], [e1, n1]); edge([e1, n1], [e0, n1]); edge([e0, n1], [e0, n0]); ring.push(ring[0]);
      return { type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: [ring] } };
    }
    function showChangeExtent(on) {
      if (!on && !map.getLayer("change-extent")) return;
      if (!map.getSource("change-extent")) {
        try {
          map.addSource("change-extent", { type: "geojson", data: changeExtentFeature() });
          map.addLayer({ id: "change-extent", type: "line", source: "change-extent", paint: { "line-color": tok("--neutral-700"), "line-width": 1.5, "line-dasharray": [3, 2] } }, "tree-change");
        } catch { return; }
      }
      map.setLayoutProperty("change-extent", "visibility", on ? "visible" : "none");
    }
    // Canopy gone by 2024 says what the 2024 survey shows where the crown stood (v1 cover_2024): open ground, or no tree
    // canopy and a house, extension or carport over the spot; the cause of the change is not known. Confidence is
    // defined in the popup: high when the canopy was in both earlier surveys, green in the earlier aerial photo and no
    // building there in 2024 (tree_change v1, k09_release.py); medium for any other change shown.
    function changePopupHtml(p) {
      if (p.fate === "removed_to_open") {
        const priorH = (p.h_2016 != null ? p.h_2016 : p.h_2013);
        const seen = (p.h_2013 != null && p.h_2016 != null) ? "2013 & 2016"
          : (p.h_2016 != null ? "2016" : "2013");
        const cover = p.cover_2024 === "built" ? "No tree canopy; built over" : p.cover_2024 === "open" ? "Open ground" : null;
        const conf = p.confidence === "high" ? "High" : p.confidence === "medium" ? "Medium" : safe(p.confidence);
        return `
          <div class="popup-title">Canopy gone by 2024 · cause not known</div>
          <div class="popup-row"><span>Confidence</span><span>${conf}</span></div>
          <div class="popup-row"><span>Height when present</span><span>${fmt(priorH, 1, " m")}</span></div>
          <div class="popup-row"><span>Seen in</span><span>${seen}</span></div>
          ${cover ? `<div class="popup-row"><span>2024 survey</span><span>${cover}</span></div>` : ""}
          ${p.species ? `<div class="popup-row"><span>Likely species</span><span>${safe(p.species)}</span></div>` : ""}
          ${changeActionsHtml(p)}
          <div class="popup-note">An earlier survey detected a canopy here${cover ? "" : "; the 2024 survey shows open ground"}. Compare the dated aerial photos of this spot to check what changed. The displayed basemap may come from another year.</div>
          <div class="popup-note">Confidence: high when the canopy was in both the 2013 and 2016 surveys, was green in the earlier aerial photo and no building stands there in 2024; medium for any other change shown.</div>`;
      }
      const since = p.fate === "established_since_2016" ? "2016" : "2013";
      return `
        <div class="popup-title">Grew into canopy since ${since}</div>
        <div class="popup-row"><span>Height now</span><span>${fmt(p.h_2024, 1, " m")}</span></div>
        ${p.species ? `<div class="popup-row"><span>Species</span><span>${safe(p.species)}</span></div>` : ""}
        ${changeActionsHtml(p)}
        <div class="popup-note">No vegetation 2 m or taller here in ${since}; 5 m or taller by 2024.</div>`;
    }
    // FTA-16: a change's aerial photos (the imagery viewer on the spot, opening on the survey before the change) and its
    // permalink (?change=<change_id> with the camera on it, change-link.js). The link is filled in once the popup knows
    // where the change is.
    function changeActionsHtml(p) {
      if (!ALTOChangeLink.parseId(p.change_id)) return "";
      return `<div class="popup-actions">
          <button type="button" class="popup-act" data-change-photos aria-haspopup="dialog">Aerial photos of this spot</button>
          <a class="popup-act" data-change-link href="#">Link to this change</a>
        </div>`;
    }
    // The imagery viewer and its styles, loaded the first time a change's photos are opened.
    let imageryViewerLoad = null;
    function loadImageryViewer() {
      if (window.ALTOImagery && window.ALTOImageryViewer) return Promise.resolve();
      if (imageryViewerLoad) return imageryViewerLoad;
      const add = (tag, attrs) => new Promise((resolve, reject) => {
        const el = Object.assign(document.createElement(tag), attrs);
        el.onload = resolve; el.onerror = () => reject(new Error(`${attrs.src || attrs.href} did not load`));
        document.head.appendChild(el);
      });
      const asset = path => ALTOVersion.asset(path);
      imageryViewerLoad = Promise.all([
        add("link", { rel: "stylesheet", href: asset("./imagery-viewer.css") }),
        add("script", { src: asset("./tree-imagery.js"), async: false }).then(() => add("script", { src: asset("./tree-imagery-viewer.js"), async: false }))
      ]).catch(e => { imageryViewerLoad = null; throw e; });
      return imageryViewerLoad;
    }
    // The viewer on the change's position: every survey that covers the spot (read as the tree page reads them, in a
    // detached list), opening on the last survey before the change, with the surveys before and after it marked.
    async function openChangePhotos(p, [lon, lat], opener) {
      const st = document.getElementById("status");
      try { await loadImageryViewer(); }
      catch { st.textContent = "The aerial photo viewer could not be loaded."; return; }
      const X = window.ALTOImagery, marks = ALTOChangeLink.surveysFor(p, X.SURVEYS, X.COARSE);
      // A change compares the LiDAR surveys since 2013: the surveys since 2010 only (no scanned historical surveys).
      const tl = X.timeline(document.createElement("div"), { lon, lat, area: Number(p.area_m2) > 0 ? Number(p.area_m2) : null, historic: false, eager: true, marks });
      window.ALTOImageryViewer.open(tl, marks.before || marks.after || X.SURVEYS[X.SURVEYS.length - 1].id, { opener });
    }
    // The open change in the address (?change=, replaceState), taken off again when its popup closes.
    function setUrlChange(id) {
      const u = new URL(window.location.href), now = u.searchParams.get("change");
      if (id) { if (now === id) return; u.searchParams.set("change", id); }
      else { if (!now) return; u.searchParams.delete("change"); }
      history.replaceState(history.state, "", u.pathname + u.search.replace(/%3A/gi, ":").replace(/%2F/gi, "/").replace(/%2C/gi, ",") + u.hash);
    }
    function openChangePopup(p, lngLat, { at = null } = {}) {
      const pos = at || [lngLat.lng, lngLat.lat];
      const popup = new maplibregl.Popup({ closeButton: true, maxWidth: "300px" })
        .setLngLat(lngLat)
        .setHTML(changePopupHtml(p))
        .addTo(map);
      const el = popup.getElement(), link = el?.querySelector("[data-change-link]"), photos = el?.querySelector("[data-change-photos]");
      if (link) link.href = ALTOChangeLink.href(window.location.href, p.change_id, pos[0], pos[1], { cameraText: ALTOViewLink.cameraText });
      photos?.addEventListener("click", () => openChangePhotos(p, pos, photos));
      if (link) { setUrlChange(p.change_id); popup.on("close", () => { if (new URL(window.location.href).searchParams.get("change") === p.change_id) setUrlChange(null); }); }
      return popup;
    }
    map.on("click", "tree-change", (event) => {
      const f = event.features[0];
      if (!f) return;
      openChangePopup(f.properties, event.lngLat, { at: f.geometry?.type === "Point" ? f.geometry.coordinates : null });
    });
    // A linked change (?change=): its popup once the change tiles under the view are in (the layer draws in Colour by
    // change). Without ?map=, the camera then moves onto it (zoom 18). A change not found there is said in the status line.
    function openLinkedChange() {
      if (!LINKED_CHANGE) return;
      const id = LINKED_CHANGE.id, until = Date.now() + 30000;
      const notFound = () => { document.getElementById("status").textContent = `Change ${id} was not found in this view of the map.`; };
      function look() {
        if (!map.getSource("akl-change") || !map.getLayer("tree-change") || !map.isSourceLoaded("akl-change")) {
          if (Date.now() > until) { map.off("idle", look); notFound(); }
          return;
        }
        map.off("idle", look);
        const f = map.querySourceFeatures("akl-change", { sourceLayer: "tree_change", filter: ["==", ["get", "change_id"], id] })[0];
        if (!f || f.geometry?.type !== "Point") { notFound(); return; }
        const [lon, lat] = f.geometry.coordinates;
        if (!VIEW_LINK.camera) map.jumpTo({ center: [lon, lat], zoom: Math.max(map.getZoom(), 18) });
        openChangePopup(f.properties, { lng: lon, lat }, { at: [lon, lat] });
      }
      map.on("idle", look);
    }
    map.on("mouseenter", "tree-change", () => { map.getCanvas().style.cursor = "pointer"; });
    map.on("mouseleave", "tree-change", () => { map.getCanvas().style.cursor = ""; });

    map.on("click", "low-candidates", (event) => {
      const f = event.features[0];
      if (!f) return;
      new maplibregl.Popup({ closeButton: true, maxWidth: "300px" })
        .setLngLat(event.lngLat)
        .setHTML(lowCanopyPopupHtml(f.properties))
        .addTo(map);
    });
    map.on("mouseenter", "points", () => { map.getCanvas().style.cursor = "pointer"; });
    map.on("mouseleave", "points", () => { map.getCanvas().style.cursor = ""; });
    map.on("mouseenter", "crowns-fill", () => { map.getCanvas().style.cursor = "pointer"; });
    map.on("mouseleave", "crowns-fill", () => { map.getCanvas().style.cursor = ""; });
    map.on("mouseenter", "low-candidates", () => { map.getCanvas().style.cursor = "pointer"; });
    map.on("mouseleave", "low-candidates", () => { map.getCanvas().style.cursor = ""; });
    // A tree or an overlay with its own popup under the pointer keeps the click; a parcel opens
    // only from open ground.
    const PARCEL_CLICK_YIELDS = ["points", "crowns-fill", "tree-change", "low-candidates", "missed-candidates", "near-canopy", "kauri-dieback", "canopy-fill", "council-positions"];
    map.on("click", "properties-fill", (event) => {
      if (pickMode) return;
      if (map.queryRenderedFeatures(event.point, { layers: PARCEL_CLICK_YIELDS.filter(id => map.getLayer(id)) }).length) return;
      const f = event.features[0];
      if (!f?.properties?.pid) return;
      document.getElementById("propertySearch").value = "";
      openProperty(f.properties.pid, null, { tile: f.properties, fly: false });
    });
    map.on("mouseenter", "properties-fill", () => { map.getCanvas().style.cursor = "pointer"; });
    map.on("mouseleave", "properties-fill", () => { map.getCanvas().style.cursor = ""; });
    // Council recorded positions (v5.2): off by default, and offered only when the release metadata
    // lists the layer. A recorded position opens its tree, using the tree's map record when its
    // tile is loaded and the full record otherwise.
    ALTORecordLinks.init({
      map, url: MAP_SOURCES.archive("council_positions"),
      before: "points", yieldTo: ["points"],
      toggle: document.getElementById("councilPositionsToggle"), note: document.getElementById("councilPositionsNote"),
      open: (p) => {
        const tree = map.querySourceFeatures("akl-points", { sourceLayer: "trees", filter: ["==", ["get", "tree_id"], p.tree_id] })[0];
        openProfile(tree ? tree.properties : { tree_id: p.tree_id, source_primary: p.source });
      }
    });

    map.on("load", () => {
      panelMapReady = true;
      ALTOIdentity.init({map,base:DATA_BASE,version:TILE_VERSION,filter:buildFilter,changed:scheduleViewportStats,open:openProfile});
      identityReady = true;
      applyFilters(); applyChangeEmphasis(); applyTrunkScaling(); applyColourMode();
      const st = document.getElementById("status"); if (st.dataset.error !== "tiles") st.textContent = "";
      // ?property=<LINZ parcel id> opens that property (the tree page links here).
      const pid = new URL(window.location.href).searchParams.get("property");
      if (pid && /^\d{1,12}$/.test(pid)) openProperty(pid, null, { fromLink: true });
      // ?change=<change_id> opens that canopy change (FTA-16).
      openLinkedChange();
    });
    // Page internals for checks, only with ?debug.
    if (new URL(window.location.href).searchParams.has("debug")) window.treePilotDebug = { map, state, buildFilter, applyFilters, applyLayerToggles };

    // About / methods & data panel. Deferred to DOMContentLoaded because the
    // modal markup follows this script in the document.
    window.addEventListener("DOMContentLoaded", function aboutPanel() {
      const backdrop = document.getElementById("aboutBackdrop");
      if (!backdrop) return;
      const closeButton = document.getElementById("aboutClose");
      let returnFocus = null;
      const open = () => {
        returnFocus = document.activeElement;
        backdrop.setAttribute("data-open", "true");
        backdrop.setAttribute("aria-hidden", "false");
        closeButton.focus({preventScroll: true});
      };
      const close = () => {
        if (!backdrop.hasAttribute("data-open")) return;
        backdrop.removeAttribute("data-open");
        backdrop.setAttribute("aria-hidden", "true");
        if (returnFocus?.focus) returnFocus.focus({preventScroll: true});
      };
      document.getElementById("aboutBtn").addEventListener("click", open);
      document.getElementById("versionChip").addEventListener("click", open);
      document.getElementById("aboutToolVersion").textContent = `Tool ${ALTOVersion.TOOL.version}`;
      // Corrections: the KYTE route joins the email once KYTE reads task=problem (kyte-config.js problemTask).
      if (window.ALTO_KYTE_CONFIG?.problemTask === true) document.getElementById("aboutCorrections").innerHTML =
        'To correct a record, use “Report a problem with this record” on its tree page or map panel (KYTE), or <a class="about-link" href="mailto:t.welch@auckland.ac.nz">email the Better Places Lab</a> (t.welch@auckland.ac.nz) with the tree number and what is wrong.';
      document.getElementById("aboutDockBtn").addEventListener("click", open);
      closeButton.addEventListener("click", close);
      backdrop.addEventListener("click", (e) => { if (e.target === backdrop) close(); });
      document.addEventListener("keydown", (e) => {
        if (!backdrop.hasAttribute("data-open")) return;
        if (e.key === "Escape") close();
        if (e.key === "Tab") {
          const focusable = [...backdrop.querySelectorAll("button, a[href], input, [tabindex]:not([tabindex='-1'])")];
          if (!focusable.length) return;
          const first = focusable[0], last = focusable[focusable.length - 1];
          if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus({preventScroll: true}); }
          else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus({preventScroll: true}); }
        }
      });
      document.getElementById("dlModel").href=vq(`${DATA_BASE}/longitudinal/model.json`);
      const ex = `${DATA_BASE}/exports`;
      document.getElementById("dlDict").href = vq(`${ex}/akl_trees_data_dictionary.md`);
      const REPO_URL = "https://github.com/squirmen/alto";
      const repo = document.getElementById("repoLink");
      if (REPO_URL) { repo.href = REPO_URL; }
      else { repo.removeAttribute("href"); repo.style.color = "inherit"; repo.title = "Repository link added on public release"; }

      const releaseMeta = document.getElementById("releaseMeta");
      const releaseManifestLink = document.getElementById("releaseManifestLink");
      const metadataUrl = dataMetadataUrl;
      releaseManifestLink.href = metadataUrl;
      const addMetaRow = (label, value) => {
        if (value === null || value === undefined || value === "") return;
        const term = document.createElement("dt");
        const detail = document.createElement("dd");
        term.textContent = label;
        detail.textContent = String(value);
        releaseMeta.append(term, detail);
      };
      dataMetadataReady
        .then((metadata) => {
          if (!metadata) throw new Error("not available");
          ALTORecordLinks.release(metadata);
          // The Data quality group links to the recorded-positions layer when the release has it.
          document.getElementById("qualityPositions").hidden = document.getElementById("councilPositionsToggle").hidden;
          if (ALTOGrowthForm.shipped(metadata)) document.getElementById("growthFormFilter").hidden = false;
          // Release 6.3 ships data/notable_group_areas.geojson: its layer is offered from that release on.
          if (ALTOFields.atLeast(metadata, 6.3) || (metadata.artifacts || []).some(a => /notable_group_areas\.geojson$/.test(a.path || ""))) {
            document.getElementById("groupAreasToggle").hidden = false; groupAreasShipped = true;
            if (state.showGroupAreas) { document.getElementById("showGroupAreas").checked = true; applyFilters(); }
          }
          const release = metadata.release || {};
          const dataset = metadata.dataset || {};
          const scope = metadata.headline_scope || {};
          const models = (metadata.models || []).map(model => model.component.replaceAll("_", " "));
          releaseMeta.replaceChildren();
          const releaseStatus = release.status === "research_only_not_independently_validated"
            ? "Research release · field validation pending"
            : release.status;
          addMetaRow("Status", releaseStatus);
          addMetaRow("Interface built", metadata.assembly?.assembled_utc);
          addMetaRow("Dataset version", release.dataset_version);
          addMetaRow("Data release", ALTOVersion.data(metadata).label ? `${ALTOVersion.data(metadata).label}${ALTOVersion.data(metadata).dev ? " (development build)" : ""}` : null);
          addMetaRow("Tool version", `v${ALTOVersion.TOOL.version} (this interface)`);
          if (release.software_version && release.software_version !== ALTOVersion.TOOL.version) addMetaRow("Checked with tool", `v${release.software_version}`);
          { const d = ALTOVersion.data(metadata), date = ALTOVersion.releaseDate(metadata);
            document.getElementById("aboutDataVersion").textContent = `Release ${date || ""}${d.label ? ` (${d.label.replace(/^v/, "")}${d.dev ? ", development build" : ""})` : ""}`.replace("Release  (", "Release ("); }
          document.getElementById("aboutCitation").textContent = ALTOVersion.citation({ metadata, url: new URL("./", window.location.href).href });
          addMetaRow("Data updated", release.dataset_last_updated_utc);
          addMetaRow("Inventory", dataset.tree_records != null
            ? `${formatNumber.format(dataset.tree_records)} tree records · ${formatNumber.format(dataset.crown_records || 0)} crowns`
            : null);
          addMetaRow("Models / methods", models.join(" · "));
          addMetaRow(metadata.assembly ? "Baseline source revision" : "Source revision", release.source_revision
            ? `${release.source_revision}${release.source_dirty ? " · working tree changes" : ""}`
            : null);
          addMetaRow("Service estimates", "Calculated from the stored size and environmental assumptions. The low and high values show how those assumptions affect the result.");
          if (scope.valuation_records_included != null && scope.modelled_nominal_records_excluded != null) {
            document.getElementById("headlineScopeCaption").textContent =
              `Service totals include ${formatNumber.format(scope.valuation_records_included)} valued records and exclude ${formatNumber.format(scope.modelled_nominal_records_excluded)} nominal crownless-tree scenarios.`;
          }
        })
        .catch(() => {
          releaseMeta.replaceChildren();
          addMetaRow("Release metadata", `Release metadata not loaded (${releaseMetadataError || "error"}).`);
        });
    });

    // ====================================================================
    // TREE PROFILE PANEL — storytelling asset page for a single tree.
    // ====================================================================
    const profilePanel = document.getElementById("treeProfile");
    const profileBody = document.getElementById("treeProfileBody");
    // Keyboard focus in the tree panel never rests out of view (WCAG 2.4.11; on a phone the panel is a sheet over the map
    // and its body scrolls). While the keyboard moves focus the body scrolls at once rather than smoothly (is-keyboard),
    // and a control Tab reaches is brought into the body's visible part again after any survey preview it starts has
    // re-laid the panel (a survey chip, 0.2.10). A tap or a click keeps the smooth scroll.
    {
      let keyboard = false;
      document.addEventListener("keydown", e => { if (e.key === "Tab") { keyboard = true; profileBody.classList.add("is-keyboard"); } }, true);
      document.addEventListener("pointerdown", () => { keyboard = false; profileBody.classList.remove("is-keyboard"); }, true);
      const inView = el => { const r = el.getBoundingClientRect(), b = profileBody.getBoundingClientRect();
        return r.top >= Math.max(b.top, 0) - 1 && r.bottom <= Math.min(b.bottom, innerHeight) + 1; };
      profileBody.addEventListener("focusin", e => {
        const el = e.target;
        if (!keyboard || !(el instanceof Element) || el === profileBody) return;
        const keep = () => { if (el.isConnected && document.activeElement === el && !inView(el)) el.scrollIntoView({ block: "nearest", inline: "nearest" }); };
        keep(); requestAnimationFrame(keep);
      });
    }
    let profileHighlightId = null;
    let profileRequestId = 0;
    let currentProperty = null, propertyRequestId = 0, propertyShape = null;

    // Closing a panel: Back works as on any page (UX-05: a panel opened from the map pushed one history entry, which
    // closing takes off again); focus returns to the control that opened the panel (the search box, a legend row, an Area
    // row, a property row), or to the map when a map click opened it.
    let profileOpener = null, panelPushed = false;
    const MAP_TITLE = document.title;
    function closeProfile({ fromHistory = false } = {}) {
      ALTOEvidenceWorkspace.dispose();
      profileRequestId++; propertyRequestId++;
      if (!fromHistory && panelPushed && history.state?.altoPanel) { panelPushed = false; urlTree = null; history.back(); }
      else { setUrlTree(null); setUrlProperty(null); }
      panelPushed = false; panelNote = null;
      const restoreFocus = profilePanel.contains(document.activeElement);
      document.body.dataset.profileOpen = "false";
      profilePanel.setAttribute("aria-hidden", "true");
      profilePanel.hidden = true; profilePanel.inert = true;
      profileBody.replaceChildren();
      clearYearLink();
      document.title = MAP_TITLE;
      if (restoreFocus) { const back = profileOpener && profileOpener.isConnected && !profileOpener.closest("[hidden],[inert]") ? profileOpener : map.getCanvas(); back.focus({ preventScroll: true }); }
      profileOpener = null;
      profileHighlightId = null;
      if (map.getLayer("points-highlight")) {
        setRings("points-highlight", ["==", ["get", "tree_id"], "__none__"]);
      }
      currentProperty = null; propertyShape = null; setProfileMode("tree"); applyPropertySelection(); areaScope = "view"; renderArea();
      clearMapPadding();
    }
    document.getElementById("treeProfileClose").addEventListener("click", () => closeProfile());
    document.addEventListener("keydown", (e) => {
      if (e.key !== "Escape" || document.getElementById("treeComparison")?.open || document.getElementById("aboutBackdrop")?.hasAttribute("data-open")) return;
      if (!profilePanel.hidden) closeProfile();
      else if (searchPin && !document.activeElement?.closest?.(".property-search")) clearSearchPin();
      else if (mobileLayout.matches && document.body.dataset.asideCollapsed === "false") setSidebarCollapsed(true, true);
    });

    function num(v) { return ALTOAnalysis.number(v); }

    const evidenceMapReady = new Promise(resolve => map.on('load',resolve));
    ALTOGround.init({kyteBase:`${SITE_ROOT}/kyte`,dataBase:DATA_BASE,version:TILE_VERSION});
    dataMetadataReady.then(() => ALTOGround.init({version: TILE_VERSION}));
    let releaseMetadata = null;
    const releaseReady = dataMetadataReady
      .then(m => {
        releaseMetadata = m;
        const v = ALTOVersion.publicLabel(m), chip = document.getElementById("versionChip");
        chip.innerHTML = m ? `${escapeHtml(v.text)}${v.preview ? ' <span class="badge-preview">Preview</span>' : ""}` : `Release metadata not loaded · Tool ${escapeHtml(ALTOVersion.TOOL.version)}`;
        chip.title = m ? `${ALTOVersion.label(m, { long: true })}. About this release` : `Release metadata not loaded (${releaseMetadataError || "error"}). About this release`;
        applyReleaseFeatures(m); return m;
      });
    // Features a data release may or may not have: the v6 growth form and the release notes page; About's totals are the
    // release's own (release metadata), or say that the metadata did not load.
    function applyReleaseFeatures(m) {
      const growth = ALTOGrowthForm.shipped(m);
      const option = document.querySelector('#colourBy option[value="structure"]');
      if (option) option.hidden = option.disabled = !growth;
      const d = ALTOVersion.data(m);
      // The link names its destination: the methods page for this release (its number belongs in About and methods).
      if (d.label) document.querySelectorAll("[data-release-notes]").forEach(a => { a.href = `${SITE_ROOT}/${d.label.replace(".", "")}-methods.html`; a.textContent = `Methods for release ${d.label.replace(/^v/, "")}${ALTOVersion.releaseDate?.(m) ? ` (${ALTOVersion.releaseDate(m)})` : ""}`; });
      const t = areaTotals(), about = ALTOArea.about, set = (id, text) => { const el = document.getElementById(id); el.textContent = text; el.closest(".stat").hidden = text === null; };
      if (!m) {
        for (const id of ["visibleCount", "crownCount", "inferredCount", "protectedCount", "valueTotal", "runoffTotal", "carbonTotal"]) set(id, null);
        // Unavailable (FE-02): which file and why, with Retry (reloads the page; the map holds no input to lose).
        const cap = document.getElementById("headlineScopeCaption");
        cap.innerHTML = `Not loaded: release-metadata.json (${escapeHtml(releaseMetadataError || "error")}). <button type="button" class="link-button" data-meta-retry>Retry</button>`;
        cap.querySelector("[data-meta-retry]").addEventListener("click", () => location.reload());
        return;
      }
      set("visibleCount", t.markers != null ? formatNumber.format(t.markers) : null);
      set("crownCount", t.crowns != null ? formatNumber.format(t.crowns) : null);
      set("inferredCount", t.lidar != null ? formatNumber.format(t.lidar) : null);
      set("protectedCount", t.schedule != null ? formatNumber.format(t.schedule) : null);
      set("valueTotal", t.value != null ? `${about(t.value, { prefix: "NZ$" })} a year` : null);
      { const lab = document.getElementById("valueTotalLabel"); if (lab) lab.textContent = t.valueBasis === "stormwater_carbon" ? "benefits: stormwater and carbon (estimate)" : "benefits (estimate; sensitivity scenario)"; }
      set("runoffTotal", t.runoff != null ? `${about(t.runoff, { unit: "m³" })} a year` : null);
      set("carbonTotal", t.carbon != null ? about(t.carbon, { unit: "t CO₂e" }) : null);
      document.getElementById("headlineScopeCaption").textContent = `Release ${d.label ? d.label.replace(/^v/, "") : ""} totals from its release metadata. Benefits, runoff and carbon are estimates (sensitivity scenario; range not computed) for current crowns, one set per crown.${t.valueBasis === "stormwater_carbon" ? " Benefits are stormwater plus carbon; air-quality and cooling dollars are not release-eligible." : ""}`;
    }
    document.querySelectorAll("[data-site-link]").forEach(a => { a.href = `${SITE_ROOT}/${a.dataset.siteLink}`; });
    // Species maxima: load the release's maxima.json, offer the filter for each area that has a clear lead, give an open
    // panel its line, and follow maxima.html's ?maxima=<area> (filter on, zoom to the area unless ?tree= names a tree).
    releaseReady.then(m => ALTOMaxima.load({ siteRoot: SITE_ROOT, metadata: m, version: TILE_VERSION })).catch(() => null).then(D => {
      if (!D || !D.maxima.length) return;
      if (!D.facts && ALTOMaxima.current?.facts) D.facts = ALTOMaxima.current.facts;
      maxima = D; ALTOMaxima.current = D;
      if (areaScope === "region" || areaScope === "board") renderArea();
      const select = document.getElementById("maximaArea");
      // Every area with species maxima; one whose maxima are all near-ties says so (it has no ring).
      select.innerHTML = ALTOMaxima.areaList(D).map(a => [a, ALTOMaxima.mapSet(D, a).trees.length, D.maxima.some(m => m.area === a)]).filter(([, n, any]) => n || any)
        .map(([a, n]) => `<option value="${escapeHtml(a)}">${escapeHtml(a)} (${n ? `${n} ${n === 1 ? "tree" : "trees"}` : "near-ties only; no ring"})</option>`).join("");
      if (![...select.options].some(o => o.value === state.maximaArea)) state.maximaArea = select.options[0]?.value || "Auckland";
      select.value = state.maximaArea;
      document.getElementById("maximaFilter").hidden = false;
      const art = profileBody.querySelector("article.tp");
      if (art && panelRec?.number && !art.querySelector(".tp-max")) {
        const html = ALTOTreePanel.maxBadge(panelRec);
        if (html) (art.querySelector(".tp-model") || art.querySelector(".tp-latin") || art.querySelector("#tpName"))?.insertAdjacentHTML("afterend", html);
      }
      const params = new URL(window.location.href).searchParams, want = VIEW_MAXIMA;
      if (want === null) { if (panelMapReady) renderLegend(); return; }
      state.maximaArea = ALTOMaxima.areaList(D).find(a => ALTOMaxima.fold(a) === ALTOMaxima.fold(want) && ALTOMaxima.mapSet(D, a).trees.length) || state.maximaArea;
      select.value = state.maximaArea; state.onlyMaxima = true; document.getElementById("onlyMaxima").checked = true;
      const go = () => { applyFilters(); if (!params.get("tree") && !VIEW_LINK.camera) zoomToMaxima(); };
      if (panelMapReady) go(); else map.once("load", go);
    });
    if (window.ALTO_CHANNEL === "beta") {
      document.body.dataset.channel = "beta";
      document.querySelector("#explorer .release-row .subhead").innerHTML = `Auckland · <span class="beta-pill">Beta</span> <a class="beta-back" href="${SITE_ROOT}/">Current map</a>`;
    }
    // Every tree link goes through the ID resolver, so permanent IDs and aliases can slot in later.
    // An ID that names no current tree opens the tree that took its place (merged, the largest part of a split, a
    // successor); a tombstone has none, and its error carries the resolution (the last position, the reason).
    async function loadTree(rawId) {
      const options = { base: DATA_BASE, version: TILE_VERSION, metadata: await releaseReady };
      const resolved = await ALTOTreeId.resolve(rawId, options);
      let detail = resolved.tree_id;
      if (resolved.status === "retired" && resolved.successor) detail = (await ALTOTreeId.resolve(resolved.successor, options)).tree_id || detail;
      if (!detail) throw Object.assign(new Error(ALTOTreeId.describe(resolved)?.note || resolved.note || "Unknown tree number or record ID"), { resolved });
      const loaded = await ALTOTreeDetails.load(DATA_BASE, TILE_VERSION, detail);
      return { ...loaded, resolved };
    }
    for (const id of ["savedTreesBtn", "savedTreesDock"]) document.getElementById(id)?.addEventListener("click", () => ALTOEvidenceWorkspace.show());
    window.addEventListener('DOMContentLoaded', () => ALTOEvidenceWorkspace.init({
      dataBase: DATA_BASE, version: TILE_VERSION, siteRoot: SITE_ROOT,
      load: loadTree, readLink: false,
      ready: evidenceMapReady, open: openProfile,
      locate: coordinates => map.flyTo({center:coordinates,zoom:18})
    }));
    // The shared tree link, read at start (above): centre on it, open its panel; a link that names no tree says why in the
    // panel, with the one correction of a mistyped number when the release holds it.
    if (linkedTree) linkedTree.then(({ record, resolved }) => {
      const r = record.datasets.record || {}, lon = Number(r.lon), lat = Number(r.lat);
      const ok = Number.isFinite(lon) && Number.isFinite(lat) && r.lon != null && r.lat != null;
      if (ok && !VIEW_LINK.camera) map.jumpTo({ center: [lon, lat], zoom: Math.max(map.getZoom(), 18) });
      openProfile({ ...r, tree_id: record.tree_id, tn: record.datasets.tree_number?.number, lon: ok ? lon : undefined, lat: ok ? lat : undefined }, { resolved, fromLink: true });
      // Clear of the panel (a phone's sheet), once it has its height.
      if (ok && !VIEW_LINK.camera) requestAnimationFrame(() => easeToTree(lon, lat, { zoom: 18, jump: true }));
      const st = document.getElementById("status"); if (st.textContent.startsWith("Opening tree")) st.textContent = "";
    }).catch(err => showTreeLinkProblem(LINKED_TREE, err));
    async function showTreeLinkProblem(raw, err) {
      const st = document.getElementById("status"); if (st.textContent.startsWith("Opening tree")) st.textContent = "";
      const r = err?.resolved || { status: err?.unavailable ? "unavailable" : "invalid", input: raw, key: raw, note: err?.message || null, kind: null, successors: [] };
      if (r.position) map.jumpTo({ center: [r.position.lon, r.position.lat], zoom: 18 });
      const typed = String(raw || "").trim();
      const fix = r.status === "invalid" && ALTOTreeId.isNumberShaped(typed) ? await ALTOTreeId.suggestNumber(typed, { base: DATA_BASE, version: TILE_VERSION, metadata: releaseMetadata }).catch(() => null) : null;
      const v = r.status === "unavailable" ? { html: `<div class="ti-id-main ti-status-page" data-status="unavailable"><p class="ti-eyebrow ti-kicker">Tree link</p><h1>Not loaded</h1><p class="ti-lead">${escapeHtml(r.note || err?.message || "The tree's record did not load.")}</p></div><div class="ti-id-actions"><button type="button" class="btn btn-primary" data-link-retry>Retry</button></div>` }
        : ALTOInstrument.statusView(r, { typed, fix, icon: ALTOViz.icon, onMap: true });
      // Links in the panel stay on the map: a corrected number opens here.
      if (mobileLayout.matches && profilePanel.hidden) setSheet("half");
      profilePanel.hidden = false; profilePanel.inert = false; setProfileMode("tree");
      document.body.dataset.profileOpen = "true"; profilePanel.setAttribute("aria-hidden", "false");
      profileBody.innerHTML = `<article class="tp ti-scope tp-linkerror">${v.html}</article>`;
      profileBody.querySelectorAll('a[href*="tree.html?id="]').forEach(a => { const id = new URL(a.href).searchParams.get("id"); a.href = ALTOTreeId.url(id, { page: "map" }); });
      profileBody.querySelector("[data-link-retry]")?.addEventListener("click", () => location.reload());
      document.getElementById("treeProfileClose").focus({ preventScroll: true });
    }

    // The crown outline drawn in the panel comes from the loaded crown tiles (the map is already there).
    function crownGeometry(treeId) {
      if (!map.getSource("akl-crowns") || !treeId) return null;
      const parts = map.querySourceFeatures("akl-crowns", { sourceLayer: "crowns", filter: ["==", ["get", "tree_id"], treeId] });
      if (!parts.length) return null;
      const polys = parts.flatMap(f => f.geometry.type === "Polygon" ? [f.geometry.coordinates] : f.geometry.type === "MultiPolygon" ? f.geometry.coordinates : []);
      return polys.length === 1 ? { type: "Polygon", coordinates: polys[0] } : { type: "MultiPolygon", coordinates: polys };
    }
    // The tree panel reads the tree record (alto.tree-record/1, tree-record.js): first from the map tile, then
    // from the full record. Its crown outline comes from the loaded crown tiles, under the marker of the record
    // that represents the crown on the map.
    const recordEnv = () => ({ dataBase: DATA_BASE, siteRoot: SITE_ROOT, metadata: releaseMetadata, version: TILE_VERSION });
    let panelGeometry = null, panelClick = null, panelNote = null;
    let panelRec = null;
    // The schedule line's date ("as published 4 Jun 2026") and a group's item number come from the release's
    // notable_facts.json (species-maxima.js), read when a tree panel opens, never at map start: where the package splits
    // the facts by tree number (release 6.3's file is 1.4 MB), the part holding the panel's tree, else the whole file once.
    // Until they arrive (or if they cannot load) the line reads without them.
    const scheduleFacts = new Map();
    let scheduleFactsWhole = false;
    function loadScheduleFacts(number) {
      const key = scheduleFactsWhole ? "*" : ALTOMaxima.shardOf(number);
      if (!scheduleFacts.has(key)) scheduleFacts.set(key, releaseReady
        .then(m => ALTOMaxima.load({ siteRoot: SITE_ROOT, metadata: m, version: TILE_VERSION }, { facts: true, trees: number ? [number] : null }))
        .then(D => {
          if (!D?.facts) return null;
          if (!D.facts.shardsRead) scheduleFactsWhole = true;
          const cur = ALTOMaxima.current;
          if (cur?.facts && D.facts.shardsRead) Object.assign(cur.facts.trees, D.facts.trees);
          else if (cur) cur.facts = D.facts; else ALTOMaxima.current = D;
          return ALTOMaxima.current.facts;
        }).catch(() => { scheduleFacts.delete(key); return null; }));
      return scheduleFacts.get(key);
    }
    function completeScheduleLine(requestId) {
      const number = panelRec?.number || null;
      if (ALTOMaxima.current?.facts && (scheduleFactsWhole || !number || scheduleFacts.has(ALTOMaxima.shardOf(number)))) return;
      loadScheduleFacts(number).then(facts => {
        if (!facts || !panelRec || requestId !== profileRequestId || profilePanel.hidden) return;
        const slot = profileBody.querySelector(".tp-sched");
        if (slot) slot.innerHTML = ALTOInstrument.protectionLine(panelRec, { cls: "ti-prot tp-prot", facts });
      });
    }
    const panelOptions = (rec) => ({ treeUrl: ALTOTreeId.url(rec.number || rec.id, { page: "tree" }), saved: ALTOEvidenceWorkspace.has(rec.id), savedCount: ALTOEvidenceWorkspace.count(), kyteBase: `${SITE_ROOT}/kyte`, note: panelNote });
    function panelHtml(rec) {
      panelRec = rec;
      panelGeometry = crownGeometry(rec.id) || crownGeometry(rec.identity?.crownRepresentative);
      return ALTOTreePanel.render(rec, { ...panelOptions(rec), geometry: panelGeometry });
    }
    // FE-17: after the frame that paints the panel's header (requestAnimationFrame runs before that paint; the timeout
    // after it), so a tap is answered at once and the rest of the panel renders in a later task.
    const afterPaint = () => new Promise(resolve => requestAnimationFrame(() => setTimeout(resolve, 0)));
    // From data release 6.1 the address names the open tree by its number (?tree=T…); before it, the address is left
    // as it was. Closing the panel takes the number off again.
    // A panel opened from the map pushes one history entry (Back closes it); switching trees while the panel is open, and
    // map moves, replace the current entry.
    let urlTree = null;
    function setUrlTree(number, { push = false } = {}) {
      const u = new URL(window.location.href);
      if (number) { if (u.searchParams.get("tree") === number) { urlTree = number; return; } u.searchParams.set("tree", number); u.searchParams.delete("property"); urlTree = number; }
      else { if (!urlTree || u.searchParams.get("tree") !== urlTree) { urlTree = null; return; } u.searchParams.delete("tree"); urlTree = null; }
      if (push) { history.pushState({ ...(history.state || {}), altoPanel: "tree" }, "", u.pathname + u.search + u.hash); panelPushed = true; }
      else history.replaceState(history.state, "", u.pathname + u.search + u.hash);
    }
    function setUrlProperty(pid, { push = false } = {}) {
      const u = new URL(window.location.href), now = u.searchParams.get("property");
      if (pid) { if (now === String(pid)) return; u.searchParams.set("property", pid); u.searchParams.delete("tree"); }
      else { if (!now) return; u.searchParams.delete("property"); }
      if (push) { history.pushState({ ...(history.state || {}), altoPanel: "property" }, "", u.pathname + u.search + u.hash); panelPushed = true; }
      else history.replaceState(history.state, "", u.pathname + u.search + u.hash);
    }
    // Back and Forward: the address names the panel that should be open.
    window.addEventListener("popstate", () => {
      const u = new URL(window.location.href), t = u.searchParams.get("tree"), pid = u.searchParams.get("property");
      if (t) { if (t !== urlTree) { urlTree = t; loadTree(t).then(({ record, resolved }) => openProfile({ ...(record.datasets.record || {}), tree_id: record.tree_id, tn: record.datasets.tree_number?.number }, { resolved, fromHistory: true })).catch(() => {}); } }
      else if (pid && /^\d{1,12}$/.test(pid)) { if (currentProperty?.pid !== pid) openProperty(pid, null, { fromHistory: true }); }
      else if (!profilePanel.hidden) { panelPushed = false; urlTree = null; closeProfile({ fromHistory: true }); }
    });
    // The capture date of the aerial tiles under the tree, from the imagery provider's metadata.
    function fillImageryCaption(rec) {
      const c = rec.identity?.position || null;
      if (!c) return;
      ALTOViz.imageryInfo(c.lon, c.lat).then(info => { const el = profileBody.querySelector(".tp-imagery"); if (el && info) el.textContent = ALTOInstrument.imageryText(info); });
    }
    // The survey year chosen in the panel, on the map: the 2024 crown outline, or where an earlier survey's
    // canopy was matched to this tree (a dashed ring with the year and its height, as in the panel's figure).
    let yearMarker = null;
    function clearYearLink() {
      yearMarker?.remove(); yearMarker = null;
      map.getSource("tp-year")?.setData({ type: "FeatureCollection", features: [] });
    }
    function showYearLink(rec, year) {
      if (!map.isStyleLoaded() && !map.getSource("tp-year")) return;
      if (!map.getSource("tp-year")) {
        map.addSource("tp-year", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
        map.addLayer({ id: "tp-year-crown", type: "line", source: "tp-year", filter: ["==", ["get", "current"], true], paint: { "line-color": tok("--viz-overlay-focus"), "line-width": 3 } });
        map.addLayer({ id: "tp-year-crown-dim", type: "line", source: "tp-year", filter: ["==", ["get", "current"], false], paint: { "line-color": tok("--neutral-0"), "line-width": 2, "line-dasharray": [2, 1.5] } });
      }
      const geometry = panelGeometry, s = (rec.surveys || []).find(x => x.year === year), current = year === 2024;
      map.getSource("tp-year").setData({ type: "FeatureCollection", features: geometry ? [{ type: "Feature", geometry, properties: { current } }] : [] });
      yearMarker?.remove(); yearMarker = null;
      const at = s?.position || (!current ? (panelClick || rec.identity?.position) : null);
      if (!at) return;
      const el = document.createElement("div");
      el.className = "tp-map-year" + (s?.height ? "" : " is-none");
      el.innerHTML = "<i></i><span></span>";
      el.querySelector("span").textContent = `${year} · ${s?.height ? ALTOInstrument.text(s.height) : s?.status === "outside" ? "outside the survey" : s?.status === "absent" ? "not detected" : "no match"}`;
      yearMarker = new maplibregl.Marker({ element: el, anchor: "left", offset: [-9, 0] }).setLngLat([at.lon, at.lat]).addTo(map);
    }
    function bindPanel(rec) {
      const status = profileBody.querySelector(".tp-status");
      profileBody.querySelector('[data-panel-action="copy-number"]')?.addEventListener("click", async event => {
        const button = event.currentTarget;
        try { await navigator.clipboard.writeText(rec.number); button.textContent = "Copied"; setTimeout(() => { button.textContent = "Copy"; }, 1600); status.textContent = `Tree number ${rec.number} copied.`; }
        catch { status.innerHTML = `<label>Copy this tree number <input readonly value="${escapeHtml(rec.number)}"></label>`; status.querySelector("input")?.select(); }
      });
      profileBody.querySelector('[data-panel-action="copy-coords"]')?.addEventListener("click", async event => {
        const button = event.currentTarget, L = ALTOTreeRecord.location(rec); if (!L) return;
        try { await navigator.clipboard.writeText(L.text); button.textContent = "Copied"; setTimeout(() => { button.textContent = "Copy"; }, 1600); status.textContent = `Coordinates ${L.text} copied.`; }
        catch { status.innerHTML = `<label>Copy these coordinates <input readonly value="${escapeHtml(L.text)}"></label>`; status.querySelector("input")?.select(); }
      });
      profileBody.querySelector('[data-panel-action="share"]')?.addEventListener("click", async () => {
        const url = rec.permalink || ALTOTreeId.url(rec.id, { page: "tree" });
        try {
          if (navigator.share && mobileLayout.matches) { await navigator.share({ title: rec.identity.title, text: `${rec.identity.title} on ALTO`, url }); return; }
          await navigator.clipboard.writeText(url); status.textContent = rec.permalink ? "Permanent link copied." : "Link to the tree page copied.";
        } catch { status.innerHTML = `<label>Copy this link <input readonly value="${escapeHtml(url)}"></label>`; status.querySelector("input")?.select(); }
      });
      profileBody.querySelector('[data-panel-action="compare"]')?.addEventListener("click", () => ALTOEvidenceWorkspace.show());
      const save = profileBody.querySelector('[data-panel-action="save"]');
      save?.addEventListener("click", () => {
        const result = ALTOEvidenceWorkspace.toggle(rec.id);
        save.setAttribute("aria-pressed", String(result.saved));
        save.querySelector("span").textContent = result.saved ? "Saved to compare" : "Save to compare";
        status.textContent = result.message;
      });
      const article = profileBody.querySelector("article.tp");
      if (rec.loaded && article) ALTOInstrument.bind(article, rec, { onYear: year => showYearLink(rec, year), popId: "tpPop" });
    }
    // Phone: the tree or property panel is a bottom sheet with three stops. It opens at half; full shows the whole panel;
    // minimised (peek) it is a slim bar: the handle, carrying the panel's title on one line (a tree's name and number, a
    // property's address), beside the close button, so the map keeps its height. The handle is the sheet's toggle
    // (aria-expanded), as the map panel's is: a press expands the bar to half and minimises a half sheet, and steps a full
    // one down to half. What the bar hides takes no focus; a control there that had it hands it to the handle.
    function setSheet(stateName) {
      profilePanel.dataset.sheet = stateName;
      document.body.dataset.sheet = stateName;
      const handle = document.getElementById("sheetHandle"), bar = stateName === "peek";
      handle.setAttribute("aria-expanded", String(!bar));
      labelSheetHandle();
      const hide = bar && sheetLayout.matches, active = document.activeElement;
      if (hide && profilePanel.contains(active) && active !== handle && active.id !== "treeProfileClose") handle.focus({ preventScroll: true });
      profileBody.inert = hide;
    }
    // The bar names what the panel shows, read whenever the panel renders: a tree's name and number, a property's address
    // (else its parcel, as the page title has it), or the panel's heading. In the bar the handle's name starts with that
    // title, as it reads on screen.
    function labelSheetHandle() {
      const handle = document.getElementById("sheetHandle"), title = document.getElementById("sheetTitle").textContent, s = profilePanel.dataset.sheet;
      handle.setAttribute("aria-label", s === "peek" ? `${title || "Panel"}: expand the panel` : s === "full" ? "Show more of the map" : "Minimise the panel");
    }
    new MutationObserver(() => {
      const name = profileBody.querySelector("#tpName")?.textContent.trim(), number = profileBody.querySelector(".tp-tn")?.textContent.trim();
      const mode = document.getElementById("treeProfileTitle").textContent;
      const parcel = mode === "Property" && currentProperty ? (currentProperty.address ? ALTOProperty.label(currentProperty.address) : `Parcel ${currentProperty.pid}`) : null;
      const heading = profileBody.querySelector("h1, h2, h3")?.textContent.trim();
      document.getElementById("sheetTitle").textContent = name ? [name, number].filter(Boolean).join(" · ") : parcel || heading || mode;
      labelSheetHandle();
    }).observe(profileBody, { childList: true });
    sheetLayout.addEventListener("change", () => setSheet(profilePanel.dataset.sheet || "half"));
    // While the panel is open on a phone the map's zoom, scale and attribution ride above its sheet (--sheet-clear), up to
    // half the screen; a full sheet covers them. Read after layout, frame by frame while the sheet moves (map.css gives
    // them no transition of their own then), so nothing is measured inside a tap (FE-17).
    new ResizeObserver(entries => {
      if (!sheetLayout.matches || document.body.dataset.profileOpen !== "true") return;
      const box = entries[entries.length - 1], h = box.borderBoxSize?.[0]?.blockSize ?? box.target.offsetHeight;
      document.documentElement.style.setProperty("--sheet-clear", `${Math.round(Math.min(h, window.innerHeight / 2))}px`);
    }).observe(profilePanel);
    (function bottomSheet() {
      const handle = document.getElementById("sheetHandle"), STOPS = ["peek", "half", "full"];
      let start = null;
      handle.addEventListener("click", () => { if (!start?.moved) setSheet(profilePanel.dataset.sheet === "half" ? "peek" : "half"); });
      handle.addEventListener("pointerdown", e => { start = { y: e.clientY, moved: false }; handle.setPointerCapture(e.pointerId); });
      handle.addEventListener("pointermove", e => { if (start && Math.abs(e.clientY - start.y) > 12) start.moved = true; });
      // A drag up or down moves one stop, a long one (over a third of the screen) two; down from the bar closes the panel.
      handle.addEventListener("pointerup", e => {
        if (start?.moved) {
          const dy = e.clientY - start.y, at = Math.max(0, STOPS.indexOf(profilePanel.dataset.sheet)), steps = Math.abs(dy) > window.innerHeight / 3 ? 2 : 1;
          if (dy < -30) setSheet(STOPS[Math.min(2, at + steps)]);
          else if (dy > 40 && at === 0) closeProfile();
          else if (dy > 60) setSheet(STOPS[Math.max(0, at - steps)]);
        }
        setTimeout(() => { start = null; }, 0);
      });
      handle.addEventListener("pointercancel", () => { start = null; });
    })();

    // options.resolved: how the tree was asked for (a link or a search), for the panel's one-line note.
    async function openProfile(props, options = {}) {
      if (!props?.tree_id) return;
      // The control that opened the panel gets focus back on close; a map click (focus on the body or canvas) the map.
      const wasOpen = !profilePanel.hidden, active = document.activeElement;
      if (!wasOpen) profileOpener = active && active !== document.body && !profilePanel.contains(active) ? active : map.getCanvas();
      const pushHistory = !wasOpen && !options.fromHistory && !options.fromLink;
      panelNote = options.resolved ? ALTOTreeId.describe(options.resolved)?.note || null : null;
      ALTOEvidenceWorkspace.dispose();
      propertyRequestId++; setProfileMode("tree");
      // A panel opens at half; one already open keeps its stop, so a tree tapped under the bar is named in the bar.
      if (mobileLayout.matches) { setSidebarCollapsed(true); if (!wasOpen) setSheet("half"); }
      profilePanel.hidden = false; profilePanel.inert = false;
      const requestId = ++profileRequestId;
      clearYearLink();
      panelClick = Number.isFinite(props.lon) && Number.isFinite(props.lat) ? { lon: props.lon, lat: props.lat } : null;
      const env = recordEnv();
      if (props.tn) loadScheduleFacts(props.tn);
      const quick = ALTOTreeRecord.fromTile(props, env);
      // FE-17: the header first (name, number, actions), then a yield to the browser, then the rest of the panel.
      panelRec = quick; panelGeometry = null;
      profileBody.innerHTML = ALTOTreePanel.header(quick, panelOptions(quick));
      if (quick.number) setUrlTree(quick.number, { push: pushHistory });
      document.title = `${quick.number || quick.id} on the map · ALTO`;
      document.body.dataset.profileOpen = "true";
      profilePanel.setAttribute("aria-hidden", "false");
      profileHighlightId = props.tree_id;
      if (map.getLayer("points-highlight")) setRings("points-highlight", ["==", ["get", "tree_id"], props.tree_id || "__none__"]);
      // The full record is asked for at once; its file reads while the header paints.
      let fullReady = false;
      const fullLoad = ALTOTreeRecord.load(props.tree_id, env, { members: 0 });
      fullLoad.then(() => { fullReady = true; }, () => {});
      await afterPaint();
      if (requestId !== profileRequestId || profilePanel.hidden) return;
      // Focus to the panel and back to its top, after the paint: inside the tap, focus() and scrollTop each forced a
      // layout of the whole page (20 to 90 ms at 4x CPU). At once, not smoothly (the panel scrolls smoothly for its
      // links): a smooth scroll was still under way when the full record kept the position, so a new tree opened
      // where the last one had been scrolled to.
      document.getElementById("treeProfileClose").focus({preventScroll: true});
      profileBody.scrollTo({ top: 0, behavior: "instant" });
      // The map tile's summary while the full record reads (skipped when the record is already here).
      if (!fullReady) { profileBody.innerHTML = panelHtml(quick); bindPanel(quick); fillImageryCaption(quick); completeScheduleLine(requestId); }
      try {
        const full = await fullLoad;
        if (requestId !== profileRequestId || profilePanel.hidden) return;
        const scroll = profileBody.scrollTop;
        profileBody.innerHTML = panelHtml(full);
        bindPanel(full); fillImageryCaption(full); completeScheduleLine(requestId);
        profileBody.scrollTo({ top: scroll, behavior: "instant" });
        if (full.number) setUrlTree(full.number, { push: pushHistory && !panelPushed });
        document.title = `${full.number || full.id} on the map · ALTO`;
        // The crown tiles may arrive after the record (the map is still flying in): draw the outline when they do.
        if (!panelGeometry) map.once("idle", () => {
          if (requestId !== profileRequestId || profilePanel.hidden) return;
          const g = crownGeometry(full.id) || crownGeometry(full.identity?.crownRepresentative);
          const article = profileBody.querySelector("article.tp"), fig = profileBody.querySelector("#tpLinked")?.closest("section");
          if (!g || !article || !fig) return;
          panelGeometry = g;
          // The outline gives the dripline radius (and a scheduled tree's root zone) in place of the equal-area radius.
          ALTOTreeRecord.extras(full, { geometry: g });
          const metricsSection = profileBody.querySelector("#tpMetrics")?.closest("section");
          if (metricsSection) metricsSection.outerHTML = ALTOTreePanel.metrics(full);
          fig.querySelector(".ti-chip")?.replaceWith(Object.assign(document.createElement("div"), { innerHTML: ALTOInstrument.crownFigure(full, g, { width: 300, height: 220 }) }).firstElementChild);
          const key = fig.querySelector(".ti-key"), fresh = ALTOInstrument.figureKey(full, { geometry: true, profile: !!fig.querySelector(".ti-hfig") });
          if (key) key.outerHTML = fresh; else fig.querySelector(".ti-linked")?.insertAdjacentHTML("afterend", fresh);
          const year = Number(article.dataset.year || 2024);
          ALTOInstrument.setYear(article, year); showYearLink(full, year);
        });
        // Where it sits among similar trees, from the release's comparison tables (when published), and its field
        // measurements (field/measurements_v1.json): a tree measured in the field has its key measurements drawn again.
        ALTOTreeRecord.enrich(full, env, { parts: ["context", "field"], onPart: name => {
          if (requestId !== profileRequestId) return;
          if (name === "field") {
            if (full.field?.status !== "ready") return;
            const metricsSection = profileBody.querySelector("#tpMetrics")?.closest("section"), article = profileBody.querySelector("article.tp");
            if (metricsSection) metricsSection.outerHTML = ALTOTreePanel.metrics(full);
            if (article) ALTOInstrument.setYear(article, Number(article.dataset.year || 2024));
          }
          const slot = profileBody.querySelector("#tpCtx"); if (slot) slot.innerHTML = ALTOInstrument.contextSentence(full);
          const links = profileBody.querySelector("#tpPage")?.closest("section")?.querySelector(".ti-pagelinks");
          if (links) links.outerHTML = ALTOInstrument.pageLinks(full, ALTOTreeId.url(full.number || full.id, { page: "tree" }));
        } }).catch(() => {});
      } catch (error) {
        if (requestId !== profileRequestId || profilePanel.hidden) return;
        const note = document.createElement("div");
        note.className = "tp-error";
        note.innerHTML = '<p>The map summary is shown, but the full record could not load.</p><button type="button" class="btn btn-quiet">Try again</button>';
        note.querySelector("button").addEventListener("click", () => openProfile(props));
        profileBody.querySelector(".tp-actions")?.after(note);
      }
    }

    // ====================================================================
    // PROPERTY PANEL — the trees on one parcel and their estimated services.
    // Shares the right-hand panel with the tree profile; a tree opened from a
    // property keeps the parcel outlined and offers a way back to it.
    // ====================================================================
    function setProfileMode(mode) {
      const property = mode === "property";
      document.getElementById("treeProfileTitle").textContent = property ? "Property" : "Tree";
      profilePanel.setAttribute("aria-label", property ? "Property summary" : "Tree profile");
      document.getElementById("profileBack").hidden = property || !currentProperty;
    }
    // Gold rings go on every counted tree in the parcel, not just the 300 the record lists: the
    // release counting rule, the parcel's land class (a register tree of another class stays off
    // its figures) and the parcel shape read back from the loaded parcel tiles. Those tiles, and
    // so the outline, start at zoom 14. Further out, a shape is only usable once every tile of
    // the parcel has been seen; until then the listed trees are ringed as well and the panel
    // says that the map may ring only those. Rings follow the tree filters, so a hidden tree is
    // never ringed.
    const PARCEL_MIN_ZOOM = 14;
    function propertyRingNote(shape) {
      const note = profileBody.querySelector("[data-property-rings]");
      if (note) note.hidden = !!shape?.complete || map.getZoom() >= PARCEL_MIN_ZOOM;
    }
    function applyPropertySelection() {
      const p = currentProperty, street = p?.streetIds || [];
      for (const id of ["property-selected-casing", "property-selected"]) {
        if (!map.getLayer(id)) continue;
        map.setFilter(id, ["==", ["get", "pid"], p ? p.pid : "__none__"]);
        map.setLayoutProperty(id, "visibility", p ? "visible" : "none");
      }
      const shape = p?.tenure && propertyShape?.pid === p.pid ? propertyShape : null;
      propertyRingNote(shape);
      if (!map.getLayer("points-property")) return;
      const rings = [];
      if (shape) rings.push(["all", ["!=", ["get", "display_role"], "earlier_detection"], ["==", ["coalesce", ["get", "tenure"], "unknown"], p.tenure], ["within", shape.geometry]]);
      if (!shape?.complete && p?.treeIds?.length) rings.push(["in", ["get", "tree_id"], ["literal", p.treeIds]]);
      if (street.length) rings.push(["in", ["get", "tree_id"], ["literal", street]]);
      const visible = buildFilter();
      setRings("points-property", !rings.length ? ["==", ["get", "tree_id"], "__none__"] : visible ? ["all", visible, ["any", ...rings]] : ["any", ...rings]);
      // Street trees just outside the parcel take the Street colour of the land types; the parcel's own are ink.
      map.setPaintProperty("points-property", "circle-stroke-color", street.length ? ["case", ["in", ["get", "tree_id"], ["literal", street]], PAL.colour("tenure", "street"), tok("--color-selection")] : tok("--color-selection"));
    }
    // The parcel's pieces in the loaded parcel tiles, read when the map is idle. At zoom 14 or more
    // with the whole parcel on the canvas every tile it touches is loaded, so the shape is
    // complete; a complete shape is kept until a newer complete one arrives. The ring filter
    // changes only when the shape does.
    function refreshPropertyShape() {
      const p = currentProperty;
      if (!p?.tenure || !map.getLayer("property-selected")) return;
      const parts = []; let n = 0, sx = 0, sy = 0;
      for (const f of map.querySourceFeatures("akl-properties", { sourceLayer: "properties", filter: ["==", ["get", "pid"], p.pid] })) {
        const g = f.geometry;
        for (const polygon of g.type === "Polygon" ? [g.coordinates] : g.type === "MultiPolygon" ? g.coordinates : []) {
          parts.push(polygon);
          for (const ring of polygon) for (const [x, y] of ring) { n++; sx += x; sy += y; }
        }
      }
      const old = propertyShape?.pid === p.pid ? propertyShape : null, key = `${parts.length}:${n}:${sx.toFixed(6)}:${sy.toFixed(6)}`;
      const b = p.bbox, v = map.getBounds();
      const complete = parts.length > 0 && !!b && map.getZoom() >= PARCEL_MIN_ZOOM && v.getWest() <= b[0] && v.getSouth() <= b[1] && v.getEast() >= b[2] && v.getNorth() >= b[3];
      if (!parts.length || (old?.complete && !complete) || (old?.key === key && old.complete === complete)) return propertyRingNote(old);
      propertyShape = { pid: p.pid, key, complete, geometry: { type: "MultiPolygon", coordinates: parts } };
      applyPropertySelection();
    }
    map.on("idle", refreshPropertyShape);
    // Keep the parcel clear of the open panels when the map moves to it. The padding is passed
    // to fitBounds and turned into an offset for easeTo; it is never left on the map, where
    // MapLibre would add it to every later fitBounds and shift every later camera move.
    function propertyPadding() {
      const canvas = map.getCanvas(), width = canvas.clientWidth, height = canvas.clientHeight;
      if (mobileLayout.matches) return { top: 120, right: 20, bottom: Math.max(20, Math.min(Math.round(height * 0.62) + 16, height - 200)), left: 20 };
      const left = document.body.dataset.asideCollapsed === "true" ? 40 : 340;
      // From 1101 px the zoom buttons and attribution sit beside the open panel (observatory.css),
      // and the attribution stays open over the bottom of the map until the first drag.
      const beside = controlsBesidePanel.matches;
      const attrib = beside ? parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--attrib-clear")) || 0 : 0;
      return { top: 48, right: Math.max(20, Math.min(beside ? 460 : 420, width - left - 200)), bottom: Math.max(48, Math.round(attrib) + 8), left };
    }
    function propertyOffset() {
      const pad = propertyPadding();
      return [(pad.left - pad.right) / 2, (pad.top - pad.bottom) / 2];
    }
    function clearMapPadding() {
      const pad = map.getPadding();
      if (pad.top || pad.right || pad.bottom || pad.left) map.setPadding({ top: 0, right: 0, bottom: 0, left: 0 });
    }
    async function openProperty(pid, address = null, options = {}) {
      if (!pid) return;
      pid = String(pid);
      ensureSource("akl-properties");
      const wasOpen = !profilePanel.hidden, active = document.activeElement;
      if (!wasOpen) profileOpener = active && active !== document.body && !profilePanel.contains(active) ? active : map.getCanvas();
      ALTOEvidenceWorkspace.dispose();
      profileRequestId++; urlTree = null;
      setUrlProperty(pid, { push: !wasOpen && !options.fromHistory && !options.fromLink });
      document.title = `${address ? ALTOProperty.label(address) : `Parcel ${pid}`} on the map · ALTO`;
      const requestId = ++propertyRequestId, same = currentProperty?.pid === pid;
      currentProperty = { pid, address: address || (same ? currentProperty.address : null), tile: options.tile || (same ? currentProperty.tile : null),
        treeIds: same ? currentProperty.treeIds : [], streetIds: same ? currentProperty.streetIds : [], tenure: same ? currentProperty.tenure : null, bbox: same ? currentProperty.bbox : null, record: same ? currentProperty.record : null };
      if (mobileLayout.matches) { setSidebarCollapsed(true); if (!wasOpen) setSheet("half"); }
      setProfileMode("property");
      profileHighlightId = null;
      if (map.getLayer("points-highlight")) setRings("points-highlight", ["==", ["get", "tree_id"], "__none__"]);
      profilePanel.hidden = false; profilePanel.inert = false;
      profileBody.innerHTML = `<div class="pp-loading"><div class="pp-skeleton"><span></span><span></span><span></span><span></span></div><p class="pp-note">Loading the property summary…</p></div>`;
      profileBody.scrollTop = 0;
      document.body.dataset.profileOpen = "true";
      profilePanel.setAttribute("aria-hidden", "false");
      document.getElementById("treeProfileClose").focus({preventScroll: true});
      if (!state.showProperties) { state.showProperties = true; document.getElementById("showProperties").checked = true; applyFilters(); }
      clearMapPadding();
      applyPropertySelection();
      const a = currentProperty.address;
      if (options.fly !== false && a) map.easeTo({ center: [a.lon, a.lat], zoom: Math.max(map.getZoom(), 17), offset: propertyOffset(), duration: 600 });
      try {
        const { record } = await ALTOProperty.load(DATA_BASE, TILE_VERSION, pid);
        if (requestId !== propertyRequestId) return;
        currentProperty.treeIds = (record?.trees || []).map(t => t.tree_id);
        currentProperty.streetIds = (record?.street_trees || []).map(t => t.tree_id);
        currentProperty.tenure = record?.property?.tenure || null;
        currentProperty.record = record || null;
        if (record) { areaScope = "property"; renderArea(); }
        currentProperty.bbox = record?.property?.bbox || null;
        profileBody.innerHTML = ALTOProperty.render(record, { pid, address: currentProperty.address, tile: currentProperty.tile });
        if (record?.property) profileBody.querySelector(".property-summary")?.insertAdjacentHTML("beforeend", '<button type="button" class="btn btn-quiet property-area-link">' + ALTOViz.icon("map", 16) + '<span>See this property in the Area dashboard</span></button>');
        profileBody.querySelector(".property-area-link")?.addEventListener("click", () => {
          areaScope = "property";
          if (mobileLayout.matches) { profilePanel.hidden = true; profilePanel.inert = true; document.body.dataset.profileOpen = "false"; }
          setSidebarCollapsed(false); selectTab("tabView"); renderArea();
        });
        if (record) ALTOProperty.bind(profileBody, record, { open: openProfile });
        applyPropertySelection();
        refreshPropertyShape();
        const box = record?.property?.bbox;
        if (options.fly !== false && box) {
          // A parcel that only just misses fitting at the zoom where its outline starts is shown
          // there, slightly cropped, rather than fitted without an outline.
          const bounds = [[box[0], box[1]], [box[2], box[3]]], padding = propertyPadding();
          const fit = map.cameraForBounds(bounds, { padding, maxZoom: 19 });
          if (fit && fit.zoom < PARCEL_MIN_ZOOM && fit.zoom >= PARCEL_MIN_ZOOM - 0.5) map.easeTo({ center: [(box[0] + box[2]) / 2, (box[1] + box[3]) / 2], zoom: PARCEL_MIN_ZOOM, offset: propertyOffset(), duration: 700 });
          else map.fitBounds(bounds, { padding, maxZoom: 19, duration: 700 });
        }
        else if (options.fly !== false && a) map.easeTo({ center: [a.lon, a.lat], zoom: 18.5, offset: propertyOffset(), duration: 600 });
      } catch (error) {
        if (requestId !== propertyRequestId) return;
        profileBody.innerHTML = '<div class="pp-section"><p class="pp-note">The property summary could not load.</p><button type="button" class="pp-retry-details">Try again</button></div>';
        profileBody.querySelector("button").addEventListener("click", () => openProperty(pid, currentProperty?.address, options));
      }
    }
    document.getElementById("profileBack").addEventListener("click", () => {
      if (currentProperty) openProperty(currentProperty.pid, currentProperty.address, { fly: false });
    });
    // Centre a tree in the part of the map the panels leave visible: above the tree sheet on a phone, beside the tree panel
    // on a desktop (an offset, never padding left on the map).
    function easeToTree(lon, lat, { zoom = 18.5, jump = false } = {}) {
      if (!Number.isFinite(lon) || !Number.isFinite(lat)) return;
      let offset = [0, 0];
      if (mobileLayout.matches) { const top = profilePanel.hidden ? window.innerHeight : profilePanel.getBoundingClientRect().top; offset = [0, -Math.max(0, window.innerHeight - top) / 2]; }
      else if (!profilePanel.hidden) offset = [-(profilePanel.offsetWidth || 0) / 2 + (document.body.dataset.asideCollapsed === "true" ? 0 : 170), 0];
      const z = Math.max(map.getZoom(), zoom);
      // jumpTo ignores an offset: a jump is an ease of no duration.
      map.easeTo({ center: [lon, lat], zoom: z, offset, duration: jump || reducedMotion.matches ? 0 : 700 });
    }
    // A street chosen in the search: the map fits its address points. An address chosen in the search keeps a pin until
    // the next search or Escape, after its panel closes.
    let searchPin = null;
    function clearSearchPin() { searchPin?.remove(); searchPin = null; }
    function pinAt(lon, lat, label) {
      clearSearchPin();
      if (!Number.isFinite(lon) || !Number.isFinite(lat)) return;
      const el = document.createElement("div"); el.className = "search-pin"; el.setAttribute("role", "img"); el.setAttribute("aria-label", label || "Searched address");
      searchPin = new maplibregl.Marker({ element: el, anchor: "bottom" }).setLngLat([lon, lat]).addTo(map);
    }
    function showStreet(st) {
      const [w, s0, e, n] = st.bbox, pad = propertyPadding();
      const dx = Math.max(0.0006, (e - w) * 0.08), dy = Math.max(0.0005, (n - s0) * 0.08);
      map.fitBounds([[w - dx, s0 - dy], [e + dx, n + dy]], { padding: mobileLayout.matches ? { top: 96, right: 28, bottom: 220, left: 28 } : pad, maxZoom: 18, duration: reducedMotion.matches ? 0 : 900 });
      clearSearchPin();
    }
    document.addEventListener("keydown", e => { if (e.key === "Escape" && searchPin && !document.activeElement?.closest?.("#treeProfile, .property-search")) clearSearchPin(); });
    // ====================================================================
    // SEARCH (from concept C): one box for addresses, tree IDs, species, local boards and map commands
    // ("protected trees", "colour by height", "show parcels", "pōhutukawa in Kaipātiki", "taller than 25 m").
    // command-search.js ranks the items below against the text (case, macrons and one typo ignored) and
    // runs the ARIA 1.2 combobox; this block builds the items from the panel's state, so each label says
    // what choosing it will do. Addresses come from the release's own address index (property.js).
    // ====================================================================
    (function commandSearch() {
      const input = document.getElementById("propertySearch"), colourBy = document.getElementById("colourBy");
      const A = () => panelActions;
      const refresh = () => { A()?.sync(); applyFilters(); };
      const NAMES = { source: "Source", structure: "Growth form", height: "Height", change: "Canopy change since 2013", quality: "Link status", evidence: "Detection evidence", tenure: "Land type" };
      const COLOUR_WORDS = { source: ["sources", "source", "owner"], structure: ["growth form", "form", "evergreen", "deciduous", "conifer"], height: ["height", "heights", "tall", "tallest", "tallest trees", "tall trees"], change: ["change since 2013", "change", "canopy change", "removed trees", "new trees", "loss"], quality: ["link status", "data quality", "quality", "links", "crown links"], evidence: ["detection evidence", "evidence", "evidence tier", "confidence"], tenure: ["land type", "tenure", "land"] };
      const SOURCE_WORDS = { register_parks: ["council parks register", "parks register", "council parks"], register_at: ["auckland transport register", "auckland transport", "at register", "street register"], register_other: ["owner not recorded", "tree register"], notable: ["notable trees schedule", "unitary plan schedule", "schedule 10"], osm: ["openstreetmap", "osm", "open street map"], kauri: ["ruru kauri survey", "ruru", "kauri survey", "kauri observations"], lidar: ["lidar detected trees", "lidar", "lidar only", "detected trees", "laser survey"] };
      const QUALITY_WORDS = { linked: ["linked", "crown linked"], probable: ["probable link", "probable"], drawn: ["crown drawn from the record", "drawn crowns", "drawn"], unlinked: ["no crown linked", "unlinked", "no crown"] };
      const LAND_WORDS = { street: ["street trees", "street land", "road reserve", "verge", "berm"], park: ["park and reserve", "parks", "reserves", "park"], institutional: ["schools and institutions", "schools", "school", "institutions"], private: ["private property", "private land", "private", "backyard"], other: ["other land", "unknown land", "coastal"] };
      const BASEMAP_WORDS = { light: ["light", "grey", "gray", "light basemap", "plain"], streets: ["streets", "street map", "roads"], hybrid: ["hybrid", "aerial with labels", "imagery with labels"], satellite: ["satellite", "aerial", "imagery", "air photo", "photo"] };
      // Layer switches: state key (and checkbox id), name, extra words, drawer group.
      const LAYERS = [
        ["showProperties", "Property boundaries", ["parcels", "properties", "boundaries", "sections", "lots", "cadastre"], "overlays"],
        ["showLandType", "Land type of parcels", ["parcel land type", "zoning", "tenure of parcels"], "overlays"],
        ["showCouncilPositions", "Council recorded positions", ["recorded positions", "council positions", "source positions"], "overlays", () => !document.getElementById("councilPositionsToggle").hidden],
        ["showGroupAreas", "Notable Group of Trees areas", ["group areas", "notable groups", "schedule 10 groups"], "overlays", () => !document.getElementById("groupAreasToggle").hidden],
        ["showCanopy", "Canopy cover by local board", ["canopy cover", "board canopy"], "overlays"],
        ["showKauri", "Kauri dieback surveillance", ["kauri dieback", "dieback", "phytophthora", "kauri disease"], "risk"],
        ["showRootZone", "Root space (earlier crowns)", ["root space", "roots", "root zone"], "risk"],
        ["showLowBand", "Low canopy, 2–3 m", ["low canopy", "low trees"], "vegetation"],
        ["showSubBand", "Low vegetation, under 2 m", ["low vegetation", "shrubs", "vegetation"], "vegetation"],
        ["showEarlierDetections", "Earlier unmatched detections", ["earlier detections", "unmatched detections"], "vegetation"],
        ["showLowCanopy", "Earlier low-canopy candidates", ["low canopy candidates", "candidates"], "vegetation"],
        ["showTrunk", "Size markers by trunk", ["trunk size", "trunk", "dbh", "diameter", "marker size"], "display"],
        ["showCrowns", "Crown outlines", ["crowns", "outlines", "crown outlines"], "display"]
      ];
      const setCheck = (id, on) => { const box = document.getElementById(id); if (box && box.checked !== on) { box.checked = on; box.dispatchEvent(new Event("change")); } };
      // The search offers species as the filter does (buildSpeciesGroups): one per species, in its display form, every
      // spelling and kauri survey variant folded in; never a string that names several species.
      function speciesGroups() {
        return SPECIES_GROUPS.filter(grp => !grp.multi).map(grp => [grp.label, grp.count, grp.keys]);
      }
      function speciesItem(name, count, names = [name]) {
        const has = names.every(n => state.selectedSpecies.has(n)), others = [...state.selectedSpecies].filter(n => !names.includes(n)).length;
        const only = () => { state.selectedSpecies = new Set(names); refresh(); };
        return { label: has ? `${name} (shown)` : others ? `Add species: ${name}` : name, meta: `Species · ${formatNumber.format(count)} ${count === 1 ? "tree" : "trees"} in the release${names.length > 1 ? ` · ${names.length} spellings` : ""}`,
          run: () => { if (!has) { if (!others) state.selectedSpecies.clear(); for (const n of names) state.selectedSpecies.add(n); refresh(); } return `Species: ${[...state.selectedSpecies].join(", ")}`; },
          ensure: only };
      }
      function heightItem(n) {
        const set = () => { state.minHeight = n; applyFilters(); };
        return { id: "height:" + n, group: "Filters", label: `Height ${n} m or more`, words: [`height ${n} m or more`, `taller than ${n} m`, `${n} m or more`, "tall trees"], meta: "Highest point of the 2024 LiDAR canopy height model within the crown", combinable: true,
          run: () => { set(); return `Height: ${n} m or more`; }, ensure: set };
      }
      // Presets: two starting points that set several things at once. Each lists what it sets.
      const PRESETS = [
        { id: "street", label: "Street trees", words: ["street trees", "road trees", "berm trees", "verge trees"], sets: "Land: Street", apply: () => { state.visibleLand = new Set(["street"]); } },
        { id: "review", label: "Records to review", words: ["records to review", "needs review", "review", "check links", "quality check"], sets: "Link status: probable, drawn and no crown linked · Colour: link status",
          apply: () => { state.visibleQuality = new Set(["probable", "drawn", "unlinked"]); colourBy.value = "quality"; } }
      ];
      function applyPreset(p) {
        A()?.resetFilters(); p.apply(); A()?.sync(); applyFilters(); applyColourMode();
        return `${p.label}: ${p.sets}`;
      }
      function commandItems(intent) {
        const items = [];
        // A switch: the label says what choosing it does; "show", "hide" and "only" in the text decide it.
        const toggle = ({ id, group = "Filters", isOn, set, onLabel, offLabel, words, meta, combinable }) => {
          const want = intent === "off" ? false : intent === "on" || intent === "only" ? true : !isOn, noop = want === isOn;
          return { id, group, words, combinable, current: isOn, label: noop ? `${want ? onLabel : offLabel} (already)` : want ? onLabel : offLabel, meta: noop ? "No change" : meta,
            run: () => { if (!noop) set(want); return want ? onLabel : offLabel; }, ensure: () => set(true) };
        };
        for (const p of PRESETS) items.push({ id: "preset:" + p.id, group: "Presets", label: p.label, words: [p.label, ...p.words], meta: `Sets ${p.sets}`, combinable: p.id === "street", run: () => applyPreset(p), ensure: () => applyPreset(p) });
        items.push(toggle({ id: "f:protected", isOn: state.statusOnly.has("protected"), set: on => { state.statusOnly = new Set(on ? ["protected"] : []); refresh(); },
          onLabel: "Only trees on the Notable Trees schedule", offLabel: "Clear the Notable Trees schedule filter", words: ["protected trees", "protected", "notable trees", "notable trees schedule", "scheduled trees", "schedule 10", "heritage trees"], meta: "Status · Notable Trees schedule (Unitary Plan, Schedule 10)", combinable: true }));
        items.push(toggle({ id: "f:named", isOn: !state.showUnknown, set: on => { state.showUnknown = !on; refresh(); },
          onLabel: "Only trees with a recorded species", offLabel: "Include trees without a recorded species", words: ["recorded species", "named trees", "identified species", "known species"], meta: "Species", combinable: true }));
        items.push(toggle({ id: "f:uncertain", isOn: !state.showUncertain, set: on => { state.showUncertain = !on; refresh(); },
          onLabel: "Hide possible and unverified detections", offLabel: "Include possible and unverified detections", words: ["possible and unverified detections", "possible detections", "unverified", "uncertain trees", "hedges"], meta: "Link status and detections" }));
        if (state.minHeight) items.push({ id: "height:any", group: "Filters", label: "Any height", words: ["any height", "all heights", "clear height"], meta: `Clears Height: ${state.minHeight} m or more`, run: () => { state.minHeight = 0; applyFilters(); return "Height: any"; } });
        for (const n of [10, 20, 30]) if (state.minHeight !== n) items.push(heightItem(n));
        // Species maxima: the ring filter (when the release has the file).
        if (maxima) items.push(toggle({ id: "f:maxima", isOn: state.onlyMaxima, set: on => { setCheck("onlyMaxima", on); },
          onLabel: `Show species maxima in ${state.maximaArea} (rings)`, offLabel: "Hide species maxima", words: ["species maxima", "maxima", "maximum", "largest trees", "biggest trees", "record trees"], meta: "Filter · the largest measured tree of each species", combinable: false }));
        const allSources = state.visibleSources.size === SOURCE_KEYS.length;
        for (const src of ALTOSources.ACTIVE) {
          const words = [src.label, ...(SOURCE_WORDS[src.key] || [])];
          if (intent === "only" || (!intent && allSources)) items.push({ id: "src:" + src.key, group: "Filters", label: `Only ${src.label}`, words, meta: "Source", combinable: true,
            run: () => { state.visibleSources = new Set([src.key]); refresh(); return `Sources: ${src.label}`; }, ensure: () => { state.visibleSources = new Set([src.key]); refresh(); } });
          else items.push(toggle({ id: "src:" + src.key, isOn: state.visibleSources.has(src.key), set: on => { on ? state.visibleSources.add(src.key) : state.visibleSources.delete(src.key); refresh(); },
            onLabel: `Show ${src.label}`, offLabel: `Hide ${src.label}`, words, meta: "Source" }));
        }
        const allQuality = state.visibleQuality.size === QUALITY_KEYS.length;
        for (const q of ALTOSources.QUALITY) {
          const words = [q.label, ...(QUALITY_WORDS[q.key] || [])];
          if (intent === "only" || (!intent && allQuality)) items.push({ id: "q:" + q.key, group: "Filters", label: `Only ${q.label.toLowerCase()}`, words, meta: "Link status", combinable: true,
            run: () => { state.visibleQuality = new Set([q.key]); refresh(); return `Link status: ${q.label}`; }, ensure: () => { state.visibleQuality = new Set([q.key]); refresh(); } });
          else items.push(toggle({ id: "q:" + q.key, isOn: state.visibleQuality.has(q.key), set: on => { on ? state.visibleQuality.add(q.key) : state.visibleQuality.delete(q.key); refresh(); },
            onLabel: `Show ${q.label.toLowerCase()}`, offLabel: `Hide ${q.label.toLowerCase()}`, words, meta: "Link status" }));
        }
        const allLand = state.visibleLand.size === LAND_GROUPS.length;
        for (const [key] of LAND_GROUPS) {
          const words = [LAND_LABELS[key], ...(LAND_WORDS[key] || [])];
          if (intent === "only" || (!intent && allLand)) items.push({ id: "land:" + key, group: "Filters", label: `Land: ${LAND_LABELS[key]} only`, words, meta: "Land type, inferred", combinable: true,
            run: () => { state.visibleLand = new Set([key]); refresh(); return `Land: ${LAND_LABELS[key]}`; }, ensure: () => { state.visibleLand = new Set([key]); refresh(); } });
          else items.push(toggle({ id: "land:" + key, isOn: state.visibleLand.has(key), set: on => { on ? state.visibleLand.add(key) : state.visibleLand.delete(key); refresh(); },
            onLabel: `Land: show ${LAND_LABELS[key]}`, offLabel: `Land: hide ${LAND_LABELS[key]}`, words, meta: "Land type, inferred" }));
        }
        if (!document.getElementById("growthFormFilter").hidden) for (const [key, label] of ALTOGrowthForm.GROUPS) items.push({ id: "gf:" + key, group: "Filters", label: `Growth form: ${label} only`, words: [label, `${label} growth form`], meta: "Estimate", combinable: true,
          run: () => { state.visibleGrowthForms = new Set([key]); refresh(); return `Growth form: ${label}`; }, ensure: () => { state.visibleGrowthForms = new Set([key]); refresh(); } });
        for (const o of colourBy.options) {
          if (o.disabled || o.hidden) continue;
          const name = NAMES[o.value] || o.textContent, cur = colourBy.value === o.value;
          items.push({ id: "colour:" + o.value, group: "Map", label: `Colour by ${name.charAt(0).toLowerCase()}${name.slice(1)}${cur ? " (current)" : ""}`, current: cur,
            words: [`colour by ${name}`, `${name} colour`, `colour ${name}`, ...(COLOUR_WORDS[o.value] || []).map(w => `colour by ${w}`), ...(COLOUR_WORDS[o.value] || [])], meta: cur ? "No change" : "Colour",
            run: () => { colourBy.value = o.value; applyColourMode(); return `Colour: ${name}`; } });
        }
        for (const [key, label, words, , available] of LAYERS) if (!available || available()) items.push(toggle({ id: "layer:" + key, group: "Map", isOn: !!state[key],
          set: on => setCheck(key, on), onLabel: key === "showTrunk" ? "Size markers by trunk" : `Show ${label.charAt(0).toLowerCase()}${label.slice(1)}`, offLabel: key === "showTrunk" ? "Markers of one size" : `Hide ${label.charAt(0).toLowerCase()}${label.slice(1)}`,
          words: [label, ...words], meta: "Layer" }));
        for (const key of ["light", "streets", "hybrid", "satellite"]) items.push({ id: "basemap:" + key, group: "Map", label: `Basemap: ${basemaps[key].label}${activeBasemapKey === key ? " (current)" : ""}`,
          words: [`basemap ${basemaps[key].label}`, ...BASEMAP_WORDS[key]], meta: activeBasemapKey === key ? "No change" : "Basemap", current: activeBasemapKey === key, run: () => { setBasemap(key); return `Basemap: ${basemaps[key].label}`; } });
        const area = scope => { areaScope = scope; if (!sheetLayout.matches || document.body.dataset.asideCollapsed !== "true") setDrawer("area"); renderArea(); };
        items.push({ id: "view:link", group: "Map", label: "Copy link to this view", words: ["copy link", "link to this view", "share view", "share map", "permalink", "url"], meta: "Centre, zoom, colour, filters and layers", run: () => copyViewLink() });
        items.push({ id: "area:region", group: "Map", label: "Area: Auckland", words: ["area auckland", "auckland totals", "region", "whole region", "auckland"], meta: "Release totals", run: () => { area("region"); return "Area: Auckland"; } });
        items.push({ id: "area:view", group: "Map", label: "Area: this view", words: ["area summary", "this view", "summary", "dashboard", "area"], meta: "Trees drawn in the map view", run: () => { area("view"); return "Area: this view"; } });
        items.push({ id: "area:pick", group: "Map", label: "Select a property on the map", words: ["select a property", "pick a property", "select parcel", "choose property", "my property"], meta: "Turns on parcels; then tap one",
          run: () => { setDrawer("area"); setPickMode(true); return "Tap a parcel to select it · Esc to cancel"; } });
        for (const [drawer, label, words] of [["filters", "Open Filters", ["filters", "all filters", "customise"]], ["layers", "Open Layers", ["layers", "overlays", "all layers"]]])
          items.push({ id: "drawer:" + drawer, group: "Map", label, words, meta: "Panel", run: () => { revealControl(drawer, null); return null; } });
        items.push({ id: "panel:reset", group: "Map", label: "Reset the map", words: ["reset", "reset map", "clear all", "clear filters", "start again", "default view"], meta: "All trees, no filters or layers", run: () => { A()?.clearAll(); colourBy.value = "source"; applyColourMode(); return "Map reset: all trees, colour by source"; } });
        items.push({ id: "panel:about", group: "Map", label: "About ALTO", words: ["about alto", "about", "methods", "citation", "cite", "help"], meta: "Methods, release, citation", run: () => { document.getElementById("aboutBtn").click(); return null; } });
        items.push({ id: "panel:compare", group: "Map", label: "Compare saved trees", words: ["compare saved trees", "compare", "saved trees"], meta: "Up to four trees", run: () => { document.getElementById("compareSavedTrees").click(); return null; } });
        items.push({ id: "panel:kyte", group: "Map", label: "Add a photo (KYTE)", words: ["kyte", "add a photo", "tree photo", "upload photo"], meta: "Opens KYTE", run: () => { document.querySelector('[data-site-link="kyte/"]')?.click(); return null; } });
        return items;
      }
      // A tree by any of its IDs: a tree number (data release 6.1 on), a record ID or a crown key; an older ID opens
      // its tree with one line in the panel saying which. A mistyped number offers the one correction the release
      // holds, when there is exactly one (looked up once per typed number).
      const numberFixes = new Map(), numberChecks = new Map();
      function numberFix(key) {
        if (!numberChecks.has(key)) numberChecks.set(key, releaseReady
          .then(metadata => ALTOTreeId.suggestNumber(key, { base: DATA_BASE, version: TILE_VERSION, metadata })).catch(() => null)
          .then(fix => { numberFixes.set(key, fix || null); search?.refresh(); return fix || null; }));
        return numberFixes.get(key);
      }
      async function openTreeId(raw) {
        search.say("Finding that tree…", { keep: true });
        let got;
        try { got = await loadTree(raw); }
        catch (error) {
          const r = error.resolved;
          if (r?.position) map.flyTo({ center: [r.position.lon, r.position.lat], zoom: 18.5 });
          throw new Error(r?.status === "retired" ? error.message : r?.status === "unknown" && r.kind === "number" ? "No tree has this number in this release."
            : "No tree with that ID in this release. Check the ID, or search an address.");
        }
        const { record, resolved } = got, r = record.datasets.record || {};
        openProfile({ ...r, tree_id: record.tree_id, tn: record.datasets.tree_number?.number }, { resolved });
        if (Number.isFinite(Number(r.lon)) && Number.isFinite(Number(r.lat))) requestAnimationFrame(() => easeToTree(Number(r.lon), Number(r.lat)));
        search.say("");
        return null;
      }
      function treeIdItem(text) {
        const t = text.trim(), Id = ALTOTreeId, shaped = Id.typedAsNumber(t) && !Id.isNumber(t) && Id.nearNumbers(t).length > 0;
        const e = Id.searchEntry(t, shaped ? numberFix(Id.compact(t)) : null);
        if (!e) return null;
        const invalid = () => `${Id.MESSAGES.invalid}.`;
        if (e.kind === "invalid") return { id: "tree:invalid", label: e.label, meta: e.meta, keepText: t, run: invalid };
        if (e.kind === "checking") return { id: "tree:check", label: e.label, meta: e.meta, keepText: t,
          run: async () => { const f = await numberChecks.get(e.key); return f ? openTreeId(f) : invalid(); } };
        return { id: "tree:" + e.key, label: e.label, meta: e.meta, run: () => openTreeId(e.kind === "mistyped" ? e.key : t) };
      }
      // Local boards: the Area's board file.
      let boardList = [];
      function loadBoards() {
        loadLocalBoards().then(fc => {
          if (!fc || boardList.length) return;
          boardList = fc.features.map(f => ({ id: "place:" + f.properties.board_name, group: "Places", label: f.properties.board_name, feature: f,
            words: [f.properties.board_name, `${f.properties.board_name} local board`], meta: "Local board · map and Area", run: () => goToBoard(f) }))
            .sort((x, y) => x.label.localeCompare(y.label));
          search?.refresh();
        });
      }
      function goToBoard(f) {
        boardPin = f; areaBoard = f; areaScope = "board";
        const pts = (f.geometry.type === "Polygon" ? [f.geometry.coordinates] : f.geometry.coordinates).flat(2);
        const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
        if (!sheetLayout.matches) setDrawer("area");
        map.fitBounds([[Math.min(...xs), Math.min(...ys)], [Math.max(...xs), Math.max(...ys)]], { padding: propertyPadding(), duration: reducedMotion.matches ? 0 : 900, maxZoom: 15 });
        renderArea();
        return `${f.properties.board_name} Local Board. Area sums the trees drawn inside it.`;
      }
      const boardByName = name => boardList.find(b => ALTOCommand.normalise(b.label) === ALTOCommand.normalise(name));
      function examples() {
        const ex = [
          { id: "ex:protected", label: "notable trees", meta: "Notable Trees schedule", run: () => { state.statusOnly = new Set(["protected"]); refresh(); return "Notable Trees schedule only"; } },
          { id: "ex:colour", label: "colour by height", meta: "Colour: Height", run: () => { colourBy.value = "height"; applyColourMode(); return "Colour: Height"; } },
          { id: "ex:parcels", label: "show parcels", meta: "Layer: Property boundaries", run: () => { setCheck("showProperties", true); return "Property boundaries: on"; } }
        ];
        const kai = boardByName("Kaipātiki"), pohutukawa = speciesGroups().find(([label]) => ALTOCommand.normalise(label) === "pohutukawa");
        if (kai && pohutukawa) ex.push({ id: "ex:combined", label: "pōhutukawa in Kaipātiki", meta: "Species and local board", run: () => { speciesItem(...pohutukawa).ensure(); return goToBoard(kai.feature); } });
        ex.push({ id: "ex:height", label: "taller than 25 m", meta: "Height: 25 m or more", run: () => heightItem(25).run() });
        for (const p of PRESETS) ex.push({ id: "ex:preset:" + p.id, label: p.label, meta: `Sets ${p.sets}`, run: () => applyPreset(p) });
        return ex.map(x => ({ ...x, group: "Examples" }));
      }
      const search = ALTOCommand.bind({
        input, list: document.getElementById("propertyOptions"), status: document.getElementById("propertyStatus"), live: document.getElementById("searchLive"),
        ctx: {
          items: commandItems, species: speciesGroups, places: () => boardList, speciesItem, treeId: treeIdItem, height: n => heightItem(n), examples,
          exampleNote: () => (releaseMetadata?.derived_products?.tree_ids ? "Addresses, tree numbers and record IDs work too: 12 Queen Street, TMCTT6X4, trp_ACCT0245027."
            : "Addresses and tree numbers work too: 12 Queen Street, TZ69KK1G.") + (coarsePointer.matches ? "" : " Press / on the map or in this panel, or Ctrl K, to come back here."),
          combine: (left, place) => ({ id: `${left.id}@${place.id}`, label: `${left.label.replace(/ \((on|shown|already|current)\)$/, "")} in ${place.label}`,
            meta: `${left.group === "Species" ? "Species" : left.group === "Presets" ? "Preset" : "Filter"}, then ${place.label} Local Board and its Area`,
            run: () => { (left.ensure || left.run)(); return goToBoard(place.feature); } })
        },
        // Addresses from the release's address index; a street typed without a number is offered as a street
        // ("Grattan Place, Freemans Bay · street · 24 addresses"), and a street typed with the wrong suburb falls back to
        // where the street is.
        addresses: async (text, items) => {
          const t = text.trim(), lead = /^(unit|flat|apt)?\s*\d/i.test(t);
          if (!lead && (t.length < 4 || items.filter(i => (i.score || 0) >= 80).length >= 2)) return [];
          const res = await ALTOProperty.search(DATA_BASE, TILE_VERSION, t, 5, { streets: true });
          const elsewhere = res.suburbMismatch ? ` · not in ${res.typedSuburb}` : "";
          const streets = (res.streets || []).map(st => ({ id: `street:${st.street}|${st.suburb || ""}`, group: "Streets", label: `${st.street}${st.suburb ? `, ${st.suburb}` : ""}`,
            meta: `street · ${formatNumber.format(st.n)} address${st.n === 1 ? "" : "es"}${elsewhere}${res.hasNumber ? "" : " · add a house number for one address"}`, keepText: `${st.street}${st.suburb ? `, ${st.suburb}` : ""}`,
            run: () => { showStreet(st); return `${st.street}${st.suburb ? `, ${st.suburb}` : ""}: ${formatNumber.format(st.n)} addresses shown`; } }));
          const rows = res.rows.map(a => ({ id: `addr:${a.pid}:${a.unit || ""}/${a.number}`, label: ALTOProperty.label(a), meta: `${a.suburb || "Auckland"}${elsewhere}`, keepText: ALTOProperty.fullLabel(a),
            run: () => { openProperty(a.pid, a); pinAt(Number(a.lon), Number(a.lat), ALTOProperty.fullLabel(a)); return null; } }));
          return [...streets, ...(res.hasNumber || !streets.length ? rows : rows.slice(0, 2))];
        },
        onOpen: () => {
          const list = document.getElementById("propertyOptions"), vv = window.visualViewport;
          const top = input.getBoundingClientRect().bottom, room = (vv ? vv.height + vv.offsetTop : window.innerHeight) - top - 24;
          list.style.maxHeight = `${Math.max(160, Math.min(room, 420))}px`;
        },
        onRun: item => {
          if (!/^addr:/.test(item.id)) clearSearchPin();
          // On a phone, a map command hands the map back (the sheet returns to peek) so the change is seen.
          const keepsPanel = /^(drawer:|area:|panel:)/.test(item.id) || ["Addresses", "Tree", "Places", "Combined"].includes(item.group);
          if (sheetLayout.matches && !keepsPanel) { input.blur(); setPanelSheet("peek"); }
          updateFilterControls();
        }
      });
      // The board names load with the Area's board file: on focus, on typing, and once the map is idle.
      input.addEventListener("focus", loadBoards);
      input.addEventListener("input", loadBoards);
      map.once("idle", () => setTimeout(loadBoards, 800));
      window.ALTOSearch = search;
      // A search handed over by another page (the 404 page's form sends /?q=…): the text in the box, its suggestions open.
      const handed = new URL(window.location.href).searchParams.get("q")?.trim();
      if (handed && handed.length <= 200) { input.value = handed; input.focus({ preventScroll: true }); input.dispatchEvent(new Event("input")); }
    })();
