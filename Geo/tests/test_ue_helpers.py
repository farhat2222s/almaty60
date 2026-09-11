"""Geometry helper checks only; these do not exercise Unreal Editor APIs."""
import importlib.util
import math
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location("ue_import", Path(__file__).parents[1] / "ue-import/import_district.py")
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class UEGeometryHelpers(unittest.TestCase):
    def test_polygon_is_counterclockwise_centimeters_without_duplicate_endpoint(self):
        ring = module.polygon_ccw([[0,0,0],[0,2,0],[3,2,0],[3,0,0],[0,0,0]])
        self.assertEqual(len(ring),4)
        area = sum(a[0]*b[1]-b[0]*a[1] for a,b in zip(ring,ring[1:]+ring[:1])) / 2
        self.assertEqual(area,60000)
        with self.assertRaises(ValueError):
            module.polygon_ccw([[0,0,0],[1,1,0],[2,2,0]])

    def test_roads_preserve_actual_segment_endpoints_and_width(self):
        result = module.road_rectangles([[3,4,0],[9,12,0]],4)
        self.assertEqual(len(result),1)
        a,b,c,d = result[0]
        self.assertAlmostEqual(math.dist(a,d),4)
        self.assertAlmostEqual(math.dist(b,c),4)
        self.assertEqual([(a[i]+d[i])/2 for i in range(2)],[3,4])
        self.assertEqual([(b[i]+c[i])/2 for i in range(2)],[9,12])

    def test_zero_length_road_segments_are_omitted(self):
        self.assertEqual(len(module.road_rectangles([[1,1,0],[1,1,0],[1,2,0]],2)),1)


if __name__ == "__main__":
    unittest.main()
