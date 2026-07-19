# 07 — Rủi ro kỹ thuật / nợ kỹ thuật quan sát được

Đây là các quan sát rút ra từ việc đọc code, không phải phản hồi chính thức từ
tác giả dự án. Nêu ra để người tiếp theo sửa code biết trước cần cẩn trọng ở đâu.

## 1. Hai đường dẫn Gemini Live không đồng bộ hành vi
`sidecar/voice_server.py` cho phép gọi thẳng `submit_hermes_task` mà **không**
qua cổng xác nhận 2 bước (`hermesGate.mjs`) mà `electron/main.mjs` có. Nếu dự
án định dùng sidecar cho một nền tảng nào đó trong tương lai, cần đồng bộ lại
logic an toàn này, nếu không sẽ vi phạm chính "hai nguyên tắc vàng" mà README
nêu ("Iris never invents Hermes results", và ở đây là "Iris never dispatches
without confirmation").

## 2. `hermesGate.mjs` là state toàn cục dạng biến module (`let proposal = null`)
Không phải theo từng phiên/tab — nếu tương lai app hỗ trợ nhiều cửa sổ/nhiều
phiên Gemini Live đồng thời trong cùng tiến trình main, biến `proposal` này sẽ
bị chia sẻ nhầm giữa các phiên. Ở kiến trúc hiện tại (một cửa sổ, một phiên
Live tại một thời điểm) thì ổn.

## 3. TTL đề xuất 5 phút (`PROPOSAL_TTL_MS`)
Nếu người dùng im lặng lâu sau khi Gemini đọc brief rồi mới nói "ừ đồng ý", đề
xuất có thể đã hết hạn và bị âm thầm loại (`claimConfirmedProposal` trả
`no_proposal`) — cần kiểm tra trải nghiệm khi rơi vào trường hợp này (Gemini có
được dạy để phát hiện và đề xuất lại không, hay người dùng sẽ thấy im lặng khó
hiểu).

## 4. Danh sách phiên Hermes giới hạn cứng 25 (`slice(0, 25)`)
`listHermesSessions()` chỉ lấy 25 phiên gần nhất do Iris tạo — hợp lý cho UI
switcher, nhưng nếu cần tính năng tìm kiếm phiên cũ hơn sau này sẽ cần API khác.

## 5. Phụ thuộc vào việc Hermes gateway đã chạy sẵn (đường Electron chính)
Không giống sidecar Python có `HermesProcessManager.ensure_running()` tự khởi
động gateway, `electron/main.mjs` (theo các đoạn đã đọc) dường như không tự
spawn tiến trình `hermes gateway` — người dùng phải tự bật theo hướng dẫn Quick
Start. Đây là điểm trải nghiệm (UX) có thể cải thiện: đồng bộ khả năng tự khởi
động gateway từ sidecar sang main.mjs.

## 6. Khoá `API_SERVER_KEY` mặc định public
Xem chi tiết ở `06-config-and-security.md` — không phải lỗi, nhưng là điểm cấu
hình cần người dùng chủ động thay đổi khi triển khai ngoài localhost.

## 7. `SetupPanel.tsx` (704 dòng) và `electron/main.mjs` (1474 dòng) khá lớn
Cả hai đều gánh nhiều trách nhiệm khác nhau trong một file (main.mjs: config +
Hermes bridge + Gemini Live + cửa sổ/tray + IPC; SetupPanel: onboarding +
settings đầy đủ). Nếu dự án phát triển thêm tính năng, tách nhỏ theo domain
(ví dụ `hermesBridge.mjs`, `geminiLive.mjs`, `windowManager.mjs`, `config.mjs`)
sẽ dễ bảo trì hơn — `hermesGate.mjs` đã là một ví dụ tốt về việc tách một mối
quan tâm (concern) riêng ra file riêng.

## 8. Không thấy test tự động
Trong phạm vi các file đã quét (`package.json` scripts), không có script
`test`. `npm run build` chỉ chạy `tsc --noEmit && vite build` (kiểm tra kiểu +
bundle), không có unit test cho các hàm logic quan trọng như
`findTaskMatches`, `hermesGate.mjs`, hay `historyStepsFromToolCalls`. Đây là
những hàm logic thuần (pure function), khá dễ viết unit test và sẽ có giá trị
cao vì chúng ảnh hưởng trực tiếp tới độ tin cậy ("never invents results",
"never dispatches without confirmation").

## Gợi ý ưu tiên nếu muốn đóng góp (dựa trên README "Good first areas" + quan sát code)
1. Viết unit test cho `hermesGate.mjs` (state machine nhỏ, dễ test, giá trị an
   toàn cao).
2. Đồng bộ tài liệu/ghi chú rõ trong `sidecar/` rằng đây là bản không dùng
   trong production, hoặc cập nhật nó để dùng chung `hermesGate`-style logic.
3. Thêm khả năng tự khởi động Hermes gateway từ `electron/main.mjs` (port logic
   từ `HermesProcessManager` của sidecar sang Node), giảm bước thủ công ở Quick
   Start.
4. Theo đúng gợi ý README: orb theme mới, thêm gesture, hoàn thiện HUD trên
   Windows/Linux (README ghi rõ Glass HUD "built and tuned on macOS"), thêm
   lệnh voice UI mới.
