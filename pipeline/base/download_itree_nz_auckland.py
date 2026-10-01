#!/usr/bin/env python3
"""Download public i-Tree Database API data relevant to New Zealand/Auckland."""

from __future__ import annotations

import csv
import hashlib
import json
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path


BASE = "https://database.itreetools.org/ls"
DEFAULT_OUT = Path("/data/alto/itree_database_2026-06-19")

NZ_ID = 153
AUCKLAND_REGION_ID = 62969
AUCKLAND_DISTRICT_ID = 62970
AUCKLAND_CITY_ID = 62971
AUCKLAND_IDS = [AUCKLAND_REGION_ID, AUCKLAND_DISTRICT_ID, AUCKLAND_CITY_ID]

NZ_BBOX = {"min_lat": -48.0, "max_lat": -33.0, "min_lon": 165.0, "max_lon": 180.0}
AUCKLAND_BBOX = {"min_lat": -37.5, "max_lat": -36.0, "min_lon": 174.0, "max_lon": 176.0}


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def api_url(path: str, params: dict | None = None) -> str:
    url = f"{BASE}/{path.lstrip('/')}"
    if params:
        url = f"{url}?{urllib.parse.urlencode(params, doseq=True)}"
    return url


def ensure_dirs(out_dir: Path) -> dict[str, Path]:
    dirs = {
        "raw": out_dir / "raw",
        "raw_locations": out_dir / "raw" / "locations",
        "raw_lookups": out_dir / "raw" / "lookups",
        "raw_species": out_dir / "raw" / "species",
        "raw_stations": out_dir / "raw" / "stations",
        "raw_station_years": out_dir / "raw" / "station_data_years",
        "raw_weather": out_dir / "raw" / "weather_details_global_by_year",
        "derived": out_dir / "derived",
    }
    for d in dirs.values():
        d.mkdir(parents=True, exist_ok=True)
    return dirs


class Downloader:
    def __init__(self, out_dir: Path):
        self.out_dir = out_dir
        self.dirs = ensure_dirs(out_dir)
        self.manifest: list[dict] = []

    def fetch_json(self, url: str, dest: Path, required: bool = True):
        dest.parent.mkdir(parents=True, exist_ok=True)
        record = {"url": url, "path": str(dest), "fetched_at": utc_now()}
        request = urllib.request.Request(url, headers={"User-Agent": "AKL-trees-iTree-downloader/1.0"})
        try:
            with urllib.request.urlopen(request, timeout=180) as response:
                body = response.read()
                record.update(
                    {
                        "status": response.status,
                        "content_type": response.headers.get("content-type"),
                        "bytes": len(body),
                        "sha256": hashlib.sha256(body).hexdigest(),
                    }
                )
        except urllib.error.HTTPError as exc:
            body = exc.read()
            record.update(
                {
                    "status": exc.code,
                    "content_type": exc.headers.get("content-type"),
                    "bytes": len(body),
                    "sha256": hashlib.sha256(body).hexdigest(),
                    "error": str(exc),
                }
            )
            if required:
                self.manifest.append(record)
                raise
        except Exception as exc:
            record.update({"error": repr(exc)})
            self.manifest.append(record)
            if required:
                raise
            return None

        dest.write_bytes(body)
        self.manifest.append(record)
        if record.get("status") != 200:
            return None
        return json.loads(body.decode("utf-8-sig"))

    def save_manifest(self):
        manifest = {
            "created_at": utc_now(),
            "source": "https://database.itreetools.org/",
            "api_base": BASE,
            "scope": {
                "new_zealand_location_id": NZ_ID,
                "auckland_region_id": AUCKLAND_REGION_ID,
                "auckland_district_id": AUCKLAND_DISTRICT_ID,
                "auckland_city_id": AUCKLAND_CITY_ID,
                "nz_bbox": NZ_BBOX,
                "auckland_bbox": AUCKLAND_BBOX,
            },
            "requests": self.manifest,
        }
        (self.out_dir / "manifest.json").write_text(json.dumps(manifest, indent=2, ensure_ascii=False) + "\n")


def in_bbox(row: dict, bbox: dict[str, float]) -> bool:
    try:
        lat = float(row.get("Latitude"))
        lon = float(row.get("Longitude"))
    except (TypeError, ValueError):
        return False
    return bbox["min_lat"] <= lat <= bbox["max_lat"] and bbox["min_lon"] <= lon <= bbox["max_lon"]


def flatten_locations(nodes: list[dict], parent: dict | None = None, path: list[dict] | None = None) -> list[dict]:
    rows: list[dict] = []
    path = path or []
    for node in nodes:
        children = node.get("Children") or []
        bare = {k: v for k, v in node.items() if k != "Children"}
        node_path = path + [bare]
        row = dict(bare)
        row["ParentId"] = parent.get("Id") if parent else None
        row["ParentGuid"] = parent.get("Guid") if parent else None
        row["ParentName"] = parent.get("Name") if parent else None
        row["ParentType"] = parent.get("Type") if parent else None
        row["Level"] = len(path)
        row["PathIds"] = " > ".join(str(p.get("Id")) for p in node_path)
        row["PathNames"] = " > ".join(str(p.get("Name")) for p in node_path)
        row["PathTypes"] = " > ".join(str(p.get("Type")) for p in node_path)
        row["ChildCount"] = len(children)
        rows.append(row)
        rows.extend(flatten_locations(children, bare, node_path))
    return rows


def write_csv(path: Path, rows: list[dict], fieldnames: list[str] | None = None):
    path.parent.mkdir(parents=True, exist_ok=True)
    if fieldnames is None:
        keys: list[str] = []
        seen = set()
        for row in rows:
            for key in row:
                if key not in seen:
                    seen.add(key)
                    keys.append(key)
        fieldnames = keys
    with path.open("w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames, extrasaction="ignore")
        writer.writeheader()
        for row in rows:
            clean = {}
            for key in fieldnames:
                value = row.get(key)
                if isinstance(value, list):
                    value = " | ".join(str(v) for v in value)
                elif isinstance(value, dict):
                    value = json.dumps(value, ensure_ascii=False, sort_keys=True)
                clean[key] = value
            writer.writerow(clean)


def count_by(rows: list[dict], key: str) -> dict[str, int]:
    counts: dict[str, int] = {}
    for row in rows:
        val = str(row.get(key))
        counts[val] = counts.get(val, 0) + 1
    return dict(sorted(counts.items()))


def download(out_dir: Path, include_weather: bool = False):
    dl = Downloader(out_dir)
    raw = dl.dirs["raw"]
    derived = dl.dirs["derived"]

    print(f"Writing i-Tree data to {out_dir}")

    lookups = {
        "climate_regions": api_url("climateRegions"),
        "location_types": api_url("locationTypes"),
        "timezones": api_url("timezones"),
        "growth_forms": api_url("Growthforms"),
        "percent_leaf_types": api_url("PercentLeafTypes"),
        "leaf_types": api_url("LeafTypes"),
        "growth_rates": api_url("Growthrates"),
        "longevities": api_url("Longevities"),
        "weather_years": api_url("weather/years"),
        "pollution_years": api_url("pollution/years"),
        "precipitation_data_years": api_url("PrecipitationData/Years"),
    }
    lookup_data = {}
    for name, url in lookups.items():
        print(f"lookup: {name}")
        lookup_data[name] = dl.fetch_json(url, dl.dirs["raw_lookups"] / f"{name}.json", required=False)

    print("species: full public species list")
    species = dl.fetch_json(api_url("Taxa/Species"), dl.dirs["raw_species"] / "taxa_species.json") or []
    species_rows = []
    for row in species:
        item = dict(row)
        item["Synonyms"] = item.get("Synonyms") or []
        species_rows.append(item)
    write_csv(derived / "itree_species_all.csv", species_rows)

    print("locations: global nations and New Zealand hierarchy")
    nations = dl.fetch_json(api_url("locations", {"type": "Nation"}), dl.dirs["raw_locations"] / "locations_type_nation.json") or []
    regions = dl.fetch_json(api_url("locations", {"type": "Region"}), dl.dirs["raw_locations"] / "locations_type_region.json", required=False) or []
    nz_children = dl.fetch_json(api_url(f"locations/{NZ_ID}/Children"), dl.dirs["raw_locations"] / "new_zealand_children.json") or []
    nz_desc = dl.fetch_json(api_url(f"locations/{NZ_ID}/Descendants"), dl.dirs["raw_locations"] / "new_zealand_descendants.json") or []
    nz_node = [row for row in nations if row.get("Id") == NZ_ID]
    nz_flat = flatten_locations(nz_node + nz_desc)
    write_csv(derived / "new_zealand_locations_flat.csv", nz_flat)

    auckland_desc_by_id = {}
    for loc_id in [NZ_ID, *AUCKLAND_IDS]:
        loc_dir = dl.dirs["raw_locations"] / str(loc_id)
        for endpoint in ["Parents", "Children", "Descendants", "FullName", "EnvironmentalEffects", "StateLat", "Currency"]:
            data = dl.fetch_json(api_url(f"locations/{loc_id}/{endpoint}"), loc_dir / f"{endpoint}.json", required=False)
            if loc_id in AUCKLAND_IDS and endpoint == "Descendants":
                auckland_desc_by_id[loc_id] = data or []

    by_id = {row.get("Id"): row for row in nz_flat}
    auckland_roots = [by_id[i] for i in AUCKLAND_IDS if i in by_id]
    region_desc = auckland_desc_by_id.get(AUCKLAND_REGION_ID) or []
    auckland_flat = flatten_locations(auckland_roots[:1] + region_desc)
    write_csv(derived / "auckland_locations_flat.csv", auckland_flat)

    guid_to_location = {row.get("Guid"): row for row in nz_flat if row.get("Guid")}

    print("stations: pollutant and precipitation station metadata")
    pollutant_stations = dl.fetch_json(api_url("PollutantStations"), dl.dirs["raw_stations"] / "pollutant_stations_all.json") or []
    pollutant_contributed = dl.fetch_json(
        api_url("PollutantStations", {"IsContributed": "true"}),
        dl.dirs["raw_stations"] / "pollutant_stations_is_contributed_true.json",
        required=False,
    ) or []
    precipitation_stations = dl.fetch_json(api_url("PrecipitationStations"), dl.dirs["raw_stations"] / "precipitation_stations_all.json") or []

    def enrich_station(row: dict) -> dict:
        item = dict(row)
        location = guid_to_location.get(item.get("LocationGuid"))
        if location:
            item["LocationId"] = location.get("Id")
            item["LocationName"] = location.get("Name")
            item["LocationType"] = location.get("Type")
            item["LocationPathNames"] = location.get("PathNames")
            item["LocationPathTypes"] = location.get("PathTypes")
        return item

    pollutant_nz = [enrich_station(r) for r in pollutant_stations if in_bbox(r, NZ_BBOX)]
    pollutant_akl = [enrich_station(r) for r in pollutant_stations if in_bbox(r, AUCKLAND_BBOX)]
    precip_nz = [dict(r) for r in precipitation_stations if in_bbox(r, NZ_BBOX)]
    precip_akl = [dict(r) for r in precipitation_stations if in_bbox(r, AUCKLAND_BBOX)]

    print(f"pollutant stations: NZ {len(pollutant_nz)}, Auckland bbox {len(pollutant_akl)}")
    print(f"precipitation stations: NZ {len(precip_nz)}, Auckland bbox {len(precip_akl)}")

    station_years = {}
    for row in pollutant_nz:
        guid = row.get("Guid")
        if not guid:
            continue
        data = dl.fetch_json(
            api_url(f"PollutantStations/{guid}/DataYears"),
            dl.dirs["raw_station_years"] / "pollutant" / f"{guid}.json",
            required=False,
        )
        station_years[guid] = data or []
        time.sleep(0.03)
    for row in pollutant_nz:
        row["DataYears"] = station_years.get(row.get("Guid"), [])
    for row in pollutant_akl:
        row["DataYears"] = station_years.get(row.get("Guid"), [])

    precip_years = {}
    for row in precipitation_stations:
        guid = row.get("Guid")
        if not guid:
            continue
        data = dl.fetch_json(
            api_url(f"PrecipitationStations/{guid}/DataYears"),
            dl.dirs["raw_station_years"] / "precipitation" / f"{guid}.json",
            required=False,
        )
        precip_years[guid] = data or []
        time.sleep(0.03)
    for row in precip_nz:
        row["DataYears"] = precip_years.get(row.get("Guid"), [])
    for row in precip_akl:
        row["DataYears"] = precip_years.get(row.get("Guid"), [])

    write_csv(derived / "new_zealand_pollutant_stations.csv", pollutant_nz)
    write_csv(derived / "auckland_pollutant_stations.csv", pollutant_akl)
    write_csv(derived / "new_zealand_precipitation_stations.csv", precip_nz)
    write_csv(derived / "auckland_precipitation_stations.csv", precip_akl)
    write_csv(derived / "pollutant_stations_all_nz_bbox.csv", pollutant_nz)

    weather_nz_all = []
    weather_akl_all = []
    weather_years = lookup_data.get("weather_years") or []
    if include_weather:
        print("weather station details: download all public years and filter to NZ/Auckland")
        for year in weather_years:
            print(f"weather details year: {year}")
            year_rows = dl.fetch_json(
                api_url("weather/details", {"year": year}),
                dl.dirs["raw_weather"] / f"weather_details_{year}.json",
                required=False,
            )
            if not isinstance(year_rows, list):
                year_rows = []
            nz_rows = [dict(r) for r in year_rows if in_bbox(r, NZ_BBOX)]
            akl_rows = [dict(r) for r in year_rows if in_bbox(r, AUCKLAND_BBOX)]
            weather_nz_all.extend(nz_rows)
            weather_akl_all.extend(akl_rows)
            write_csv(derived / "weather_details_by_year" / f"new_zealand_weather_details_{year}.csv", nz_rows)
            write_csv(derived / "weather_details_by_year" / f"auckland_weather_details_{year}.csv", akl_rows)
            time.sleep(0.05)

        write_csv(derived / "new_zealand_weather_details_all_years.csv", weather_nz_all)
        write_csv(derived / "auckland_weather_details_all_years.csv", weather_akl_all)
    else:
        print("weather station details: skipped; rerun with --include-weather to download")

    summary = {
        "created_at": utc_now(),
        "output_dir": str(out_dir),
        "counts": {
            "species_all": len(species_rows),
            "nations_all": len(nations),
            "regions_all": len(regions),
            "new_zealand_children": len(nz_children),
            "new_zealand_locations_flat": len(nz_flat),
            "auckland_locations_flat": len(auckland_flat),
            "pollutant_stations_all": len(pollutant_stations),
            "pollutant_stations_is_contributed_true": len(pollutant_contributed),
            "new_zealand_pollutant_stations": len(pollutant_nz),
            "auckland_pollutant_stations": len(pollutant_akl),
            "precipitation_stations_all": len(precipitation_stations),
            "new_zealand_precipitation_stations": len(precip_nz),
            "auckland_precipitation_stations": len(precip_akl),
            "weather_details_new_zealand_all_years": len(weather_nz_all),
            "weather_details_auckland_all_years": len(weather_akl_all),
        },
        "new_zealand_location_type_counts": count_by(nz_flat, "Type"),
        "auckland_location_type_counts": count_by(auckland_flat, "Type"),
        "notes": [
            "Raw API responses are under raw/.",
            "CSV extracts are under derived/.",
            "Weather details endpoints are global station/year metadata and are skipped by default; rerun with --include-weather to download coordinate-filtered CSV extracts.",
            "Pollutant/precipitation station endpoint parameters did not filter by location, so station CSVs are coordinate-filtered and pollutant stations are enriched with NZ location hierarchy where LocationGuid matches.",
            "No public endpoint was found for full hourly pollution, precipitation, or weather measurements; exposed endpoints provide station metadata and available years.",
        ],
    }
    (out_dir / "summary.json").write_text(json.dumps(summary, indent=2, ensure_ascii=False) + "\n")

    readme = f"""# i-Tree Database API extract: New Zealand / Auckland

Created: {summary['created_at']}

Source site: https://database.itreetools.org/

## Scope

- New Zealand location id: `{NZ_ID}`
- Auckland region id: `{AUCKLAND_REGION_ID}`
- Auckland district id: `{AUCKLAND_DISTRICT_ID}`
- Auckland city id: `{AUCKLAND_CITY_ID}`
- NZ coordinate filter: `{NZ_BBOX}`
- Auckland coordinate filter: `{AUCKLAND_BBOX}`

## Contents

- `raw/`: direct API responses.
- `derived/new_zealand_locations_flat.csv`: flattened NZ location hierarchy.
- `derived/auckland_locations_flat.csv`: flattened Auckland location hierarchy.
- `derived/itree_species_all.csv`: full public species list from `Taxa/Species`.
- `derived/new_zealand_pollutant_stations.csv`: NZ pollutant stations with available data years.
- `derived/auckland_pollutant_stations.csv`: Auckland pollutant stations with available data years.
- `derived/new_zealand_weather_details_all_years.csv`: NZ weather station/year metadata.
- `derived/auckland_weather_details_all_years.csv`: Auckland weather station/year metadata.
- `summary.json`: counts and notes.
- `manifest.json`: URL, status, byte count, and SHA-256 for each request.

## Important caveat

The public API endpoints exposed by the i-Tree Database web app provide species,
location, station metadata, and station/year availability. I did not find a public
GET endpoint for full hourly weather, precipitation, or pollution measurements.
"""
    (out_dir / "README.md").write_text(readme)

    dl.save_manifest()
    print(json.dumps(summary["counts"], indent=2))


def main(argv: list[str]) -> int:
    include_weather = False
    args = []
    for arg in argv[1:]:
        if arg == "--include-weather":
            include_weather = True
        else:
            args.append(arg)
    out_dir = Path(args[0]).expanduser() if args else DEFAULT_OUT
    download(out_dir, include_weather=include_weather)
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
