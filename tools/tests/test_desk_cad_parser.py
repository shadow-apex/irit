import os
import sys
import tempfile
import unittest

import _path  # noqa: F401

# Thêm đường dẫn assets/spatial_desk/tools vào sys.path
SPATIAL_TOOLS = os.path.abspath(
    os.path.join(os.path.dirname(__file__), "..", "..", "assets", "spatial_desk", "tools")
)
if SPATIAL_TOOLS not in sys.path:
    sys.path.insert(0, SPATIAL_TOOLS)

import desk_cad_parser  # noqa: E402


class TestDeskCadParser(unittest.TestCase):
    def test_build_parametric_box(self):
        triangles = desk_cad_parser.build_parametric_box_triangles(
            length=60.0, width=40.0, height=20.0, wall=2.0
        )
        self.assertGreater(len(triangles), 20)
        bbox = desk_cad_parser.compute_bounding_box(triangles)
        self.assertAlmostEqual(bbox["length"], 60.0, delta=0.5)
        self.assertAlmostEqual(bbox["width"], 40.0, delta=0.5)
        self.assertAlmostEqual(bbox["height"], 20.0, delta=0.5)

    def test_stl_binary_roundtrip(self):
        triangles = [
            {
                "normal": (0.0, 0.0, 1.0),
                "v1": (0.0, 0.0, 0.0),
                "v2": (10.0, 0.0, 0.0),
                "v3": (0.0, 10.0, 0.0),
            },
            {
                "normal": (0.0, 0.0, 1.0),
                "v1": (10.0, 0.0, 0.0),
                "v2": (10.0, 10.0, 0.0),
                "v3": (0.0, 10.0, 0.0),
            },
        ]
        with tempfile.NamedTemporaryFile(suffix=".stl", delete=False) as f:
            tmp_path = f.name
        try:
            desk_cad_parser.write_stl_binary(tmp_path, triangles)
            parsed_tris, fmt = desk_cad_parser.load_cad_file(tmp_path)
            self.assertEqual(fmt, "stl_binary")
            self.assertEqual(len(parsed_tris), 2)
            bbox = desk_cad_parser.compute_bounding_box(parsed_tris)
            self.assertAlmostEqual(bbox["length"], 10.0, delta=0.1)
            self.assertAlmostEqual(bbox["width"], 10.0, delta=0.1)
        finally:
            if os.path.exists(tmp_path):
                os.remove(tmp_path)

    def test_obj_parsing(self):
        obj_content = """# Minimal Cube face
v 0.0 0.0 0.0
v 25.0 0.0 0.0
v 25.0 15.0 0.0
v 0.0 15.0 0.0
f 1 2 3
f 1 3 4
"""
        with tempfile.NamedTemporaryFile(mode="w", suffix=".obj", delete=False, encoding="utf-8") as f:
            f.write(obj_content)
            tmp_path = f.name
        try:
            parsed_tris, fmt = desk_cad_parser.load_cad_file(tmp_path)
            self.assertEqual(fmt, "wavefront_obj")
            self.assertEqual(len(parsed_tris), 2)
            bbox = desk_cad_parser.compute_bounding_box(parsed_tris)
            self.assertAlmostEqual(bbox["length"], 25.0, delta=0.1)
            self.assertAlmostEqual(bbox["width"], 15.0, delta=0.1)
        finally:
            if os.path.exists(tmp_path):
                os.remove(tmp_path)

    def test_process_cad_model_resize_and_explode(self):
        res = desk_cad_parser.process_cad_model(
            stl_path="",  # Fallback to parametric box
            target_length=70.0,
            target_width=45.0,
            target_height=30.0,
            explode=True,
            explode_distance_mm=35.0,
        )
        self.assertEqual(res["file_name"], "iris_spatial_box.stl")
        self.assertAlmostEqual(res["current_dimensions_mm"]["length"], 70.0, delta=0.5)
        self.assertAlmostEqual(res["current_dimensions_mm"]["width"], 45.0, delta=0.5)
        self.assertAlmostEqual(res["current_dimensions_mm"]["height"], 30.0, delta=0.5)
        self.assertTrue(res["is_exploded"])
        self.assertEqual(res["component_count"], 2)
        # Kiểm tra chi tiết nắp trượt được tách rời
        lid_comp = [c for c in res["components"] if c["id"] == "part-lid"][0]
        self.assertGreater(lid_comp["offset_applied_mm"][2], 0.0)


if __name__ == "__main__":
    unittest.main()
