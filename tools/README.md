# tools/ — script Python mà Gemini Live gọi trực tiếp

Mọi script ở đây chỉ chạy trên **Windows**. Lớp bọc phía Node: `electron/main/local-tools.mjs`
(+ `computer-use-tools.mjs` cho close/hide/minimize/restore/note).

## Schema đầu ra (duy nhất)
Đúng **một dòng JSON** trên stdout:

```json
{"success": true,  "message": "...", "...": "các trường riêng của tool"}
{"success": false, "error": "lý do rõ ràng"}      // và tiến trình thoát với mã ≠ 0
```

Phía Node chuẩn hoá thành `{..., "status": "success" | "error"}` (`electron/main/tool-result.mjs`):
`status` luôn đặt **sau cùng** và là `error` nếu mã thoát ≠ 0 *hoặc* `success:false` *hoặc* có `error` mà không có `success:true`.

## Quy tắc khi thêm/sửa tool
1. `import _common` (đặt `sys.path` theo `__file__`); gọi `_common.ensure_utf8()` trong `if __name__ == "__main__":`.
2. Thư viện chỉ-Windows import **bên trong hàm** (để unit test chạy được trên mọi OS).
3. Thiếu thư viện ⇒ `_common.require("x")` (KHÔNG tự `pip install`).
4. Cấm `os.system`, `shell=True`, nội suy chuỗi vào mã PowerShell/cmd. Dữ liệu từ người dùng/Gemini chỉ đi qua argv hoặc biến môi trường.
5. Tham số tự do truyền dạng `--opt=<giá trị>`; số nguyên dùng `type=to_int` (làm tròn số thực).
6. Hành động phá huỷ/riêng tư phải được khai báo trong `electron/main/dangerous-tools.mjs` (xác nhận hai bước).
7. Hàm thuần (parse, validate, tính toán) tách riêng và có test trong `tools/tests/`.

## Thư viện chung
| File | Việc |
|---|---|
| `_common.py` | `emit/fail/require/ensure_utf8/dpi_aware/user_data_dir/decode_bytes`, `validate_process_name` + danh sách bảo vệ |
| `_winutil.py` | liệt kê/chọn cửa sổ (ctypes), `select_windows`, loại cửa sổ của Iris |
| `_procutil.py` | tìm/đóng tiến trình theo tên (đóng êm mặc định, `/F` khi `--force`) |

## Danh sách tool
| Script | Tool Gemini | Ghi chú |
|---|---|---|
| `process_manager.py` | `process_manager` | `list`, `kill <tên> [--force]` — tên được kiểm tra, đóng êm |
| `system_actions.py` | `close_app` `hide_app` `minimize_app` `restore_app` `write_note` | `hide` ghi sổ để `restore` khôi phục được |
| `move_window.py` / `magic_move.py` | `move_window_precise` / `move_window_magic` | ctypes, không PowerShell; `--wait` đếm ngược thật |
| `mouse_control.py` | `mouse_control` | `release`, `--monitor N`, kẹp theo màn hình ảo |
| `wifi_manager.py` | `wifi_manager` | độc lập ngôn ngữ Windows (đọc bytes OEM) |
| `sys_control.py` | `system_control` | âm lượng tuyệt đối, độ sáng (kiểm hỗ trợ), bluetooth/camera (UAC `-Wait`) |
| `power_manager.py` | `power_manager` | shutdown/restart trễ 5 s, báo `hibernate_enabled` |
| `clipboard_manager.py` | `read_clipboard` `write_clipboard` | ghi dài qua stdin |
| `clipboard_history.py` | `clipboard_history` | **mặc định tắt** (`IRIS_CLIPBOARD_HISTORY=1`), TTL, lọc mật khẩu/OTP/thẻ |
| `read_notifications.py` | `read_system_notifications` | che mã OTP trừ khi `--reveal-otp` |
| `search_everything.py` | `search_local_files` | cần `es.exe` |
| `ocr_region.py` | `ocr_region` | `IRIS_OCR_LANG`, tự chọn `vie+eng` nếu có |
| `image_viewer.py` | `view_image` | chỉ hiển thị cho người dùng |
| `sys_monitor.py` | `get_system_stats` | CPU/RAM/ổ đĩa/pin |
| `active_window_info.py` `color_picker.py` `idle_time.py` `multi_monitor_info.py` `lock_screen.py` `focus_assist.py` `notifier.py` `media_control.py` `desktop_manager.py` | cùng tên | |

Chụp màn hình (`take_ai_screenshot`) và nhắc việc (`quick_reminder`) **không còn là script Python**: chúng chạy trong tiến trình Electron
(`desktopCapturer`, `electron/main/reminders.mjs`).

## Test
```
python -m unittest discover -s tools/tests -v     # hàm thuần, chạy được trên Linux/macOS
node --test scripts/tests                          # gồm tools-contract / normalize-tool-result / ...
```
Mọi thứ cần Windows thật được liệt kê là **BLOCKED(Windows)** trong `CHANGES.md`.
