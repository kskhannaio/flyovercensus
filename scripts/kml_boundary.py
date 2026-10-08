"""Minimal KML polygon extraction - just enough to pull named Polygon
placemarks out of the specific alignment KMLs downloaded from OpenCity.
Not a general KML parser."""

import xml.etree.ElementTree as ET

from shapely.geometry import Polygon

NS = {"kml": "http://www.opengis.net/kml/2.2"}


def _polygon_from_placemark(pm):
    # Only handles the outer boundary (no holes) - none of the source KMLs
    # here have inner rings.
    coords_el = pm.find(".//kml:outerBoundaryIs//kml:coordinates", NS)
    if coords_el is None:
        coords_el = pm.find(".//kml:coordinates", NS)
    pts = []
    for tok in coords_el.text.split():
        lon, lat, *_ = tok.split(",")
        pts.append((float(lon), float(lat)))
    return Polygon(pts)


def extract_polygons(kml_path, name_filter=None):
    """Return [(name, shapely Polygon), ...] for every Polygon placemark,
    optionally restricted to placemarks whose <name> is in name_filter
    (case-sensitive, exact match against the source KML's own name text)."""
    tree = ET.parse(kml_path)
    root = tree.getroot()
    out = []
    for pm in root.findall(".//kml:Placemark", NS):
        if pm.find(".//kml:Polygon", NS) is None:
            continue
        name_el = pm.find("kml:name", NS)
        name = name_el.text.strip() if name_el is not None and name_el.text else None
        if name_filter is not None and name not in name_filter:
            continue
        out.append((name, _polygon_from_placemark(pm)))
    return out
