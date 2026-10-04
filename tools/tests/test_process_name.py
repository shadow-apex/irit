import unittest
import _path  # noqa: F401
import _common
import _procutil


class ProcessName(unittest.TestCase):
    def test_accepts_and_appends_exe(self):
        self.assertEqual(_common.validate_process_name("chrome"), "chrome.exe")
        self.assertEqual(_common.validate_process_name("  Code.exe "), "Code.exe")
        self.assertEqual(_common.validate_process_name("My App (x86).exe"), "My App (x86).exe")

    def test_rejects_wildcards_paths_empty_long(self):
        for bad in ("*", "*.exe", "chr*", "chrome?", "..\\x", "a/b", "C:\\x.exe", "", "   ", "a" * 65, "-evil", "a;b", None, 5):
            with self.assertRaises(ValueError, msg=repr(bad)):
                _common.validate_process_name(bad)

    def test_protected_processes_refused_any_case(self):
        for p in ("explorer.exe", "EXPLORER", "winlogon", "csrss.exe", "lsass.exe", "svchost", "dwm.exe",
                  "electron.exe", "Iris.exe", "claude.exe", "node.exe", "python.exe", "pythonw", "wininit.exe", "services.exe"):
            with self.assertRaises(ValueError, msg=p):
                _common.validate_process_name(p)

    def test_env_can_extend_protection(self):
        import os
        os.environ["IRIS_PROTECTED_PROCESSES"] = "keepme.exe"
        try:
            with self.assertRaises(ValueError):
                _common.validate_process_name("KeepMe")
        finally:
            del os.environ["IRIS_PROTECTED_PROCESSES"]

    def test_classify_close_result(self):
        self.assertEqual(_procutil.classify_close_result(0, 0, False, [])[0], False)
        ok, msg = _procutil.classify_close_result(3, 0, False, [])
        self.assertTrue(ok); self.assertIn("3/3", msg)
        ok, msg = _procutil.classify_close_result(3, 2, False, [])
        self.assertFalse(ok); self.assertIn("force", msg)   # đóng êm chưa xong ⇒ KHÔNG báo thành công
        ok, _ = _procutil.classify_close_result(2, 1, True, ["denied"])
        self.assertFalse(ok)


if __name__ == "__main__":
    unittest.main()
