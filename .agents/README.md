# .agents — Tài liệu phân tích dự án I.R.I.S

Thư mục này chứa phân tích kỹ thuật (không phải tài liệu chính thức của tác giả)
được tạo ra bằng cách đọc mã nguồn thực tế trong repo `ASHR12/iris`. Mục đích: giúp
một agent/AI hoặc lập trình viên mới hiểu nhanh kiến trúc, luồng dữ liệu, và các
điểm cần lưu ý trước khi sửa code.

## Danh sách file

| File | Nội dung |
|---|---|
| `01-overview.md` | Bức tranh tổng thể: I.R.I.S là gì, 2 "bộ não" (Gemini Live + Hermes Agent), các thành phần chính |
| `02-electron-main.md` | Phân tích chi tiết `electron/main.mjs` — tiến trình chính Electron, IPC, cấu hình, Glass HUD, tray |
| `03-sidecar-python.md` | Phân tích thư mục `sidecar/` — sidecar Python xử lý Gemini Live qua PyAudio (đường dự phòng/thử nghiệm) |
| `04-frontend-react.md` | Phân tích `src/` — App.tsx, components, hooks, state machine của UI |
| `05-data-flow.md` | Luồng dữ liệu end-to-end: voice → Gemini → Hermes → UI, kèm sơ đồ |
| `06-config-and-security.md` | Cấu hình, biến môi trường, các điểm cần lưu ý về bảo mật |
| `07-risks-and-todo.md` | Rủi ro kỹ thuật, nợ kỹ thuật (technical debt), gợi ý cải tiến quan sát được từ code |

## Cách đọc nhanh

- Muốn hiểu dự án trong 2 phút → đọc `01-overview.md`.
- Muốn sửa logic dispatch task cho Hermes → đọc `02-electron-main.md` (phần "Hermes dispatch gate").
- Muốn sửa UI/orb/gesture → đọc `04-frontend-react.md`.
- Muốn hiểu tại sao có cả sidecar Python lẫn Electron xử lý Gemini Live → đọc `03-sidecar-python.md`.

Toàn bộ phân tích dựa trên trạng thái repo tại thời điểm clone (nhánh mặc định,
commit mới nhất khi tải về). Nếu repo được cập nhật, các con số dòng/tên hàm có
thể lệch đi.
