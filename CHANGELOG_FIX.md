# Tóm tắt các fix — repo irit (shadow-apex/irit)

Cách dùng: copy đè 11 file bên dưới vào đúng đường dẫn tương ứng trong repo của bạn
(giữ nguyên cấu trúc thư mục `tools/...`, `electron/main/...`, `.agents/skills/...`).
Vì các script này chạy trên Windows (ctypes.windll, WASAPI, taskkill, pycaw...), tôi
**không build/test thực tế được** trên môi trường Linux — bạn cần chạy thử lại trên
máy Windows.

Sau khi copy file, chạy lại: `pip install -r tools/requirements.txt --break-system-packages`
(có thêm `pycaw`, `comtypes`, và file đã được sửa lỗi encoding).

---

## Đợt 1 — Quay màn hình mất tiếng + Magic Window demo2

### 1. `tools/screen_recorder.py`
- **Lỗi mất tiếng (gốc rễ)**: code cũ tự dò thiết bị loopback (âm thanh loa) bằng cách so
  tên thủ công. Khi không khớp tên (rất hay xảy ra), nó rơi vào thiết bị OUTPUT thật
  (0 kênh input) → tạo ra file `.wav` hỏng → `ffmpeg` mix lỗi → video cuối cùng **không
  có tiếng hệ thống**. Đã thay bằng `pyaudiowpatch.PyAudio.get_default_wasapi_loopback()`
  — hàm chính chủ của thư viện được viết ra để làm đúng việc này.
- Thêm **mở mic / tắt mic / tạm dừng / tiếp tục** từ xa qua file lệnh
  (`tools/recorder_cmd.txt`) — action mới: `pause`, `resume`, `mic_on`, `mic_off`
  (bên cạnh `start`, `stop`, `status` cũ). Không cần bấm nút nhỏ trên overlay nữa.
- Thêm file trạng thái `tools/videos/recorder_status.json` để `status` biết đang tạm
  dừng / mic bật hay tắt hay không, thay vì chỉ biết "có đang chạy hay không".
- Kết quả lúc `stop` giờ là JSON có `has_sys_audio`, `has_mic_audio`, `ffmpeg_ok` — báo
  rõ cảnh báo nếu thiếu tiếng thay vì im lặng.
- Lỗi audio/ffmpeg giờ được ghi vào `tools/videos/error.log` thay vì bị nuốt lặng lẽ
  (`except: pass`).

### 2. `tools/magic_move.py`
- Gỡ giới hạn "CLI-only, không cho AI gọi" trong docstring của `demo_mode_2()` — không có
  gì thực sự chặn nó về mặt kỹ thuật, chỉ là chưa được wire vào Electron.

### 3. `electron/main/local-tools.mjs`
- `moveWindowMagicTool`: thêm nhánh `mode === "demo2"` (mở 6 cửa sổ Notepad xếp lưới).
- `recordScreenTool`: validate action hợp lệ, tăng timeout action `stop` từ 10s → 35s
  (một nguyên nhân góp phần gây mất tiếng: Electron cũ kill tiến trình giữa lúc `ffmpeg`
  đang mux, vì `screen_recorder.py` cần tới 30s).

### 4. `electron/main/claude-tools-catalog.mjs`
- Cập nhật mô tả `record_screen` (thêm pause/resume/mic_on/mic_off) và
  `move_window_magic` (thêm mode `demo2`).

### 5. `electron/main/gemini-live.mjs`
- Cập nhật mô tả `move_window_magic` trong system prompt để nhắc tới `demo2`.

### 6. `.agents/skills/window-magic/SKILL.md`
- Thêm hướng dẫn "Demo Mode 2" cho nhánh Claude Code agent.

---

## Đợt 2 — Ẩn / Mở / Mở mới / Đóng / Thu nhỏ ứng dụng

Vấn đề gốc: chỉ có 3 hành động (`close_app`, `minimize_app`, `restore_app`) nhưng mô tả
cho AI lại **gộp chung** "ẩn" và "thu nhỏ" vào cùng `minimize_app`, và gộp chung "mở" và
"khôi phục" vào `restore_app`. Không có khái niệm "ẩn thật" (hide khỏi taskbar) nào tồn
tại. `open_url_or_app` cũng luôn spawn tiến trình MỚI, không kiểm tra app đã chạy chưa.

### 7. `tools/system_actions.py`
- Đổi `_enum_visible_windows()` → `_enum_windows(..., require_visible=True/False)` — fix
  bắt buộc: nếu không có tham số này, `restore_app()` sẽ không bao giờ tìm lại được một
  cửa sổ đã bị ẩn thật (`SW_HIDE` khiến `IsWindowVisible=False`).
- **Thêm `hide_app(target)` mới**: dùng `SW_HIDE` thật sự — biến mất khỏi màn hình VÀ
  khỏi taskbar/Alt-Tab, nhưng tiến trình vẫn chạy ngầm (khác `minimize_app`, vẫn giữ
  nguyên `SW_SHOWMINIMIZED`).
- `restore_app()` giờ tìm được cả cửa sổ đang ẩn lẫn đang thu nhỏ.
- Thêm action CLI mới: `python tools/system_actions.py hide <target>`.

### 8. `electron/main/computer-use-tools.mjs`
- **Thêm `hideAppTool(args)`**.
- **Sửa `openUrlOrApp`**: thêm tham số `force_new` (mặc định `false`) — mặc định thử
  `restore` (tìm + focus cửa sổ đang chạy, kể cả đang ẩn/thu nhỏ) trước; chỉ khi không
  tìm thấy mới spawn tiến trình mới. `force_new=true` luôn spawn mới.

### 9. `electron/main/tool-dispatcher.mjs`
- Wire `hide_app` → `hideAppTool`.

### 10. `electron/main/claude-tools-catalog.mjs` (cập nhật thêm)
- `open_url_or_app`: thêm `force_new`. Thêm tool mới `hide_app`. Viết lại mô tả
  `close_app`/`minimize_app`/`restore_app` cho rõ ràng, không còn gộp nghĩa.

### 11. `electron/main/gemini-live.mjs` (cập nhật thêm)
- Viết lại mục "(5) SYSTEM APPS", ánh xạ rõ 1:1 mỗi câu lệnh tiếng Việt → đúng 1 action.

### Bảng hành vi mới (đợt 2)

| Bạn nói | Action | Kết quả |
|---|---|---|
| "ẩn X" | `hide_app` | Biến mất khỏi màn hình + taskbar, vẫn chạy ngầm |
| "thu nhỏ X" | `minimize_app` | Thu nhỏ xuống taskbar, vẫn thấy icon |
| "mở X" | `open_url_or_app(force_new=false)` | Đang chạy → mở lại + focus; chưa chạy → mở mới |
| "mở X mới" | `open_url_or_app(force_new=true)` | Luôn tạo cửa sổ/tiến trình mới |
| "đóng X" | `close_app` | `taskkill /F` — tắt hẳn |

---

## Đợt 3 — Rà toàn bộ /tools tìm thêm lỗi "gộp lệnh" khác

Đã kiểm tra hết 30 file `.py` trong `/tools` và toàn bộ chỗ wire chúng vào Electron.
Tìm thấy 1 lỗi "gộp lệnh" thật sự khác + 1 lỗi encoding không liên quan nhưng tiện sửa luôn.

### 12. `tools/sys_control.py` — volume mute/unmute bị gộp làm 1 nút TOGGLE
- **Xác nhận lỗi**: `gemini-live.mjs` (system prompt cho AI) viết rõ AI được phép làm
  "mute/unmute" qua `system_control`. Nhưng schema (`claude-tools-catalog.mjs`) chỉ cho
  `volume: mute|up|down` — **không có `unmute`** — và CLI (`sys_control.py`) cũng chỉ
  chấp nhận `choices=["mute","up","down"]`. Nếu AI cố gọi "unmute" sẽ bị argparse từ chối.
  Tệ hơn: `mute` cũ chỉ là **1 lần bấm phím ảo `VK_VOLUME_MUTE`** — đây là phím **TOGGLE**
  của Windows, không phải "đặt trạng thái mute = true". Gọi "mute" khi đang tắt tiếng sẵn
  sẽ **bật tiếng lại** — hoàn toàn không đoán trước được. Đúng bản chất lỗi "gộp lệnh"
  giống hệt vụ ẩn/thu nhỏ/đóng app ở đợt 2.
- **Fix**: chuyển sang dùng `pycaw` (Core Audio Windows API — `SetMute(True/False)`,
  `SetMasterVolumeLevelScalar()`) để có `mute`/`unmute`/`set <0-100>` **deterministic
  thật sự**, không còn là toggle. `up`/`down` giờ cũng dùng pycaw (tăng/giảm theo %,
  tự động bỏ mute giống hành vi phím vật lý thật). Nếu máy **chưa cài** `pycaw`/`comtypes`,
  tự động fallback về phím ảo cũ **chỉ cho up/down** — còn `mute`/`unmute`/`set` sẽ báo lỗi
  rõ ràng kèm hướng dẫn cài đặt, thay vì làm sai âm thầm.
- Thêm action mới: `--volume set --volume-level N` (đặt % chính xác), `--volume unmute`.

### 13. `tools/requirements.txt` — lỗi encoding (không phải gộp lệnh, phát hiện khi rà)
- Cuối file trước đây bị dính UTF-16 (byte `\0` xen kẽ mỗi ký tự) ở 2 dòng cuối
  (`playwright`, `pyaudiowpatch`) — chắc do một lệnh PowerShell `>>` ghi thêm bằng sai
  encoding, khiến `pip install -r requirements.txt` dễ báo lỗi khi đọc file. Đã viết lại
  sạch toàn bộ file bằng UTF-8, giữ nguyên nội dung cũ, thêm `pycaw` + `comtypes`.

### 14. `electron/main/local-tools.mjs` (cập nhật thêm)
- `systemControlTool`: nhận thêm `volume: "unmute"` và `volume: "set"` + `volumeLevel`
  (0-100), forward đúng xuống `sys_control.py`.

### 15. `electron/main/claude-tools-catalog.mjs` (cập nhật thêm)
- Schema `system_control`: `volume` giờ liệt kê đủ `mute, unmute, up, down, set`; thêm
  tham số `volumeLevel` (bắt buộc khi `volume: "set"`).

### 16. `electron/main/gemini-live.mjs` (cập nhật thêm)
- Mục "(5) system_control" trong system prompt: nói rõ mute/unmute giờ deterministic,
  và "đặt âm lượng về X%" phải dùng `volume: "set"` + `volumeLevel: X`.

### Các file khác đã rà nhưng KHÔNG có lỗi gộp lệnh (không cần sửa)
`clipboard_manager.py`, `clipboard_history.py`, `mouse_control.py`, `power_plan.py`,
`process_manager.py`, `wifi_manager.py`, `quick_reminder.py`, `image_viewer.py`,
`video_player.py`, `notifier.py`, `ai_vision.py`, `active_window_info.py`, `ocr_region.py`,
`color_picker.py`, `idle_time.py`, `multi_monitor_info.py`, `focus_assist.py`,
`lock_screen.py`, `sys_monitor.py` — mỗi action đều tách biệt rõ ràng, mô tả cho AI khớp
đúng với CLI thật, không có action nào bị gộp/toggle mập mờ.

`move_window.py`, `test_audio.py`, `test_audio2.py`, `test_scroll.py`, `mess.py`,
`mess_login.py`, `mess_ngam.py`, `type_discord.py` — script dev/test hoặc module
Messenger riêng, **không hề được wire vào AI** (chỉ có 1 dòng comment giải thích lý do
không wire trong `local-tools.mjs`) — nên không có rủi ro "gộp lệnh".

### Bảng hành vi mới (đợt 3 — âm lượng)

| Bạn nói | Action gọi | Kết quả |
|---|---|---|
| "tắt tiếng" | `volume: "mute"` | Luôn tắt tiếng (deterministic, không toggle) |
| "bật tiếng lại" | `volume: "unmute"` | Luôn bật tiếng lại |
| "để âm lượng 30%" | `volume: "set", volumeLevel: 30` | Đặt chính xác 30%, tự bỏ mute |
| "tăng âm lượng" | `volume: "up"` | Tăng ~5%, tự bỏ mute nếu đang mute |
| "giảm âm lượng" | `volume: "down"` | Giảm ~5%, tự bỏ mute nếu đang mute |

**Lưu ý cài đặt**: cần chạy lại `pip install -r tools/requirements.txt --break-system-packages`
(có thêm `pycaw`, `comtypes`) để mute/unmute/set hoạt động chính xác. Nếu chưa cài, up/down
vẫn chạy được qua phím ảo (kém chính xác hơn), còn mute/unmute/set sẽ báo lỗi rõ ràng thay
vì làm sai.

---

## Ghi chú test trên Windows

1. Mở Notepad → nói "ẩn Notepad" → kiểm tra biến mất khỏi taskbar nhưng vẫn còn trong
   Task Manager → nói "mở Notepad" → phải hiện lại đúng cửa sổ cũ (không mất nội dung).
2. Mở Notepad → nói "thu nhỏ Notepad" → kiểm tra vẫn còn icon trên taskbar → nói "mở
   Notepad" → phải phục hồi lại.
3. Nói "mở Notepad mới" trong khi Notepad đang chạy → phải ra thêm 1 cửa sổ mới.
4. Nói "đóng Notepad" → tiến trình notepad.exe phải biến mất khỏi Task Manager.
5. Quay màn hình (start → nói vài giây → stop) → kiểm tra video có tiếng hệ thống; thử
   "bật mic" giữa chừng rồi nói gì đó → dừng → kiểm tra tiếng nói có trong video; thử
   "tạm dừng" → đợi → "tiếp tục" → dừng → kiểm tra đoạn tạm dừng không bị quay hình/tiếng.
6. Phát nhạc/video bất kỳ → nói "tắt tiếng" → phải im → nói "tắt tiếng" lần nữa → PHẢI
   VẪN IM (không được tự bật lại) → nói "bật tiếng lại" → mới được bật lại.
7. Nói "để âm lượng 20%" → kiểm tra thanh âm lượng Windows hiển thị đúng 20%.
