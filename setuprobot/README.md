# Hướng dẫn Cài đặt Robot ESP32 để kết nối với Iris

Thư mục này chứa mã nguồn (`esp32_robot.ino`) để nạp vào bo mạch ESP32 (hoặc ESP32-CAM) giúp Robot của bạn có thể nhận lệnh điều khiển (WASD) từ phần mềm Iris.

## Tóm tắt các file liên quan trong hệ thống Iris:
1. **`src/components/RobotCameras.tsx`**: Giao diện hiển thị Camera của các Robot. Lắng nghe thao tác phím W, A, S, D của bạn khi mở to camera và truyền tín hiệu `triggerRobotAction` xuống Backend.
2. **`electron/preload.cjs`**: Cầu nối (Bridge). Mở cổng `triggerRobotAction` để Frontend (React) có thể gọi xuống Backend (NodeJS).
3. **`electron/main.mjs`**: Nhận lệnh từ `preload.cjs`, đọc địa chỉ `control_url` của robot từ file `robots.json` và bắn một luồng HTTP POST chứa `{ "action": "forward" }` qua mạng Wi-Fi tới Robot.
4. **`robots.json` (Thư mục gốc)**: File chứa danh sách Robot, định nghĩa IP Camera (`camera_url`) và IP Điều khiển (`control_url`) của ESP32.
5. **`setuprobot/esp32_robot/esp32_robot.ino`**: Code C++ chạy trên con Robot (ESP32). Nó tạo ra một Web Server nhỏ để hứng lệnh HTTP POST từ `main.mjs`, giải mã JSON và bật/tắt điện cấp cho IC điều khiển động cơ L298N.

## Hướng dẫn kết nối:
## Thư mục `esp32_cam_iris` (Dành cho mạch ESP32-CAM)
Đây là bộ mã nguồn "All-in-one" được tối ưu hóa riêng cho Iris, kết hợp luồng Video MJPEG siêu mượt và API nhận lệnh WASD.

1. **Chuẩn bị:** Mở Arduino IDE, cài đặt Board `ESP32` và chọn Board là `AI Thinker ESP32-CAM`. Bạn cũng cần cài đặt thư viện `ArduinoJson`.
2. Mở file `setuprobot/esp32_cam_iris/esp32_cam_iris.ino`.
3. Sửa `WIFI_SSID` và `WIFI_PASSWORD` bằng thông tin mạng Wi-Fi nhà bạn.
4. Cắm dây các chân motor L298N vào các chân ESP32 theo đúng thứ tự:
   - Motor Trái (Tiến): Chân 12
   - Motor Trái (Lùi): Chân 13
   - Motor Phải (Tiến): Chân 15
   - Motor Phải (Lùi): Chân 14
5. Bấm Upload code. Sau khi xong, mở Serial Monitor (Baudrate 115200) để lấy IP (Ví dụ: `192.168.1.15`).
6. Vào file `robots.json` của phần mềm Iris, cấu hình như sau:
   - `"camera_url": "http://192.168.1.15:81/stream"`
   - `"control_url": "http://192.168.1.15/control"`

---

## Cách 2: Dành cho Arduino thường cắm cáp USB (Không có Wi-Fi)
Nếu bạn chỉ có mạch Arduino Uno/Nano cắm dây cáp USB trực tiếp vào máy tính, Arduino không có Wi-Fi nên không thể tự tạo WebServer được. Thay vào đó, chúng ta sẽ dùng máy tính làm WebServer trung gian!
- **Thư mục `arduino_usb`** có chứa 2 file dành cho cách này.

### Cách chạy:
1. Nạp file `arduino_usb.ino` vào mạch Arduino của bạn.
2. Mở Terminal (Command Prompt) trên máy tính, cài thư viện Python: `pip install flask pyserial`
3. Mở file `usb_server.py`, sửa dòng `COM_PORT = 'COM3'` thành đúng cổng USB của Arduino nhà bạn.
4. Chạy file bằng lệnh: `python setuprobot/arduino_usb/usb_server.py`. Nó sẽ tạo ra một máy chủ ảo ở địa chỉ `http://localhost:5000`.
5. Cuối cùng, vào file `robots.json` của Iris, đổi `control_url` của robot thành `http://localhost:5000/control`.

*Quy trình:* Bạn bấm phím `W` trên Iris -> Iris gửi HTTP POST đến `localhost:5000` -> Python Server đọc chữ `forward` -> Python truyền chữ `W` qua dây cáp USB -> Arduino đọc dây cáp thấy chữ `W` -> Bật điện quay bánh xe!

---

## 🤖 Prompt để nhờ Claude kiểm tra
Nếu bạn muốn nhờ Claude Code (AI) đọc lại và kiểm tra toàn bộ luồng chạy này xem có ổn không, hãy copy đoạn Prompt sau và dán cho Claude:

> "Claude, hãy đọc giúp tôi các file sau: `src/components/RobotCameras.tsx`, `electron/preload.cjs`, `electron/main.mjs`, file `setuprobot/arduino_usb/usb_server.py` và code C++ `setuprobot/arduino_usb/arduino_usb.ino`. Tôi vừa thêm tính năng bấm phím WASD trên giao diện RobotCameras để gửi lệnh HTTP POST xuống Python Server (cổng 5000), sau đó truyền tiếp xuống Arduino qua cáp USB Serial. Hãy kiểm tra xem luồng dữ liệu này đã liền mạch chưa nhé."
