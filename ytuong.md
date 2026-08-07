# Ý Tưởng Phát Triển Iris

## 1. Lập trình Thói quen (Routines / Cron Scheduler)
- **Mục tiêu:** Bổ sung bộ nhớ dài hạn (Memory) và khả năng lập lịch tự động cho Iris.
- **Kịch bản sử dụng:** *"Iris, từ nay cứ 11h đêm là tắt toàn bộ đèn nhà và mở nhạc Lo-fi cho tôi"*.
- **Cơ chế hoạt động:** 
  Lưu cấu hình vào file/SQLite. Sử dụng một cron scheduler chạy ngầm. Đến giờ kích hoạt âm thầm gọi Smart Home API.

## 2. Trợ lý Kỷ luật (Deep Work & Focus Enforcer)
- **Mục tiêu:** Ngăn chặn sự xao nhãng khi làm việc.
- **Kịch bản sử dụng:** Iris theo dõi ngầm cửa sổ đang active (vd dùng `active-win`). Nếu mở Facebook/YouTube trong giờ làm việc, Iris đổi màu đỏ, phát cảnh báo: *"Bạn đang xao nhãng! Hãy quay lại làm việc!"* và tự động mở nhạc tập trung.

## 3. Giao tiếp Kéo thả (Black Hole Dropzone)
- **Mục tiêu:** Biến quả cầu Iris thành điểm nhận dữ liệu vật lý.
- **Kịch bản sử dụng:** Kéo một file PDF hoặc đoạn code thả trực tiếp vào quả cầu Iris trên màn hình.
- **Cơ chế hoạt động:** Bắt sự kiện `ondrop` trên chế độ HUD. Sau khi nhận file, AI lập tức đọc và lên tiếng hỏi: *"Tôi đã nhận file, bạn muốn tôi tóm tắt hay làm gì?"*.

## 4. "Nhắc Tuồng" Thông minh (AI Teleprompter & Meeting Copilot)
- **Mục tiêu:** Trợ giúp trả lời câu hỏi trực tiếp trong lúc họp Zoom/Meet.
- **Kịch bản sử dụng:** Bật mic cho Iris nghe cuộc họp. Nếu có ai hỏi câu khó, Iris tự suy nghĩ và bắn các gạch đầu dòng câu trả lời lên kính HUD (chỉ bạn thấy được).

## 5. Quản gia Sức khỏe (Posture & Health Monitor)
- **Mục tiêu:** Bảo vệ sức khỏe người dùng khi ngồi máy tính lâu.
- **Cơ chế hoạt động:** Dùng AI (MediaPipe) chạy ngầm quét camera máy tính. Nếu bạn ngồi gù lưng quá lâu hoặc dí sát mắt vào màn hình, Iris sẽ popup cảnh báo và nhắc uống nước.

## 6. Tự động viết Nhật ký & Báo cáo Công việc (Auto-Journaling)
- **Mục tiêu:** Tổng hợp công việc cuối ngày.
- **Cơ chế hoạt động:** Dựa vào log của Terminal, commit Git, và lịch sử file để Iris tự sinh ra báo cáo lúc 5h chiều: *"Hôm nay bạn code 4 tiếng, sửa 3 lỗi..."*.

## 7. Ghi âm & Tóm tắt Cuộc họp Zoom/Meet (Meeting Summarizer)
- **Mục tiêu:** AI nghe toàn bộ nội dung phòng họp (âm thanh loa + âm thanh mic) và tự động tóm tắt lại nội dung chính, action items sau khi kết thúc.
- **Cơ chế hoạt động:** 
  - Sử dụng cơ chế System Audio Loopback (như WASAPI trên Windows) để ghi âm cả tiếng của những người khác trong Zoom (loa) và tiếng của bạn (micro).
  - Dùng AI (Whisper) để chuyển giọng nói thành văn bản (Speech-to-Text) theo thời gian thực.
  - Khi cuộc họp kết thúc, truyền toàn bộ Transcript vào Gemini/Claude để tóm tắt và kết xuất ra file Markdown.
- **Repo tham khảo:**
  - [Ecoute (Python)](https://github.com/SevaSk/ecoute): Một công cụ mã nguồn mở kinh điển dùng PyAudio để bắt âm thanh từ loa + mic, sau đó dùng Whisper để nhận diện giọng nói và OpenAI tạo câu trả lời trực tiếp cho phỏng vấn/Zoom. (Có thể tham khảo cách họ bắt âm thanh Loopback).
  - [whisper.cpp](https://github.com/ggerganov/whisper.cpp): Dùng để chạy nhận diện giọng nói siêu nhẹ ngay trên máy tính mà không cần tốn tiền API.

## 8. Tích hợp Second Brain (Notion/Obsidian Sync)
- **Mục tiêu:** Lưu trữ và đồng bộ hóa ý tưởng/kiến thức vào bộ nhớ dài hạn.
- **Cách hoạt động:** *"Iris, lưu lại ý tưởng này vào thư mục Dự án mới..."*.
- **Độ thông minh:** Kết nối thẳng vào hệ thống ghi chú (Notion, Obsidian, Trello). Bạn nảy ra ý tưởng gì cứ nói, Iris sẽ tự động gõ lại, định dạng đẹp đẽ và vứt đúng vào thư mục trong phần mềm ghi chú của bạn để không bao giờ bị trôi mất.

## 9. Bản tin Buổi sáng Độc bản (Personal Morning Briefing)
- **Mục tiêu:** Cung cấp thông tin tổng hợp cá nhân hóa mỗi ngày.
- **Cách hoạt động:** Khi bạn ngồi vào máy tính buổi sáng và nói: *"Chào buổi sáng Iris"*.
- **Độ thông minh:** Iris sẽ tự động đi gom nhặt dữ liệu: Thời tiết hôm nay, tình hình kẹt xe trên tuyến đường bạn hay đi làm, tin tức công nghệ mới nhất trong đêm, và giá cổ phiếu/crypto mà bạn đang theo dõi... sau đó đọc một bản tin tóm tắt trong 1 phút dành riêng cho bạn.

## 10. Kế toán Cá nhân (Expense & Invoice Tracker)
- **Mục tiêu:** Quản lý chi tiêu và hóa đơn tự động.
- **Cách hoạt động:** *"Iris, tôi vừa chuyển khoản 150 cành tiền cà phê"* hoặc *"Iris, lưu lại cái hóa đơn tiền điện trên màn hình vào sổ"*.
- **Độ thông minh:** Tự động nhận diện số tiền, phân loại danh mục (Ăn uống, Sinh hoạt), và ghi thẳng vào bảng tính (Google Sheets/Notion) quản lý chi tiêu của bạn. 

## 11. Trợ lý Xử lý Email (Email Triage)
- **Mục tiêu:** Phân loại và phản hồi Email nhanh chóng.
- **Cách hoạt động:** *"Iris, có email nào khẩn cấp không?"*
- **Độ thông minh:** Móc vào Gmail/Outlook của bạn, lọc ra những email quan trọng, tóm tắt lại bằng 1-2 câu, và tự động soạn sẵn thư trả lời nháp. Bạn chỉ cần nói *"Ok, gửi đi"*.

## 12. Quản gia Lịch trình (Smart Calendar & Scheduler)
- **Mục tiêu:** Sắp xếp và quản lý lịch họp/công việc thông minh.
- **Cách hoạt động:** *"Iris, chiều nay tôi rảnh lúc nào? Xếp cho tôi 1 lịch họp 30 phút..."*.
- **Độ thông minh:** Không chỉ biết xem giờ, mà tự động kiểm tra khoảng thời gian trống, tự động tạo sự kiện, soạn luôn email mời họp. Sáng dậy tự động tóm tắt: *"Hôm nay bạn có 2 cuộc họp..."*.

## 13. Thám tử File (Semantic Local Search)
- **Mục tiêu:** Tìm kiếm tài liệu bằng ngữ nghĩa thay vì tên file.
- **Cách hoạt động:** *"Iris, tìm cho tôi cái hợp đồng mà tuần trước tôi có nhắc đến..."*.
- **Hiệu ứng VIP:** Quét nhanh nội dung bên trong tất cả các file PDF, Word, TXT gần đây, hiểu ngữ nghĩa và lập tức mở đúng file đó lên.

## 14. Chế độ "Workspace Matrix" (Setup Không gian làm việc 1 chạm)
- **Mục tiêu:** Tự động điều khiển và dàn xếp cửa sổ ứng dụng theo bối cảnh.
- **Cách hoạt động:** *"Iris, khởi động chế độ code dự án Robot"*.
- **Hiệu ứng VIP:** Tự động đóng các tab giải trí, mở VS Code, xếp layout màn hình, mở Terminal chạy script, và bật chế độ Focus Mode của Windows. Chỉ một câu nói, máy tính "biến hình" sẵn sàng.

## 15. Trợ lý Trực ban (Smart Auto-Responder)
- **Mục tiêu:** Tự động trả lời tin nhắn/cuộc gọi khi bạn rời khỏi máy tính.
- **Cách hoạt động:** AI sử dụng Camera/Mic để biết bạn đã rời khỏi bàn làm việc. Nếu có tin nhắn công việc gấp trên Zalo/Teams/Discord, Iris sẽ tự động nhắn lại: *"Sếp tôi đang đi ra ngoài, khoảng 10 phút nữa sẽ quay lại. Bạn có cần tôi ghi chú lại lời nhắn không?"*. Khi bạn quay lại, Iris sẽ báo cáo ngay lập tức.

## 16. Bác sĩ Code Tự động (Self-Healing / Live Bug Fixer)
- **Mục tiêu:** Giám sát và tự động đề xuất sửa lỗi phần mềm theo thời gian thực.
- **Cách hoạt động:** Iris liên tục chạy ngầm và đọc Log (Terminal/Console) của dự án bạn đang code. Nếu server bị sập hoặc báo lỗi màu đỏ, Iris sẽ phân tích ngay lập tức và nói lên: *"Dự án vừa sập vì lỗi TypeError ở dòng 45, nguyên nhân là biến bị Null. Tôi đã viết sẵn code sửa lỗi, bạn có muốn tôi áp dụng ngay và khởi động lại Server không?"*.

## 17. Quản gia DevOps & Git (Voice-Activated Developer)
- **Mục tiêu:** Tự động hóa các thao tác lập trình nhàm chán bằng giọng nói.
- **Cách hoạt động:** Khi code xong một tính năng, bạn vươn vai nói: *"Iris, dọn dẹp code, format lại toàn bộ, tạo commit với nội dung tôi vừa làm xong tính năng PIP, và đẩy lên Github nhé"*. Iris sẽ tự động chạy Prettier/Linter, kiểm tra lỗi, ghi câu lệnh git chuẩn semantic và push lên mạng.

## 18. Khiên chắn Thông báo AI (Notification Shield)
- **Mục tiêu:** Lọc bỏ thông báo rác và chỉ báo cáo những gì thực sự quan trọng.
- **Cách hoạt động:** Windows thường xuyên nhảy thông báo gây mất tập trung. Iris sẽ đánh chặn toàn bộ thông báo (Zalo, Email, Facebook). Nó gom nhóm lại và thỉnh thoảng báo cáo: *"Có 15 thông báo rác không quan trọng, nhưng sếp vừa nhắn tin yêu cầu gửi báo cáo gấp, bạn nên kiểm tra ngay!"*.

## 19. Đóng gói & Dọn dẹp Không gian Số (Auto-Session Cleanup)
- **Mục tiêu:** Dọn dẹp máy tính sau một ngày làm việc và lưu lại trạng thái (Session).
- **Cách hoạt động:** Bạn nói *"Tôi làm xong dự án này rồi, nghỉ thôi"*. Iris sẽ tự động tắt hàng chục tab Chrome đang mở về dự án đó, tắt VS Code, xóa các file nháp không cần thiết, dọn rác bộ nhớ máy tính. Đặc biệt, nó sẽ lưu lại "Trạng thái không gian làm việc" để ngày mai khi bạn nói *"Tiếp tục dự án hôm qua"*, mọi tab và cửa sổ sẽ được mở lại y hệt lúc bạn rời đi.
