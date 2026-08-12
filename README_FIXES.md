# Iris — bản vá OmniParser/Gemini + 2 bug nhỏ

Giữ nguyên cấu trúc thư mục — chỉ cần copy-đè các file này vào đúng vị trí
tương ứng trong repo `irit/` của bạn.

## 1. electron/main/computer-use-tools.mjs
Tách hẳn bước "chọn khung để click" ra khỏi kênh `sendRealtimeInput` dùng
chung với camera companion + giọng nói.

- **Trước**: gửi ảnh đã đánh số thẳng vào Gemini Live để nó tự nhìn và gọi
  `click_id` → dễ bị chen ngang bởi frame camera (1 khung/giây) hoặc audio,
  gây trễ và chọn sai khung.
- **Sau**: gọi `/parse` kèm `prompt` ngay từ đầu → `api_server.py` tự chọn
  khung bằng vision AI riêng của nó (ưu tiên Claude qua `ANTHROPIC_API_KEY`,
  fallback Gemini qua `GEMINI_VISION_API_KEY`) trong một request đồng bộ,
  rồi click luôn — không đụng tới kênh Gemini Live. Chỉ khi bước này lỗi
  (ví dụ chưa set key nào) mới rơi về cách cũ (stream ảnh cho Gemini Live)
  làm phương án dự phòng.

**Bạn cần làm**: tạo 1 API key Gemini free thứ 2 tại
https://aistudio.google.com/apikey, thêm vào `.env`:
```
GEMINI_VISION_API_KEY=your_second_key
```
(hoặc set `ANTHROPIC_API_KEY` nếu muốn dùng Claude — độ chính xác nhận diện
khung số cao hơn Gemini Flash).

## 2. electron/main/local-tools.mjs
Bug: `takeAiScreenshotTool()` gọi `ai_vision.py --outdir` với thư mục gốc
`tools/` thay vì `tools/img/`, khiến ảnh chụp màn hình "nhìn giúp tôi" nằm
lẫn với code. Đã sửa để trỏ đúng `tools/img/`.

> Ảnh cũ đang nằm sai chỗ trong project của bạn — bạn nên tự di chuyển các
> file `tools/screenshot_*.png` sang `tools/img/` một lần cho gọn (không có
> trong file zip này vì đó là dữ liệu, không phải code).

## 3. tools/video_player.py
Bug: script luôn thoát với exit code 0 dù thất bại (không tìm thấy video,
mở file lỗi...), khiến Electron nhận `status: "success"` giả trong khi
thực tế không làm được gì. Đã thêm `sys.exit(1)` ở 2 nhánh lỗi.

## 4. .env.example
Dọn 2 khối xung đột merge Git chưa resolve (`<<<<<<< HEAD` / `=======` /
`>>>>>>>`) còn sót lại quanh phần cấu hình OmniParser/vision-key, gộp lại
thành 1 bản mô tả nhất quán (Claude ưu tiên, Gemini fallback, key tách
riêng khỏi `GEMINI_API_KEY` của trợ lý giọng nói).

---

Đã kiểm tra `node --check` và `python3 -m py_compile` sạch cho cả 3 file
code. Phần còn lại của `/tools` và `/electron` không có thay đổi nào khác
ngoài 4 file trên.
