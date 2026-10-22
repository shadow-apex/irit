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

    def test_find_control_by_automation_id(self):
        controls = [
            {"name": "", "type": "Button", "automation_id": "SubmitBtn"},
            {"name": "Cancel", "type": "Button", "automation_id": "CancelBtn"},
        ]
        match = ui_automation.find_control(controls, "submitbtn")
        self.assertIsNotNone(match)
        self.assertEqual(match["automation_id"], "SubmitBtn")

    def test_find_control_with_natural_language_prefixes(self):
        controls = [
            {"name": "Save Changes", "type": "Button", "class": "Button"},
            {"name": "Google Chrome", "type": "Pane", "class": "BrowserRootView"},
        ]
        match1 = ui_automation.find_control(controls, "bấm nút Save")
        self.assertIsNotNone(match1)
        self.assertEqual(match1["name"], "Save Changes")

        match2 = ui_automation.find_control(controls, "click vào icon Chrome")
        self.assertIsNotNone(match2)
        self.assertEqual(match2["name"], "Google Chrome")

    def test_control_types_mapping(self):
        self.assertEqual(ui_automation.UIA_CONTROL_TYPES.get(50000), "Button")
        self.assertEqual(ui_automation.UIA_CONTROL_TYPES.get(50004), "Edit")
        self.assertEqual(ui_automation.UIA_CONTROL_TYPES.get(50002), "CheckBox")
        self.assertEqual(ui_automation.UIA_CONTROL_TYPES.get(50011), "MenuItem")


if __name__ == "__main__":
    unittest.main()
