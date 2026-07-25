# Các thay đổi đã áp dụng

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
