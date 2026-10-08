"""
Reproduce the Yeshwantpur-KR Puram elevated corridor tree count natively in
Google Earth Engine, including the 5m/10m/15m buffer scenarios.

Intended for someone with GIS/domain expertise to independently check the
numbers reported for this analysis:
    Base (published EC project boundary):  547 trees
    +5m buffer  (per side, cumulative):     738 trees
    +10m buffer (per side, cumulative):     905 trees
    +15m buffer (per side, cumulative):   1,119 trees

Those numbers were computed locally with Python/shapely, buffering in a flat
local-metres projection. This script recomputes the same thing a different
way — using Earth Engine's own geodesic Geometry.buffer() — as an
independent cross-check. If the two methods agree, that's a good sign
neither has a subtle bug; if they diverge noticeably, that's worth digging
into (see the note at the bottom).

Copy this into a Colab / Jupyter notebook cell (or run it as a script if
you're already authenticated locally). Needs the two small GeoJSON files in
./data/ alongside it:
  - corridor_boundary.geojson   (project boundary polygon, ~55 KB)
  - corridor_area_trees.geojson (38,534 BBMP census trees in/around the
                                  corridor's bounding box, ~6.4 MB — a
                                  superset; GEE does the actual point-in-
                                  polygon filtering below, at every buffer
                                  distance)

Install once:
    pip install earthengine-api geemap

First run: ee.Authenticate() opens an interactive browser login tied to your
own Google account. You also need a Google Cloud project with the Earth
Engine API enabled (console.cloud.google.com -> enable "Earth Engine API"),
its project id goes in EE_PROJECT below.
"""

import json
import os

import ee

EE_PROJECT = "your-gee-project-id"  # <-- replace with your own GEE-enabled Cloud project id

try:
    ee.Initialize(project=EE_PROJECT)
except Exception:
    ee.Authenticate()  # interactive, one-time browser login
    ee.Initialize(project=EE_PROJECT)

DATA_DIR = os.path.join(os.path.dirname(__file__), "data")

with open(os.path.join(DATA_DIR, "corridor_boundary.geojson")) as f:
    boundary_geojson = json.load(f)

with open(os.path.join(DATA_DIR, "corridor_area_trees.geojson")) as f:
    trees_geojson = json.load(f)

# The published Environmental Clearance project boundary polygon.
corridor = ee.Geometry(boundary_geojson["features"][0]["geometry"])

# BBMP census trees near the corridor (bbox pre-filtered client-side just to
# keep the upload small; the actual polygon containment check below is done
# by Earth Engine itself, not pre-computed).
trees = ee.FeatureCollection(trees_geojson)

# Reference numbers from the local shapely computation, for comparison.
REFERENCE_COUNTS = {0: 547, 5: 738, 10: 905, 15: 1119}

# --- Spatial join at each buffer distance, computed by Earth Engine -------
# Geometry.buffer(distance, maxError) on a geographic (lon/lat) geometry is
# a true geodesic buffer in meters — not the flat-projection approximation
# used locally — so this is a genuinely independent method, not just a
# replay of the same math.
results = {}
geometries = {0: corridor}
for d in (5, 10, 15):
    geometries[d] = corridor.buffer(d, 1)  # maxError = 1m

for d, geom in geometries.items():
    trees_within = trees.filterBounds(geom)
    count = trees_within.size().getInfo()
    results[d] = (count, trees_within)

print(f"{'Buffer':>10} | {'GEE count':>9} | {'Reference':>9} | {'Diff':>5}")
print("-" * 42)
for d in (0, 5, 10, 15):
    gee_count = results[d][0]
    ref_count = REFERENCE_COUNTS[d]
    label = "base" if d == 0 else f"+{d}m"
    print(f"{label:>10} | {gee_count:>9} | {ref_count:>9} | {gee_count - ref_count:>+5}")

print(
    "\nSmall diffs (a handful of trees) are expected — different buffer "
    "algorithms/projections round differently at bends. A large diff at "
    "one specific row and not the others is worth flagging for a closer "
    "look rather than assumed to be rounding."
)

# --- Optional: visualize in a notebook (needs `pip install geemap`) -------
try:
    import geemap

    # Same color scheme as the web POC (src/proof_of_concept/light/), so a
    # reviewer can cross-check this against that view directly.
    STYLE = {
        0: {"line": "2563eb", "fill": "dc2626"},
        5: {"line": "b45309", "fill": "f59e0b"},
        10: {"line": "6b21a8", "fill": "9333ea"},
        15: {"line": "0f766e", "fill": "14b8a6"},
    }

    m = geemap.Map()
    m.centerObject(corridor, 13)
    for d in (15, 10, 5, 0):  # widest first, so narrower rings draw on top
        count, trees_within = results[d]
        style = STYLE[d]
        label = "Project boundary" if d == 0 else f"+{d}m buffer"
        m.addLayer(geometries[d], {"color": style["line"]}, f"{label} outline")
        m.addLayer(trees_within, {"color": style["fill"]}, f"{label} — {count} trees")
    m  # noqa: B018  (displays automatically as the last expression in a notebook cell)
except ImportError:
    pass
