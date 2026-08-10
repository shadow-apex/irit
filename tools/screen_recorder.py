"""
tools/screen_recorder.py

FIX (2026):
  - Loi "quay video nhung khong co tieng": code cu tu do WASAPI loopback
    device bang cach doi ten thu cong (for loopback in generator: if
    default_spk["name"] in loopback["name"]). Neu KHONG tim thay ten khop
    (rat hay xay ra vi ten loopback device khac ten output device tren
    nhieu may), bien default_spk van la thiet bi OUTPUT that (khong phai
    loopback) -> maxInputChannels=0 -> wave.open() van tao ra file .wav
    "0 kenh" hong -> p.open() nem loi (bi nuot boi except: pass) -> file wav
    he thong bi hong/rong -> ffmpeg mix loi -> video cuoi cung KHONG co
    tieng he thong (va neu mic cung tat thi video hoan toan cam lang).
    -> Sua bang pyaudiowpatch.PyAudio.get_default_wasapi_loopback(), ham co
    san chuyen de lam dung viec nay, tra loi loi ro rang neu khong co
    loopback device thay vi fallback sai.
  - Them co che dieu khien tu xa qua CMD_FILE (giong nhu "stop" da co san):
    pause / resume / mic_on / mic_off, de Iris (AI) co the goi truc tiep
    thay vi nguoi dung phai bam nut nho tren thanh overlay. Xem
    RECORDER_STATUS_FILE + cac action moi trong argparse o cuoi file.
  - Ghi trang thai (dang ghi / da tam dung / mic bat hay tat) ra
    RECORDER_STATUS_FILE moi khi thay doi, de action "status" tra ve dung
    trang thai hien tai thay vi chi biet "co dang chay hay khong".
  - Loi audio (sys/mic) gio duoc ghi vao videos/error.log va tra ve trong
    ket qua JSON cuoi cung (truong "audio_status") thay vi nuot lang le,
    de nguoi dung/Iris biet duoc vi sao mot video nao do lai khong co tieng.
"""
import os
import sys
import argparse
import time
import subprocess
import json
import psutil
from datetime import datetime
import threading
import tkinter as tk

CMD_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "recorder_cmd.txt")
VID_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "videos")
STATUS_FILE = os.path.join(VID_DIR, "recorder_status.json")
ERROR_LOG = os.path.join(VID_DIR, "error.log")


def _log_error(tag, exc):
    """Ghi loi ra videos/error.log thay vi nuot lang le (except: pass),
    de con debug duoc vi sao mot lan ghi hinh nao do bi mat tieng/loi."""
    try:
        if not os.path.exists(VID_DIR):
            os.makedirs(VID_DIR)
        with open(ERROR_LOG, "a", encoding="utf-8") as f:
            f.write(f"[{datetime.now().isoformat()}] {tag}: {exc}\n")
    except Exception:
        pass


def write_status(**kwargs):
    """Ghi trang thai hien tai cua daemon (dang ghi/tam dung/mic) ra file,
    de action 'status' tu tien trinh khac (CLI do Iris goi) doc duoc trang
    thai THAT chu khong chi biet daemon con song hay khong."""
    try:
        data = {}
        if os.path.exists(STATUS_FILE):
            try:
                with open(STATUS_FILE, "r", encoding="utf-8") as f:
                    data = json.load(f)
            except Exception:
                data = {}
        data.update(kwargs)
        data["updated_at"] = datetime.now().isoformat()
        with open(STATUS_FILE, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False)
    except Exception:
        pass


def read_status():
    try:
        with open(STATUS_FILE, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return {}


def is_daemon_running():
    for p in psutil.process_iter(['name', 'cmdline']):
        try:
            cmd = p.info.get('cmdline')
            if cmd and 'python' in p.info.get('name', '').lower() and 'screen_recorder.py' in ' '.join(cmd) and '--action' in ' '.join(cmd) and 'daemon' in ' '.join(cmd):
                return True
        except (psutil.NoSuchProcess, psutil.AccessDenied):
            pass
    return False

def write_command(cmd, window=None):
    data = {"cmd": cmd, "window": window}
    with open(CMD_FILE, 'w') as f:
        json.dump(data, f)

def run_daemon():
    import mss
    import cv2
    import numpy as np
    import pygetwindow as gw
    import pyaudiowpatch as pyaudio
    import wave
    
    if not os.path.exists(VID_DIR):
        os.makedirs(VID_DIR)

    window_title = None
    if os.path.exists(CMD_FILE):
        try:
            with open(CMD_FILE, 'r') as f:
                data = json.load(f)
                if data.get('window'):
                    window_title = data.get('window')
            os.remove(CMD_FILE)
        except:
            pass
            
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    temp_video = os.path.abspath(os.path.join(VID_DIR, f"temp_{timestamp}.avi"))
    temp_sys_audio = os.path.abspath(os.path.join(VID_DIR, f"sys_{timestamp}.wav"))
    temp_mic_audio = os.path.abspath(os.path.join(VID_DIR, f"mic_{timestamp}.wav"))
    final_video = os.path.abspath(os.path.join(VID_DIR, f"record_{timestamp}.mp4"))
    
    sct = mss.mss()
    monitor = sct.monitors[1] 
    
    if window_title:
        try:
            windows = gw.getWindowsWithTitle(window_title)
            if windows:
                win = windows[0]
                left = max(0, win.left)
                top = max(0, win.top)
                width = min(monitor['width'] - left, win.width)
                height = min(monitor['height'] - top, win.height)
                if width > 0 and height > 0:
                    monitor = {"top": top, "left": left, "width": width, "height": height}
        except:
            pass

    fourcc = cv2.VideoWriter_fourcc(*'XVID') 
    fps = 24.0
    out = cv2.VideoWriter(temp_video, fourcc, fps, (monitor['width'], monitor['height']))
    frame_interval = int(1000 / fps)

    # ---------------- UI Setup ----------------
    root = tk.Tk()
    root.title("Iris Recorder")
    root.geometry("380x45+10+10")
    root.attributes("-topmost", True)
    root.attributes("-alpha", 0.9)
    root.overrideredirect(True)
    root.configure(bg="#222222")

    is_paused = False
    is_stopped = False
    is_mic_on = False

    write_status(is_paused=False, is_mic_on=False, is_recording=True, window=window_title, processing=False)

    record_start_time = time.time()
    total_paused_time = 0
    pause_start_time = 0

    def get_formatted_time():
        if is_stopped:
            return "00:00"
        elapsed = time.time() - record_start_time - total_paused_time
        if is_paused:
            elapsed = pause_start_time - record_start_time - total_paused_time
        mins = int(elapsed // 60)
        secs = int(elapsed % 60)
        return f"{mins:02d}:{secs:02d}"
        
    lbl_time = tk.Label(root, text="00:00", font=("Consolas", 14, "bold"), bg="#222222", fg="white")
    lbl_time.place(x=35, y=10)

    canvas = tk.Canvas(root, width=16, height=16, bg="#222222", highlightthickness=0)
    canvas.place(x=10, y=14)
    dot = canvas.create_oval(2, 2, 14, 14, fill="#ff3333", outline="#ff3333")
    
    dot_visible = True
    def toggle_dot():
        nonlocal dot_visible
        if not is_paused and not is_stopped:
            if dot_visible:
                canvas.itemconfig(dot, state="hidden")
            else:
                canvas.itemconfig(dot, state="normal")
            dot_visible = not dot_visible
        else:
            canvas.itemconfig(dot, state="normal")
        if not is_stopped:
            root.after(500, toggle_dot)
        
    toggle_dot()

    def do_pause_resume():
        nonlocal is_paused, pause_start_time, total_paused_time
        if is_paused:
            total_paused_time += time.time() - pause_start_time
            is_paused = False
            btn_pause.config(text="⏸ Tạm dừng")
            canvas.itemconfig(dot, fill="#ff3333", outline="#ff3333")
        else:
            is_paused = True
            pause_start_time = time.time()
            btn_pause.config(text="▶ Tiếp tục")
            canvas.itemconfig(dot, fill="gray", outline="gray")
        write_status(is_paused=is_paused, is_mic_on=is_mic_on, is_recording=True)

    def toggle_mic():
        nonlocal is_mic_on
        is_mic_on = not is_mic_on
        if is_mic_on:
            btn_mic.config(text="🎤 Mic: BẬT", fg="#44ff44")
        else:
            btn_mic.config(text="🎤 Mic: TẮT", fg="#aaaaaa")
        write_status(is_paused=is_paused, is_mic_on=is_mic_on, is_recording=True)

    lbl_status = tk.Label(root, text="", font=("Arial", 9, "italic"), bg="#222222", fg="#ffcc00")
    
    def do_stop():
        nonlocal is_stopped
        is_stopped = True
        write_status(is_paused=False, is_mic_on=is_mic_on, is_recording=False, processing=True)
        lbl_status.config(text="Đang xử lý âm thanh & video, xin chờ...")
        lbl_status.place(x=35, y=28)
        lbl_time.place_forget()
        btn_pause.place_forget()
        btn_mic.place_forget()
        btn_stop.place_forget()
        btn_collapse.place_forget()
        root.geometry("250x45+10+10")
        
        root.update()
        root.after(100, root.quit)

    btn_pause = tk.Button(root, text="⏸ Tạm dừng", command=do_pause_resume, bg="#444444", fg="white", bd=0, padx=8, pady=4, font=("Arial", 9, "bold"))
    btn_pause.place(x=100, y=10)
    
    btn_mic = tk.Button(root, text="🎤 Mic: TẮT", command=toggle_mic, bg="#444444", fg="#aaaaaa", bd=0, padx=8, pady=4, font=("Arial", 9, "bold"))
    btn_mic.place(x=195, y=10)
    
    btn_stop = tk.Button(root, text="⏹ Dừng lại", command=do_stop, bg="#aa3333", fg="white", bd=0, padx=8, pady=4, font=("Arial", 9, "bold"))
    btn_stop.place(x=285, y=10)

    is_collapsed = False
    def toggle_collapse():
        nonlocal is_collapsed
        if is_collapsed:
            root.geometry("380x45+0+10")
            lbl_time.place(x=35, y=10)
            btn_pause.place(x=100, y=10)
            btn_mic.place(x=195, y=10)
            btn_stop.place(x=285, y=10)
            btn_collapse.config(text="<")
            btn_collapse.place(x=355, y=10)
            is_collapsed = False
        else:
            root.geometry("45x45+0+10")
            lbl_time.place_forget()
            btn_pause.place_forget()
            btn_mic.place_forget()
            btn_stop.place_forget()
            btn_collapse.config(text=">")
            btn_collapse.place(x=25, y=10)
            is_collapsed = True

    btn_collapse = tk.Button(root, text="<", command=toggle_collapse, bg="#222222", fg="#888888", bd=0, padx=2, pady=2, font=("Arial", 10, "bold"))
    btn_collapse.place(x=355, y=10)

    # ---------------- AUDIO RECORDING THREADS ----------------
    audio_running = True

    def record_sys_audio():
        nonlocal has_sys_audio
        with pyaudio.PyAudio() as p:
            # FIX: tim loopback device bang ham chuyen dung cua pyaudiowpatch
            # thay vi tu doi ten thu cong. Cach cu, khi khong tim thay ten
            # khop, se ROT VE thiet bi OUTPUT that (maxInputChannels=0) ->
            # tao file .wav 0-kenh hong -> ffmpeg mix that bai -> video cuoi
            # cung mat tieng he thong hoan toan. get_default_wasapi_loopback()
            # luon tra ve dung thiet bi loopback cua loa dang dung, hoac nem
            # loi ro rang de minh bat va bao cao thay vi am tham fail.
            try:
                default_spk = p.get_default_wasapi_loopback()
            except Exception as e:
                _log_error("sys_audio(find_loopback)", e)
                return

            try:
                channels = default_spk["maxInputChannels"]
                rate = int(default_spk["defaultSampleRate"])

                with wave.open(temp_sys_audio, 'wb') as wf:
                    wf.setnchannels(channels)
                    wf.setsampwidth(p.get_sample_size(pyaudio.paInt16))
                    wf.setframerate(rate)

                    def callback(in_data, frame_count, time_info, status):
                        if not is_paused:
                            wf.writeframes(in_data)
                        else:
                            wf.writeframes(b'\x00' * len(in_data))
                        return (in_data, pyaudio.paContinue)

                    stream = p.open(format=pyaudio.paInt16,
                                    channels=channels,
                                    rate=rate,
                                    input=True,
                                    input_device_index=default_spk["index"],
                                    stream_callback=callback)

                    has_sys_audio = True
                    while audio_running:
                        time.sleep(0.1)

                    stream.stop_stream()
                    stream.close()
            except Exception as e:
                _log_error("sys_audio(record)", e)
                # File .wav co the da duoc tao nhung hong/rong -> xoa de
                # ffmpeg khong co gang mix mot file audio hong.
                try:
                    if os.path.exists(temp_sys_audio):
                        os.remove(temp_sys_audio)
                except Exception:
                    pass

    def record_mic_audio():
        nonlocal has_mic_audio
        with pyaudio.PyAudio() as p:
            try:
                default_mic = p.get_default_input_device_info()
                channels = min(2, default_mic["maxInputChannels"]) # Gioi han 2 kenh
                rate = int(default_mic["defaultSampleRate"])

                with wave.open(temp_mic_audio, 'wb') as wf:
                    wf.setnchannels(channels)
                    wf.setsampwidth(p.get_sample_size(pyaudio.paInt16))
                    wf.setframerate(rate)

                    def callback(in_data, frame_count, time_info, status):
                        # is_mic_on gio co the duoc Iris bat/tat tu xa qua
                        # CMD_FILE (xem record_loop) chu khong chi qua nut
                        # bam nho tren overlay nua.
                        if not is_paused and is_mic_on:
                            wf.writeframes(in_data)
                        else:
                            wf.writeframes(b'\x00' * len(in_data))
                        return (in_data, pyaudio.paContinue)

                    stream = p.open(format=pyaudio.paInt16,
                                    channels=channels,
                                    rate=rate,
                                    input=True,
                                    input_device_index=default_mic["index"],
                                    stream_callback=callback)

                    has_mic_audio = True
                    while audio_running:
                        time.sleep(0.1)

                    stream.stop_stream()
                    stream.close()
            except Exception as e:
                _log_error("mic_audio(record)", e)
                try:
                    if os.path.exists(temp_mic_audio):
                        os.remove(temp_mic_audio)
                except Exception:
                    pass

    has_sys_audio = False
    has_mic_audio = False
    t_sys = threading.Thread(target=record_sys_audio)
    t_mic = threading.Thread(target=record_mic_audio)
    t_sys.start()
    t_mic.start()

    # ---------------- VIDEO RECORDING THREAD ----------------
    def record_loop():
        if is_stopped:
            return

        # FIX: CMD_FILE truoc day CHI xu ly lenh "stop". Gio nhan them
        # pause/resume/mic_on/mic_off de Iris co the dieu khien viec ghi
        # hinh tu xa (goi tu screen_recorder.py --action ...) thay vi nguoi
        # dung phai tu bam vao nut nho tren thanh overlay luon-noi-tren-cung.
        if os.path.exists(CMD_FILE):
            cmd = None
            try:
                with open(CMD_FILE, 'r') as f:
                    data = json.load(f)
                cmd = data.get("cmd")
            except Exception:
                cmd = None
            finally:
                try:
                    os.remove(CMD_FILE)
                except Exception:
                    pass

            if cmd == "stop":
                do_stop()
                return
            elif cmd == "pause" and not is_paused:
                do_pause_resume()
            elif cmd == "resume" and is_paused:
                do_pause_resume()
            elif cmd == "mic_on" and not is_mic_on:
                toggle_mic()
            elif cmd == "mic_off" and is_mic_on:
                toggle_mic()

        if not is_collapsed:
            lbl_time.config(text=get_formatted_time())

        if not is_paused:
            start_time = time.time()
            img = sct.grab(monitor)
            frame = np.array(img)
            frame = cv2.cvtColor(frame, cv2.COLOR_BGRA2BGR)
            out.write(frame)
            
            elapsed = time.time() - start_time
            delay = max(1, int(frame_interval - (elapsed * 1000)))
            root.after(delay, record_loop)
        else:
            root.after(100, record_loop)

    root.after(100, record_loop)
    root.mainloop()
    
    # ---------------- CLEANUP & FFMPEG MIXING ----------------
    audio_running = False
    out.release()
    sct.close()
    
    # Đợi 2 luồng âm thanh dừng lại
    t_sys.join(timeout=2)
    t_mic.join(timeout=2)
    
    ffmpeg_cmd = ["ffmpeg", "-y", "-i", temp_video]
    has_sys = os.path.exists(temp_sys_audio)
    has_mic = os.path.exists(temp_mic_audio)
    
    if has_sys: ffmpeg_cmd.extend(["-i", temp_sys_audio])
    if has_mic: ffmpeg_cmd.extend(["-i", temp_mic_audio])
        
    if has_sys and has_mic:
        ffmpeg_cmd.extend([
            "-filter_complex", 
            "[2:a]afftdn=nf=-25[mic_clean]; [1:a][mic_clean]amix=inputs=2:duration=longest[aout]",
            "-map", "0:v", "-map", "[aout]",
            "-c:v", "copy", "-c:a", "aac"
        ])
    elif has_sys:
        ffmpeg_cmd.extend(["-c:v", "copy", "-c:a", "aac"])
    elif has_mic:
        ffmpeg_cmd.extend([
            "-filter_complex", "[1:a]afftdn=nf=-25[aout]", 
            "-map", "0:v", "-map", "[aout]", 
            "-c:v", "copy", "-c:a", "aac"
        ])
    else:
        ffmpeg_cmd.extend(["-c:v", "copy"])
        
    ffmpeg_cmd.append(final_video)

    ffmpeg_ok = True
    try:
        proc = subprocess.run(ffmpeg_cmd, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
        if proc.returncode != 0:
            ffmpeg_ok = False
            _log_error("ffmpeg", proc.stderr.decode("utf-8", errors="ignore")[-2000:])
        else:
            # Dọn file rác
            if os.path.exists(temp_video): os.remove(temp_video)
            if os.path.exists(temp_sys_audio): os.remove(temp_sys_audio)
            if os.path.exists(temp_mic_audio): os.remove(temp_mic_audio)
    except Exception as e:
        ffmpeg_ok = False
        _log_error("ffmpeg(exception)", e)

    if not ffmpeg_ok:
        final_video = temp_video  # Tra ve file cu (khong tieng) neu ffmpeg loi

    root.destroy()
    write_status(is_paused=False, is_mic_on=False, is_recording=False, processing=False)
    # FIX: ket qua bay gio la JSON (co ca audio_status) thay vi chi mot
    # dong duong dan text, de action 'stop' biet va bao cho nguoi dung neu
    # tieng he thong/mic bi thieu thay vi im lang.
    result_payload = {
        "filepath": final_video,
        "has_sys_audio": has_sys_audio,
        "has_mic_audio": has_mic_audio,
        "ffmpeg_ok": ffmpeg_ok,
    }
    with open(CMD_FILE + ".result", 'w', encoding="utf-8") as f:
        json.dump(result_payload, f, ensure_ascii=False)

def _send_live_command(cmd, ok_message, not_running_message):
    """Gui mot lenh dieu khien (pause/resume/mic_on/mic_off) toi daemon dang
    chay qua CMD_FILE, cho toi 2s de daemon ap dung, roi tra ve trang thai
    moi nhat tu STATUS_FILE. Dung chung cho 4 action moi ben duoi."""
    if not is_daemon_running():
        return {"success": False, "error": not_running_message}

    before = read_status().get("updated_at")
    write_command(cmd)
    status = {}
    for _ in range(20):  # doi toi 2s de daemon xu ly va ghi status
        time.sleep(0.1)
        status = read_status()
        # Cho toi khi status thuc su duoc CAP NHAT (updated_at doi khac gia
        # tri truoc khi gui lenh), thay vi chi kiem tra co ton tai hay
        # khong — status file da co tu luc bat dau ghi hinh nen se luon
        # "ton tai" ngay ca khi daemon chua kip xu ly lenh moi.
        if status.get("updated_at") and status.get("updated_at") != before:
            break
    return {
        "success": True,
        "message": ok_message,
        "is_paused": status.get("is_paused"),
        "is_mic_on": status.get("is_mic_on"),
    }


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--action",
        choices=['start', 'stop', 'status', 'daemon', 'pause', 'resume', 'mic_on', 'mic_off'],
        required=True,
    )
    parser.add_argument("--window", type=str, help="Tên cửa sổ")
    args = parser.parse_args()
    
    sys.stdout = open(sys.stdout.fileno(), mode='w', encoding='utf-8', buffering=1)
    
    try:
        if args.action == 'daemon':
            try:
                run_daemon()
            except Exception as e:
                _log_error("daemon(fatal)", e)
                sys.exit(1)
        elif args.action == 'start':
            if is_daemon_running():
                print(json.dumps({"success": False, "error": "Đã có trình quay video đang chạy."}))
            else:
                # Don status/error cu de khong doc nham trang thai cua lan
                # ghi hinh truoc.
                for stale in (STATUS_FILE, ERROR_LOG, CMD_FILE + ".result"):
                    try:
                        if os.path.exists(stale): os.remove(stale)
                    except Exception:
                        pass
                write_command("start", args.window)
                subprocess.Popen([sys.executable, __file__, "--action", "daemon"], creationflags=subprocess.CREATE_NO_WINDOW)
                print(json.dumps({"success": True, "message": "Bắt đầu ghi hình ngầm."}))
        elif args.action == 'stop':
            if not is_daemon_running():
                err_path = ERROR_LOG
                if os.path.exists(err_path):
                    with open(err_path, 'r', encoding="utf-8") as f: err_msg = f.read()
                    os.remove(err_path)
                    print(json.dumps({"success": False, "error": f"Lỗi: {err_msg}"}))
                else:
                    print(json.dumps({"success": False, "error": "Không có video nào."}))
            else:
                write_command("stop")
                result_data = None
                for _ in range(300): # Đợi 30 giây cho ffmpeg mix xong
                    if os.path.exists(CMD_FILE + ".result"):
                        try:
                            with open(CMD_FILE + ".result", 'r', encoding="utf-8") as f:
                                raw = f.read().strip()
                            if raw:
                                # FIX: ket qua bay gio la JSON ({filepath,
                                # has_sys_audio, has_mic_audio, ffmpeg_ok})
                                # thay vi mot dong duong dan text thuan.
                                # Van cho phep doc duoc file cu (plain text)
                                # de tuong thich nguoc.
                                try:
                                    result_data = json.loads(raw)
                                except Exception:
                                    result_data = {"filepath": raw}
                                os.remove(CMD_FILE + ".result")
                                break
                        except Exception:
                            pass
                    time.sleep(0.1)

                if result_data is None:
                    print(json.dumps({"success": False, "error": "Hết thời gian chờ xử lý video/âm thanh."}))
                else:
                    filepath = result_data.get("filepath", "")
                    warnings = []
                    if not result_data.get("has_sys_audio"):
                        warnings.append("không thu được âm thanh hệ thống (loa)")
                    if not result_data.get("ffmpeg_ok"):
                        warnings.append("ghép âm thanh vào video bị lỗi (ffmpeg) — video có thể không có tiếng")
                    msg = f"Đã lưu video tại: {filepath}"
                    if warnings:
                        msg += " (cảnh báo: " + "; ".join(warnings) + ")"
                    print(json.dumps({
                        "success": True,
                        "message": msg,
                        "filepath": filepath,
                        "has_sys_audio": result_data.get("has_sys_audio"),
                        "has_mic_audio": result_data.get("has_mic_audio"),
                        "ffmpeg_ok": result_data.get("ffmpeg_ok"),
                    }, ensure_ascii=False))
                    if filepath and os.path.exists(filepath):
                        os.startfile(filepath)
        elif args.action == 'status':
            running = is_daemon_running()
            status = read_status() if running else {}
            print(json.dumps({
                "success": True,
                "is_recording": running,
                "is_paused": status.get("is_paused", False),
                "is_mic_on": status.get("is_mic_on", False),
                "window": status.get("window"),
            }, ensure_ascii=False))
        elif args.action == 'pause':
            print(json.dumps(_send_live_command(
                "pause", "Đã tạm dừng ghi hình.", "Không có video nào đang ghi để tạm dừng."
            ), ensure_ascii=False))
        elif args.action == 'resume':
            print(json.dumps(_send_live_command(
                "resume", "Đã tiếp tục ghi hình.", "Không có video nào đang ghi để tiếp tục."
            ), ensure_ascii=False))
        elif args.action == 'mic_on':
            print(json.dumps(_send_live_command(
                "mic_on", "Đã bật mic khi ghi hình.", "Không có video nào đang ghi để bật mic."
            ), ensure_ascii=False))
        elif args.action == 'mic_off':
            print(json.dumps(_send_live_command(
                "mic_off", "Đã tắt mic khi ghi hình.", "Không có video nào đang ghi để tắt mic."
            ), ensure_ascii=False))
    except Exception as e:
        print(json.dumps({"success": False, "error": str(e)}))
        sys.exit(1)
