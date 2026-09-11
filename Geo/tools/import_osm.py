#!/usr/bin/env python3
"""Import a bounded public OSM XML extract into attributed, clipped GeoJSON.

Only the Python standard library is required. Coordinates remain WGS84 longitude,
latitude. Relations are intentionally not converted: polygon ways belonging to
multipolygons are also omitted, avoiding filled courtyards or invented areas.
No network requests are made by this program.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
from pathlib import Path
import re
import sys
import tempfile
from datetime import datetime, timezone
from urllib.parse import urlsplit
import xml.etree.ElementTree as ET


MAX_INPUT_BYTES = 20 * 1024 * 1024
MAX_WAY_REFS = 2000
EPSILON = 1e-12
AREA_EPSILON = 1e-16
OSM_LICENSE_URL = "https://opendatacommons.org/licenses/odbl/1-0/"
OSM_ATTRIBUTION_URL = "https://www.openstreetmap.org/copyright"
DEFAULT_RETRIEVED_AT_BASIS = "Provided retrieval timestamp; capture method not recorded."
POI_KEYS = ("shop", "amenity", "tourism", "historic", "leisure", "healthcare", "office", "craft")
GREEN_VALUES = {"leisure": {"park", "garden", "playground", "recreation_ground"},
                "landuse": {"grass", "forest", "recreation_ground", "meadow"},
                "natural": {"wood", "scrub", "grassland"}}
TAG_WHITELIST = frozenset({
    "name", "name:ru", "name:kk", "name:en", "official_name", "alt_name",
    "highway", "width", "lanes", "surface", "oneway", "maxspeed", "access",
    "foot", "bicycle", "sidewalk", "cycleway", "lit", "bridge", "tunnel", "layer",
    "building", "building:part", "height", "min_height", "building:levels",
    "building:min_level", "roof:height", "roof:levels", "roof:shape",
    "shop", "amenity", "tourism", "historic", "leisure", "healthcare", "office", "craft",
    "operator", "brand", "brand:wikidata", "opening_hours", "cuisine", "sport",
    "addr:street", "addr:housenumber", "addr:city", "wheelchair",
    "public_transport", "railway", "type", "wikidata", "wikipedia",
    "area", "area:highway", "landuse", "natural",
})


class OSMImportError(ValueError):
    """The input cannot safely or unambiguously be imported."""


def parse_bbox(value):
    """Return (west, south, east, north), rejecting nonfinite/wrapped boxes."""
    try:
        values = value.split(",") if isinstance(value, str) else value
        west, south, east, north = (float(number) for number in values)
    except (TypeError, ValueError, OverflowError) as exc:
        raise OSMImportError("bbox must contain west,south,east,north") from exc
    if not all(math.isfinite(number) for number in (west, south, east, north)):
        raise OSMImportError("bbox coordinates must be finite")
    if not (-180 <= west < east <= 180 and -90 <= south < north <= 90):
        raise OSMImportError("bbox must be ordered and within longitude/latitude bounds")
    return west, south, east, north


def _inside(point, bbox):
    west, south, east, north = bbox
    return west <= point[0] <= east and south <= point[1] <= north


def _same_point(a, b):
    return abs(a[0] - b[0]) <= EPSILON and abs(a[1] - b[1]) <= EPSILON


def _clamp(point, bbox):
    west, south, east, north = bbox
    return (max(west, min(east, point[0])), max(south, min(north, point[1])))


def clip_segment(a, b, bbox):
    """Liang–Barsky segment clipping; a zero-length intersection returns None."""
    west, south, east, north = bbox
    dx, dy = b[0] - a[0], b[1] - a[1]
    lower, upper = 0.0, 1.0
    for p, q in ((-dx, a[0] - west), (dx, east - a[0]),
                 (-dy, a[1] - south), (dy, north - a[1])):
        if p == 0:
            if q < 0:
                return None
            continue
        ratio = q / p
        if p < 0:
            lower = max(lower, ratio)
        else:
            upper = min(upper, ratio)
        if lower > upper:
            return None
    start = _clamp((a[0] + lower * dx, a[1] + lower * dy), bbox)
    end = _clamp((a[0] + upper * dx, a[1] + upper * dy), bbox)
    return None if _same_point(start, end) else (start, end)


def clip_line(points, bbox):
    """Clip a polyline without connecting separate visits to the rectangle."""
    parts, current = [], []
    for a, b in zip(points, points[1:]):
        if _same_point(a, b):
            continue
        segment = clip_segment(a, b, bbox)
        if segment is None:
            if len(current) >= 2:
                parts.append(current)
            current = []
            continue
        start, end = segment
        if current and _same_point(current[-1], start):
            if not _same_point(current[-1], end):
                current.append(end)
        else:
            if len(current) >= 2:
                parts.append(current)
            current = [start, end]
    if len(current) >= 2:
        parts.append(current)
    return parts


def _open_ring(points):
    result = []
    for point in points:
        if not result or not _same_point(result[-1], point):
            result.append(point)
    if len(result) > 1 and _same_point(result[0], result[-1]):
        result.pop()
    return result


def _signed_area(ring):
    if not ring:
        return 0.0
    # Translate near the origin to avoid cancellation at Almaty's longitude.
    ox, oy = ring[0]
    return 0.5 * sum((a[0] - ox) * (b[1] - oy) - (b[0] - ox) * (a[1] - oy)
                     for a, b in zip(ring, ring[1:] + ring[:1]))


def _cross(a, b, c):
    return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])


def _on_segment(a, b, point):
    return (abs(_cross(a, b, point)) <= AREA_EPSILON
            and min(a[0], b[0]) - EPSILON <= point[0] <= max(a[0], b[0]) + EPSILON
            and min(a[1], b[1]) - EPSILON <= point[1] <= max(a[1], b[1]) + EPSILON)


def _segments_intersect(a, b, c, d):
    if (max(a[1], b[1]) + EPSILON < min(c[1], d[1])
            or max(c[1], d[1]) + EPSILON < min(a[1], b[1])):
        return False
    c1, c2, c3, c4 = _cross(a, b, c), _cross(a, b, d), _cross(c, d, a), _cross(c, d, b)
    if ((c1 > AREA_EPSILON and c2 < -AREA_EPSILON or c1 < -AREA_EPSILON and c2 > AREA_EPSILON)
            and (c3 > AREA_EPSILON and c4 < -AREA_EPSILON or c3 < -AREA_EPSILON and c4 > AREA_EPSILON)):
        return True
    return any((_on_segment(a, b, c), _on_segment(a, b, d),
                _on_segment(c, d, a), _on_segment(c, d, b)))


def _is_simple_ring(ring):
    """Reject crossings/touches/overlapping edges; bound work via MAX_WAY_REFS."""
    n = len(ring)
    if n < 3 or abs(_signed_area(ring)) <= AREA_EPSILON:
        return False
    if len(set(ring)) != n:
        return False
    edges = sorted((min(a[0], b[0]), max(a[0], b[0]), i, a, b)
                   for i, (a, b) in enumerate(zip(ring, ring[1:] + ring[:1])))
    for index, (_, max_x, i, a, b) in enumerate(edges):
        for min_x2, _, j, c, d in edges[index + 1:]:
            if min_x2 > max_x + EPSILON:
                break
            if (i - j) % n in (1, n - 1):
                # Adjacent edges may share one endpoint, but cannot double back.
                shared = b if (i + 1) % n == j else a
                other1 = a if shared == b else b
                other2 = d if shared == c else c
                if _on_segment(shared, other1, other2) or _on_segment(shared, other2, other1):
                    return False
                continue
            if _segments_intersect(a, b, c, d):
                return False
    return True


def clip_polygon(points, bbox):
    """Clip a single simple exterior ring using Sutherland–Hodgman.

    Returns an open ring. The caller verifies simplicity; disconnected clipped
    footprints are omitted instead of being joined by invented boundary edges.
    """
    ring = _open_ring(points)
    west, south, east, north = bbox
    for axis, boundary, keep_greater in ((0, west, True), (0, east, False),
                                         (1, south, True), (1, north, False)):
        if not ring:
            break
        clipped = []
        previous = ring[-1]
        previous_inside = previous[axis] >= boundary if keep_greater else previous[axis] <= boundary
        for point in ring:
            point_inside = point[axis] >= boundary if keep_greater else point[axis] <= boundary
            if point_inside != previous_inside:
                ratio = (boundary - previous[axis]) / (point[axis] - previous[axis])
                intersection = [previous[0] + ratio * (point[0] - previous[0]),
                                previous[1] + ratio * (point[1] - previous[1])]
                intersection[axis] = boundary
                clipped.append(tuple(intersection))
            if point_inside:
                clipped.append(point)
            previous, previous_inside = point, point_inside
        ring = _open_ring(clipped)
    return _open_ring([_clamp(point, bbox) for point in ring])


def _tags(element):
    return {child.get("k"): child.get("v", "") for child in element.findall("tag")
            if child.get("k") in TAG_WHITELIST}


def _positive_id(value):
    if not value or not re.fullmatch(r"[1-9][0-9]{0,18}", value):
        return None
    return int(value)


def _meaningful(value):
    return bool(value and value.strip().lower() not in ("no", "false", "0", "none"))


def _way_kind(tags):
    if _meaningful(tags.get("building")):
        return "building"
    if tags.get("area:highway") == "pedestrian" or (tags.get("highway") == "pedestrian" and tags.get("area") == "yes"):
        return "plaza"
    if any(tags.get(key) in values for key, values in GREEN_VALUES.items()):
        return "green"
    if _meaningful(tags.get("highway")):
        return "road"
    return None


def _height_properties(tags):
    value = tags.get("height", "").strip().lower()
    match = re.fullmatch(r"(\d+(?:[.,]\d+)?)\s*(m|meters?|metres?|ft|feet|foot|')?", value)
    height = None
    if match:
        height = float(match.group(1).replace(",", "."))
        if match.group(2) in ("ft", "feet", "foot", "'"):
            height *= 0.3048
    if height is not None and math.isfinite(height) and 0 < height <= 1000:
        return {"heightMeters": round(height, 3), "heightSource": "osm:height", "heightEstimated": False}
    levels = tags.get("building:levels", "").strip()
    if re.fullmatch(r"\d+(?:[.,]\d+)?", levels):
        level_count = float(levels.replace(",", "."))
        if 0 < level_count <= 200:
            return {"heightMeters": round(level_count * 3, 3),
                    "heightSource": "estimated:building:levels*3m", "heightEstimated": True,
                    "heightAssumption": "Visual estimate: mapped building:levels multiplied by 3 metres; not surveyed height."}
    return {"heightMeters": 9, "heightSource": "visual-default:9m", "heightEstimated": True,
            "heightAssumption": "Visual assumption of 9 metres: no supported OSM height or building:levels value."}


def _feature(kind, osm_type, osm_id, tags, geometry, source_url, clipped=False):
    properties = {"kind": kind, "osmType": osm_type, "osmId": osm_id,
                  "name": next((tags[key] for key in ("name", "name:ru", "name:kk", "name:en") if tags.get(key)), ""),
                  "tags": tags, "source": "OpenStreetMap", "sourceUrl": source_url,
                  "geometryClipped": clipped}
    if kind == "building":
        properties.update(_height_properties(tags))
    return {"type": "Feature", "id": f"osm:{osm_type}/{osm_id}", "properties": properties, "geometry": geometry}


def _retrieval_timestamp(value):
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except (TypeError, AttributeError, ValueError) as exc:
        raise OSMImportError("retrieved-at must be an ISO 8601 datetime with timezone") from exc
    if parsed.tzinfo is None or parsed.utcoffset() is None:
        raise OSMImportError("retrieved-at must include timezone, for example 2026-09-09T10:00:00Z")
    return parsed.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


def _read_xml(path):
    try:
        with Path(path).open("rb") as stream:
            raw = stream.read(MAX_INPUT_BYTES + 1)
    except OSError as exc:
        raise OSMImportError(f"cannot read input: {exc}") from exc
    if len(raw) > MAX_INPUT_BYTES:
        raise OSMImportError(f"input exceeds {MAX_INPUT_BYTES} byte limit (20 MiB)")
    try:
        xml = raw.decode("utf-8-sig")
    except UnicodeDecodeError as exc:
        raise OSMImportError("only UTF-8 OSM XML is supported") from exc
    if "\x00" in xml or re.search(r"<!\s*(?:DOCTYPE|ENTITY)\b", xml, re.IGNORECASE):
        raise OSMImportError("DTD/entity declarations and NUL bytes are forbidden")
    encoding = re.search(r"<\?xml\s[^?]*encoding\s*=\s*['\"]([^'\"]+)", xml, re.IGNORECASE)
    if encoding and encoding.group(1).lower() not in ("utf-8", "utf8", "us-ascii", "ascii"):
        raise OSMImportError("only UTF-8/ASCII XML encodings are supported")
    try:
        root = ET.fromstring(xml)
    except ET.ParseError as exc:
        raise OSMImportError(f"invalid XML: {exc}") from exc
    if root.tag != "osm":
        raise OSMImportError("input root must be <osm>")
    return raw, root


def import_osm(input_path, bbox, source_url, retrieved_at,
               retrieved_at_basis=DEFAULT_RETRIEVED_AT_BASIS):
    """Return (FeatureCollection, metadata), with no writes or network activity."""
    bbox = parse_bbox(bbox)
    try:
        url = urlsplit(source_url)
        if url.scheme not in ("http", "https") or not url.hostname or url.username or url.password:
            raise ValueError("source URL must be public HTTP(S)")
    except (TypeError, ValueError) as exc:
        raise OSMImportError("source-url must be an HTTP(S) URL without credentials") from exc
    retrieved_at = _retrieval_timestamp(retrieved_at)
    if not isinstance(retrieved_at_basis, str) or not retrieved_at_basis.strip():
        raise OSMImportError("retrieved-at-basis must be a nonempty explanation of the timestamp source")
    raw, root = _read_xml(input_path)
    skipped = dict.fromkeys(("invalidNodes", "duplicateNodes", "invisibleNodes", "poisOutsideBbox",
                            "unclassifiedNodes", "invalidWayIds", "duplicateWays", "invisibleWays",
                            "incompleteWays", "oversizedWays", "unclassifiedWays", "roadsOutsideBbox",
                            "invalidBuildingRings", "buildingsOutsideBbox", "unsupportedBuildingClip",
                            "relationBuildingMembers", "relations", "multipolygonRelations",
                            "invalidPlazaRings", "plazasOutsideBbox", "unsupportedPlazaClip", "relationPlazaMembers",
                            "invalidGreenRings", "greenOutsideBbox", "unsupportedGreenClip", "relationGreenMembers"), 0)
    counts = {"roads": 0, "buildings": 0, "pois": 0, "plazas": 0, "green": 0, "total": 0}
    source_counts = {"nodes": 0, "ways": 0, "relations": 0}
    nodes, node_tags, features = {}, {}, []
    seen_node_ids = set()
    for element in root.findall("node"):
        source_counts["nodes"] += 1
        osm_id = _positive_id(element.get("id"))
        if osm_id is None:
            skipped["invalidNodes"] += 1
            continue
        if osm_id in seen_node_ids:
            skipped["duplicateNodes"] += 1
            continue
        seen_node_ids.add(osm_id)
        if element.get("visible") == "false":
            skipped["invisibleNodes"] += 1
            continue
        try:
            lon, lat = float(element.get("lon", "")), float(element.get("lat", ""))
        except (TypeError, ValueError, OverflowError):
            skipped["invalidNodes"] += 1
            continue
        if not (math.isfinite(lon) and math.isfinite(lat) and -180 <= lon <= 180 and -90 <= lat <= 90):
            skipped["invalidNodes"] += 1
            continue
        nodes[osm_id] = (lon, lat)
        node_tags[osm_id] = _tags(element)

    polygon_relation_members = set()
    for relation in root.findall("relation"):
        source_counts["relations"] += 1
        skipped["relations"] += 1
        tags = _tags(relation)
        if tags.get("type") == "multipolygon":
            skipped["multipolygonRelations"] += 1
            polygon_relation_members.update(_positive_id(member.get("ref"))
                                            for member in relation.findall("member") if member.get("type") == "way")

    seen_way_ids = set()
    for element in root.findall("way"):
        source_counts["ways"] += 1
        osm_id = _positive_id(element.get("id"))
        if osm_id is None:
            skipped["invalidWayIds"] += 1
            continue
        if osm_id in seen_way_ids:
            skipped["duplicateWays"] += 1
            continue
        seen_way_ids.add(osm_id)
        if element.get("visible") == "false":
            skipped["invisibleWays"] += 1
            continue
        tags = _tags(element)
        kind = _way_kind(tags)
        if kind is None:
            skipped["unclassifiedWays"] += 1
            continue
        if kind != "road" and osm_id in polygon_relation_members:
            skipped[f"relation{kind.capitalize()}Members"] += 1
            continue
        references = [_positive_id(node.get("ref")) for node in element.findall("nd")]
        if len(references) > MAX_WAY_REFS:
            skipped["oversizedWays"] += 1
            continue
        if len(references) < 2 or any(reference not in nodes for reference in references):
            skipped["incompleteWays"] += 1
            continue
        points = [nodes[reference] for reference in references]
        clipped = any(not _inside(point, bbox) for point in points)
        if kind != "road":
            label = kind.capitalize()
            count_key = {"building": "buildings", "plaza": "plazas", "green": "green"}[kind]
            ring = _open_ring(points)
            if references[0] != references[-1] or not _is_simple_ring(ring):
                skipped[f"invalid{label}Rings"] += 1
                continue
            ring = clip_polygon(ring, bbox)
            if len(ring) < 3 or abs(_signed_area(ring)) <= AREA_EPSILON:
                skipped[f"{count_key}OutsideBbox"] += 1
                continue
            if not _is_simple_ring(ring):
                skipped[f"unsupported{label}Clip"] += 1
                continue
            if _signed_area(ring) < 0:
                ring.reverse()
            geometry = {"type": "Polygon", "coordinates": [[list(point) for point in ring + ring[:1]]]}
            features.append(_feature(kind, "way", osm_id, tags, geometry, source_url, clipped))
            counts[count_key] += 1
        else:
            parts = clip_line(points, bbox)
            if not parts:
                skipped["roadsOutsideBbox"] += 1
                continue
            coordinates = [[[point[0], point[1]] for point in part] for part in parts]
            geometry = {"type": "LineString" if len(parts) == 1 else "MultiLineString",
                        "coordinates": coordinates[0] if len(parts) == 1 else coordinates}
            features.append(_feature("road", "way", osm_id, tags, geometry, source_url, clipped))
            counts["roads"] += 1

    for osm_id, point in nodes.items():
        tags = node_tags[osm_id]
        if not any(_meaningful(tags.get(key)) for key in POI_KEYS):
            skipped["unclassifiedNodes"] += 1
            continue
        if not _inside(point, bbox):
            skipped["poisOutsideBbox"] += 1
            continue
        features.append(_feature("poi", "node", osm_id, tags,
                                 {"type": "Point", "coordinates": list(point)}, source_url))
        counts["pois"] += 1

    counts["total"] = len(features)
    metadata = {
        "schemaVersion": 1, "bbox": list(bbox), "crs": "EPSG:4326",
        "coordinateOrder": "longitude,latitude", "sourceCounts": source_counts,
        "counts": counts, "skipped": skipped,
        "source": {"name": "OpenStreetMap", "url": source_url, "retrievedAt": retrieved_at,
                   "retrievedAtBasis": retrieved_at_basis,
                   "rawSha256": hashlib.sha256(raw).hexdigest(), "rawBytes": len(raw),
                   "license": "ODbL-1.0", "licenseUrl": OSM_LICENSE_URL,
                   "attribution": "© OpenStreetMap contributors", "attributionUrl": OSM_ATTRIBUTION_URL},
        "processing": {"roadClipping": "Liang-Barsky", "polygonClipping": "Sutherland-Hodgman; simple exterior rings only",
                       "maximumInputBytes": MAX_INPUT_BYTES, "maximumWayReferences": MAX_WAY_REFS,
                       "poiClassificationKeys": list(POI_KEYS), "preservedTags": sorted(TAG_WHITELIST)},
        "limitations": [
            "All OSM relations, including multipolygons, are omitted; polygon member ways are also omitted to avoid inventing filled holes or solid footprints.",
            "Only complete highway ways, simple closed building/plaza/green ways and classified POI nodes are imported; names alone do not create POIs.",
            "Disconnected or non-simple clipped area footprints are omitted, not reconstructed as invented polygons.",
            "Mapped building height is used when valid; levels × 3 m and a 9 m default are explicitly marked visual estimates, not surveyed dimensions.",
            "OSM data may be incomplete or outdated. Mapped shops/brands are points of interest, not participating partners or active promotions.",
            "Geometry is geographic map data, not a photorealistic model, native game build or proof of physical player presence.",
        ],
    }
    osm_meta = root.find("meta")
    if osm_meta is not None and osm_meta.get("osm_base"):
        metadata["source"]["upstreamBaseTimestamp"] = osm_meta.get("osm_base")
    collection = {"type": "FeatureCollection", "bbox": list(bbox),
                  "attribution": metadata["source"]["attribution"], "metadata": metadata, "features": features}
    return collection, metadata


def _write_json(path, value):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", dir=path.parent,
                                         prefix=f".{path.name}.", suffix=".tmp", delete=False) as stream:
            temporary = Path(stream.name)
            json.dump(value, stream, ensure_ascii=False, allow_nan=False, indent=2)
            stream.write("\n")
        os.replace(temporary, path)
    finally:
        if temporary is not None and temporary.exists():
            temporary.unlink()


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", required=True, type=Path, help="existing public OSM map XML, UTF-8, at most 20 MiB")
    parser.add_argument("--output", required=True, type=Path, help="output GeoJSON FeatureCollection")
    parser.add_argument("--metadata", required=True, type=Path, help="output provenance/counts JSON")
    parser.add_argument("--bbox", required=True, help="west,south,east,north; longitude,latitude in degrees")
    parser.add_argument("--source-url", required=True, help="actual upstream URL from which the XML was retrieved")
    parser.add_argument("--retrieved-at", required=True, help="actual download datetime in ISO 8601 with timezone")
    parser.add_argument("--retrieved-at-basis", default=DEFAULT_RETRIEVED_AT_BASIS,
                        help="explain how the retrieval timestamp was obtained, e.g. completed download file mtime")
    args = parser.parse_args(argv)
    try:
        paths = [path.resolve() for path in (args.input, args.output, args.metadata)]
        if len(set(paths)) != 3:
            raise OSMImportError("input, output and metadata must be three distinct paths")
        collection, metadata = import_osm(args.input, args.bbox, args.source_url, args.retrieved_at,
                                          args.retrieved_at_basis)
        _write_json(args.output, collection)
        _write_json(args.metadata, metadata)
    except (OSMImportError, OSError) as exc:
        parser.exit(2, f"import_osm: {exc}\n")
    print(json.dumps({"output": str(args.output), "metadata": str(args.metadata), "counts": metadata["counts"],
                      "rawSha256": metadata["source"]["rawSha256"]}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
