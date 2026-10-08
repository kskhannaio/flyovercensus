"""
Generalized version of the Yeshwantpur-KR Puram corridor tree-felling analysis
(see data/elevated_corridor/corridor_tree_analysis.json and
src/proof_of_concept/gee/corridor_tree_count.py for the original single-corridor
approach), extended to run over any number of upcoming flyover/elevated-corridor
projects whose OpenCity KML gives a clean project-boundary polygon.

For each project boundary polygon (in EPSG:4326) this:
  1. Reprojects to EPSG:32643 (UTM 43N, meters - valid for Bangalore) to buffer
     in real metres rather than degrees.
  2. Computes trees within the base boundary, then within +5/+10/+15m
     cumulative buffers, spatially joined against the canonical BBMP tree
     census (data/zip_citywide/bbmp_tree_census_july_2026.geojson).
  3. Writes an analysis JSON (species/ward/status breakdowns) and a set of
     GeoJSON files (boundary, buffer rings, trees, buffer-band trees) laid out
     the same way the existing POC expects, under
     src/proof_of_concept/light/data/<slug>/.

Tree census is loaded and spatially indexed once, then reused across all
projects passed in PROJECTS below - much cheaper than re-scanning 702k trees
per project.
"""

import json
import os

import pyproj
from shapely.geometry import shape, mapping
from shapely.ops import transform, unary_union
from shapely.strtree import STRtree

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CENSUS_PATH = os.path.join(REPO_ROOT, "data/zip_citywide/bbmp_tree_census_july_2026.geojson")
POC_DATA_ROOT = os.path.join(REPO_ROOT, "src/proof_of_concept/light/data")

TO_UTM = pyproj.Transformer.from_crs("EPSG:4326", "EPSG:32643", always_xy=True).transform
TO_WGS84 = pyproj.Transformer.from_crs("EPSG:32643", "EPSG:4326", always_xy=True).transform

BUFFERS_M = (5, 10, 15)


def load_census_index():
    print(f"Loading tree census from {CENSUS_PATH} ...")
    with open(CENSUS_PATH) as f:
        census = json.load(f)
    features = census["features"]
    print(f"  {len(features)} trees loaded, reprojecting to UTM43N ...")

    geoms_utm = []
    props = []
    for feat in features:
        geom = shape(feat["geometry"])
        geoms_utm.append(transform(TO_UTM, geom))
        p = feat.get("properties", {})
        props.append(
            {
                "species": p.get("TreeName"),
                "ward": p.get("WardNumber"),
                "tree_id": p.get("KGISTreeID"),
                "status": p.get("Status"),
            }
        )
    tree = STRtree(geoms_utm)
    print("  spatial index built.")
    return tree, geoms_utm, props


def tree_feature(geom_wgs84, props, extra=None):
    p = dict(props)
    if extra:
        p.update(extra)
    return {"type": "Feature", "geometry": mapping(geom_wgs84), "properties": p}


def query_within(tree, geoms_utm, props, polygon_utm):
    # STRtree.query(geometry, predicate) tests predicate(geometry, tree_geometry)
    # - i.e. predicate="within" would ask "is the polygon within each point?"
    # (always false). "covers" is the polygon-relative-to-point form of
    # point-in-polygon, and also counts trees exactly on the boundary line.
    idxs = tree.query(polygon_utm, predicate="covers")
    return [(geoms_utm[i], props[i]) for i in idxs]


def analyze_project(name, slug, source_url, boundary_polygons_wgs84, census_index, out_root):
    tree, geoms_utm, props = census_index

    boundary_wgs84 = unary_union(boundary_polygons_wgs84)
    boundary_utm = transform(TO_UTM, boundary_wgs84)

    base_hits = query_within(tree, geoms_utm, props, boundary_utm)
    seen_ids = {id(g) for g, _ in base_hits}

    buffer_polys_utm = {d: boundary_utm.buffer(d) for d in BUFFERS_M}
    buffer_band_hits = {}  # d -> [(geom, props), ...] newly captured at this band (not in smaller bands)
    already = set(seen_ids)
    for d in BUFFERS_M:
        hits = query_within(tree, geoms_utm, props, buffer_polys_utm[d])
        band_new = [(g, p) for g, p in hits if id(g) not in already]
        buffer_band_hits[d] = band_new
        already |= {id(g) for g, _ in band_new}

    out_dir = os.path.join(out_root, slug)
    os.makedirs(out_dir, exist_ok=True)

    # boundary.geojson
    with open(os.path.join(out_dir, "corridor_boundary.geojson"), "w") as f:
        json.dump(
            {
                "type": "FeatureCollection",
                "features": [
                    {
                        "type": "Feature",
                        "geometry": mapping(boundary_wgs84),
                        "properties": {"name": name, "source": source_url},
                    }
                ],
            },
            f,
        )

    # buffers.geojson - ring outlines (buffer minus boundary, for display only;
    # kept as full buffered polygon boundary line, matching original convention
    # of storing the buffered polygon itself, not a thin ring)
    buffer_features = []
    for d in BUFFERS_M:
        poly_wgs84 = transform(TO_WGS84, buffer_polys_utm[d])
        buffer_features.append(
            {
                "type": "Feature",
                "geometry": mapping(poly_wgs84),
                "properties": {"buffer_m": d},
            }
        )
    with open(os.path.join(out_dir, "corridor_buffers.geojson"), "w") as f:
        json.dump({"type": "FeatureCollection", "features": buffer_features}, f)

    # trees within base boundary
    base_features = [
        tree_feature(transform(TO_WGS84, g), p) for g, p in base_hits
    ]
    with open(os.path.join(out_dir, "corridor_trees.geojson"), "w") as f:
        json.dump({"type": "FeatureCollection", "features": base_features}, f)

    # buffer band trees (tagged with which band first captured them)
    buffer_tree_features = []
    for d in BUFFERS_M:
        for g, p in buffer_band_hits[d]:
            buffer_tree_features.append(
                tree_feature(transform(TO_WGS84, g), p, {"band_m": d})
            )
    with open(os.path.join(out_dir, "corridor_buffer_trees.geojson"), "w") as f:
        json.dump({"type": "FeatureCollection", "features": buffer_tree_features}, f)

    # analysis.json - same shape as data/elevated_corridor/corridor_tree_analysis.json
    def counts(features_props, key):
        c = {}
        for p in features_props:
            v = p.get(key)
            v = "null" if v is None else str(v)
            c[v] = c.get(v, 0) + 1
        return c

    all_base_props = [p for _, p in base_hits]
    species_counts = {}
    for p in all_base_props:
        s = p.get("species") or "Unknown"
        species_counts[s] = species_counts.get(s, 0) + 1
    species_counts_sorted = sorted(species_counts.items(), key=lambda kv: -kv[1])

    cumulative = {0: len(base_hits)}
    running = len(base_hits)
    for d in BUFFERS_M:
        running += len(buffer_band_hits[d])
        cumulative[d] = running

    analysis = {
        "project_name": name,
        "source_url": source_url,
        "polygon_source": name,
        "census_source": "bbmp_tree_census_july_2026.geojson",
        "total_trees_in_boundary": len(base_hits),
        "cumulative_counts_by_buffer_m": cumulative,
        "species_counts": species_counts_sorted,
        "ward_counts": counts(all_base_props, "ward"),
        "status_counts": counts(all_base_props, "status"),
    }
    with open(os.path.join(out_dir, "analysis.json"), "w") as f:
        json.dump(analysis, f, indent=2)

    print(f"[{slug}] base={len(base_hits)} " + " ".join(f"+{d}m_cum={cumulative[d]}" for d in BUFFERS_M))
    return analysis
