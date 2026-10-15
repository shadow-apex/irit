import os
import unittest
import _path  # noqa: F401
import file_explorer


class TestFileExplorer(unittest.TestCase):
    def test_resolve_shortcuts(self):
        home = os.path.expanduser("~")
        self.assertEqual(file_explorer.resolve_target_path(""), home)
        self.assertEqual(file_explorer.resolve_target_path("home"), home)
        self.assertEqual(file_explorer.resolve_target_path("desktop"), os.path.normpath(os.path.join(home, "Desktop")))
        self.assertEqual(file_explorer.resolve_target_path("downloads"), os.path.normpath(os.path.join(home, "Downloads")))
        self.assertEqual(file_explorer.resolve_target_path("documents"), os.path.normpath(os.path.join(home, "Documents")))

    def test_resolve_drive(self):
        self.assertTrue(file_explorer.resolve_target_path("c:").lower().startswith("c:\\"))
        self.assertTrue(file_explorer.resolve_target_path("C:").lower().startswith("c:\\"))

    def test_resolve_tilde_and_env(self):
        home = os.path.expanduser("~")
        self.assertEqual(file_explorer.resolve_target_path("~"), home)
        # Test expandvars
        os.environ["TEST_EXPLORER_DIR"] = home
        self.assertEqual(file_explorer.resolve_target_path("%TEST_EXPLORER_DIR%"), home)

    def test_resolve_relative_path(self):
        current_dir = os.path.abspath(".")
        self.assertEqual(file_explorer.resolve_target_path("."), current_dir)

    def test_parser(self):
        p = file_explorer.build_parser()
        args = p.parse_args(["downloads", "--select"])
        self.assertEqual(args.path, "downloads")
        self.assertTrue(args.select)

        args2 = p.parse_args(["--path=C:\\Windows", "--action=open"])
        self.assertEqual(args2.path_opt, "C:\\Windows")
        self.assertEqual(args2.action, "open")


if __name__ == "__main__":
    unittest.main()
