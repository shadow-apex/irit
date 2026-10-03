"""
tools/focus_assist.py

LUU Y QUAN TRONG: Windows KHONG cong bo CLI/API chinh thuc nao de bat/tat
"Focus Assist" (Chan thong bao) truc tiep tu script. Cac cach lam dieu nay
luu hanh tren mang deu dua vao doc/ghi mot registry key dang nhi phan
KHONG duoc Microsoft cong bo chinh thuc — cau truc co the khac nhau giua
cac ban Windows Update va de gay loi ngam neu ghi sai gia tri.

De tranh rui ro ghi sai vao registry va lam hong cai dat thong bao cua
nguoi dung bang mot "hack" khong chac chan, tool nay CHU DONG khong tu
dong sua registry. Thay vao do no mo dung trang Settings cua Focus Assist
bang URI chinh thuc duoc Windows ho tro (ms-settings:quiethours), de nguoi
dung (hoac AI huong dan nguoi dung) bam chon che do mong muon bang 1-2 cai
click — an toan 100%, khong dung ky thuat reverse-engineer nao ca.

Vi du dung:
    python tools/focus_assist.py open
"""
import sys
import io
import json
import subprocess

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")
sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding="utf-8")


def open_focus_assist_settings():
    try:
        subprocess.run(["cmd", "/c", "start", "", "ms-settings:quiethours"], check=True)
        return {
            "success": True,
            "message": "Da mo trang cai dat Focus Assist.",
            "instructions": "Khong co API chinh thuc de bat/tat Focus Assist ngam duoc — hay bam chon che do mong muon (Tat / Chi uu tien / Chi bao thuc) tren man hinh Settings vua mo.",
        }
    except Exception as e:
        return {"success": False, "error": str(e)}


if __name__ == "__main__":
    print(json.dumps(open_focus_assist_settings(), ensure_ascii=False))
