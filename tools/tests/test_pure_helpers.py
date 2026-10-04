import json
import os
import random
import tempfile
import unittest

import _path  # noqa: F401
import _common
import _winutil
import clipboard_history as ch
import mouse_control as mc
import ocr_region
import read_notifications as rn
import search_everything as se
import sys_control
import system_actions
import wifi_manager as wm
import image_viewer as iv

BOUNDS = (-1920, 0, 1919, 1079)     # 2 màn hình: phụ bên trái (âm) + chính


class MouseGeometry(unittest.TestCase):
    def test_to_int_rounds_floats_and_strings(self):
        self.assertEqual(mc.to_int("123.5"), 124)
        self.assertEqual(mc.to_int("-5"), -5)
        self.assertEqual(mc.to_int(7.4), 7)

    def test_secondary_monitor_not_forced_into_primary(self):
        # TL-05: x âm (màn hình phụ bên trái) KHÔNG bị ép về 0
        x, y, adj = mc.resolve_target(-1500, 400, BOUNDS)
        self.assertEqual((x, y), (-1500, 400)); self.assertFalse(adj)

    def test_clamps_outside_virtual_screen(self):
        x, y, adj = mc.resolve_target(99999, 99999, BOUNDS)
        self.assertLessEqual(x, 1919); self.assertLessEqual(y, 1079)
        self.assertTrue(adj)

    def test_corners_are_avoided(self):
        for cx, cy in ((-1920, 0), (1919, 0), (-1920, 1079), (1919, 1079), (0, 0)):
            x, y = mc.avoid_failsafe(cx, cy, BOUNDS)
            self.assertNotEqual((x, y), (cx, cy))
            self.assertGreater(abs(x - cx) + abs(y - cy), mc.FAILSAFE_MARGIN)

    def test_monitor_relative(self):
        mons = [{"left": 0, "top": 0, "right": 1920, "bottom": 1080},
                {"left": -1280, "top": 100, "right": 0, "bottom": 1124}]
        x, y, _ = mc.resolve_target(200, 300, BOUNDS, mons, 1)
        self.assertEqual((x, y), (-1080, 400))
        with self.assertRaises(ValueError):
            mc.resolve_target(1, 1, BOUNDS, mons, 5)

    def test_every_bezier_point_inside_and_off_corners(self):
        rng = random.Random(7)
        for _ in range(200):
            a = (rng.randint(-1920, 1919), rng.randint(0, 1079))
            b = (rng.choice([-1920, 0, 1919]), rng.choice([0, 1079]))     # đích hay là góc!
            path = mc.safe_path(a, b, BOUNDS, 30, 0.25, rng)
            for px, py in path:
                self.assertTrue(BOUNDS[0] <= px <= BOUNDS[2] and BOUNDS[1] <= py <= BOUNDS[3])
                for cx, cy in ((-1920, 0), (1919, 0), (-1920, 1079), (1919, 1079), (0, 0)):
                    self.assertFalse(abs(px - cx) <= mc.FAILSAFE_MARGIN and abs(py - cy) <= mc.FAILSAFE_MARGIN, (px, py))

    def test_parser_negative_and_float(self):
        a = mc.build_parser().parse_args(["click", "-1500", "300.7", "--fast", "--monitor=1"])
        self.assertEqual((a.x, a.y, a.monitor, a.fast_mode), (-1500, 301, 1, True))
        a = mc.build_parser().parse_args(["drag", "1", "2", "3", "4"])
        self.assertEqual(a.command, "drag")
        self.assertEqual(mc.build_parser().parse_args(["release"]).command, "release")


class WindowSelection(unittest.TestCase):
    W = [
        {"hwnd": 1, "pid": 100, "title": "Notes - Notepad", "exe": "notepad.exe"},
        {"hwnd": 2, "pid": 101, "title": "Iris", "exe": "electron.exe"},
        {"hwnd": 3, "pid": 102, "title": "Docs - Google Chrome", "exe": "chrome.exe"},
        {"hwnd": 4, "pid": 103, "title": "Inbox - Google Chrome", "exe": "chrome.exe"},
        {"hwnd": 5, "pid": 104, "title": "Visual Studio Code", "exe": "Code.exe"},
        {"hwnd": 6, "pid": 105, "title": "Iris settings", "exe": "notepad.exe"},
    ]

    def test_exact_exe_first(self):
        self.assertEqual([w["hwnd"] for w in _winutil.select_windows(self.W, "chrome")], [3, 4])
        self.assertEqual([w["hwnd"] for w in _winutil.select_windows(self.W, "Code.exe")], [5])

    def test_iris_windows_excluded(self):
        self.assertEqual(_winutil.select_windows(self.W, "iris"), [self.W[5]])  # chỉ tiêu đề; electron.exe bị loại
        self.assertEqual(_winutil.select_windows(self.W, "electron"), [])
        self.assertEqual(_winutil.select_windows(self.W, "x", self_pid=0), [])
        self.assertNotIn(self.W[1], _winutil.select_windows(self.W, "Iris", self_pid=101))
        self.assertEqual(_winutil.select_windows(self.W, "notepad", self_pid=100), [self.W[5]])

    def test_short_title_does_not_match(self):
        self.assertEqual(_winutil.select_windows(self.W, "co"), [])     # < 4 ký tự: không khớp tiêu đề
        self.assertEqual(_winutil.select_windows(self.W, "code")[0]["hwnd"], 5)  # = tên exe

    def test_title_substring_when_no_exe(self):
        self.assertEqual([w["hwnd"] for w in _winutil.select_windows(self.W, "Studio")], [5])
        self.assertEqual(_winutil.select_windows(self.W, ""), [])


class HiddenLedger(unittest.TestCase):
    def test_roundtrip_atomic(self):
        with tempfile.TemporaryDirectory() as d:
            p = os.path.join(d, "hidden.json")
            self.assertEqual(system_actions.load_ledger(p), [])
            system_actions.save_ledger([{"hwnd": 9, "pid": 1, "title": "t", "exe": "a.exe"}], p)
            self.assertEqual(system_actions.load_ledger(p)[0]["hwnd"], 9)
            with open(p, "w") as f:
                f.write("{bad json")
            self.assertEqual(system_actions.load_ledger(p), [])      # file hỏng ⇒ không ném


class WifiParsing(unittest.TestCase):
    EN = "SSID 1 : Home\n    Network type : Infrastructure\n    Authentication : WPA2-Personal\n    BSSID 1 : aa:bb\n         Signal : 87%\nSSID 2 : Cafe\n    Authentication : Open\n         Signal : 40%\n"
    VI = "SSID 1 : Nhà Tôi\n    Loại mạng : Cơ sở hạ tầng\n    Xác thực : WPA2-Personal\n    BSSID 1 : aa:bb\n         Tín hiệu : 91%\n"

    def test_networks_english(self):
        n = wm.parse_networks(self.EN)
        self.assertEqual([(x["ssid"], x["signal"], x["auth"]) for x in n], [("Home", "87%", "WPA2-Personal"), ("Cafe", "40%", "Open")])

    def test_networks_vietnamese_labels(self):
        n = wm.parse_networks(self.VI)
        self.assertEqual(n[0]["ssid"], "Nhà Tôi"); self.assertEqual(n[0]["signal"], "91%"); self.assertEqual(n[0]["auth"], "WPA2-Personal")

    def test_profiles_any_language(self):
        en = "Profiles on interface Wi-Fi:\n\nGroup policy profiles (read only)\n---------------------------------\n    <None>\n\nUser profiles\n-------------\n    All User Profile     : Home\n    All User Profile     : Cafe 5G\n"
        vi = "Cấu hình trên giao diện Wi-Fi:\n\nHồ sơ người dùng\n-------------\n    Tất cả hồ sơ người dùng : Nhà Tôi\n"
        self.assertEqual(wm.parse_profiles(en), ["Home", "Cafe 5G"])
        self.assertEqual(wm.parse_profiles(vi), ["Nhà Tôi"])

    def test_status_and_ssid_validation(self):
        self.assertEqual(wm.parse_status("    Name : Wi-Fi\n    State : connected\n")["State"], "connected")
        for bad in ("", "x" * 33, "a\x07b", None):
            with self.assertRaises(ValueError):
                wm.validate_ssid(bad)
        self.assertEqual(wm.validate_ssid(" Nhà Tôi "), "Nhà Tôi")


class Encoding(unittest.TestCase):
    def test_utf8_and_oem(self):
        self.assertEqual(_common.decode_bytes("Đường dẫn".encode("utf-8")), "Đường dẫn")
        # cp1258 = code page OEM/ANSI tiếng Việt: byte 0xE0 là "à", 0xEA là "ê" (không phải UTF-8 hợp lệ)
        raw = "Cà phê".encode("cp1258")
        self.assertEqual(_common.decode_bytes(raw, oem_cp=1258), "Cà phê")
        self.assertEqual(_common.decode_bytes(b"\xff\xfe", oem_cp=None) != "", True)   # không bao giờ ném
        self.assertEqual(_common.decode_bytes(None), "")

    def test_search_parse_and_query_validation(self):
        self.assertEqual(se.parse_results("C:\\a b\\x.txt\r\n\r\nD:\\y\r\n".encode()), ["C:\\a b\\x.txt", "D:\\y"])
        for bad in ("-n 99999", "/a", "", "  ", "x" * 201, "a\x00b"):
            with self.assertRaises(ValueError):
                se.validate_query(bad)
        self.assertEqual(se.validate_query("tài liệu"), "tài liệu")


class ClipboardPrivacy(unittest.TestCase):
    def test_sensitive_detection(self):
        for s in ("123456", "4111 1111 1111 1111", "4111111111111111", "P@ssw0rd!2024", "Xk9#mQ2$vL8z"):
            self.assertTrue(ch.looks_sensitive(s), s)
        for s in ("hello world", "https://example.com/path?x=1", "Ghi chú họp ngày mai", "1234567890123", "ngày 12/03", ""):
            self.assertFalse(ch.looks_sensitive(s), s)

    def test_luhn(self):
        self.assertTrue(ch.luhn_ok("4111111111111111")); self.assertFalse(ch.luhn_ok("4111111111111112"))

    def test_prune_ttl_and_cap(self):
        items = [{"text": str(i), "ts": 1000 + i} for i in range(30)]
        out = ch.prune(items, now=1000 + 29, ttl=600)
        self.assertEqual(len(out), ch.MAX_ENTRIES); self.assertEqual(out[-1]["text"], "29")
        self.assertEqual(ch.prune(items, now=5000, ttl=600), [])

    def test_pid_record_must_match_create_time_and_cmdline(self):
        rec = {"pid": 5, "create_time": 1000.0}
        self.assertTrue(ch.pid_record_matches(rec, 1000.4, ["python", "x/clipboard_history.py", "_run"]))
        self.assertFalse(ch.pid_record_matches(rec, 5000.0, ["python", "clipboard_history.py"]))   # PID bị tái sử dụng
        self.assertFalse(ch.pid_record_matches(rec, 1000.0, ["chrome.exe"]))                       # tiến trình khác
        self.assertFalse(ch.pid_record_matches({}, 1, []))

    def test_disabled_by_default(self):
        os.environ.pop("IRIS_CLIPBOARD_HISTORY", None)
        with self.assertRaises(SystemExit):
            ch._require_enabled()


class Otp(unittest.TestCase):
    def test_mask(self):
        self.assertEqual(rn.mask_otp("Mã xác thực của bạn là 123456"), "Mã xác thực của bạn là ****")
        self.assertEqual(rn.mask_otp("Your code is 4821"), "Your code is ****")
        self.assertEqual(rn.mask_otp("Make 2 matches at 1234"), "Make 2 matches at 1234")
        self.assertEqual(rn.mask_notification_texts(["Zalo", "OTP 998877"]), ["Zalo", "OTP ****"])
        self.assertEqual(rn.mask_notification_texts(["OTP 998877"], reveal=True), ["OTP 998877"])


class Ocr(unittest.TestCase):
    def test_lang_pick(self):
        self.assertEqual(ocr_region.pick_lang("deu", ["eng"], ""), ("deu", None))
        self.assertEqual(ocr_region.pick_lang(None, ["eng", "vie"], "fra"), ("fra", None))
        self.assertEqual(ocr_region.pick_lang(None, ["eng", "vie"], ""), ("vie+eng", None))
        lang, warn = ocr_region.pick_lang(None, ["eng"], "")
        self.assertEqual(lang, "eng"); self.assertIn("vie", warn)

    def test_downscale(self):
        self.assertEqual(ocr_region.downscale_size(1000, 500), (1000, 500, 1.0))
        w, h, f = ocr_region.downscale_size(4800, 2700)
        self.assertEqual(w, 2400); self.assertEqual(h, 1350); self.assertAlmostEqual(f, 0.5)

    def test_region_parsing_floats_negative(self):
        a = ocr_region.build_parser().parse_args(["--region", "-100", "10.6", "300", "200"])
        self.assertEqual(a.region, [-100, 11, 300, 200])


class SysControl(unittest.TestCase):
    def test_volume_plan(self):
        self.assertEqual(sys_control.volume_key_plan(0), (50, 0))
        self.assertEqual(sys_control.volume_key_plan(50), (50, 25))
        self.assertEqual(sys_control.volume_key_plan(100), (50, 50))
        self.assertEqual(sys_control.volume_key_plan(999), (50, 50))
        self.assertEqual(sys_control.volume_key_plan(-4), (50, 0))

    def test_encoded_command_roundtrip_and_no_user_data(self):
        import base64
        for dev in ("bluetooth", "camera"):
            for st in ("on", "off"):
                script = sys_control.hardware_inner_script(dev, st)
                self.assertEqual(base64.b64decode(sys_control.encode_ps("é" + script)).decode("utf-16-le"), "é" + script)
                self.assertIn("exit 2", script)
        self.assertIn("Disable-PnpDevice", sys_control.hardware_inner_script("camera", "off"))
        self.assertIn("$env:IRIS_BRIGHTNESS", sys_control._BRIGHTNESS_PS)       # mức sáng qua BIẾN MÔI TRƯỜNG
        self.assertNotIn("{", sys_control._BRIGHTNESS_PS.replace("@{", "").replace("{ exit", "").replace("}", ""))


class ImageViewer(unittest.TestCase):
    def test_step_index(self):
        self.assertEqual(iv.step_index(-1, 3, "latest"), 0)
        self.assertEqual(iv.step_index(0, 3, "prev"), 1)       # prev = cũ hơn
        self.assertEqual(iv.step_index(2, 3, "prev"), None)
        self.assertEqual(iv.step_index(1, 3, "next"), 0)
        self.assertEqual(iv.step_index(0, 3, "next"), None)
        self.assertEqual(iv.step_index(0, 0, "latest"), None)

    def test_lists_jpg_and_png_newest_first(self):
        with tempfile.TemporaryDirectory() as d:
            for i, n in enumerate(("a.png", "b.jpg", "c.txt", "d.jpeg")):
                p = os.path.join(d, n)
                with open(p, "w"):
                    pass
                os.utime(p, (1000 + i, 1000 + i))
            self.assertEqual([os.path.basename(x) for x in iv.list_images(d)], ["d.jpeg", "b.jpg", "a.png"])


if __name__ == "__main__":
    unittest.main()
