# 🏠 HƯỚNG DẪN TÍCH HỢP NHÀ THÔNG MINH (SMART HOME) VÀO IRIS

## Nguyên lý hoạt động
Nhà thông minh trong Iris thực chất kế thừa hoàn toàn nguyên lý của chức năng Robot. 
Mỗi khi bạn ra lệnh bằng giọng nói (ví dụ: *"Iris, bật đèn phòng ngủ"* hoặc *"Tắt quạt"*), AI (Gemini) sẽ phân tích câu nói và gọi một công cụ nội bộ để gửi một gói tin **HTTP POST** chứa lệnh dưới định dạng JSON (VD: `{"action": "turn_on"}`) tới một đường link gọi là `control_url`.

## Có cần cài code vào server (thiết bị) không?
**CÓ.** Để nhận được lệnh JSON do Iris bắn tới, thiết bị thực thi (bóng đèn, công tắc, quạt) phải có khả năng hiểu được giao thức HTTP.
Bạn có 2 lựa chọn:
1. **Dùng ESP32/ESP8266 (Điều khiển qua Wi-Fi)**: Bạn nạp code trực tiếp vào mạch ESP32. ESP32 lúc này đóng vai trò như một mini server, kết nối trực tiếp vào Wi-Fi nhà bạn và lắng nghe lệnh từ Iris.
2. **Dùng USB Relay (Cắm thẳng vào máy tính)**: Nếu bạn dùng mạch Relay qua cổng USB (không có Wi-Fi), bạn cần chạy một file Python (`usb_server.py`) trên chính máy tính đang chạy Iris. Máy tính sẽ đóng vai trò là server, dịch lệnh HTTP từ Iris thành tín hiệu điện truyền qua cáp USB để đóng/mở công tắc.

Tất cả code mẫu cần thiết đều đã được mình gói gọn trong thư mục `setupsmarthome` này.

---

## 🛠 HƯỚNG DẪN CÀI ĐẶT

### Cách 1: Sử dụng Mạch ESP32/ESP8266 kết nối Wi-Fi (Khuyên dùng)
*Sử dụng ESP32 kết nối với Module Relay để đóng ngắt điện 220V cho đèn, quạt.*

1. Mở thư mục `setupsmarthome/esp32_relay/` và dùng phần mềm **Arduino IDE** mở file `esp32_relay.ino`.
2. Sửa thông tin Wi-Fi:
   - `const char* ssid = "Tên_WiFi_Nhà_Bạn";`
   - `const char* password = "Mật_khẩu_WiFi";`
3. Cắm mạch ESP32 vào máy tính và bấm Upload.
4. Sau khi nạp xong, mở `Tools -> Serial Monitor` (baudrate 115200) để xem địa chỉ IP của ESP32 (Ví dụ: `192.168.1.50`).
5. Vào thư mục gốc của Iris, mở file `robots.json` và thêm "thiết bị" mới với `control_url` trỏ tới IP trên:
```json
    "smart_light_1": {
      "name": "Đèn Phòng Ngủ",
      "control_url": "http://192.168.1.50/control"
    }
```

### Cách 2: Sử dụng Mạch USB Relay (Kết nối dây qua PC)
*Sử dụng khi mạch điều khiển cắm trực tiếp vào máy tính qua cổng USB, dùng Arduino làm thiết bị trung gian.*

1. Mở thư mục `setupsmarthome/usb_relay/` và chạy file `usb_server.py`.
   *(Bạn cần cài thư viện trước: `pip install flask pyserial`)*
2. Chú ý sửa biến `COM_PORT = 'COM3'` trong file Python thành cổng COM thực tế đang cắm mạch USB.
3. Chạy file server: `python usb_server.py`. Server này sẽ chạy ở cổng `5000` của máy tính.
4. Vào thư mục gốc của Iris, mở file `robots.json` và thêm cấu hình:
```json
    "smart_fan_1": {
      "name": "Quạt Bàn USB",
      "control_url": "http://localhost:5000/control"
    }
```

---
**Lưu ý an toàn:** Khi làm việc với thiết bị điện 220V qua Relay, bạn cần có kiến thức cơ bản về an toàn điện để tránh chập cháy hoặc giật điện nhé!
