import os
import tempfile
import unittest
import _path  # noqa: F401
import cad_automation


class TestCadAutomation(unittest.TestCase):
    def test_check_status(self):
        res = cad_automation.check_autocad_status()
        self.assertIn("running", res)
        self.assertIn("process", res)
        self.assertEqual(res["process"], "acad.exe")

    def test_generate_doraemon(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            out_file = os.path.join(tmpdir, "doraemon.scr")
            res = cad_automation.generate_script(out_file, template_name="doraemon")
            self.assertTrue(os.path.exists(out_file))
            self.assertEqual(res["template"], "doraemon")
            with open(out_file, "r", encoding="utf-8") as f:
                content = f.read()
            self.assertIn("_CIRCLE 0,100 80", content)
            self.assertIn("_ZOOM _E", content)

    def test_generate_custom_commands(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            out_file = os.path.join(tmpdir, "custom.scr")
            res = cad_automation.generate_script(out_file, commands="_CIRCLE 10,20 30\n_ZOOM _E")
            self.assertTrue(os.path.exists(out_file))
            with open(out_file, "r", encoding="utf-8") as f:
                content = f.read()
            self.assertIn("_CIRCLE 10,20 30", content)
            self.assertTrue(content.endswith("\n"))


if __name__ == "__main__":
    unittest.main()
