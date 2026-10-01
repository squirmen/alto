#!/usr/bin/env python3
"""Patch the live Sep 13 ALTO page for the v4 release.

Every replacement must match exactly the expected number of times, otherwise the
script stops and writes nothing. Usage:
    python patch_ui_v4.py SRC_INDEX DST_INDEX totals.json VERSION
"""
import json
import sys
from pathlib import Path

src, dst, totals_path, version = sys.argv[1:5]
html = Path(src).read_text(encoding="utf-8")
T = json.loads(Path(totals_path).read_text())
OLD_VERSION = "20260913050855"


def sub(old, new, count=1):
    global html
    found = html.count(old)
    if found != count:
        raise SystemExit(f"expected {count} match(es), found {found}: {old[:90]!r}")
    html = html.replace(old, new)


# the three modules below were never uploaded; their tags only produced 404s
for name in ("survey-time.js", "field/store.js", "field-bridge.js"):
    sub(f'  <script src="./{name}?v={OLD_VERSION}"></script>\n', "")

sub('<span class="dot inferred"></span><span>LiDAR-inferred</span></button>',
    '<span class="dot inferred"></span><span>Detected from LiDAR</span></button>')

sub("""            <label class="check" for="showUnknown">
              <input id="showUnknown" type="checkbox" checked>
              <span>Unknown spp.</span>
            </label>
""", """            <label class="check" for="showUnknown">
              <input id="showUnknown" type="checkbox" checked>
              <span>Unknown spp.</span>
            </label>
            <label class="check" for="showUncertain" title="LiDAR detections that may be a hedge, shrub or duplicate, or that the 2024 laser survey did not confirm">
              <input id="showUncertain" type="checkbox" checked>
              <span>Possible &amp; unverified trees</span>
            </label>
""")

sub('    const CATEGORY_KEYS = ["park", "road", "inferred", "noCrown", "protected", "other"];\n',
    '''    const CATEGORY_KEYS = ["park", "road", "inferred", "noCrown", "protected", "other"];
    const DETECTION_SOURCES = ["lidar_inferred_canopy", "lidar_pointcloud_v4", "low_canopy_promoted", "pointcloud_missed_promoted"];
    const UNCERTAIN_TIERS = ["possible", "unverified", "possible_duplicate"];
    const TIER_TEXT = {
      very_likely: "Very likely a tree",
      probable: "Probably a tree",
      possible: "Possibly a tree (could be a hedge or large shrub)",
      unverified: "Unverified: the 2024 laser survey shows no canopy here",
      possible_duplicate: "Possibly the same tree as a nearby record",
      not_assessed: "Not yet checked against the 2024 laser survey",
      recorded: "Recorded tree"
    };
    function tierText(props) {
      const text = TIER_TEXT[props.evidence_tier] || "";
      return props.evidence_reasons && props.evidence_tier !== "recorded" ? `${text} · ${props.evidence_reasons}` : text;
    }
    function isDetection(props) { return DETECTION_SOURCES.includes(props.source_primary); }
''')

old_totals = """    const PILOT_TOTALS = {
      trees: 1677438,
      crowns: 1650129,
      protected: 3932,
      lidarInferred: 1367481,
      totalValueNzdY: 227204750,
      runoffM3Y: 13824883,
      carbonTco2e: 2333733
    };"""
sub(old_totals, f"""    const PILOT_TOTALS = {{
      trees: {T['trees']},
      crowns: {T['crowns']},
      protected: {T['protected']},
      lidarInferred: {T['detections']},
      totalValueNzdY: {T['total_value_nzd_y']},
      runoffM3Y: {T['runoff_m3_y']},
      carbonTco2e: {T['carbon_tco2e']}
    }};""")

sub('        ["!=", ["get", "source_primary"], "lidar_inferred_canopy"],\n',
    '        ["!", ["in", ["get", "source_primary"], ["literal", DETECTION_SOURCES]]],\n')
sub('        ["==", ["get", "source_primary"], "lidar_inferred_canopy"], "inferred",\n',
    '        ["in", ["get", "source_primary"], ["literal", DETECTION_SOURCES]], "inferred",\n')

sub("    function protectedExpr() {\n", """    function pointOpacityExpr() {
      return ["match", primaryCategoryExpr(),
        "noCrown", 0.95,
        "inferred", ["match", ["coalesce", ["get", "evidence_tier"], ""],
          "very_likely", 0.82, "probable", 0.66, "possible", 0.46, "unverified", 0.32, "possible_duplicate", 0.24, "not_assessed", 0.7, 0.7],
        0.9];
    }

    function protectedExpr() {
""")
sub("""              "circle-opacity": [
                "match", primaryCategoryExpr(),
                "noCrown", 0.95,
                "inferred", 0.7,
                /* default */ 0.9
              ]""", '              "circle-opacity": pointOpacityExpr()')
sub('          : ["match", primaryCategoryExpr(), "noCrown", 0.95, "inferred", 0.7, 0.9]);',
    '          : pointOpacityExpr());')

sub("""      if (!state.showUnknown) {
        conditions.push(["!=", ["get", "species_confidence"], "unknown"]);
        conditions.push(["!=", ["get", "species_confidence"], "lidar_inferred_no_species"]);
      }
""", """      if (!state.showUnknown) {
        conditions.push(["!=", ["get", "species_confidence"], "unknown"]);
        conditions.push(["!=", ["get", "species_confidence"], "lidar_inferred_no_species"]);
        conditions.push(["!=", ["get", "species_confidence"], "pointcloud_v4_no_species"]);
        conditions.push(["!=", ["get", "species_confidence"], "pointcloud_promoted_no_species"]);
      }
      if (!state.showUncertain) {
        conditions.push(["!", ["in", ["coalesce", ["get", "evidence_tier"], "recorded"], ["literal", UNCERTAIN_TIERS]]]);
      }
""")
sub("+ (state.showUnknown ? 0 : 1);", "+ (state.showUnknown ? 0 : 1) + (state.showUncertain ? 0 : 1);")
sub("      showUnknown: true,\n", "      showUnknown: true,\n      showUncertain: true,\n")
sub("""      showUnknown.addEventListener("change", () => {
        state.showUnknown = showUnknown.checked;
        applyFilters();
      });
""", """      showUnknown.addEventListener("change", () => {
        state.showUnknown = showUnknown.checked;
        applyFilters();
      });
      document.getElementById("showUncertain").addEventListener("change", event => {
        state.showUncertain = event.target.checked;
        applyFilters();
      });
""")
sub("state.growthFilters.clear(); state.showUnknown = true; showUnknown.checked = true;",
    "state.growthFilters.clear(); state.showUnknown = true; showUnknown.checked = true;"
    " state.showUncertain = true; document.getElementById(\"showUncertain\").checked = true;")

sub('      const inferred = props.source_primary === "lidar_inferred_canopy";\n',
    "      const inferred = isDetection(props);\n", count=2)
sub("""        ? `LiDAR-inferred · predicted ${speciesClassLabel(props.species_class).toLowerCase()}`""",
    """        ? (props.species_class
          ? `${TIER_TEXT[props.evidence_tier] || "LiDAR detection"} · predicted ${speciesClassLabel(props.species_class).toLowerCase()}`
          : (TIER_TEXT[props.evidence_tier] || "LiDAR detection"))""")
sub("""        <div class="popup-row"><span>Source</span><span>${safe(props.source_primary)}</span></div>
""", """        <div class="popup-row"><span>Source</span><span>${safe(props.source_primary)}</span></div>
        ${props.evidence_tier ? `<div class="popup-row"><span>Evidence</span><span>${safe(tierText(props))}</span></div>` : ""}
""")
sub('      if (ALTOAnalysis.flag(props.pc_canopy_present)) label += " · point-cloud confirmed";\n',
    """      const tierConfidence = {
        very_likely: ["model", "Machine-detected (LiDAR) · very likely a tree"],
        probable: ["model", "Machine-detected (LiDAR) · probably a tree"],
        possible: ["low", "Machine-detected (LiDAR) · possibly a tree"],
        unverified: ["low", "Machine-detected · not confirmed by the 2024 laser survey"],
        possible_duplicate: ["low", "Possible duplicate of a nearby record"],
        not_assessed: ["model", "Machine-detected (LiDAR) · not yet checked against the 2024 laser survey"]
      }[props.evidence_tier];
      if (tierConfidence) [level, label] = tierConfidence;
      if (ALTOAnalysis.flag(props.restored)) label += " · restored record";
      if (ALTOAnalysis.flag(props.pc_canopy_present)) label += " · point-cloud confirmed";
""")
sub('        lidar_inferred_canopy: "LiDAR-inferred"\n',
    '        lidar_inferred_canopy: "LiDAR-inferred",\n'
    '        lidar_pointcloud_v4: "2024 LiDAR point cloud",\n'
    '        low_canopy_promoted: "LiDAR low-canopy detection",\n'
    '        pointcloud_missed_promoted: "LiDAR point-cloud detection"\n')
sub('<div class="stat"><strong id="inferredCount">0</strong><span>LiDAR-inferred</span></div>',
    '<div class="stat"><strong id="inferredCount">0</strong><span>detected from LiDAR</span></div>')
sub("""        expression = ["case", ["==", ["to-number", ["get", "pc_review_no_canopy"], 0], 1], "#c27025",
          ["==", ["to-number", ["get", "pc_canopy_present"], 0], 1], "#287d65", "#8c9290"];
        keys = [["#287d65","Canopy corroborated"],["#c27025","No canopy · review"],["#8c9290","No confirmation"]];""",
    """        expression = ["match", ["coalesce", ["get", "evidence_tier"], "recorded"],
          "recorded", "#4267ac", "very_likely", "#287d65", "probable", "#7fae4e", "possible", "#d9a33a",
          "unverified", "#c27025", "possible_duplicate", "#b0a8a0", "not_assessed", "#7b8fa3", "#8c9290"];
        keys = [["#4267ac","Recorded tree"],["#287d65","Very likely"],["#7fae4e","Probable"],["#d9a33a","Possible"],["#c27025","Unverified"],["#b0a8a0","Possible duplicate"],["#7b8fa3","Not yet checked"]];""")
sub("      <h3>Coverage and limitations</h3>\n",
    "      <h3>Coverage and limitations</h3>\n"
    "      <p>Trees found only in the 2024 laser survey are labelled by how strong the evidence is: very likely, probably or possibly a tree. "
    "A possible tree may be a hedge or a large shrub. The “Possible &amp; unverified trees” switch in Layers hides them.</p>\n")

sub('        <div class="popup-row"><span>Stormwater scenario</span><span>${formatCurrency.format(stormwater)}/yr · ${fmt(runoff, 1, " m³/yr")}</span></div>\n        <div class="popup-row"><span>Carbon scenario</span><span>${formatCurrency.format(carbonValue)}/yr · ${fmt(carbonStored, 2, " tCO₂e")}</span></div>\n        <div class="popup-row"><span>Cooling scenario</span><span>${formatCurrency.format(cooling)}/yr</span></div>\n        <div class="popup-row"><span>Air scenario</span><span>${formatCurrency.format(air)}/yr</span></div>\n        <div class="popup-row"><span>Total scenario</span><span>${formatCurrency.format(total)}/yr</span></div>\n        <div class="popup-row"><span>Scenario tier</span><span>${safe(props.valuation_confidence)}</span></div>\n',
    '        ${props.total_value_nzd_y == null && props.scenario_total_value_nzd_y == null\n          ? `<div class="popup-row"><span>Services</span><span>Not estimated yet for this tree</span></div>`\n          : `        <div class="popup-row"><span>Stormwater scenario</span><span>${formatCurrency.format(stormwater)}/yr · ${fmt(runoff, 1, " m³/yr")}</span></div>\n        <div class="popup-row"><span>Carbon scenario</span><span>${formatCurrency.format(carbonValue)}/yr · ${fmt(carbonStored, 2, " tCO₂e")}</span></div>\n        <div class="popup-row"><span>Cooling scenario</span><span>${formatCurrency.format(cooling)}/yr</span></div>\n        <div class="popup-row"><span>Air scenario</span><span>${formatCurrency.format(air)}/yr</span></div>\n        <div class="popup-row"><span>Total scenario</span><span>${formatCurrency.format(total)}/yr</span></div>\n        <div class="popup-row"><span>Scenario tier</span><span>${safe(props.valuation_confidence)}</span></div>`}\n')

# crowns of weakly supported detections stay on the map but faint
sub('              "fill-opacity": 0.3\n',
    '              "fill-opacity": ["match", ["coalesce", ["get", "evidence_tier"], ""], '
    '"unverified", 0.07, "possible_duplicate", 0.07, "possible", 0.16, 0.3]\n')
sub('              "line-opacity": 0.95\n',
    '              "line-opacity": ["match", ["coalesce", ["get", "evidence_tier"], ""], '
    '"unverified", 0.35, "possible_duplicate", 0.35, "possible", 0.6, 0.95]\n')

sub(OLD_VERSION, version, count=html.count(OLD_VERSION))
Path(dst).write_text(html, encoding="utf-8")
print(f"patched -> {dst} (version {version})")
