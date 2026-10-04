# Nhật ký sửa lỗi — Lần 2/3: thư mục `tools/` (04/10/2026)

Nguồn: `IRIS_PROMPT_2_TOOLS.md`. Chạy: `npm run build`, `npm test` (153 test), `npm run test:py` (44 test).

## Kiểm tra lần 1 trước khi làm lần 2
`npm install` + `npm run build` xanh; `npm test` 115/115 qua; `npm run setup:ort` thật sự chép 8 file `ort-wasm*` (mục "chưa kiểm chứng" của lượt bổ sung đã được xác nhận); mọi `.mjs` qua `node --check`;
`toolsDir()/pythonBin()/userDataDir()`, `killTree`, xác nhận hai bước, `sendVideoFrame` đều có. **Không cần sửa lại phần lần 1.**

## Kết quả kiểm chứng
| Hạng mục | Kết quả |
|---|---|
| `npm run build` | xanh |
| `npm test` | 153/153 (38 test mới cho tools) |
| `python -m unittest discover -s tools/tests` | 44/44 (hàm thuần chạy trên Linux) |
| `py_compile` toàn bộ `tools/*.py` | sạch |
| Smoke test script trên Linux (nhánh không cần Windows) | `kill *`, `kill *.exe`, `kill explorer.exe`, `kill python`, truy vấn `-n`, SSID rỗng, tiêu đề rỗng, tham số sai ⇒ JSON `success:false` + mã thoát ≠ 0 |

## ĐÃ SỬA
**T.1 lớp chạy Python (`local-tools.mjs`, `tool-result.mjs`):** `PYTHONUTF8/PYTHONIOENCODING`, `setEncoding("utf8")`, giới hạn stdout 1 MB, hết giờ ⇒ `killTree` rồi chạy `onTimeout` (nhả chuột); truyền `IRIS_SELF_PID`/`IRIS_USER_DATA`; tham số tự do dạng `--opt=<v>`, số thực làm tròn, văn bản clipboard dài qua **stdin** (TL-14); `normalizeToolResult` — `status` đặt sau cùng, kết quả không phải JSON không bao giờ là success (TL-03); `pythonBin()/toolsDir()` đọc lười, `computer-session.mjs` đọc `OMNIPARSER_*` lười (P-03).
**TL-01** `move_window.py` viết lại bằng ctypes (`_winutil.py`), không còn PowerShell/C#. **TL-02** `validate_process_name` + danh sách bảo vệ + đóng êm + `--force` (`_common.py`, `_procutil.py`); `close_app`/`kill` chờ kết quả thật. **TL-03** (trên). **TL-04** `PAUSE=0`, lệnh `release`, đường Bezier kẹp trong màn hình ảo và né góc fail-safe, timeout `drag` 20 s, mặc định `--fast`. **TL-05** kẹp theo màn hình ảo, `--monitor N`, `space:"frame"` + `frame_geometry` (vision/`take_ai_screenshot`). **TL-06** sổ cửa sổ đã ẩn (`hidden_windows.json`), khớp exe chính xác trước, tiêu đề ≥ 4 ký tự, loại cửa sổ Iris. **TL-07** `--wait` đếm ngược thật, từ chối cửa sổ Iris, `demo` chỉ khi `IRIS_DEV_TOOLS=1`, xoá `--setup/--demo2`. **TL-08** clipboard history mặc định tắt/TTL/lọc mật khẩu-OTP-thẻ/PID kiểm `create_time`+cmdline/dừng khi thoát; thông báo che OTP. **TL-09** nhắc việc chuyển sang Electron (`reminders.mjs`), lưu userData, nạp lại, không nuốt lỗi. **TL-10** `wifi_manager` đọc bytes OEM + phân tích độc lập ngôn ngữ; `search_everything` giải mã UTF-8→OEM, chặn truy vấn `-`/`/`. **TL-11** chụp màn hình bằng `desktopCapturer` (bỏ `ai_vision.py`), chỉ lưu khi `save:true` (≤ 20 ảnh/24 h); `image_viewer.py` cùng thư mục ảnh, báo lỗi thật, kênh lệnh trong userData. **TL-12** độ sáng kiểm hỗ trợ + mã thoát, bluetooth/camera chạy UAC `-Wait` với `-EncodedCommand` hằng số, âm lượng tuyệt đối + `unmute`, `power_manager` bỏ `os.system`, shutdown trễ 5 s, báo `hibernate_enabled`. **TL-13** `idle_time` số học modulo 2^32. **TL-15** OCR tự chọn `vie+eng`, `IRIS_OCR_LANG`, thu nhỏ vùng lớn, `ImageGrab(all_screens)`. **TL-16** xoá `minimize.ps1`, 2 `.bat`, `quick_reminder.py`, `ai_vision.py`; `_common.py`; `requirements.txt` khớp thật; mọi lỗi tham số `argparse` cũng ra JSON. **TL-17** tạo `sys_monitor.py` + tool `get_system_stats`; cập nhật 5 `SKILL.md`; `tools/README.md`.
Khác: catalog mô tả đúng hành vi thật, bỏ 2 khai báo trùng tên còn sót, thêm `reveal_otp`/`force`/`save`/`volume_level`/`space`/`monitor`; `dangerous-tools` thêm bluetooth/camera "on" và `reveal_otp`.

## Chỗ prompt 2 nói SAI / lệch (đã đối chiếu code)
- **TL-17:** `project_tree.md` liệt kê `mouse_controller.py` — đó là file **thật** ở `sidecar/mouse_controller.py`, không phải lỗi; không sửa.
- **P-03:** `pythonBin()` đã lười từ lần 1; chỉ `computer-session.mjs` còn đọc env ở cấp module (đã sửa).
- Mô tả `power_manager sleep` ⇒ hibernate là kiến thức Windows, không kiểm được ở đây; code chỉ báo `hibernate_enabled` thay vì tự quyết.

## BLOCKED(Windows) — chưa chạy trên máy thật, KHÔNG tự đánh PASS
Chỉ phần logic thuần được test. Cần bạn thử trên Windows: `mouse drag` + timeout + `release`; kẹp toạ độ ở màn hình phụ/`--monitor`; `hide` rồi `restore`; `minimize "iris"` không thu nhỏ Iris; `magic_move --active --wait 5`; `move_window_precise` với tên có ký tự lạ; `wifi_manager list/profiles/connect` trên **Windows tiếng Việt**; `search_local_files "tài liệu"`; `clipboard_history` (start/stop/TTL/quyền 0600); `read_system_notifications` che OTP; `power_manager` (xác nhận hai bước, shutdown trễ 5 s); `system_control` camera/bluetooth (UAC `-Wait`), độ sáng trên màn hình rời; `idle_time`; `image_viewer` (cần Pillow + tkinter); `ocr_region` với gói `vie`; `take_ai_screenshot` (`desktopCapturer`) + `space:"frame"` click đúng điểm; nhắc việc qua restart thật; `taskkill` đóng êm với ứng dụng có hộp thoại lưu.
**Giới hạn của test:** `run-python-tool.test.mjs` chạy runner thật nhưng dùng `node` làm "python" (kiểm UTF-8, stdin, timeout, giới hạn 1 MB); chưa đối chứng được rằng test chunk-đa-byte sẽ đỏ với code cũ.

## Việc bạn cần làm
1. `pip install -r tools/requirements.txt` (có thêm `winsdk`; `Pillow` giờ bắt buộc cho OCR/color/viewer). Cài Tesseract + gói `vie` nếu cần OCR tiếng Việt; `es.exe` (Everything CLI) cho `search_local_files`.
2. Lịch sử clipboard muốn dùng: `IRIS_CLIPBOARD_HISTORY=1` trong `.env`.
3. Chạy `npm install && npm run build && npm test && npm run test:py`, rồi duyệt danh sách BLOCKED(Windows) ở trên.

---

# Nhật ký sửa lỗi — Lần 1/3: Vision & Chức năng (03/10/2026)

Nguồn: `IRIS_PROMPT_1_VISION_VA_CHUC_NANG.md`. Mọi thay đổi có test hoặc kiểm tra tương ứng; chạy `npm test`
(`node --test scripts/tests/*.test.mjs`), `npm run build` (`tsc --noEmit` + `vite build`).

## Kết quả kiểm chứng
| Hạng mục | Trước | Sau |
|---|---|---|
| `npx tsc` | chạy gói npm `tsc` giả (cảnh báo, không type-check) | TypeScript 7.0.2, **0 lỗi** |
| `npm run build` | thất bại (7 lỗi TS, `resources/project-seed` không tồn tại) | thành công |
| Frame lên Gemini (`sendRealtimeInput`) | truyền **mảng** ⇒ SDK gửi `{"realtimeInput":{}}` rỗng | object `{video}` — đã kiểm bằng `Session` thật của SDK |
| Test tự động | 0 | ~100 test (xem `scripts/tests/`) |

## ĐÃ SỬA
**Build/cấu hình:** B-01 (gói `tsc` giả), B-02 (7 lỗi TS + kiểu IPC), B-03 (`windows-media-sessions` → optionalDependencies, import động theo nền tảng), B-04 (ghim phiên bản, `mediapipe` ghim cứng), B-05 (extraResources), B-06 (xoá file rác), B-07 (mojibake + BOM), M-05 (`.env.example` hết marker xung đột + thêm biến mới).

**Vision:** V-01 (`live-input.mjs` + `sendVideoFrame`), V-02 (`grabJpeg` cắt đúng 1 frame MJPEG, có timeout), V-03 (vòng lặp không tự chết khi reconnect), V-04 (bỏ đường đẩy ảnh điện thoại không cổng), V-05 (chỉ một nguồn vision + chuyển camera), V-06, V-07 (preload `getSmartHomeCamerasConfig`), V-12 (desk snapshot chỉ báo success khi frame thật sự tới), V-13/V-14 (validate/dedupe frame, trạng thái camera điện thoại), V-15 (`take_ai_screenshot` thu nhỏ JPEG, ghi vào userData), V-17 (WebRTC: tín hiệu tuần tự, đệm ICE, extraction một lần, revoke Blob URL), V-20 (gỡ Expo Go).

**Cử chỉ tay:** V-08 (huỷ đúng khi unmount, camera không bị mở mồ côi), V-09 (cử chỉ kích hoạt theo cạnh — `gestureLatch.ts`), V-10 (whitelist payload, toạ độ theo tỉ lệ DPI-đúng, cử chỉ hệ thống mặc định **tắt**), V-11 (xung đột phím W/S), V-18 (GPU→CPU, fallback camera, rVFC, id theo handedness), V-19.

**Bảo mật:** S-01 (OmniParser: 127.0.0.1 + token + giới hạn upload), S-02 (TURN qua `.env`/WS, không nhúng trong HTML), S-03 (`app:open/close` allowlist + `execFile`), S-04 (ngrok opt-in, không `ngrok.kill()`), S-05, S-06 (`asInvoker`), S-07, S-09 (web dashboard mặc định tắt, mật khẩu ≥12 ký tự, header-only, constant-time, rate-limit), S-10 (`.env` an toàn: chống chèn dòng, round-trip, 0600, không trả khoá thô cho renderer), S-11 (xác nhận hai bước cho shutdown/kill/tắt wifi...), S-12 (ESPHome: `!secret`, OTA, mã hoá API, từ chối token mẫu), F-01 (firmware: token fail-closed + deadman 600 ms + `/capture`).

**Ổn định:** R-01 (queue không kẹt khi `startRun` ném), R-02 (turn PO/STUDY không treo, Stop hoạt động, `closeWhenIdle`), R-03 (chạy `claude` trên Windows không qua `shell:true`), R-04 (UTF-8 không vỡ giữa chunk), R-05 (giết cả cây tiến trình), watchdog 30 phút (`IRIS_RUN_TIMEOUT_MS`), G-01 (`cleanupAll` thật sự được chờ), G-02, G-03 (giữ resumption handle — đối chiếu tài liệu), G-04, G-07, G-08, G-09, T-01 (log lỗi toàn cục + Telegram), T-02, T-03, E-02 (ghi atomic + cách ly file hỏng), L-01, A-01 (một luồng mic), W-01 (wake 0.15), M-01 (Computer Use theo cấu hình), M-02 (model/SDK), M-04 (test key bằng kết nối Live thật), P-01 (`toolsDir()/pythonBin()/userDataDir()`).

**Lỗi phát hiện thêm trong lúc sửa (không có trong prompt):**
- `runQueue.active` không tồn tại ⇒ `/status` của Telegram và web luôn báo "Idle" → thêm `activeRunId()`.
- Tool mô tả action `move_forward`/`turn_left` nhưng firmware chỉ hiểu `forward`/`left` ⇒ lệnh thoại bị bỏ qua mà vẫn "success" → chuẩn hoá action + lái có thời hạn (heartbeat 200 ms rồi tự `stop`).
- `power_manager`/`media_control`/`desktop_manager` bị khai báo sai định dạng (`input_schema` đứng riêng) ⇒ Gemini không gọi được → gộp vào `functionDeclarations`; bỏ 2 khai báo trùng tên.
- Gõ w/a/s/d vào ô nhập vẫn lái robot; mất focus khi giữ phím làm heartbeat chạy mãi → đã chặn.
- Upload quá lớn ở OmniParser trả 500 thay vì 413 (tự phát hiện bằng smoke test) → đã sửa.

## CHƯA LÀM / CẦN BẠN QUYẾT ĐỊNH (nói thẳng)
- **M-03** (chuyển sang `gemini-3.8-live`): chưa làm. Đổi model kéo theo function calling mặc định bất đồng bộ (`NON_BLOCKING`) và bỏ `thinking_config`; cần thử với phiên Live thật. Tôi cũng chưa xác nhận được mã model từ tài liệu. Hiện vẫn dùng `gemini-3.1-flash-live-preview` (docs hiện hành vẫn dùng nó trong ví dụ).
- **V-16 đầy đủ** (chỉ cảnh báo + hỗ trợ `snapshot_url`; PiP vẫn mở luồng riêng — cần camera hub, Phase 8.1), **A-01 đoạn chuyển AudioWorklet** (đã chặn mở hai luồng mic; `ScriptProcessorNode` vẫn còn), Phase 8 (cải tiến tuỳ chọn), nhãn "AI đang xem" trên PiP (5.5), ưu tiên stream điện thoại cho desk snapshot (4.6). *(G-05, G-06 và ONNX offline đã làm ở mục "Lượt bổ sung" bên dưới.)*
- Chạy MediaPipe và ONNX Runtime **offline**: cần chạy `npm run setup:mediapipe` và `npm run setup:ort` một lần (có mạng); chưa chạy thì tự rơi về CDN.
- **Chưa kiểm chứng trên phần cứng/Windows thật**: firmware (chỉ qua biên dịch cú pháp với stub + ArduinoJson thật), `claude.cmd`/`taskkill`, cử chỉ tay với camera, WebRTC với điện thoại. Phần logic thuần đều có test.
- Điểm yếu còn lại cần biết: luồng camera ESP32 (`:81/stream`, `/capture`) vẫn không xác thực (cùng mạng LAN).

## LƯỢT BỔ SUNG (03/10/2026, sau lần 1/3)
> **Giới hạn kiểm chứng của lượt này:** máy chạy lượt này **không có `node`/`npm`/`git`** trong PATH và chưa có `node_modules`, nên **chưa chạy được** `tsc`, `npm run build`, `npm test` cho các thay đổi dưới đây. Mọi mục chỉ được viết + đọc lại, **chưa được chạy**. Hãy chạy `npm install && npm run build && npm test` trước khi tin.

**Đã làm thêm**
- **G-05 — phím tắt toàn cục cấu hình được.** Module thuần mới `electron/main/hotkeys.mjs` (`resolveHotkeys`) đọc `IRIS_HOTKEYS` (JSON): đổi phím, tắt phím bằng giá trị rỗng, bỏ qua khoá lạ/accelerator không hợp lệ (có cảnh báo), tự tắt phím trùng. `electron/main.mjs` đăng ký 10 phím qua một bảng thay cho 10 khối lặp; `register()` ném lỗi hoặc trả `false` đều được log rõ. **Giữ nguyên phím mặc định** (không đổi sang `CommandOrControl+Alt+…` như gợi ý của prompt để khỏi phá thói quen; ai bị xung đột thì tự đổi qua biến này). Test: `scripts/tests/hotkeys.test.mjs`. Docs: `.env.example`, `CLAUDE.md`.
- **G-06.** Bỏ tham số `options` thừa của `startSidecar` ở `preload.cjs`, `src/vite-env.d.ts`, `src/App.tsx` (handler `sidecar:start` vốn bỏ qua nó).
- **W-01 (phần offline).** Wake word không còn bắt buộc CDN: `scripts/prepare-ort.mjs` (`npm run setup:ort`) chép `ort-wasm*` từ `node_modules/onnxruntime-web/dist` vào `public/ort/` (đã thêm vào `.gitignore`); `useWakeWord.ts` dò `ort/ready.txt` và dùng bản local, không có thì rơi về CDN. `configureOrt()` giờ là `async` (đã `await`). Test: `scripts/tests/ort-offline.test.mjs` (URL CDN phải khớp phiên bản trong `package-lock.json`). **Chưa kiểm chứng:** tên file `ort-wasm*` thật của `onnxruntime-web@1.27.0` và việc `HEAD fetch` hoạt động khi app nạp bằng `file://` (nếu không được thì tự dùng CDN như MediaPipe).

**Cố ý KHÔNG làm**
- **M-03 (`gemini-3.8-live`).** Tra cứu lại lượt này cho kết quả **mâu thuẫn**: một nguồn nói function calling phải `NON_BLOCKING` và bản "extended thinking" không chấp nhận tool đồng bộ, trong khi prompt gốc nói khai báo được `BLOCKING`. Không đối chiếu được tài liệu gốc, và code hiện giả định tool trả kết quả đồng bộ, nên đổi mặc định hoặc thêm lựa chọn vào SetupPanel có nguy cơ làm hỏng tool-calling mà không có phiên Live thật để thử. Giữ `gemini-3.1-flash-live-preview`. Cần bạn thử thoại thật rồi quyết định.
- **A-01 AudioWorklet, V-16 camera hub, Phase 8:** thay đổi sâu vào âm thanh/camera thời gian thực, không thể kiểm chứng khi không chạy được app → để lại thay vì viết mù.

## VIỆC BẠN CẦN LÀM SAU KHI NHẬN BẢN NÀY
0. `npm install && npm run build && npm test` — kiểm các thay đổi của "Lượt bổ sung" (chưa từng được chạy).
1. `npm install` rồi `npm run setup:mediapipe` và `npm run setup:ort` (tải/chép asset để hand-tracking và wake word chạy offline; không bắt buộc).
2. Firmware: tạo `secrets.h` cạnh sketch với `#define CONTROL_TOKEN "chuoi-bi-mat-dai"`; token này phải trùng `token` của robot trong `robots.json`. **Token rỗng ⇒ firmware từ chối mọi lệnh** (cố ý). Sao chép `robots.example.json` → `robots.json`, `smarthome_cameras.example.json` → `smarthome_cameras.json`, `secrets.yaml.example` → `secrets.yaml`.
3. Web dashboard muốn dùng: `IRIS_WEB_DASHBOARD=1` + `WEB_PASSWORD` ≥ 12 ký tự.
4. Kiểm tra `.env` hiện tại của bạn: nếu API key từng bị lộ qua repo/zip này thì **đổi key**.
5. Cử chỉ hệ thống (Win, Alt+F4, Alt+Tab, Ctrl±) giờ mặc định tắt: bật bằng `IRIS_HAND_SYSTEM_GESTURES=1` nếu muốn.

---

# Lịch sử trước đó


## 1. AudioContext bị Suspended trên PC
**File:** `src/components/CompanionWebRTC.tsx`
- Thêm `attachAudioAutoResume()`: gắn listener global (`pointerdown/mousedown/keydown/touchstart`,
  capture phase) lên `window`, tự gọi `ctx.resume()` ngay ở gesture đầu tiên sau khi
  AudioContext được tạo (không cần click đúng vào phần tử cụ thể nào).
- Nếu sau ~2.5s vẫn `suspended`, hiện thêm badge mờ góc màn hình ("Click để bật
  Audio Companion") làm phương án dự phòng — click vào đó cũng gọi resume qua
  `companionStream.requestResume()`.
- Trạng thái audio (`idle|running|suspended|closed`) được publish ra
  `src/lib/companionStream.ts` để UI khác (PiP) cũng đọc được.

## 2. Alt+C (PiP) không đồng bộ với luồng WebRTC
**File mới:** `src/lib/companionStream.ts` — singleton chia sẻ `MediaStream` +
trạng thái audio giữa `CompanionWebRTC.tsx` (chạy ngầm) và bất kỳ UI nào cần
hiển thị (không tạo thêm `RTCPeerConnection` thứ hai).

**File:** `src/components/CompanionWebRTC.tsx`
- `pc.ontrack` giờ gọi `companionStream.setStream(e.streams[0])`.
- `peer-left` reset lại stream/audio state về rỗng.

**File:** `src/components/CompanionVideo.tsx`
- Ưu tiên #1: subscribe `companionStream`, gắn thẳng `MediaStream` vào thẻ
  `<video>` của chính PiP.
- Ưu tiên #2 (dự phòng): `onCompanionFrame` (Expo Go cũ) — chỉ dùng khi chưa
  có WebRTC stream.
- Ưu tiên #3 (dự phòng): QR ngrok — chỉ hiện khi không có cả hai nguồn trên.
- Hiện badge nhỏ trong PiP nếu audio đang `suspended`.

## 3. Tích hợp OmniParser cho Computer Use

**File:** `electron/computer-session.mjs`
- Đọc trực tiếp `reponew/toado/api_server.py` (+ `util/utils.py`,
  `util/box_annotator.py`) để lấy đúng contract thật — **không phải** JSON
  base64 như giả định ban đầu:
  - `POST {OMNIPARSER_ANNOTATE_URL}` (mặc định `http://127.0.0.1:8000/parse`),
    `multipart/form-data`, field `file` = ảnh, **không gửi** field `prompt`
    (để server không tự gọi Gemini chọn 1 khung, mà trả về toàn bộ danh sách
    cho Claude tự chọn ở mỗi bước).
  - Response: `{ labeled_image_base64 (PNG), coordinates: {"<id>": [x,y,w,h] tỉ lệ 0-1} }`.
- Hàm mới `annotateWithOmniParser()`: gọi OmniParser trước mỗi lượt chụp màn
  hình, quy đổi toạ độ ratio → pixel tuyệt đối theo `width/height` màn hình
  thật, build danh sách text `"[id] center=(x,y) box=[...]"`, gửi kèm ảnh đã
  đánh khung đỏ cho Claude thay vì ảnh gốc.
- Có timeout (`OMNIPARSER_TIMEOUT_MS`, mặc định 90s — khớp YOLO+OCR chậm trên
  máy yếu) và cờ bật/tắt (`OMNIPARSER_ENABLED`). Nếu OmniParser lỗi/offline,
  tự động fallback về ảnh gốc — Computer Use không bao giờ bị chặn vì OmniParser.
- System prompt được cập nhật để hướng dẫn Claude ưu tiên toạ độ từ danh sách
  OmniParser thay vì tự đoán.
- `sniffImageMediaType()`: dò PNG/JPEG theo magic bytes base64, vì ảnh
  OmniParser trả về luôn là PNG còn ảnh gốc là JPEG.

**Cấu hình:** xem phần mới trong `.env.example` (`OMNIPARSER_ANNOTATE_URL`,
`OMNIPARSER_ENABLED`, `OMNIPARSER_TIMEOUT_MS`). Chạy server bằng:
```
cd reponew/toado
python api_server.py
```

### Lưu ý quan trọng đã phát hiện trong lúc sửa
- `electron/computer-session.mjs` dùng **Claude Computer Use** (Anthropic
  API, tool `computer_20241022`) để tự chọn toạ độ bằng vision riêng — không
  phải Gemini như mô tả ban đầu.
- Dự án đã có sẵn một luồng OmniParser khác, riêng biệt, trong
  `electron/main.mjs` (`startOmniParserTask`): gửi kèm `prompt`, để server tự
  gọi Gemini chọn 1 khung và trả `target_center`, rồi gọi `/click` + `/type`
  (server tự thực thi chuột/phím qua `pyautogui`). Luồng này **không bị đụng
  vào** — vẫn hoạt động như cũ, độc lập với thay đổi ở mục 3.
## 4. Audit toàn repo 2026-08-02: sửa lỗi bảo mật, dọn rác, cập nhật tài liệu

**Bối cảnh:** rà soát toàn bộ repo theo yêu cầu — kiểm tra xem `main.mjs` đã
được tách/rút gọn/liên kết đúng chưa, tìm lỗi còn sót, dọn dẹp file rác, và
đồng bộ lại tài liệu đang lệch thực tế.

**Lỗi bảo mật (đã sửa) — `electron/main.mjs`:**
`electron/renderer-security.mjs` (chặn điều hướng cửa sổ ra ngoài + chỉ cấp
quyền mic/camera cho đúng document của app, viết theo change `harden-security-
boundaries` trước đó) tồn tại trên đĩa nhưng **chưa từng được `import`/gọi ở
đâu cả**. App vẫn chạy bản `setPermissionRequestHandler` cũ cấp quyền media
cho bất kỳ `webContents` nào không kiểm tra nguồn gốc, và hoàn toàn không có
`will-navigate`/`setWindowOpenHandler` nào chặn điều hướng — một link độc hại
trong ghi chú second-brain (render qua react-markdown) có thể điều hướng cả
cửa sổ chính (mang theo `preload.cjs` với `window.iris`) sang trang từ xa rồi
xin quyền mic/camera. Đã `import { installRendererSecurity }` và gọi
`installRendererSecurity({ repoRoot })` thay cho handler cũ.

**Rò rỉ bộ nhớ (đã sửa) — `electron/main.mjs`:**
`notifyIris()`'s `pendingClaudeAnnouncements` (hàng đợi thông báo thoại khi
Gemini Live offline) không có giới hạn kích thước — mất kết nối kéo dài sẽ
phình vô hạn. Bản `announcements.mjs` mới hơn (cũng chưa từng được liên kết)
có cap drop-oldest = 20; đã thêm cùng logic đó trực tiếp vào `notifyIris()`.

**Dọn rác:**
- Xoá `electron/temp_claude.mjs` — file rác encode UTF-16 lỗi, là bản sao cũ
  của `companion-server.mjs`, không được import ở đâu.
- Xoá 6 module trong `electron/` tồn tại nhưng chưa từng được `import` ở bất
  kỳ đâu — di sản từ fork myiris, chức năng đã được port trực tiếp vào
  `main.mjs` (dư thừa) hoặc mô tả một tính năng ("listening mode" boundary
  sequencing) chưa từng được tích hợp vào fork này:
  `coalesce.mjs`, `listen-boundary.mjs`, `pipeline-probes.mjs`, `platform.mjs`,
  `renderer-bridge.mjs`, `announcements.mjs`.
- Xoá 1 file rỗng (0 byte) tên bị lỗi encoding, trùng nội dung với `plan.md`.
- Đổi tên `b╬ô├╢┬úΓö£┬ío c╬ô├╢┬úΓö£┬ío camera,ROBOT,APP.md` (tên file bị lỗi
  encoding nhiều lớp, nội dung UTF-8 vẫn nguyên vẹn) thành
  `Bao-Cao-Kiem-Thu-QA-Report-2026-07-21.md`.
- Đối chiếu toàn bộ danh sách bug trong report QA đó (BUG-CAM-\*, BUG-HAND-\*,
  BUG-COMP-\*) với code hiện tại: tất cả đã được fix từ trước (có comment
  `BUG-XXX FIX` rõ ràng trong code), trừ 2 lỗi ở trên vừa fix trong lần này.

**Cập nhật tài liệu (đã lệch thực tế khá nhiều):**
- `CLAUDE.md`: số dòng `main.mjs` ghi "~1500 lines" trong khi thực tế ~5100
  dòng; `App.tsx` ghi "~1350 lines" trong khi thực tế ~1870 dòng. Đã sửa và
  thêm mục "Known documentation drift" ghi lại toàn bộ audit này.
- `.agents/skills/myiris/SKILL.md`: xoá đường dẫn cá nhân cứng
  `C:\Users\vanha\Downloads\myiris`, sửa link `file://` tuyệt đối hỏng trỏ tới
  `project_tree.md` thành link tương đối trong repo, cập nhật số dòng
  `main.mjs`/`App.tsx`.
- `.agents/skills/myiris/references/project_tree.md`: quá cũ, thiếu hơn chục
  file/module đã thêm vào `electron/` từ sau lần tạo trước — đã tạo lại toàn
  bộ (rút gọn phần vendored/lớn như `reponew/`, `openspec/changes/archive/*`
  còn 1-2 cấp để vẫn dễ đọc).
- `.agents/SKILLS_MAP.md` + `.agents/skills.json`: cả hai trỏ tới
  `skills/skills/skills` — thư mục không tồn tại ở bất kỳ đâu trong repo (bộ
  skill công khai của Anthropic được mô tả trong đó chưa từng được commit vào
  git, chỉ tồn tại cục bộ trên máy người tạo repo trước đây). Viết lại để mô
  tả đúng các skill thực sự có trong repo (`.agents/skills/*` và
  `resources/skills/claude-skills/*`), và trỏ `skills.json` vào đó.

**Xác nhận không có regression:** `node --check` pass trên toàn bộ `.mjs`/
`.cjs`; `npx tsc --noEmit` pass sạch; `npx vite build` pass sạch.

