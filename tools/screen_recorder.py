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

    def toggle_mic():
        nonlocal is_mic_on
        is_mic_on = not is_mic_on
        if is_mic_on:
            btn_mic.config(text="🎤 Mic: BẬT", fg="#44ff44")
        else:
            btn_mic.config(text="🎤 Mic: TẮT", fg="#aaaaaa")

    lbl_status = tk.Label(root, text="", font=("Arial", 9, "italic"), bg="#222222", fg="#ffcc00")
    
    def do_stop():
        nonlocal is_stopped
        is_stopped = True
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
        with pyaudio.PyAudio() as p:
            try:
                wasapi = p.get_host_api_info_by_type(pyaudio.paWASAPI)
                default_spk = p.get_device_info_by_index(wasapi["defaultOutputDevice"])
                
                if not default_spk["isLoopbackDevice"]:
                    for loopback in p.get_loopback_device_info_generator():
                        if default_spk["name"] in loopback["name"]:
                            default_spk = loopback
                            break
                            
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
                                    
                    while audio_running:
                        time.sleep(0.1)
                        
                    stream.stop_stream()
                    stream.close()
            except Exception as e:
                pass

    def record_mic_audio():
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
                                    
                    while audio_running:
                        time.sleep(0.1)
                        
                    stream.stop_stream()
                    stream.close()
            except Exception as e:
                pass

    t_sys = threading.Thread(target=record_sys_audio)
    t_mic = threading.Thread(target=record_mic_audio)
    t_sys.start()
    t_mic.start()

    # ---------------- VIDEO RECORDING THREAD ----------------
    def record_loop():
        if is_stopped:
            return
            
        if os.path.exists(CMD_FILE):
            try:
                with open(CMD_FILE, 'r') as f:
                    data = json.load(f)
                if data.get("cmd") == "stop":
                    os.remove(CMD_FILE)
                    do_stop()
                    return
            except:
                pass

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
    
    try:
        subprocess.run(ffmpeg_cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        # Dọn file rác
        if os.path.exists(temp_video): os.remove(temp_video)
        if os.path.exists(temp_sys_audio): os.remove(temp_sys_audio)
        if os.path.exists(temp_mic_audio): os.remove(temp_mic_audio)
    except Exception as e:
        final_video = temp_video # Tra ve file cu neu ffmpeg loi

    root.destroy()
    with open(CMD_FILE + ".result", 'w') as f:
        f.write(final_video)

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--action", choices=['start', 'stop', 'status', 'daemon'], required=True)
    parser.add_argument("--window", type=str, help="Tên cửa sổ")
    args = parser.parse_args()
    
    sys.stdout = open(sys.stdout.fileno(), mode='w', encoding='utf-8', buffering=1)
    
    try:
        if args.action == 'daemon':
            try:
                run_daemon()
            except Exception as e:
                with open(os.path.join(VID_DIR, "error.log"), "w") as f:
                    f.write(str(e))
                sys.exit(1)
        elif args.action == 'start':
            if is_daemon_running():
                print(json.dumps({"success": False, "error": "Đã có trình quay video đang chạy."}))
            else:
                write_command("start", args.window)
                subprocess.Popen([sys.executable, __file__, "--action", "daemon"], creationflags=subprocess.CREATE_NO_WINDOW)
                print(json.dumps({"success": True, "message": "Bắt đầu ghi hình ngầm."}))
        elif args.action == 'stop':
            if not is_daemon_running():
                err_path = os.path.join(VID_DIR, "error.log")
                if os.path.exists(err_path):
                    with open(err_path, 'r') as f: err_msg = f.read()
                    os.remove(err_path)
                    print(json.dumps({"success": False, "error": f"Lỗi: {err_msg}"}))
                else:
                    print(json.dumps({"success": False, "error": "Không có video nào."}))
            else:
                write_command("stop")
                filepath = "Chưa rõ đường dẫn"
                for _ in range(300): # Đợi 30 giây cho ffmpeg mix xong
                    if os.path.exists(CMD_FILE + ".result"):
                        try:
                            with open(CMD_FILE + ".result", 'r') as f:
                                filepath = f.read().strip()
                            if filepath:
                                os.remove(CMD_FILE + ".result")
                                break
                        except: pass
                    time.sleep(0.1)
                
                print(json.dumps({"success": True, "message": f"Đã lưu video tại: {filepath}", "filepath": filepath}))
                if os.path.exists(filepath): os.startfile(filepath)
        elif args.action == 'status':
            print(json.dumps({"success": True, "is_recording": is_daemon_running()}))
    except Exception as e:
        print(json.dumps({"success": False, "error": str(e)}))
        sys.exit(1)
