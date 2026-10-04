import unittest
import _path  # noqa: F401
import idle_time


class IdleTime(unittest.TestCase):
    def test_normal(self):
        self.assertEqual(idle_time.compute_idle_ms(10_000, 7_000), 3_000)

    def test_uptime_over_2_pow_31(self):
        tick = 2 ** 31 + 5_000          # ~24,8 ngày: bản cũ cho số ÂM
        last = 2 ** 31 + 2_000
        self.assertEqual(idle_time.compute_idle_ms(tick, last), 3_000)

    def test_wraparound_2_pow_32(self):
        # tick64 đã vượt 2^32 trong khi dwTime (32-bit) đã quay vòng
        tick64 = 2 ** 32 + 1_000
        last_dword = 2 ** 32 - 4_000
        self.assertEqual(idle_time.compute_idle_ms(tick64, last_dword), 5_000)

    def test_never_negative(self):
        for t, l in ((0, 0), (5, 5), (2 ** 33 + 7, 2 ** 31), (100, 4_294_967_000)):
            self.assertGreaterEqual(idle_time.compute_idle_ms(t, l), 0)


if __name__ == "__main__":
    unittest.main()
