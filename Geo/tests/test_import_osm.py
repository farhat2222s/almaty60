"""Meaningful standard-library tests for the OSM importer, with inline fixtures."""

import hashlib
import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch


MODULE_PATH = Path(__file__).resolve().parents[1] / "tools" / "import_osm.py"
SPEC = importlib.util.spec_from_file_location("almaty_import_osm", MODULE_PATH)
osm = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(osm)
SOURCE_URL = "https://api.openstreetmap.org/api/0.6/map?bbox=0,0,10,10"
RETRIEVED_AT = "2026-09-09T15:00:00+05:00"
BBOX = (0, 0, 10, 10)


def xml_document(body):
    return '<?xml version="1.0" encoding="UTF-8"?><osm version="0.6">' + body + "</osm>"


def way_fixture(points, tags='<tag k="highway" v="residential"/>', way_id=101):
    nodes = ''.join(f'<node id="{i + 1}" lon="{x}" lat="{y}"/>' for i, (x, y) in enumerate(points))
    references = list(range(1, len(points) + 1))
    if points[0] == points[-1]:
        references[-1] = references[0]
    way = f'<way id="{way_id}">' + ''.join(f'<nd ref="{i}"/>' for i in references) + tags + '</way>'
    return xml_document(nodes + way)


class ImporterTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.path = Path(self.directory.name) / "map.osm"

    def run_import(self, xml, bbox=BBOX):
        self.path.write_bytes(xml.encode("utf-8") if isinstance(xml, str) else xml)
        return osm.import_osm(self.path, bbox, SOURCE_URL, RETRIEVED_AT)

    def test_crossing_road_clips_to_exact_bbox_and_preserves_provenance(self):
        xml = way_fixture([(-2, 5), (12, 5)], '<tag k="highway" v="footway"/><tag k="name" v="Арбат"/><tag k="width" v="12"/><tag k="unrelated" v="omit"/>')
        collection, metadata = self.run_import(xml)
        feature = collection["features"][0]
        self.assertEqual(feature["geometry"], {"type": "LineString", "coordinates": [[0, 5], [10, 5]]})
        self.assertEqual(feature["id"], "osm:way/101")
        self.assertEqual(feature["properties"]["osmId"], 101)
        self.assertTrue(feature["properties"]["geometryClipped"])
        self.assertEqual(feature["properties"]["tags"]["width"], "12")
        self.assertNotIn("unrelated", feature["properties"]["tags"])
        self.assertEqual(feature["properties"]["sourceUrl"], SOURCE_URL)
        self.assertEqual(metadata["source"]["rawSha256"], hashlib.sha256(xml.encode()).hexdigest())
        self.assertEqual(metadata["source"]["retrievedAt"], "2026-09-09T10:00:00Z")
        self.assertEqual(metadata["source"]["retrievedAtBasis"], osm.DEFAULT_RETRIEVED_AT_BASIS)
        self.assertEqual(metadata["source"]["license"], "ODbL-1.0")
        self.assertEqual(metadata["source"]["attribution"], "© OpenStreetMap contributors")

    def test_road_reentry_is_multiline_without_fake_connecting_edge(self):
        collection, _ = self.run_import(way_fixture([(1, 2), (12, 2), (12, 8), (1, 8)]))
        self.assertEqual(collection["features"][0]["geometry"],
                         {"type": "MultiLineString", "coordinates": [[[1, 2], [10, 2]], [[10, 8], [1, 8]]]})

    def test_contained_road_duplicates_boundary_and_corner_tangent(self):
        parts = osm.clip_line([(0, 0), (0, 0), (0, 5), (0, 10)], BBOX)
        self.assertEqual(parts, [[(0, 0), (0, 5), (0, 10)]])
        self.assertIsNone(osm.clip_segment((-1, 1), (1, -1), BBOX))
        collection, _ = self.run_import(way_fixture([(1, 2), (3, 4)]))
        self.assertFalse(collection["features"][0]["properties"]["geometryClipped"])

    def test_clipped_building_is_closed_ccw_polygon_with_mapped_height(self):
        collection, metadata = self.run_import(way_fixture([(-2, 2), (-2, 8), (4, 8), (4, 2), (-2, 2)],
                                                         '<tag k="building" v="yes"/><tag k="height" v="12.5 m"/>'))
        feature = collection["features"][0]
        ring = feature["geometry"]["coordinates"][0]
        self.assertEqual(feature["geometry"]["type"], "Polygon")
        self.assertEqual(ring[0], ring[-1])
        self.assertTrue(all(0 <= x <= 10 and 0 <= y <= 10 for x, y in ring))
        self.assertAlmostEqual(osm._signed_area(ring[:-1]), 24)
        self.assertEqual(feature["properties"]["heightMeters"], 12.5)
        self.assertEqual(feature["properties"]["heightSource"], "osm:height")
        self.assertFalse(feature["properties"]["heightEstimated"])
        self.assertTrue(feature["properties"]["geometryClipped"])
        self.assertEqual(metadata["counts"]["buildings"], 1)

    def test_building_height_estimates_are_explicit_and_bad_values_fall_back(self):
        for tags, height, source in [({"height": "30 ft"}, 9.144, "osm:height"),
                                     ({"height": "unknown", "building:levels": "4"}, 12, "estimated:building:levels*3m"),
                                     ({"height": "NaN", "building:levels": "-3"}, 9, "visual-default:9m"),
                                     ({"height": "99999999999999999999999999"}, 9, "visual-default:9m")]:
            with self.subTest(tags=tags):
                result = osm._height_properties(tags)
                self.assertEqual(result["heightMeters"], height)
                self.assertEqual(result["heightSource"], source)
                self.assertEqual(result["heightEstimated"], source != "osm:height")
                if source != "osm:height":
                    self.assertIn("heightAssumption", result)

    def test_pois_require_classification_and_keep_primary_tagged_node(self):
        collection, metadata = self.run_import(xml_document('''
          <node id="1" lon="2" lat="3"><tag k="name" v="Named road vertex"/></node>
          <node id="2" lon="5" lat="5"><tag k="amenity" v="cafe"/><tag k="name:ru" v="Кафе"/><tag k="name:kk" v="Кафе KZ"/></node>
          <node id="3" lon="10" lat="10"><tag k="shop" v="books"/></node>
          <node id="4" lon="11" lat="5"><tag k="tourism" v="museum"/></node>
          <node id="5" lon="5" lat="5"><tag k="shop" v="no"/></node>
        '''))
        self.assertEqual([feature["id"] for feature in collection["features"]], ["osm:node/2", "osm:node/3"])
        properties = collection["features"][0]["properties"]
        self.assertEqual(properties["name"], "Кафе")
        self.assertEqual(properties["tags"]["name:kk"], "Кафе KZ")
        self.assertEqual(properties["osmType"], "node")
        self.assertFalse(properties["geometryClipped"])
        self.assertEqual(metadata["skipped"]["poisOutsideBbox"], 1)

    def test_invalid_coordinates_make_ways_incomplete_not_shortened(self):
        collection, metadata = self.run_import(xml_document('''
          <node id="1" lon="1" lat="1"/><node id="2" lon="NaN" lat="5"/>
          <node id="3" lon="2" lat="91"/><node id="4" lon="181" lat="2"/>
          <node id="5" lon="3" lat="inf"/><node id="6" lon="4" lat="4"/>
          <way id="9"><nd ref="1"/><nd ref="2"/><nd ref="6"/><tag k="highway" v="path"/></way>
          <way id="10"><nd ref="1"/><nd ref="999"/><tag k="highway" v="path"/></way>
        '''))
        self.assertEqual(collection["features"], [])
        self.assertEqual(metadata["skipped"]["invalidNodes"], 4)
        self.assertEqual(metadata["skipped"]["incompleteWays"], 2)

    def test_multipolygons_and_their_building_members_are_explicitly_omitted(self):
        xml = way_fixture([(1, 1), (4, 1), (4, 4), (1, 1)], '<tag k="building" v="yes"/>')
        relation = '<relation id="7"><member type="way" ref="101" role="outer"/><tag k="type" v="multipolygon"/><tag k="building" v="yes"/></relation>'
        collection, metadata = self.run_import(xml.replace('</osm>', relation + '</osm>'))
        self.assertEqual(collection["features"], [])
        self.assertEqual(metadata["skipped"]["relations"], 1)
        self.assertEqual(metadata["skipped"]["multipolygonRelations"], 1)
        self.assertEqual(metadata["skipped"]["relationBuildingMembers"], 1)

    def test_invalid_open_and_self_crossing_buildings_are_skipped(self):
        for points in [[(1, 1), (4, 1), (4, 4)], [(1, 1), (4, 4), (1, 4), (4, 1), (1, 1)]]:
            with self.subTest(points=points):
                collection, metadata = self.run_import(way_fixture(points, '<tag k="building" v="yes"/>'))
                self.assertEqual(collection["features"], [])
                self.assertEqual(metadata["skipped"]["invalidBuildingRings"], 1)

    def test_closed_pedestrian_plazas_and_green_areas_are_polygons(self):
        cases = [('area:highway', 'pedestrian', 'plaza', 'plazas'),
                 ('leisure', 'park', 'green', 'green'), ('landuse', 'grass', 'green', 'green'),
                 ('natural', 'wood', 'green', 'green')]
        for key, value, kind, count_key in cases:
            with self.subTest(key=key):
                tags = f'<tag k="{key}" v="{value}"/><tag k="name" v="Mapped area"/>'
                collection, metadata = self.run_import(way_fixture([(-2, 2), (4, 2), (4, 8), (-2, 8), (-2, 2)], tags))
                feature = collection['features'][0]
                self.assertEqual(feature['properties']['kind'], kind)
                self.assertEqual(feature['properties']['tags'][key], value)
                self.assertEqual(feature['geometry']['type'], 'Polygon')
                self.assertTrue(feature['properties']['geometryClipped'])
                self.assertNotIn('heightMeters', feature['properties'])
                self.assertEqual(metadata['counts'][count_key], 1)
        tags = '<tag k="highway" v="pedestrian"/><tag k="area" v="yes"/>'
        collection, metadata = self.run_import(way_fixture([(1, 1), (4, 1), (4, 4), (1, 1)], tags))
        self.assertEqual(metadata['counts']['plazas'], 1)
        self.assertEqual(metadata['counts']['roads'], 0)

    def test_open_green_way_is_omitted_as_invalid_area(self):
        collection, metadata = self.run_import(way_fixture([(1, 1), (4, 1), (4, 4)], '<tag k="leisure" v="park"/>'))
        self.assertEqual(collection['features'], [])
        self.assertEqual(metadata['skipped']['invalidGreenRings'], 1)

    def test_disconnected_building_clip_is_omitted_instead_of_invented_bridge(self):
        # U shape connected above the bbox; clipping leaves two separate legs.
        points = [(1, 1), (3, 1), (3, 12), (7, 12), (7, 1), (9, 1), (9, 14), (1, 14), (1, 1)]
        collection, metadata = self.run_import(way_fixture(points, '<tag k="building" v="yes"/>'))
        self.assertEqual(collection["features"], [])
        self.assertEqual(metadata["skipped"]["unsupportedBuildingClip"], 1)

    def test_dtd_entity_and_utf16_payloads_rejected(self):
        malicious = ['<!DOCTYPE osm [<!ENTITY x "EXPAND">]><osm>&x;</osm>',
                     '<!DOCTYPE osm SYSTEM "file:///etc/passwd"><osm/>',
                     '<osm><!ENTITY x "EXPAND"></osm>',
                     '<osm/>'.encode('utf-16')]
        for xml in malicious:
            with self.subTest(xml=xml):
                with self.assertRaises(osm.OSMImportError):
                    self.run_import(xml)

    def test_malformed_root_and_size_limit_rejected(self):
        for xml in ['<osm>', '<not_osm/>']:
            with self.assertRaises(osm.OSMImportError):
                self.run_import(xml)
        with patch.object(osm, "MAX_INPUT_BYTES", 10):
            with self.assertRaisesRegex(osm.OSMImportError, "exceeds"):
                self.run_import('<osm>' + ' ' * 20 + '</osm>')

    def test_invalid_bbox_and_unattributed_datetime_rejected(self):
        for bbox in ['1,2,3', '0,0,nan,10', '10,0,0,10', '0,-91,10,10', '0,0,181,10']:
            with self.subTest(bbox=bbox):
                with self.assertRaises(osm.OSMImportError):
                    osm.parse_bbox(bbox)
        self.path.write_text('<osm/>')
        for timestamp in ['2026-09-09', '2026-09-09T10:00:00', 'today']:
            with self.assertRaises(osm.OSMImportError):
                osm.import_osm(self.path, BBOX, SOURCE_URL, timestamp)
        with self.assertRaises(osm.OSMImportError):
            osm.import_osm(self.path, BBOX, 'https://secret@example.org/map', RETRIEVED_AT)

    def test_cli_writes_usable_json_and_refuses_to_overwrite_input(self):
        self.path.write_text(way_fixture([(1, 1), (9, 9)]), encoding="utf-8")
        before = self.path.read_bytes()
        output = Path(self.directory.name) / "map.geojson"
        metadata = Path(self.directory.name) / "map.metadata.json"
        args = [sys.executable, str(MODULE_PATH), '--input', str(self.path), '--output', str(output),
                '--metadata', str(metadata), '--bbox', '0,0,10,10', '--source-url', SOURCE_URL,
                '--retrieved-at', RETRIEVED_AT]
        result = subprocess.run(args, capture_output=True, text=True, timeout=15)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(json.loads(output.read_text())["type"], "FeatureCollection")
        self.assertEqual(json.loads(metadata.read_text())["counts"]["roads"], 1)
        args[args.index('--output') + 1] = str(self.path)
        result = subprocess.run(args, capture_output=True, text=True, timeout=15)
        self.assertEqual(result.returncode, 2)
        self.assertEqual(self.path.read_bytes(), before)

    def test_retrieval_timestamp_basis_propagates_through_cli_to_both_outputs(self):
        self.path.write_text('<osm/>', encoding='utf-8')
        output = Path(self.directory.name) / 'map.geojson'
        metadata = Path(self.directory.name) / 'map.metadata.json'
        basis = 'Filesystem mtime of completed root download; not HTTP Date or an OSM timestamp.'
        args = [sys.executable, str(MODULE_PATH), '--input', str(self.path), '--output', str(output),
                '--metadata', str(metadata), '--bbox', '0,0,10,10', '--source-url', SOURCE_URL,
                '--retrieved-at', RETRIEVED_AT, '--retrieved-at-basis', basis]
        result = subprocess.run(args, capture_output=True, text=True, timeout=15)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(json.loads(metadata.read_text())['source']['retrievedAtBasis'], basis)
        self.assertEqual(json.loads(output.read_text())['metadata']['source']['retrievedAtBasis'], basis)
        with self.assertRaises(osm.OSMImportError):
            osm.import_osm(self.path, BBOX, SOURCE_URL, RETRIEVED_AT, '   ')


if __name__ == '__main__':
    unittest.main()
