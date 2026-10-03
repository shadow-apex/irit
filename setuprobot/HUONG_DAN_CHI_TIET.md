# 📘 CẨM NANG TOÀN TẬP: KẾT NỐI MỌI LOẠI ROBOT VÀO HỆ THỐNG IRIS

Phần mềm Iris được thiết kế mở để có thể điều khiển **bất kỳ loại robot nào** trên thế giới, miễn là con robot đó có thể nhận được lệnh thông qua giao thức mạng (HTTP/Wi-Fi) hoặc qua cáp USB.

Dưới đây là hướng dẫn chi tiết từ A-Z cách thiết lập phần cứng cho 2 phương pháp phổ biến nhất.

---

## 🛒 TỔNG HỢP DANH SÁCH LINH KIỆN CẦN MUA (Tham khảo Shopee/Lazada)

Dưới đây là danh sách từ khóa và link tham khảo để bạn dễ dàng tìm mua linh kiện điện tử tại Việt Nam.

**1. Mạch Xử Lý & Camera**
- **ESP32-CAM (Kèm đế nạp CH340):** Não bộ trung tâm có camera. 
  - *Từ khóa tìm kiếm:* `Mạch ESP32-CAM kèm đế CH340` (Giá ~120k - 150k).
  - *Link tham khảo:* [Shopee - Mạch ESP32 CAM](https://shopee.vn/search?keyword=esp32-cam%20ch340)
- **Arduino Uno R3 (Tùy chọn):** Dùng nếu bạn không muốn xài Wi-Fi mà thích cắm cáp USB.
  - *Từ khóa tìm kiếm:* `Arduino Uno R3 SMD cáp USB` (Giá ~90k).

**2. Động Cơ & Điều Khiển Xe (Bánh xe)**
- **Khung Xe Robot 4 Bánh (Smart Car Chassis):** Bao gồm khung Mica, 4 bánh xe và 4 động cơ giảm tốc vàng.
  - *Từ khóa tìm kiếm:* `Khung xe robot 4 bánh mica trong suốt` (Giá ~130k).
- **Mạch điều khiển động cơ L298N:** Dùng để chịu tải dòng điện cao cho bánh xe.
  - *Từ khóa tìm kiếm:* `Module điều khiển động cơ L298N đỏ` (Giá ~30k).

**3. Cánh Tay Robot & Khớp Nối (Mở rộng)**
- **Khung cánh tay Robot 4 bậc tự do (Mica/Nhôm):** Khung cắt sẵn CNC để bắt vít.
  - *Từ khóa tìm kiếm:* `Khung cánh tay robot 4 DOF mica` (Giá ~100k - 200k).
- **Động cơ Servo SG90 (Cần 4 con):** Động cơ xoay góc dùng cho khớp tay.
  - *Từ khóa tìm kiếm:* `Động cơ RC Servo SG90 9g` (Giá ~25k/con).
- **Mạch mở rộng Servo I2C PCA9685 (Rất Quan Trọng):** Dùng để gắn Servo vào ESP32 mà không bị thiếu chân cắm hoặc sụt nguồn.
  - *Từ khóa tìm kiếm:* `Mạch điều khiển 16 Servo PCA9685 I2C` (Giá ~50k).

**4. Phụ Kiện Cấp Nguồn**
- **Hộp đế pin 18650 & Pin:** Robot cần điện mạnh, không dùng pin con thỏ được.
  - *Từ khóa tìm kiếm:* `Đế 2 pin 18650 có dây` và `Pin sạc 18650 3.7V` (Giá ~60k).
- **Dây cắm test board (Dupont):** Mua loại Cái-Cái (Female-Female) và Đực-Cái (Male-Female).
  - *Từ khóa tìm kiếm:* `Dây cắm cắm test board 20cm` (Giá ~15k/tép).

---

## 🛠 PHẦN 1: DÀNH CHO ESP32-CAM (ROBOT WI-FI CÓ CAMERA)
*Đây là phương pháp hoàn hảo nhất. Mạch ESP32-CAM đóng vai trò là não bộ, vừa truyền hình ảnh không dây, vừa nhận lệnh WASD điều khiển bánh xe.*

### Bước 1: Chuẩn bị Phần cứng
1. Mạch ESP32-CAM (loại có đế nạp CH340 hoặc dùng cắm dây USB-TTL để nạp code).
2. Module điều khiển động cơ L298N hoặc L293D.
3. Khung xe Robot 2 bánh hoặc 4 bánh.

### Bước 2: Cài đặt Môi trường nạp Code (Arduino IDE)
1. Tải và cài đặt phần mềm **Arduino IDE** (từ arduino.cc).
2. Mở Arduino IDE, vào `File` -> `Preferences`. Dán link sau vào ô *Additional Boards Manager URLs*: 
   `https://dl.espressif.com/dl/package_esp32_index.json`
3. Vào `Tools` -> `Board` -> `Boards Manager`, gõ **esp32** và bấm Install.
4. Vào `Sketch` -> `Include Library` -> `Manage Libraries`, gõ **ArduinoJson** và cài đặt.

### Bước 3: Nạp Code cho ESP32-CAM
1. Mở thư mục `setuprobot/esp32_cam_iris/` và mở file `esp32_cam_iris.ino` bằng Arduino IDE.
2. Sửa dòng `WIFI_SSID` và `WIFI_PASSWORD` bằng mạng Wi-Fi nhà bạn.
3. Chọn Board: `Tools` -> `Board` -> `ESP32 Arduino` -> **AI Thinker ESP32-CAM**.
4. Cắm cáp USB vào ESP32, chọn đúng Cổng `Port`.
5. Bấm nút **Upload** (Mũi tên chỉ sang phải). Đợi chạy 100%.

### Bước 4: Đấu dây và Lấy IP
- Chân Motor tiến lùi kết nối vào GPIO ESP32 theo cấu hình trong code: `12, 13, 15, 14`.
- Bấm nút *Reset* trên ESP32.
- Mở `Tools` -> `Serial Monitor` (chọn Baudrate 115200). Bạn sẽ thấy dòng chữ:
  `Camera Stream Ready! Go to: http://192.168.1.xxx:81/stream`
- Mở file `robots.json` của Iris, điền địa chỉ IP này vào phần `camera_url` và `control_url`. Bật Iris lên và tận hưởng!

---

## 🔌 PHẦN 2: DÀNH CHO ARDUINO (CẮM CÁP USB TRỰC TIẾP)
*Dùng khi bạn chỉ có mạch Arduino Uno/Nano/Mega không có Wi-Fi, và không có camera trên xe.*

### Bước 1: Nạp Code Nhận Lệnh Cho Arduino
1. Mở Arduino IDE, chọn Board là **Arduino Uno** (hoặc loại bạn có).
2. Mở file `setuprobot/arduino_usb/arduino_usb.ino`.
3. Bấm nút **Upload** nạp thẳng vào Arduino. Lúc này Arduino chỉ đứng chờ chữ "W, A, S, D" gửi xuống cáp USB.

### Bước 2: Cài đặt Máy chủ Ảo Python (Trên Máy tính)
Bởi vì Arduino không có Wi-Fi, máy tính của bạn (nơi đang cắm cáp USB) sẽ đóng vai trò làm máy chủ trung gian.
1. Mở Terminal/CMD trên máy tính, gõ lệnh: `pip install flask pyserial`
2. Mở file `setuprobot/arduino_usb/usb_server.py`.
3. Tìm dòng `COM_PORT = 'COM3'` và đổi thành cổng COM mà Arduino của bạn đang cắm (Xem trong Arduino IDE).
4. Chạy file bằng lệnh: `python usb_server.py`
5. Máy chủ sẽ chạy ở cổng 5000. Bạn vào file `robots.json` của Iris, sửa `control_url` thành `http://localhost:5000/control`.

*(Quy trình chạy: Bấm W trên Iris -> Iris bắn tới Python ở cổng 5000 -> Python dịch ra chữ W chui qua dây cáp USB -> Arduino nhận được bật Motor chạy).*

---

## 🚀 PHẦN 3: BÍ KÍP ĐỂ KẾT NỐI "BẤT KỲ" ROBOT NÀO KHÁC
Nếu bạn mua một con Robot xịn của DJI, hãng Freenove, hay SunFounder... làm sao để Iris điều khiển được nó?

Nguyên lý duy nhất của phần mềm Iris là: **Iris sẽ luôn ném một gói tin HTTP POST tới cái link `control_url` có chứa chữ `{"action": "forward"}`**. 
Vì vậy, để mọi con robot nghe lời Iris, bạn chỉ cần làm **1 trong 2 cách**:

### Cách A: Sửa thẳng vào bộ não con Robot (Firmware)
Nếu con Robot đó là mã nguồn mở (như Freenove ESP32), bạn chỉ cần đọc code của họ, tìm đoạn nào tạo ra "WebServer" (Ví dụ hàm `server.on("/move"...)`), và thêm một đoạn code cực ngắn bằng C++ để bắt chữ của Iris:
```cpp
server.on("/control", HTTP_POST, []() {
    String action = server.arg("plain"); // Lấy gói tin của Iris
    if (action.indexOf("forward") > 0) { motorRun(255, 255); } // Gọi hàm tiến lên của Robot đó
    server.send(200);
});
```

### Cách B: Bắt cầu bằng Python (Middleware) - Tuyệt kỹ không cần đụng vào code Robot
Nếu con Robot đó đã bị khóa code (không sửa được), nhưng nó lại có App điều khiển trên điện thoại riêng. Bạn có thể tự viết 1 file Python nhỏ (giống hệt `usb_server.py`), tạo cổng 5000 để hứng lấy chữ `{"action": "forward"}` từ Iris.
Sau khi Python nhận được, Python sẽ dùng thư viện riêng của hãng Robot đó (VD: Thư viện `djitellopy` của Flycam Tello) để ra lệnh:
```python
@app.route('/control', methods=['POST'])
def control():
    action = request.json.get('action')
    if action == 'forward':
        flycam_tello.move_forward(30) # Gửi lệnh bay tới trước bằng chuẩn riêng của DJI
    return "ok"
```
Khi đó, chỉ cần đổi `control_url` của Iris thành `http://localhost:5000/control`, Iris sẽ gián tiếp điều khiển được cả Máy bay không người lái DJI Tello!
