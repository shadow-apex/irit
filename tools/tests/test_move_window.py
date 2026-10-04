import unittest
import _path  # noqa: F401
import move_window


class MoveWindowSafety(unittest.TestCase):
    def test_no_shell_or_powershell_in_source(self):
        # TL-01: không còn PowerShell/C# biên dịch lúc chạy ⇒ không có chỗ để nội suy tiêu đề vào mã.
        with open(move_window.__file__, encoding="utf-8") as f:
            src = f.read()
        for bad in ("Add-Type", "-Command", "subprocess", "shell=True", "os.system", "Invoke-Expression"):
            self.assertNotIn(bad, src, bad)

    def test_validate_accepts_normal_and_injection_strings_as_plain_text(self):
        self.assertEqual(move_window.validate_window_title("  Notepad "), "Notepad")
        evil = "x'); calc; ('"
        self.assertEqual(move_window.validate_window_title(evil), evil)  # hợp lệ nhưng chỉ là dữ liệu

    def test_validate_rejects_bad_titles(self):
        for bad in ("", "   ", "a" * 201, "abc\x00def", "line\nbreak", 5):
            with self.assertRaises(ValueError):
                move_window.validate_window_title(bad)

    def test_parser_accepts_negative_coords_and_options(self):
        a = move_window.build_parser().parse_args(["Notepad", "-1920", "-5", "--width=300", "--height=200"])
        self.assertEqual((a.x, a.y, a.width, a.height), (-1920, -5, 300, 200))


if __name__ == "__main__":
    unittest.main()
