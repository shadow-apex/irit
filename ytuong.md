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
