#!/usr/bin/env python3
"""Compute per-tree ecosystem service quantities and dollar values.

This replaces the prior uniform interim assumptions in
``build_tree_crown_pilot.py`` with site-specific, model-driven estimates that
combine crown geometry, CHM height, species class, local impervious fraction,
flood/overland-flow proximity, and predicted air temperature.

Every value carries a ``method_id`` and ``confidence`` field. Dollar prices
are stored separately from physical quantities so the pricing assumptions can
change without rerunning the segmentation pipeline.

Services modelled
-----------------

1. Carbon storage and annual sequestration via species-class allometry on
   CHM-derived height. Carbon → NZ ETS-style monetary value.
2. Avoided runoff via species-specific rainfall interception fraction,
   Auckland-average annual rainfall, and a local runoff-coefficient that
   blends per-tree impervious fraction (or heat-grid paved fraction fallback)
   and flood-prone weight.
3. Shade / urban-cooling proxy weighted by local mean air temperature and
   impervious/paved-surface fraction.
4. PM2.5 dry-deposition removal via a leaf-area-index proxy.

Each per-tree contribution is recorded both as a physical quantity (kg, m3,
m2 of leaf area, kg of pollutant) and as an NZD/year figure under the
documented price assumptions in ``VALUATION_ASSUMPTIONS``.
"""

from __future__ import annotations

import argparse
import os
import csv
import json
import re
import sqlite3
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
PROCESSED_ROOT = ROOT / "data" / "processed"
DOCS_ROOT = ROOT / "docs"
# Overridable so a costing run can target a working copy instead of the
# shared database. Set AKL_TREES_DB to an absolute path.
SQLITE_PATH = Path(os.environ["AKL_TREES_DB"]) if os.environ.get("AKL_TREES_DB") \
    else PROCESSED_ROOT / "akl_trees.sqlite"

VALUATION_ASSUMPTIONS = {
    "annual_rainfall_m": 1.240,
    "rainfall_source": "Auckland-wide ~1240 mm/year (NIWA climate normals 1991-2020 for the Auckland Aero gauge). Used as a constant for the pilot until per-tree gridded rainfall is wired in.",
    "interception_fraction_evergreen_broadleaf": 0.18,
    "interception_fraction_deciduous_broadleaf": 0.10,
    "interception_fraction_conifer": 0.20,
    "interception_fraction_palm_other": 0.12,
    "runoff_coefficient_pervious": 0.30,
    "runoff_coefficient_impervious": 0.90,
    "flood_prone_uplift_factor": 1.5,
    "stormwater_value_nzd_per_m3": 3.50,
    "stormwater_value_basis": (
        "Policy sensitivity scenario only. NZD 3.50/m³ and the 1.5 flood uplift "
        "are not audited Auckland marginal avoided costs and must not be used for "
        "financial, tax, or benefit-cost decisions until Healthy Waters validates them."
    ),
    "cooling_temp_threshold_c": 18.0,
    # Cooling NZD/m² figures revised downward from the v1 placeholders. v1 used
    # 1.50 NZD/m²/°C and 0.80 NZD/m² per paved fraction, which sat above the
    # i-Tree Eco literature range for temperate climates. v2 uses values that
    # bracket Auckland literature and the i-Tree Eco residential range.
    "cooling_value_nzd_per_m2_per_degree": 0.60,
    "cooling_paved_value_nzd_per_m2_paved_fraction": 0.30,
    "cooling_value_basis": (
        "Exploratory index converted to NZD with unvalidated coefficients. It is "
        "not an energy, health, shade-geometry, or pavement-life model. Replace "
        "with explicit Auckland exposure and dose-response pathways."
    ),
    "lai_evergreen_broadleaf": 4.0,
    "lai_deciduous_broadleaf": 2.5,
    "lai_conifer": 3.0,
    "lai_palm_other": 2.0,
    "pm25_removal_rate_kg_per_m2_lai_per_year": 0.008,
    "pm25_value_nzd_per_kg": 25.0,
    "pm25_value_basis": (
        "Sensitivity scenario only. The physical proxy omits local hourly PM2.5 "
        "concentration, deposition velocity, weather, resuspension, mixing height, "
        "population exposure and NZ health valuation, so NZD 25/kg is not a "
        "validated damage-avoidance value."
    ),
    # Legacy allometry sensitivity. The coefficient table below has not been
    # reproduced from the named publications and is disabled in computation.
    "allometry_method": "height_to_dbh_proxy_then_unverified_class_sensitivity_v4",
    "allometry_basis": (
        "Exploratory coefficient scaffold. DBH is first inferred from an uncalibrated "
        "height-only curve, then fed to species/genus/class power functions. Several "
        "coefficient-source mappings have not been reproduced from published equation "
        "tables. Do not describe these as Beets/i-Tree estimates until every equation, "
        "unit, domain and citation is independently verified."
    ),
    "agb_a_evergreen_broadleaf": 0.083,
    "agb_b_evergreen_broadleaf": 2.46,
    "agb_a_deciduous_broadleaf": 0.060,
    "agb_b_deciduous_broadleaf": 2.50,
    "agb_a_conifer": 0.053,
    "agb_b_conifer": 2.62,
    "carbon_root_shoot_ratio_broadleaf": 0.24,
    "carbon_root_shoot_ratio_conifer": 0.22,
    "carbon_root_shoot_ratio_palm": 0.20,
    "carbon_fraction_broadleaf": 0.47,
    "carbon_fraction_conifer": 0.50,
    "carbon_fraction_palm": 0.45,
    "co2_per_carbon_mass_ratio": 44.0 / 12.0,
    "carbon_sequestration_fraction_per_year": 0.015,
    "carbon_sequestration_basis": "1.5% annual increase as a planning-grade default for urban broadleaf trees; should be replaced by age/condition-specific increments per i-Tree Eco growth equations.",
    "carbon_price_nzd_per_tco2e": 50.0,
    "carbon_price_basis": "Versioned NZD 50/tCO2e sensitivity scenario, not a live or dated NZU price.",
    "wood_density_kg_per_m3_default": 600.0,
    "method_id": "valuation_v4_exploratory_sensitivity_not_release_eligible",
}


# Legacy per-species coefficient hypotheses (AGB_kg = a × DBH_cm^b).
# They are retained only to document prior runs. Their source mappings have not
# been reproduced from equation tables and they are not used by the current
# computation. Do not treat the ``source`` strings as verified citations.
SPECIES_ALLOMETRY = {
    # ---- NZ-native conifers (best-calibrated NZ equations) ----
    "agathis australis": {
        "a": 0.066, "b": 2.65,
        "scope": "kauri",
        "source": "Steward & Beveridge 2010 (kauri AGB)",
    },
    "podocarpus totara": {
        "a": 0.058, "b": 2.61,
        "scope": "totara",
        "source": "Beets 2008 NZ podocarp",
    },
    "podocarpus": {
        "a": 0.058, "b": 2.61,
        "scope": "podocarp genus",
        "source": "Beets 2008 NZ podocarp",
    },
    "dacrydium cupressinum": {
        "a": 0.056, "b": 2.60,
        "scope": "rimu",
        "source": "Beets 2008 NZ podocarp",
    },
    "prumnopitys": {
        "a": 0.056, "b": 2.60,
        "scope": "matai / miro genus",
        "source": "Beets 2008 NZ podocarp",
    },
    # ---- NZ-native broadleaf evergreens (Beets 2008 broadleaf default) ----
    "metrosideros excelsa": {
        "a": 0.110, "b": 2.40,
        "scope": "pohutukawa (dense wood)",
        "source": "Coomes et al. 2002 / Schipper et al. 2014 mature pohutukawa",
    },
    "metrosideros": {
        "a": 0.110, "b": 2.40,
        "scope": "Metrosideros genus",
        "source": "Schipper et al. 2014",
    },
    "vitex lucens": {
        "a": 0.083, "b": 2.46,
        "scope": "puriri",
        "source": "Beets 2008 NZ broadleaf evergreen",
    },
    "alectryon excelsus": {
        "a": 0.083, "b": 2.46,
        "scope": "titoki",
        "source": "Beets 2008 NZ broadleaf evergreen",
    },
    "corynocarpus laevigatus": {
        "a": 0.083, "b": 2.46,
        "scope": "karaka",
        "source": "Beets 2008 NZ broadleaf evergreen",
    },
    "griselinia littoralis": {
        "a": 0.075, "b": 2.45,
        "scope": "kapuka / broadleaf",
        "source": "Beets 2008 NZ broadleaf",
    },
    "knightia excelsa": {
        "a": 0.083, "b": 2.46,
        "scope": "rewarewa",
        "source": "Beets 2008 NZ broadleaf evergreen",
    },
    # ---- NZ Pittosporum group (smaller broadleaf) ----
    "pittosporum eugenoides": {
        "a": 0.060, "b": 2.40,
        "scope": "tarata",
        "source": "Beets 2008 NZ broadleaf small-tree",
    },
    "pittosporum crassifolium": {
        "a": 0.060, "b": 2.40,
        "scope": "karo",
        "source": "Beets 2008 NZ broadleaf small-tree",
    },
    "pittosporum tenuifolium": {
        "a": 0.060, "b": 2.40,
        "scope": "matipo",
        "source": "Beets 2008 NZ broadleaf small-tree",
    },
    "pittosporum": {
        "a": 0.060, "b": 2.40,
        "scope": "Pittosporum genus",
        "source": "Beets 2008 NZ broadleaf small-tree",
    },
    "coprosma": {
        "a": 0.060, "b": 2.40,
        "scope": "Coprosma genus",
        "source": "Beets 2008 NZ broadleaf small-tree",
    },
    # ---- Cabbage tree / palms ----
    "cordyline australis": {
        "a": 12.0, "b": 1.0,
        "scope": "cabbage tree (monocot, linear DBH)",
        "source": "linear DBH fallback for monocots",
    },
    "cordyline": {
        "a": 12.0, "b": 1.0,
        "scope": "Cordyline genus",
        "source": "linear DBH fallback",
    },
    "phoenix canariensis": {
        "a": 18.0, "b": 1.0,
        "scope": "phoenix palm",
        "source": "linear DBH fallback for palm",
    },
    "phoenix": {
        "a": 18.0, "b": 1.0,
        "scope": "Phoenix palm genus",
        "source": "linear DBH fallback",
    },
    # ---- Exotic deciduous broadleaf (i-Tree Eco urban equations) ----
    "quercus robur": {
        "a": 0.085, "b": 2.45,
        "scope": "English oak",
        "source": "Nowak 2002 i-Tree Eco oak",
    },
    "quercus palustris": {
        "a": 0.080, "b": 2.46,
        "scope": "pin oak",
        "source": "Nowak 2002 i-Tree Eco oak",
    },
    "quercus": {
        "a": 0.083, "b": 2.46,
        "scope": "Quercus genus",
        "source": "Nowak 2002 i-Tree Eco oak group",
    },
    "platanus x acerifolia": {
        "a": 0.072, "b": 2.50,
        "scope": "London plane",
        "source": "McPherson 2016 i-Tree Eco plane",
    },
    "platanus": {
        "a": 0.072, "b": 2.50,
        "scope": "Platanus genus",
        "source": "McPherson 2016 i-Tree Eco plane group",
    },
    "betula pendula": {
        "a": 0.058, "b": 2.50,
        "scope": "silver birch",
        "source": "Nowak 2002 i-Tree Eco birch",
    },
    "betula": {
        "a": 0.058, "b": 2.50,
        "scope": "Betula genus",
        "source": "Nowak 2002 i-Tree Eco birch group",
    },
    "liquidambar styraciflua": {
        "a": 0.067, "b": 2.48,
        "scope": "liquidambar",
        "source": "Pillsbury 1998 urban (liquidambar)",
    },
    "liquidambar": {
        "a": 0.067, "b": 2.48,
        "scope": "Liquidambar genus",
        "source": "Pillsbury 1998 urban",
    },
    "liriodendron tulipifera": {
        "a": 0.067, "b": 2.48,
        "scope": "tulip tree",
        "source": "Brown 1997 deciduous",
    },
    "fraxinus": {
        "a": 0.072, "b": 2.48,
        "scope": "ash genus",
        "source": "Nowak 2002 i-Tree Eco ash group",
    },
    "ulmus": {
        "a": 0.077, "b": 2.48,
        "scope": "elm genus",
        "source": "Nowak 2002 i-Tree Eco elm group",
    },
    "acer": {
        "a": 0.073, "b": 2.48,
        "scope": "maple genus",
        "source": "Nowak 2002 i-Tree Eco maple group",
    },
    "prunus serrulata": {
        "a": 0.060, "b": 2.45,
        "scope": "flowering cherry",
        "source": "Pillsbury 1998 prunus",
    },
    "prunus": {
        "a": 0.060, "b": 2.45,
        "scope": "Prunus genus (cherry / plum)",
        "source": "Pillsbury 1998",
    },
    "magnolia grandiflora": {
        "a": 0.083, "b": 2.46,
        "scope": "Magnolia grandiflora",
        "source": "Pillsbury 1998 magnolia",
    },
    "magnolia": {
        "a": 0.083, "b": 2.46,
        "scope": "Magnolia genus",
        "source": "Pillsbury 1998",
    },
    "melia azedarach": {
        "a": 0.067, "b": 2.45,
        "scope": "Indian bead tree",
        "source": "Chave 2014 pantropical broadleaf",
    },
    "melia": {
        "a": 0.067, "b": 2.45,
        "scope": "Melia genus",
        "source": "Chave 2014 pantropical broadleaf",
    },
    "robinia": {
        "a": 0.075, "b": 2.46,
        "scope": "Robinia genus",
        "source": "Nowak 2002 i-Tree Eco general broadleaf",
    },
    # ---- Australian Myrtaceae common in Auckland streets ----
    "tristaniopsis laurina": {
        "a": 0.070, "b": 2.46,
        "scope": "water gum",
        "source": "Brown 1997 evergreen broadleaf",
    },
    "tristaniopsis": {
        "a": 0.070, "b": 2.46,
        "scope": "Tristaniopsis genus",
        "source": "Brown 1997 evergreen broadleaf",
    },
    "lophostemon conferta": {
        "a": 0.072, "b": 2.46,
        "scope": "Queensland box",
        "source": "Brown 1997 evergreen broadleaf",
    },
    "agonis flexuosa": {
        "a": 0.070, "b": 2.46,
        "scope": "willow myrtle",
        "source": "Brown 1997 evergreen broadleaf",
    },
    "acmena smithii": {
        "a": 0.075, "b": 2.46,
        "scope": "monkey apple",
        "source": "Brown 1997 evergreen broadleaf",
    },
    "eucalyptus": {
        "a": 0.107, "b": 2.50,
        "scope": "Eucalyptus genus (dense wood)",
        "source": "Brown 1997 eucalyptus",
    },
    # ---- Exotic conifers ----
    "pinus radiata": {
        "a": 0.075, "b": 2.50,
        "scope": "radiata pine",
        "source": "Beets et al. 2007 radiata pine NZ",
    },
    "pinus": {
        "a": 0.075, "b": 2.50,
        "scope": "Pinus genus",
        "source": "Beets et al. 2007 NZ pine",
    },
    "cupressus macrocarpa": {
        "a": 0.060, "b": 2.58,
        "scope": "macrocarpa",
        "source": "Beets 2008 NZ cypress general",
    },
    "cupressus": {
        "a": 0.060, "b": 2.58,
        "scope": "Cupressus genus",
        "source": "Beets 2008 NZ cypress general",
    },
    "sequoia sempervirens": {
        "a": 0.054, "b": 2.62,
        "scope": "coastal redwood",
        "source": "Beets 2008 NZ conifer general",
    },
    "sequoiadendron giganteum": {
        "a": 0.054, "b": 2.62,
        "scope": "wellingtonia / sequoia",
        "source": "Beets 2008 NZ conifer general",
    },
}

# Fallback aliases for trees that have common names but no Latin name in
# the council data. Maps lowercased common-name token → Latin key in the
# SPECIES_ALLOMETRY table above.
COMMON_NAME_TO_LATIN_KEY = {
    "pohutukawa": "metrosideros excelsa",
    "kauri": "agathis australis",
    "totara": "podocarpus totara",
    "rimu": "dacrydium cupressinum",
    "matai": "prumnopitys",
    "miro": "prumnopitys",
    "puriri": "vitex lucens",
    "titoki": "alectryon excelsus",
    "karaka": "corynocarpus laevigatus",
    "kapuka": "griselinia littoralis",
    "tarata": "pittosporum eugenoides",
    "karo": "pittosporum crassifolium",
    "matipo": "pittosporum tenuifolium",
    "rewarewa": "knightia excelsa",
    "cabbage tree": "cordyline australis",
    "ti kouka": "cordyline australis",
    "wellingtonia": "sequoiadendron giganteum",
    "radiata pine": "pinus radiata",
    "macrocarpa": "cupressus macrocarpa",
    "london plane": "platanus x acerifolia",
    "london plane tree": "platanus x acerifolia",
    "english oak": "quercus robur",
    "pin oak": "quercus palustris",
    "silver birch": "betula pendula",
    "liquidambar": "liquidambar styraciflua",
    "tulip tree": "liriodendron tulipifera",
    "monkey apple": "acmena smithii",
    "queensland box": "lophostemon conferta",
    "willow myrtle": "agonis flexuosa",
    "water gum": "tristaniopsis laurina",
    "indian bead tree": "melia azedarach",
    "phoenix palm": "phoenix canariensis",
}


def species_specific_allometry(common: str | None, latin: str | None) -> dict | None:
    """Look up a disabled legacy coefficient hypothesis.

    This helper is retained for audit/reproduction of historical runs. Current
    valuation code must not call it until coefficients, units and domains are
    independently verified against the original equation tables.

    Look up species-specific (a, b) coefficients for the AGB equation.
    Tries full Latin first, then genus, then common-name aliases.
    Returns None if no entry matches; callers should fall back to the
    class-level equations.
    """
    if latin:
        key = " ".join(latin.lower().strip().split())
        if key in SPECIES_ALLOMETRY:
            return SPECIES_ALLOMETRY[key]
        genus = key.split()[0] if key else ""
        if genus in SPECIES_ALLOMETRY:
            return SPECIES_ALLOMETRY[genus]
    if common:
        key = " ".join(common.lower().strip().split())
        if key in COMMON_NAME_TO_LATIN_KEY:
            return SPECIES_ALLOMETRY[COMMON_NAME_TO_LATIN_KEY[key]]
        first_word = key.split()[0] if key else ""
        if first_word in COMMON_NAME_TO_LATIN_KEY:
            return SPECIES_ALLOMETRY[COMMON_NAME_TO_LATIN_KEY[first_word]]
    return None


CONIFER_KEYWORDS = (
    "pine",
    "fir",
    "spruce",
    "cedar",
    "podocarp",
    "rimu",
    "totara",
    "matai",
    "miro",
    "kahikatea",
    "kauri",
    "yew",
    "cypress",
    "macrocarpa",
    "redwood",
    "araucaria",
)

DECIDUOUS_KEYWORDS = (
    "oak",
    "plane",
    "maple",
    "elm",
    "ash",
    "beech",
    "birch",
    "willow",
    "poplar",
    "liquidambar",
    "magnolia",
    "ginkgo",
    "cherry",
    "apple",
    "pear",
    "robinia",
    "alder",
    "tulip",
    "walnut",
    "horse chestnut",
    "wisteria",
    "rowan",
    "hawthorn",
)

PALM_KEYWORDS = (
    # Explicit palm genera + safe common-name fragments.
    # NOTE: not including "palm" as a bare keyword because that would
    # false-match "palmatum" (Japanese Maple, Acer palmatum, is broadleaf).
    "phoenix", "cordyline", "rhopalostylis", "washingtonia",
    "trachycarpus", "howea", "butia", "areca", "cycas", "livistona",
    "nikau", "ti kouka", "cabbage tree", "cycad",
)

_PALM_WORD_RE = re.compile(r"\bpalm\b")


def _has_palm_keyword(text: str) -> bool:
    if not text:
        return False
    if any(keyword in text for keyword in PALM_KEYWORDS):
        return True
    return bool(_PALM_WORD_RE.search(text))


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def species_class(common: str | None, latin: str | None) -> str:
    text = " ".join(filter(None, [common or "", latin or ""])).lower()
    if not text.strip():
        return "evergreen_broadleaf"  # safest urban default
    if _has_palm_keyword(text):
        return "palm_other"
    if any(keyword in text for keyword in CONIFER_KEYWORDS):
        return "conifer"
    if any(keyword in text for keyword in DECIDUOUS_KEYWORDS):
        return "deciduous_broadleaf"
    return "evergreen_broadleaf"


def interception_fraction(klass: str) -> float:
    if klass == "deciduous_broadleaf":
        return VALUATION_ASSUMPTIONS["interception_fraction_deciduous_broadleaf"]
    if klass == "conifer":
        return VALUATION_ASSUMPTIONS["interception_fraction_conifer"]
    if klass == "palm_other":
        return VALUATION_ASSUMPTIONS["interception_fraction_palm_other"]
    return VALUATION_ASSUMPTIONS["interception_fraction_evergreen_broadleaf"]


def lai_for_class(klass: str) -> float:
    if klass == "deciduous_broadleaf":
        return VALUATION_ASSUMPTIONS["lai_deciduous_broadleaf"]
    if klass == "conifer":
        return VALUATION_ASSUMPTIONS["lai_conifer"]
    if klass == "palm_other":
        return VALUATION_ASSUMPTIONS["lai_palm_other"]
    return VALUATION_ASSUMPTIONS["lai_evergreen_broadleaf"]


def estimate_dbh_cm(height_m: float, klass: str) -> float:
    """Rough urban tree DBH (cm) from height (m).

    Curves chosen so that:
    - a 5 m tree ≈ 8 cm DBH
    - a 15 m broadleaf ≈ 28-32 cm DBH
    - a 25 m broadleaf ≈ 55 cm DBH
    Conifers run slightly thinner per unit height; palms tracked separately.
    """
    height_m = max(0.0, height_m)
    if klass == "palm_other":
        return float(max(5.0, 2.0 + 1.2 * height_m))
    if klass == "conifer":
        return float(max(5.0, 1.5 * height_m + 0.02 * height_m * height_m))
    # broadleaf
    return float(max(5.0, 1.6 * height_m + 0.04 * height_m * height_m))


def biomass_kg_above_ground(
    dbh_cm: float,
    height_m: float,
    klass: str,
    species_entry: dict | None = None,
) -> float:
    """Above-ground biomass sensitivity (kg), not an inventory estimate.

    Tier 1: per-species AGB equation if ``species_entry`` is supplied
    (from ``species_specific_allometry``). Form ``AGB = a × DBH^b``;
    palm/cordyline entries use a linear DBH form.

    The class coefficients are unvalidated internal scenario parameters. They
    are not attributed to Beets, Chave or i-Tree.
    """
    if dbh_cm <= 0:
        return 0.0
    if klass == "palm_other" and species_entry is None:
        return max(0.0, 15.0 * dbh_cm)
    if species_entry is not None:
        a = species_entry["a"]
        b = species_entry["b"]
        if b <= 1.05:  # linear DBH form for palms / cordylines
            return max(0.0, a * dbh_cm)
        return max(0.0, a * (dbh_cm ** b))
    if klass == "conifer":
        a = VALUATION_ASSUMPTIONS["agb_a_conifer"]
        b = VALUATION_ASSUMPTIONS["agb_b_conifer"]
    elif klass == "deciduous_broadleaf":
        a = VALUATION_ASSUMPTIONS["agb_a_deciduous_broadleaf"]
        b = VALUATION_ASSUMPTIONS["agb_b_deciduous_broadleaf"]
    else:  # evergreen_broadleaf and any unknown default
        a = VALUATION_ASSUMPTIONS["agb_a_evergreen_broadleaf"]
        b = VALUATION_ASSUMPTIONS["agb_b_evergreen_broadleaf"]
    return max(0.0, a * (dbh_cm ** b))


def _root_shoot_ratio(klass: str) -> float:
    if klass == "conifer":
        return VALUATION_ASSUMPTIONS["carbon_root_shoot_ratio_conifer"]
    if klass == "palm_other":
        return VALUATION_ASSUMPTIONS["carbon_root_shoot_ratio_palm"]
    return VALUATION_ASSUMPTIONS["carbon_root_shoot_ratio_broadleaf"]


def _carbon_fraction(klass: str) -> float:
    if klass == "conifer":
        return VALUATION_ASSUMPTIONS["carbon_fraction_conifer"]
    if klass == "palm_other":
        return VALUATION_ASSUMPTIONS["carbon_fraction_palm"]
    return VALUATION_ASSUMPTIONS["carbon_fraction_broadleaf"]


def carbon_components(height_m: float, klass: str, species_entry: dict | None = None) -> dict[str, float]:
    dbh_cm = estimate_dbh_cm(height_m, klass)
    agb_kg = biomass_kg_above_ground(dbh_cm, height_m, klass, species_entry=species_entry)
    bgb_kg = agb_kg * _root_shoot_ratio(klass)
    total_biomass_kg = agb_kg + bgb_kg
    carbon_kg = total_biomass_kg * _carbon_fraction(klass)
    co2e_kg = carbon_kg * VALUATION_ASSUMPTIONS["co2_per_carbon_mass_ratio"]
    sequestration_co2e_kg_y = co2e_kg * VALUATION_ASSUMPTIONS["carbon_sequestration_fraction_per_year"]
    return {
        "dbh_cm_est": dbh_cm,
        "agb_kg_est": agb_kg,
        "bgb_kg_est": bgb_kg,
        "carbon_kg_est": carbon_kg,
        "stored_co2e_tonnes_est": co2e_kg / 1000.0,
        "annual_sequestration_tco2e_y_est": sequestration_co2e_kg_y / 1000.0,
    }


def avoided_runoff_m3(crown_area_m2: float, klass: str, paved_fraction: float | None) -> dict[str, float]:
    intercept = interception_fraction(klass)
    rainfall = VALUATION_ASSUMPTIONS["annual_rainfall_m"]
    paved = paved_fraction if paved_fraction is not None and 0.0 <= paved_fraction <= 1.0 else 0.35
    impervious = VALUATION_ASSUMPTIONS["runoff_coefficient_impervious"]
    pervious = VALUATION_ASSUMPTIONS["runoff_coefficient_pervious"]
    runoff_coefficient = pervious + (impervious - pervious) * paved
    intercepted_m3 = crown_area_m2 * rainfall * intercept
    avoided_m3 = intercepted_m3 * runoff_coefficient
    return {
        "intercepted_rainfall_m3_y": intercepted_m3,
        "avoided_runoff_m3_y": avoided_m3,
        "runoff_coefficient_used": runoff_coefficient,
        "interception_fraction_used": intercept,
        "paved_fraction_used": paved,
    }


def stormwater_value_nzd(avoided_m3: float, flood_prone: bool) -> float:
    base = avoided_m3 * VALUATION_ASSUMPTIONS["stormwater_value_nzd_per_m3"]
    if flood_prone:
        return base * VALUATION_ASSUMPTIONS["flood_prone_uplift_factor"]
    return base


def cooling_value_nzd(
    crown_area_m2: float,
    air_temp_mean_c: float | None,
    paved_fraction: float | None,
) -> dict[str, float]:
    threshold = VALUATION_ASSUMPTIONS["cooling_temp_threshold_c"]
    temp_excess = max(0.0, (air_temp_mean_c or threshold) - threshold)
    temp_term = crown_area_m2 * temp_excess * VALUATION_ASSUMPTIONS["cooling_value_nzd_per_m2_per_degree"]
    paved = paved_fraction if paved_fraction is not None and 0.0 <= paved_fraction <= 1.0 else 0.35
    paved_term = crown_area_m2 * paved * VALUATION_ASSUMPTIONS["cooling_paved_value_nzd_per_m2_paved_fraction"]
    return {
        "cooling_value_nzd_y_temp": temp_term,
        "cooling_value_nzd_y_paved": paved_term,
        "cooling_value_nzd_y_total": temp_term + paved_term,
        "temp_excess_c": temp_excess,
    }


def air_quality_value_nzd(crown_area_m2: float, klass: str) -> dict[str, float]:
    lai = lai_for_class(klass)
    pm25_kg = crown_area_m2 * lai * VALUATION_ASSUMPTIONS["pm25_removal_rate_kg_per_m2_lai_per_year"]
    return {
        "lai_used": lai,
        "pm25_removed_kg_y": pm25_kg,
        "pm25_value_nzd_y": pm25_kg * VALUATION_ASSUMPTIONS["pm25_value_nzd_per_kg"],
    }


def load_inputs() -> list[dict[str, Any]]:
    conn = sqlite3.connect(SQLITE_PATH)
    conn.row_factory = sqlite3.Row
    try:
        has_predictions = conn.execute(
            "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='tree_species_class_predictions'"
        ).fetchone()[0]
        pred_join = (
            "LEFT JOIN tree_species_class_predictions p ON p.tree_id = c.tree_id"
            if has_predictions
            else ""
        )
        pred_cols = (
            ", p.predicted_species_class AS ml_species_class, p.species_class_confidence AS ml_species_class_confidence"
            if has_predictions
            else ", NULL AS ml_species_class, NULL AS ml_species_class_confidence"
        )
        # Use the Auckland Council 2017 impervious-surface fraction when
        # available — much sharper than the 240 m heat-grid paved fraction.
        has_impervious = conn.execute(
            "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='tree_impervious_pilot'"
        ).fetchone()[0]
        imperv_join = (
            "LEFT JOIN tree_impervious_pilot imp ON imp.tree_id = c.tree_id"
            if has_impervious
            else ""
        )
        imperv_cols = (
            ", imp.fraction_impervious_30m AS imperv_fraction_30m"
            if has_impervious
            else ", NULL AS imperv_fraction_30m"
        )
        rows = conn.execute(
            f"""
            SELECT
                t.tree_id,
                t.source_primary,
                t.source_tree_id,
                t.species_common, t.species_latin, t.owner_class,
                t.is_protected_notable, t.lon, t.lat,
                c.crown_area_m2, c.crown_diameter_m,
                c.crown_mean_chm_m, c.crown_max_chm_m,
                ctx.in_flood_plain, ctx.in_flood_prone_area,
                ctx.flood_prone_max_depth_m, ctx.dist_overland_flow_path_m,
                ctx.dist_stormwater_pipe_m, ctx.dist_stormwater_catchpit_m,
                ctx.dist_stormwater_manhole_m, ctx.dist_stormwater_inlet_outlet_m,
                ctx.air_temp_mean_c, ctx.air_temp_max_c,
                ctx.fraction_paved_surfaces, ctx.fraction_buildings,
                ctx.fraction_trees
                {pred_cols}
                {imperv_cols}
            FROM tree_crown_pilot c
            JOIN trees t ON t.tree_id = c.tree_id
            LEFT JOIN tree_context_pilot ctx ON ctx.tree_id = c.tree_id
            {pred_join}
            {imperv_join}
            """
        ).fetchall()
    finally:
        conn.close()
    return [dict(row) for row in rows]


def compute_tree_valuation(row: dict[str, Any]) -> dict[str, Any]:
    source_primary = row.get("source_primary") or ""
    is_inferred = source_primary == "lidar_inferred_canopy"
    ml_klass = row.get("ml_species_class")
    ml_klass_conf = row.get("ml_species_class_confidence")
    if is_inferred and ml_klass in {"evergreen_broadleaf", "deciduous_broadleaf", "conifer", "palm_other"}:
        klass = ml_klass
        species_class_source = "stage3_cnn_growth_form_prediction"
    else:
        klass = species_class(row.get("species_common"), row.get("species_latin"))
        species_class_source = "rule_keyword_from_council_name"
    # The legacy species coefficient table is disabled because its equation
    # and citation mappings have not been independently reproduced.
    species_entry = None
    species_allometry_source = "unverified_internal_class_coefficient_sensitivity"
    height = row.get("crown_max_chm_m") or 0.0
    crown_area = row.get("crown_area_m2") or 0.0
    flood_prone = bool(row.get("in_flood_prone_area") or row.get("in_flood_plain"))
    # Prefer the 1 m Auckland Council impervious raster when we have a per-
    # tree sample; fall back to the heat-grid paved fraction otherwise.
    imperv_30m = row.get("imperv_fraction_30m")
    paved_fraction = imperv_30m if imperv_30m is not None else row.get("fraction_paved_surfaces")
    paved_fraction_source = (
        "auckland_impervious_2017_30m" if imperv_30m is not None
        else ("heat_grid_240m" if row.get("fraction_paved_surfaces") is not None else "default_0.35")
    )
    air_temp_mean = row.get("air_temp_mean_c")

    carbon = carbon_components(height, klass, species_entry=species_entry)
    storm = avoided_runoff_m3(crown_area, klass, paved_fraction)
    storm_nzd = stormwater_value_nzd(storm["avoided_runoff_m3_y"], flood_prone)
    cooling = cooling_value_nzd(crown_area, air_temp_mean, paved_fraction)
    air = air_quality_value_nzd(crown_area, klass)
    carbon_annual_nzd = carbon["annual_sequestration_tco2e_y_est"] * VALUATION_ASSUMPTIONS["carbon_price_nzd_per_tco2e"]
    carbon_stored_nzd = carbon["stored_co2e_tonnes_est"] * VALUATION_ASSUMPTIONS["carbon_price_nzd_per_tco2e"]
    total_annual_nzd = carbon_annual_nzd + storm_nzd + cooling["cooling_value_nzd_y_total"] + air["pm25_value_nzd_y"]

    if is_inferred:
        # The current CNN score is not calibrated as a probability and cannot
        # upgrade valuation confidence. All remotely inferred records remain low.
        confidence = "modelled_low"
    elif paved_fraction is not None and air_temp_mean is not None:
        confidence = "modelled_medium"
    else:
        confidence = "modelled_low"
    # Uncertainty bands: each confidence class corresponds to a ± multiplier.
    # modelled_medium ≈ ±30%, modelled_low ≈ ±60%. These are planning-grade
    # bounds, not statistical CIs.
    uncertainty_factor = 0.30 if confidence == "modelled_medium" else 0.60
    return {
        "tree_id": row["tree_id"],
        "species_class": klass,
        "species_class_source": species_class_source,
        "species_class_confidence_ml": float(ml_klass_conf) if ml_klass_conf is not None else None,
        "species_allometry_source": species_allometry_source,
        "paved_fraction_source": paved_fraction_source,
        "uncertainty_factor": uncertainty_factor,
        "crown_area_m2": crown_area,
        "crown_max_chm_m": height,
        "in_flood_prone_area": int(flood_prone),
        "paved_fraction_used": storm["paved_fraction_used"],
        "interception_fraction_used": storm["interception_fraction_used"],
        "runoff_coefficient_used": storm["runoff_coefficient_used"],
        "intercepted_rainfall_m3_y": storm["intercepted_rainfall_m3_y"],
        "avoided_runoff_m3_y": storm["avoided_runoff_m3_y"],
        "stormwater_value_nzd_y": storm_nzd,
        "dbh_cm_est": carbon["dbh_cm_est"],
        "agb_kg_est": carbon["agb_kg_est"],
        "bgb_kg_est": carbon["bgb_kg_est"],
        "carbon_kg_est": carbon["carbon_kg_est"],
        "stored_co2e_tonnes_est": carbon["stored_co2e_tonnes_est"],
        "annual_sequestration_tco2e_y_est": carbon["annual_sequestration_tco2e_y_est"],
        "carbon_value_nzd_stored": carbon_stored_nzd,
        "carbon_value_nzd_y": carbon_annual_nzd,
        "cooling_value_nzd_y_temp": cooling["cooling_value_nzd_y_temp"],
        "cooling_value_nzd_y_paved": cooling["cooling_value_nzd_y_paved"],
        "cooling_value_nzd_y": cooling["cooling_value_nzd_y_total"],
        "lai_used": air["lai_used"],
        "pm25_removed_kg_y": air["pm25_removed_kg_y"],
        "air_quality_value_nzd_y": air["pm25_value_nzd_y"],
        "total_value_nzd_y": total_annual_nzd,
        "total_value_nzd_y_low": total_annual_nzd * (1 - uncertainty_factor),
        "total_value_nzd_y_high": total_annual_nzd * (1 + uncertainty_factor),
        "valuation_confidence": confidence,
        "method_id": VALUATION_ASSUMPTIONS["method_id"],
    }


def write_sqlite(values: list[dict[str, Any]]) -> None:
    conn = sqlite3.connect(SQLITE_PATH)
    try:
        conn.execute("DROP TABLE IF EXISTS tree_valuation_pilot")
        conn.execute(
            """
            CREATE TABLE tree_valuation_pilot (
                tree_id TEXT PRIMARY KEY,
                species_class TEXT,
                species_class_source TEXT,
                species_class_confidence_ml REAL,
                species_allometry_source TEXT,
                paved_fraction_source TEXT,
                crown_area_m2 REAL,
                crown_max_chm_m REAL,
                in_flood_prone_area INTEGER,
                paved_fraction_used REAL,
                interception_fraction_used REAL,
                runoff_coefficient_used REAL,
                intercepted_rainfall_m3_y REAL,
                avoided_runoff_m3_y REAL,
                stormwater_value_nzd_y REAL,
                dbh_cm_est REAL,
                agb_kg_est REAL,
                bgb_kg_est REAL,
                carbon_kg_est REAL,
                stored_co2e_tonnes_est REAL,
                annual_sequestration_tco2e_y_est REAL,
                carbon_value_nzd_stored REAL,
                carbon_value_nzd_y REAL,
                cooling_value_nzd_y_temp REAL,
                cooling_value_nzd_y_paved REAL,
                cooling_value_nzd_y REAL,
                lai_used REAL,
                pm25_removed_kg_y REAL,
                air_quality_value_nzd_y REAL,
                total_value_nzd_y REAL,
                total_value_nzd_y_low REAL,
                total_value_nzd_y_high REAL,
                uncertainty_factor REAL,
                valuation_confidence TEXT,
                method_id TEXT,
                assumptions_json TEXT,
                created_at_utc TEXT
            )
            """
        )
        created = utc_now()
        assumptions_json = json.dumps(VALUATION_ASSUMPTIONS)
        columns = [
            "tree_id",
            "species_class",
            "species_class_source",
            "species_class_confidence_ml",
            "species_allometry_source",
            "paved_fraction_source",
            "uncertainty_factor",
            "crown_area_m2",
            "crown_max_chm_m",
            "in_flood_prone_area",
            "paved_fraction_used",
            "interception_fraction_used",
            "runoff_coefficient_used",
            "intercepted_rainfall_m3_y",
            "avoided_runoff_m3_y",
            "stormwater_value_nzd_y",
            "dbh_cm_est",
            "agb_kg_est",
            "bgb_kg_est",
            "carbon_kg_est",
            "stored_co2e_tonnes_est",
            "annual_sequestration_tco2e_y_est",
            "carbon_value_nzd_stored",
            "carbon_value_nzd_y",
            "cooling_value_nzd_y_temp",
            "cooling_value_nzd_y_paved",
            "cooling_value_nzd_y",
            "lai_used",
            "pm25_removed_kg_y",
            "air_quality_value_nzd_y",
            "total_value_nzd_y",
            "total_value_nzd_y_low",
            "total_value_nzd_y_high",
            "valuation_confidence",
            "method_id",
        ]
        conn.executemany(
            f"INSERT INTO tree_valuation_pilot ({', '.join(columns)}, assumptions_json, created_at_utc) "
            f"VALUES ({', '.join('?' for _ in columns)}, ?, ?)",
            [
                tuple(value[column] for column in columns) + (assumptions_json, created)
                for value in values
            ],
        )
        conn.execute("CREATE INDEX idx_tree_valuation_total ON tree_valuation_pilot(total_value_nzd_y)")
        conn.execute("CREATE INDEX idx_tree_valuation_carbon ON tree_valuation_pilot(stored_co2e_tonnes_est)")
        conn.commit()
    finally:
        conn.close()


def write_services_csv(values: list[dict[str, Any]]) -> None:
    out_path = PROCESSED_ROOT / "tree_services_pilot.csv"
    fieldnames = [
        "tree_id",
        "service",
        "physical_quantity",
        "physical_unit",
        "value_nzd_y",
        "confidence",
        "method_id",
    ]
    with out_path.open("w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        for value in values:
            confidence = value["valuation_confidence"]
            method = value["method_id"]
            writer.writerow(
                {
                    "tree_id": value["tree_id"],
                    "service": "carbon_storage",
                    "physical_quantity": round(value["stored_co2e_tonnes_est"], 4),
                    "physical_unit": "tCO2e",
                    "value_nzd_y": round(value["carbon_value_nzd_y"], 2),
                    "confidence": confidence,
                    "method_id": f"{method}__carbon_height_dbh_proxy_allometry",
                }
            )
            writer.writerow(
                {
                    "tree_id": value["tree_id"],
                    "service": "avoided_runoff",
                    "physical_quantity": round(value["avoided_runoff_m3_y"], 3),
                    "physical_unit": "m3/year",
                    "value_nzd_y": round(value["stormwater_value_nzd_y"], 2),
                    "confidence": confidence,
                    "method_id": f"{method}__interception_paved_runoff",
                }
            )
            writer.writerow(
                {
                    "tree_id": value["tree_id"],
                    "service": "cooling_proxy",
                    "physical_quantity": round(value["crown_area_m2"], 2),
                    "physical_unit": "m2 crown area",
                    "value_nzd_y": round(value["cooling_value_nzd_y"], 2),
                    "confidence": confidence,
                    "method_id": f"{method}__cooling_temp_paved_weight",
                }
            )
            writer.writerow(
                {
                    "tree_id": value["tree_id"],
                    "service": "air_quality_pm25",
                    "physical_quantity": round(value["pm25_removed_kg_y"], 4),
                    "physical_unit": "kg PM2.5/year",
                    "value_nzd_y": round(value["air_quality_value_nzd_y"], 2),
                    "confidence": confidence,
                    "method_id": f"{method}__lai_pm25_dry_deposition",
                }
            )


def _round_floats(obj: Any, decimals: int = 2) -> Any:
    if isinstance(obj, float):
        return round(obj, decimals)
    if isinstance(obj, list):
        return [_round_floats(item, decimals) for item in obj]
    if isinstance(obj, dict):
        return {k: _round_floats(v, decimals) for k, v in obj.items()}
    return obj


def update_map_geojson(values: list[dict[str, Any]]) -> None:
    by_tree = {v["tree_id"]: v for v in values}
    enrich_keys = [
        "species_class",
        "crown_area_m2",
        "crown_max_chm_m",
        "in_flood_prone_area",
        "paved_fraction_used",
        "avoided_runoff_m3_y",
        "stormwater_value_nzd_y",
        "stored_co2e_tonnes_est",
        "annual_sequestration_tco2e_y_est",
        "carbon_value_nzd_y",
        "carbon_value_nzd_stored",
        "cooling_value_nzd_y",
        "lai_used",
        "pm25_removed_kg_y",
        "air_quality_value_nzd_y",
        "total_value_nzd_y",
        "valuation_confidence",
    ]
    for filename in ("trees_map_points.geojson", "tree_crowns_pilot.geojson"):
        path = PROCESSED_ROOT / filename
        if not path.exists():
            continue
        data = json.loads(path.read_text(encoding="utf-8"))
        for feature in data.get("features", []):
            tree_id = feature.get("id") or feature.get("properties", {}).get("tree_id")
            valuation = by_tree.get(tree_id)
            props = feature.setdefault("properties", {})
            if valuation:
                if filename == "trees_map_points.geojson":
                    props["crown_pilot"] = 1 if valuation["crown_area_m2"] else 0
                for key in enrich_keys:
                    value = valuation.get(key)
                    if isinstance(value, float):
                        value = round(value, 2)
                    props[key] = value
            # Drop nulls/empty strings to shrink browser payload.
            feature["properties"] = {
                k: v for k, v in props.items() if v not in (None, "")
            }
            # Round coordinates to ~10 cm precision.
            geom = feature.get("geometry") or {}
            if geom.get("coordinates") is not None:
                geom["coordinates"] = _round_floats(geom["coordinates"], 6)
        path.write_text(json.dumps(data, separators=(",", ":")), encoding="utf-8")


def write_report(values: list[dict[str, Any]]) -> None:
    if not values:
        return
    total = len(values)
    sum_total = sum(v["total_value_nzd_y"] for v in values)
    sum_storm = sum(v["stormwater_value_nzd_y"] for v in values)
    sum_cool = sum(v["cooling_value_nzd_y"] for v in values)
    sum_air = sum(v["air_quality_value_nzd_y"] for v in values)
    sum_carbon_y = sum(v["carbon_value_nzd_y"] for v in values)
    sum_stored = sum(v["stored_co2e_tonnes_est"] for v in values)
    sum_seq = sum(v["annual_sequestration_tco2e_y_est"] for v in values)
    sum_pm25 = sum(v["pm25_removed_kg_y"] for v in values)
    sum_avoided_runoff = sum(v["avoided_runoff_m3_y"] for v in values)

    lines = [
        "# Tree ecosystem-service sensitivity scenarios",
        "",
        f"Generated at: {utc_now()}",
        "",
        "These are exploratory sensitivity scenarios, not validated physical or economic estimates. They combine:",
        "",
        "- CHM-derived height per tree, fed through species-class allometry for carbon storage and annual sequestration.",
        "- Crown area combined with species-class rainfall interception, Auckland average annual rainfall, and a local runoff coefficient derived from Auckland Council 2017 impervious-surface fraction in a 30 m tree window, with heat-grid paved fraction as fallback.",
        "- A flood-prone uplift factor for trees whose crowns intersect mapped flood-prone or flood-plain polygons.",
        "- A cooling proxy weighted by the local mean air temperature (excess above 18 °C) and impervious/paved-surface fraction.",
        "- A first-pass PM2.5 dry-deposition removal estimate via species-class leaf area index.",
        "",
        "Confidence is `modelled_medium` for trees with both paved fraction and air temperature context; `modelled_low` where context is missing. Confidence is never `observed` because no field-measured DBH, leaf area, or stem density feeds into the pilot.",
        "",
        "## Scenario totals (not release claims)",
        "",
        f"- Trees valued: {total:,}.",
        f"- Stored carbon (estimated): {sum_stored:,.0f} tCO₂e.",
        f"- Annual sequestration (estimated): {sum_seq:,.0f} tCO₂e/year.",
        f"- Carbon value: NZD {sum_carbon_y:,.0f}/year (annual sequestration only).",
        f"- Avoided runoff: {sum_avoided_runoff:,.0f} m³/year.",
        f"- Stormwater value: NZD {sum_storm:,.0f}/year (flood-prone uplift applied).",
        f"- Cooling proxy value: NZD {sum_cool:,.0f}/year.",
        f"- Air-quality (PM2.5 removal): {sum_pm25:,.1f} kg/year, NZD {sum_air:,.0f}/year.",
        f"- **Total annual sensitivity scenario:** NZD {sum_total:,.0f}/year.",
        "",
        "## Headline Assumptions",
        "",
        "```json",
        json.dumps(VALUATION_ASSUMPTIONS, indent=2),
        "```",
        "",
        "## Limitations to Resolve Next",
        "",
        "1. Replace H→DBH allometry with species-specific local equations (NZ urban tree inventories or i-Tree Eco's DBH module).",
        "2. Replace constant annual rainfall with gridded or gauge-based Auckland rainfall.",
        "3. Replace `NZD/m³` stormwater value with a council-approved avoided-treatment/storage marginal cost.",
        "4. Replace cooling proxy with energy savings, pavement-life, and health-pathway components rather than a single NZD/m²/°C term.",
        "5. Add observed DBH and condition fields when Auckland Council asset records are released, and downgrade `modelled_*` confidences to `observed` wherever applicable.",
        "",
        "## Outputs",
        "",
        "- `data/processed/akl_trees.sqlite`, table `tree_valuation_pilot`",
        "- `data/processed/tree_services_pilot.csv` (long format: one row per service per tree)",
        "",
    ]
    (DOCS_ROOT / "tree_valuation_pilot.md").write_text("\n".join(lines), encoding="utf-8")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--skip-geojson", action="store_true",
                        help="update SQLite/report only; defer multi-GB map GeoJSON rewrite")
    parser.add_argument("--skip-services-csv", action="store_true",
                        help="defer the long-format service CSV rewrite")
    args = parser.parse_args()
    rows = load_inputs()
    print(f"Loaded {len(rows):,} crown rows for valuation")
    values = [compute_tree_valuation(row) for row in rows]
    write_sqlite(values)
    if not args.skip_services_csv:
        write_services_csv(values)
    if not args.skip_geojson:
        update_map_geojson(values)
    write_report(values)
    if values:
        summary = {
            "trees": len(values),
            "total_value_nzd_y": round(sum(v["total_value_nzd_y"] for v in values), 2),
            "stored_co2e_tonnes": round(sum(v["stored_co2e_tonnes_est"] for v in values), 2),
            "annual_seq_tco2e_y": round(sum(v["annual_sequestration_tco2e_y_est"] for v in values), 2),
        }
        print(json.dumps(summary, indent=2))


if __name__ == "__main__":
    main()
