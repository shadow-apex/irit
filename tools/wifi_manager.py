"""
tools/wifi_manager.py — quản lý Wi-Fi qua netsh (không cần cài thêm).

    python tools/wifi_manager.py list | profiles | status | disconnect
    python tools/wifi_manager.py connect -- "TenWifi"      # chỉ với SSID ĐÃ có profile lưu sẵn

TL-10: không còn phụ thuộc nhãn tiếng Anh và không giả định UTF-8. `netsh` xuất theo code page OEM
(vd. cp1258 trên Windows tiếng Việt) ⇒ đọc BYTES rồi giải mã (UTF-8 → OEM). Phân tích dựa vào cấu
trúc (token `SSID n :`, `\\d+%`, dòng thụt lề `khoá : giá trị`) chứ không dựa vào chữ "All User Profile"…
Mật khẩu Wi-Fi KHÔNG bao giờ đi qua argv.
"""
import os
import re
import subprocess
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import _common  # noqa: E402

_AUTH_RE = re.compile(r"\b(Open|OWE|WEP|WPA3?(?:-\w+)?|WPA2(?:-\w+)?)\b", re.I)


def parse_networks(text):
    """`netsh wlan show networks mode=bssid` → [{ssid, signal, auth}] (không phụ thuộc ngôn ngữ)."""
    networks, cur = [], None
    for raw in text.splitlines():
        line = raw.strip()
        m = re.match(r"^SSID\s+\d+\s*:\s*(.*)$", line)
        if m:
            if cur:
                networks.append(cur)
            cur = {"ssid": m.group(1).strip(), "signal": None, "auth": None}
            continue
        if cur is None:
            continue
        if cur["signal"] is None:
            ms = re.search(r"(\d{1,3})\s*%", line)
            if ms:
                cur["signal"] = f"{ms.group(1)}%"
                continue
        if cur["auth"] is None and ":" in line:
            ma = _AUTH_RE.search(line.split(":", 1)[1])
            if ma:
                cur["auth"] = ma.group(1)
    if cur:
        networks.append(cur)
    return networks


def parse_profiles(text):
    """`netsh wlan show profiles` → tên profile: mọi dòng THỤT LỀ dạng `nhãn : tên` (bỏ <None>/rỗng)."""
    out = []
    for raw in text.splitlines():
        if not raw[:1].isspace() or ":" not in raw:
            continue
        value = raw.split(":", 1)[1].strip()
        if value and value.lower() not in ("<none>", "<không có>", "none") and value not in out:
            out.append(value)
    return out


def parse_status(text):
    info = {}
    for raw in text.splitlines():
        if ":" in raw:
            k, _, v = raw.strip().partition(":")
            k, v = k.strip(), v.strip()
            if k and v:
                info[k] = v
    return info


def validate_ssid(ssid):
    if not isinstance(ssid, str) or not ssid.strip():
        raise ValueError("SSID rỗng.")
    s = ssid.strip()
    if len(s) > 32:
        raise ValueError("SSID dài quá 32 ký tự.")
    if any(ord(c) < 32 or ord(c) == 127 for c in s):
        raise ValueError("SSID chứa ký tự điều khiển.")
    return s


def _run(args):
    r = subprocess.run(["netsh"] + args, capture_output=True)
    return r.returncode, _common.decode_bytes(r.stdout), _common.decode_bytes(r.stderr)


def build_parser():
    p = _common.ArgParser(description="Quản lý Wi-Fi qua netsh")
    sub = p.add_subparsers(dest="command", required=True)
    for n in ("list", "profiles", "disconnect", "status"):
        sub.add_parser(n)
    c = sub.add_parser("connect")
    c.add_argument("ssid")
    return p


if __name__ == "__main__":
    _common.ensure_utf8()
    a = build_parser().parse_args()
    if a.command == "list":
        code, out, err = _run(["wlan", "show", "networks", "mode=bssid"])
        if code != 0:
            _common.fail((err or out).strip() or "Không quét được Wi-Fi (adapter Wi-Fi đã bật chưa?).")
        _common.emit(True, networks=parse_networks(out))
    elif a.command == "profiles":
        code, out, err = _run(["wlan", "show", "profiles"])
        if code != 0:
            _common.fail((err or out).strip() or "Không đọc được profile Wi-Fi.")
        _common.emit(True, profiles=parse_profiles(out))
    elif a.command == "status":
        code, out, err = _run(["wlan", "show", "interfaces"])
        if code != 0:
            _common.fail((err or out).strip() or "Không đọc được trạng thái Wi-Fi.")
        _common.emit(True, status=parse_status(out))
    elif a.command == "disconnect":
        code, out, err = _run(["wlan", "disconnect"])
        if code != 0:
            _common.fail((err or out).strip() or "Không ngắt được Wi-Fi.")
        _common.emit(True, message="Đã ngắt kết nối Wi-Fi.")
    else:
        try:
            ssid = validate_ssid(a.ssid)
        except ValueError as e:
            _common.fail(str(e))
        # Chỉ tin mã thoát (không tìm chữ 'completed successfully' — sai trên Windows tiếng Việt).
        code, out, err = _run(["wlan", "connect", f"name={ssid}"])
        if code != 0:
            _common.fail(f"{(out or err).strip() or 'Không kết nối được.'} (SSID phải đã có profile lưu sẵn.)")
        _common.emit(True, message=f"Đã gửi yêu cầu kết nối tới '{ssid}'. Kiểm tra bằng action 'status'.")
