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

