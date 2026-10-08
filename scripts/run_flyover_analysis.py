"""Driver: run build_flyover_analysis for every upcoming flyover project that
has a usable project-boundary polygon in its OpenCity KML.

Ragigudda-to-Kanakapura-Rd/NICE-Rd is deliberately excluded here - its KML is
a raw AutoCAD-to-KML export (126+ layers: centerline/wall/building/drain/...)
with no single clean boundary polygon, and the candidate "boundary" layers are
themselves inconsistent (thousands of stray fragments under a garbled layer
name, spanning a bounding box far larger than the actual corridor). Building
an automated boundary from that risks a fabricated/misleading footprint for a
civic tree-felling estimate, so it's left for manual GIS digitization instead
of guessed here.

Pipeline Road (West of Chord Road to Outer Ring Road, Mahalakshmi Layout) is
also excluded - its boundary polygon extracts cleanly, but the base/+5/+10/+15m
counts all come out to zero (confirmed: nearest census tree is ~930m from the
alignment, not a predicate bug - see the STRtree "covers" fix in
build_flyover_analysis.py). With nothing to show on the tree-impact map, it's
dropped from the generated set rather than listed as an empty project.
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from build_flyover_analysis import analyze_project, load_census_index, POC_DATA_ROOT, REPO_ROOT
from kml_boundary import extract_polygons

FLYOVERS_DIR = os.path.join(REPO_ROOT, "data/flyovers")

PROJECTS = [
    {
        "name": "Old Madras Road to Central Silk Board Elevated Corridor",
        "slug": "old-madras-road-to-silk-board",
        "source_url": "https://data.opencity.in/dataset/elevated-corridor-from-old-madras-road-to-central-silk-board-documents",
        "kml_path": os.path.join(FLYOVERS_DIR, "old-madras-road-to-silk-board/alignment_official.kml"),
        "name_filter": {"Proposed Road"},  # exclude the "Existing Road" polygon
    },
]


def main():
    census_index = load_census_index()

    manifest = []
    for proj in PROJECTS:
        polys = extract_polygons(proj["kml_path"], name_filter=proj["name_filter"])
        if not polys:
            print(f"!! no matching polygons found for {proj['slug']}, skipping")
            continue
        boundary_polygons = [p for _, p in polys]
        analysis = analyze_project(
            proj["name"],
            proj["slug"],
            proj["source_url"],
            boundary_polygons,
            census_index,
            POC_DATA_ROOT,
        )
        manifest.append(
            {
                "slug": proj["slug"],
                "name": proj["name"],
                "source_url": proj["source_url"],
                "total_trees_in_boundary": analysis["total_trees_in_boundary"],
                "cumulative_counts_by_buffer_m": analysis["cumulative_counts_by_buffer_m"],
            }
        )

    manifest_path = os.path.join(POC_DATA_ROOT, "projects.json")
    import json

    # Preserve the original single-corridor entry as "yeshwantpur-kr-puram" so
    # the existing hardcoded dataset also shows up in the generalized picker.
    manifest.insert(
        0,
        {
            "slug": "yeshwantpur-kr-puram",
            "name": "Yeshwantpur–KR Puram Elevated Corridor",
            "source_url": "https://data.opencity.in/dataset/elevated-corridor-from-yeshwantpur-to-kr-puram",
            "total_trees_in_boundary": 547,
            "cumulative_counts_by_buffer_m": {0: 547, 5: 738, 10: 905, 15: 1119},
        },
    )

    with open(manifest_path, "w") as f:
        json.dump(manifest, f, indent=2)
    print(f"\nWrote manifest with {len(manifest)} projects to {manifest_path}")


if __name__ == "__main__":
    main()
