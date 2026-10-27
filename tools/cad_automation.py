"""
tools/cad_automation.py — Tự động hoá thiết kế và sinh kịch bản AutoCAD (.SCR / .LSP).

    python tools/cad_automation.py status
    python tools/cad_automation.py generate --output=desktop/draw.scr --template=doraemon
    python tools/cad_automation.py generate --output=desktop/room.scr --template=room --width=5000 --height=4000
    python tools/cad_automation.py generate --output=desktop/rect.scr --template=rect --width=200 --height=100
    python tools/cad_automation.py generate --output=desktop/custom.scr --commands="_CIRCLE 0,0 50\n_ZOOM _E"
    python tools/cad_automation.py run_script desktop/draw.scr

Hỗ trợ shortcut thư mục (desktop, downloads, documents, temp).
"""
import argparse
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import _common  # noqa: E402

_common.ensure_utf8()
from file_explorer import resolve_target_path  # noqa: E402


TEMPLATES = {
    "doraemon": """; Script AutoCAD ve chu meo may Doraemon
_CIRCLE 0,100 80
_CIRCLE 0,90 65
_CIRCLE -16,130 14
_CIRCLE 16,130 14
_CIRCLE -12,130 4
_CIRCLE 12,130 4
_CIRCLE 0,110 10
_LINE 0,100 0,55 
_ARC -45,75 0,45 45,75
_LINE -12,98 -55,106 
_LINE -12,88 -58,88 
_LINE -12,78 -55,70 
_LINE 12,98 55,106 
_LINE 12,88 58,88 
_LINE 12,78 55,70 
_RECTANG -45,20 45,30
_CIRCLE 0,15 12
_LINE -12,17 12,17 
_LINE -12,13 12,13 
_CIRCLE 0,9 3
_ARC -55,20 0,-70 55,20
_CIRCLE 0,-25 45
_LINE -30,-25 30,-25 
_ARC -30,-25 0,-50 30,-25
_ZOOM _E
""",
    "room": """; Script ve phong kien truc tieu chuan
_RECTANG 0,0 {width},{height}
_OFFSET 220 0,0 100,100 
_ZOOM _E
""",
    "rect": """; Script ve hinh chu nhat
_RECTANG {x},{y} {w_end},{h_end}
_ZOOM _E
""",
    "circle": """; Script ve hinh tron
_CIRCLE {x},{y} {radius}
_ZOOM _E
""",
    "grid": """; Script ve he truc toa do cot kien truc
_LINE 0,0 {width},0 
_LINE 0,0 0,{height} 
_LINE 0,{height} {width},{height} 
_LINE {width},0 {width},{height} 
_ZOOM _E
""",
}


def check_autocad_status():
    """Kiểm tra xem AutoCAD (acad.exe) có đang chạy trên Windows hay không."""
    running = False
    pids = []
    try:
        import subprocess

        out = subprocess.check_output(
            ["tasklist", "/FI", "IMAGENAME eq acad.exe", "/FO", "CSV", "/NH"],
            stderr=subprocess.DEVNULL,
            encoding="utf-8",
            errors="ignore",
            timeout=8,
        )
        for line in out.strip().splitlines():
            line = line.strip()
            if line and "acad.exe" in line.lower():
                running = True
                parts = [p.strip('"') for p in line.split('","')]
                if len(parts) >= 2 and parts[1].isdigit():
                    pids.append(int(parts[1]))
    except Exception:
        pass
    return {"running": running, "process": "acad.exe", "pids": pids}


def generate_script(output_path, template_name="custom", commands=None, **kwargs):
    """Sinh file .scr AutoCAD dựa trên mẫu hoặc chuỗi lệnh tuỳ biến."""
    resolved = resolve_target_path(output_path)
    os.makedirs(os.path.dirname(resolved), exist_ok=True)

    content = ""
    template_key = (template_name or "custom").lower().strip()

    if commands and str(commands).strip():
        content = str(commands).strip() + "\n"
    elif template_key in TEMPLATES:
        tmpl = TEMPLATES[template_key]
        w = float(kwargs.get("width") or 5000)
        h = float(kwargs.get("height") or 4000)
        x = float(kwargs.get("x") or 0)
        y = float(kwargs.get("y") or 0)
        r = float(kwargs.get("radius") or 500)
        content = tmpl.format(
            width=w,
            height=h,
            x=x,
            y=y,
            w_end=x + w,
            h_end=y + h,
            radius=r,
        )
    else:
        content = "; Script AutoCAD tao boi Iris AI\n_ZOOM _E\n"

    # Đảm bảo kết thúc bằng dấu xuống dòng để AutoCAD nạp lệnh cuối
    if not content.endswith("\n"):
        content += "\n"

    with open(resolved, "w", encoding="utf-8", newline="\r\n") as f:
        f.write(content)

    return {
        "path": resolved,
        "template": template_key,
        "bytes": len(content.encode("utf-8")),
        "line_count": len(content.splitlines()),
    }


def execute_script(script_path):
    """Nạp file kịch bản vào AutoCAD đang chạy hoặc mở bằng ứng dụng mặc định."""
    resolved = resolve_target_path(script_path)
    if not os.path.exists(resolved):
        _common.fail(f"Không tìm thấy file kịch bản: {resolved}")

    status = check_autocad_status()
    dispatched = False
    method = "file_ready"

    # Thử qua COM nếu AutoCAD đang chạy và máy có pywin32
    if status["running"]:
        try:
            import win32com.client

            acad = win32com.client.Dispatch("AutoCAD.Application")
            doc = acad.ActiveDocument
            if doc:
                doc.SendCommand(f'_SCRIPT "{resolved}"\n')
                dispatched = True
                method = "com_sendcommand"
        except Exception:
            pass

    return {
        "path": resolved,
        "autocad_running": status["running"],
        "dispatched": dispatched,
        "method": method,
        "instruction": f'Mo AutoCAD va go lenh: SCRIPT roi chon file "{resolved}"',
    }


def main():
    parser = argparse.ArgumentParser(description="Tự động hoá thiết kế và sinh script AutoCAD.")
    sub = parser.add_subparsers(dest="action", required=True)

    # status
    sub.add_parser("status", help="Kiểm tra trạng thái AutoCAD đang chạy")

    # generate
    gen_p = sub.add_parser("generate", help="Sinh file kịch bản .scr")
    gen_p.add_argument("--output", "-o", default="desktop/autocad_iris.scr", help="Đường dẫn file .scr xuất ra")
    gen_p.add_argument("--template", "-t", default="doraemon", choices=list(TEMPLATES.keys()) + ["custom"])
    gen_p.add_argument("--commands", "-c", default="", help="Chuỗi lệnh AutoCAD tuỳ biến")
    gen_p.add_argument("--width", type=float, default=5000, help="Chiều rộng (mm)")
    gen_p.add_argument("--height", type=float, default=4000, help="Chiều cao (mm)")
    gen_p.add_argument("--radius", type=float, default=500, help="Bán kính (mm)")
    gen_p.add_argument("--x", type=float, default=0, help="Toạ độ X gốc")
    gen_p.add_argument("--y", type=float, default=0, help="Toạ độ Y gốc")

    # run_script
    run_p = sub.add_parser("run_script", help="Nạp và chạy script trong AutoCAD")
    run_p.add_argument("path", help="Đường dẫn file .scr")

    args = parser.parse_args()

    if args.action == "status":
        _common.emit(True, **check_autocad_status())
    elif args.action == "generate":
        # Hỗ trợ đọc commands từ stdin nếu truyền --commands=-
        raw_cmd = args.commands
        if raw_cmd == "-":
            raw_cmd = sys.stdin.read()
        res = generate_script(
            args.output,
            template_name=args.template,
            commands=raw_cmd,
            width=args.width,
            height=args.height,
            radius=args.radius,
            x=args.x,
            y=args.y,
        )
        _common.emit(True, **res)
    elif args.action == "run_script":
        res = execute_script(args.path)
        _common.emit(True, **res)


if __name__ == "__main__":
    main()
