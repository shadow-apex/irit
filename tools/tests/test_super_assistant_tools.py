import os
import tempfile
import unittest
import _path  # noqa: F401
import universal_app_launcher
import terminal_executor
import filesystem_ops
import window_manager
import system_ops


class TestSuperAssistantTools(unittest.TestCase):
    def test_universal_app_launcher_scoring_and_aliases(self):
        self.assertIn("notepad", universal_app_launcher.SMART_ALIASES)
        score_exact = universal_app_launcher.match_score("Notepad", "notepad.exe")
        score_prefix = universal_app_launcher.match_score("Visual Studio Code", "visual studio")
        score_miss = universal_app_launcher.match_score("Calculator", "notepad")
        self.assertEqual(score_exact, 100)
        self.assertGreaterEqual(score_prefix, 75)
        self.assertEqual(score_miss, 0)

    def test_terminal_executor_python_execution(self):
        res = terminal_executor.run_command("python", "print(21 * 2)", timeout_sec=10)
        self.assertTrue(res.get("command_succeeded"))
        self.assertEqual(res.get("stdout", "").strip(), "42")

    def test_filesystem_ops_lifecycle(self):
        with tempfile.TemporaryDirectory() as tmp:
            sub = os.path.join(tmp, "notes")
            r_mkdir = filesystem_ops.make_dir(sub)
            self.assertEqual(r_mkdir["action"], "mkdir")

            f1 = os.path.join(sub, "hello.txt")
            r_write = filesystem_ops.write_file(f1, "Xin chào Iris", append=False)
            self.assertEqual(r_write["action"], "write")

            r_append = filesystem_ops.write_file(f1, "\nDòng 2", append=True)
            self.assertEqual(r_append["action"], "append")

            r_read = filesystem_ops.read_file(f1)
            self.assertIn("Xin chào Iris", r_read["content"])
            self.assertIn("Dòng 2", r_read["content"])

            f2 = os.path.join(sub, "copied.txt")
            r_copy = filesystem_ops.copy_item(f1, f2)
            self.assertEqual(r_copy["action"], "copy")
            self.assertTrue(os.path.exists(f2))

            r_list = filesystem_ops.list_dir(sub)
            self.assertEqual(r_list["total_entries"], 2)

            zip_path = os.path.join(tmp, "archive.zip")
            r_zip = filesystem_ops.zip_item(sub, zip_path)
            self.assertEqual(r_zip["action"], "zip")
            self.assertTrue(os.path.exists(zip_path))

            unzip_dir = os.path.join(tmp, "extracted")
            r_unzip = filesystem_ops.unzip_item(zip_path, unzip_dir)
            self.assertEqual(r_unzip["action"], "unzip")
            self.assertTrue(os.path.exists(os.path.join(unzip_dir, "notes", "hello.txt")))

            r_del = filesystem_ops.delete_item(f2)
            self.assertEqual(r_del["action"], "delete")
            self.assertFalse(os.path.exists(f2))

    def test_filesystem_ops_blocks_critical_root(self):
        with self.assertRaises(SystemExit):
            filesystem_ops._check_safe_modify("C:\\Windows")
        with self.assertRaises(SystemExit):
            filesystem_ops._check_safe_modify("C:\\")

    def test_window_manager_list(self):
        res = window_manager.list_windows()
        self.assertEqual(res.get("action"), "list")
        self.assertIsInstance(res.get("windows"), list)

    def test_system_ops_env_and_ports(self):
        res_env = system_ops.list_env("PATH")
        self.assertEqual(res_env.get("action"), "env_list")
        self.assertIn("variables", res_env)
        res_ports = system_ops.list_ports()
        self.assertEqual(res_ports.get("action"), "ports")


if __name__ == "__main__":
    unittest.main()
