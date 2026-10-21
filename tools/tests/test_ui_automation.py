import unittest
import _path  # noqa: F401
import ui_automation


class TestUiAutomation(unittest.TestCase):
    def test_find_control_exact(self):
        controls = [
            {"name": "Save", "type": "Button", "class": "Button"},
            {"name": "Cancel", "type": "Button", "class": "Button"},
            {"name": "Search here", "type": "Edit", "class": "Edit"},
        ]
        match = ui_automation.find_control(controls, "Save")
        self.assertIsNotNone(match)
        self.assertEqual(match["name"], "Save")

    def test_find_control_substring(self):
        controls = [
            {"name": "Save Changes", "type": "Button", "class": "Button"},
            {"name": "Cancel Operation", "type": "Button", "class": "Button"},
        ]
        match = ui_automation.find_control(controls, "save")
        self.assertIsNotNone(match)
        self.assertEqual(match["name"], "Save Changes")

    def test_find_control_by_type(self):
        controls = [
            {"name": "", "type": "Edit", "class": "Edit"},
            {"name": "OK", "type": "Button", "class": "Button"},
        ]
        match = ui_automation.find_control(controls, "edit")
        self.assertIsNotNone(match)
        self.assertEqual(match["type"], "Edit")

    def test_find_control_not_found(self):
        controls = [{"name": "OK", "type": "Button"}]
        match = ui_automation.find_control(controls, "NonExistent")
        self.assertIsNone(match)


if __name__ == "__main__":
    unittest.main()
