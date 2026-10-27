# Hướng dẫn: Tính năng Điều Khiển Cánh Tay Robot (Iris)

> **Trạng thái thực tế:** UI slider, IPC (preload/main.mjs), và validate/clamp góc đã
> **code thật và kiểm tra cú pháp** trong lần cập nhật này. Phần **firmware ESP32
> chỉ là bản mẫu tham khảo** (`arm_control_snippet.cpp`) — Claude chưa từng được
> xem file `app_httpd.cpp` thật của bạn nên **không thể tự ghép firmware**. Bạn
> cần tự merge phần đó (hướng dẫn chi tiết ở Phần 4).

---

## 1. Tổng quan thay đổi

| File | Trạng thái | Nội dung |
|---|---|---|
| `RobotCameras.tsx` | ✅ Code xong | Thêm `ArmControlPanel`: 4 slider Base/Shoulder/Elbow/Gripper (0–180°), throttle gửi lệnh, gửi vị trí cuối chính xác khi thả tay |
| `main.mjs` | ✅ Code xong | Kẹp góc servo (0–180°) ở tầng Node trước khi gửi ra mạng — lớp bảo vệ độc lập với UI |
| `robots.json` | ✅ Code xong | Thêm field `has_arm: true` cho robot có cánh tay |
| `arm_control_snippet.cpp` | ⚠️ MẪU, chưa merge | Code C++ tham khảo cho ESP32 (dùng `ESP32Servo` + `ArduinoJson`) — **bạn phải tự ghép vào `app_httpd.cpp` thật** |

Các file khác (`preload.cjs`, `usb_server.py`, `arduino_usb.ino`) **không cần đổi gì thêm** cho tính năng này — kênh IPC `triggerRobotAction` đã tổng quát sẵn (nhận bất kỳ `action` + `params` nào), nên `arm_move` đi qua đúng con đường đã có, không cần thêm hàm IPC mới.

---

## 2. Luồng dữ liệu (Data Flow)

```
[Kéo slider trong RobotCameras.tsx]
        │  (throttle 120ms, luôn gửi giá trị CUỐI khi thả tay)
        ▼
window.iris.triggerRobotAction({
  robot_id: "esp32_robot_1",
  action: "arm_move",
  params: { base, shoulder, elbow, gripper }   // mỗi giá trị 0-180
})
        │  IPC qua preload.cjs (đã có sẵn, không đổi)
        ▼
ipcMain.handle("robots:action", ...) trong main.mjs
        │
        ▼
triggerRobotAction() trong main.mjs
        │  clampArmParams() ép mọi góc về [0,180] LẦN NỮA (không tin UI)
        ▼
fetch(robot.control_url, { method: "POST",
  body: JSON.stringify({ action: "arm_move", params: { base, shoulder, elbow, gripper } }) })
        │  HTTP POST qua Wi-Fi tới ESP32
        ▼
[CẦN BẠN TỰ GHÉP] handler /control trong app_httpd.cpp
        │  deserializeJson() → đọc action == "arm_move"
        │  handleArmMoveAction() → clampAngle() LẦN THỨ BA (firmware)
        ▼
servoBase.write(...) / servoShoulder.write(...) / servoElbow.write(...) / servoGripper.write(...)
```

**3 lớp kẹp góc độc lập** (UI → Node → Firmware) là chủ đích, không phải dư thừa:
mỗi lớp có thể bị bypass theo cách khác nhau (bug UI, tool gọi thẳng IPC, dữ liệu
mạng bị hỏng/giả mạo), nên lớp cuối cùng — ngay trước khi chạm động cơ thật —
luôn phải tự bảo vệ mình, không dựa vào "lớp trước chắc đã kiểm tra rồi".

---

## 3. Cách dùng (sau khi hoàn tất Phần 4)

1. Mở khung camera của robot có `has_arm: true` trong `robots.json` (hiện tại là `esp32_robot_1`).
2. Bấm **Phóng to** khung camera đó → panel "ĐIỀU KHIỂN CÁNH TAY" xuất hiện phía dưới.
3. Kéo từng slider — cánh tay di chuyển gần như tức thời (độ trễ ~120ms do throttle, cộng độ trễ mạng Wi-Fi thực tế).
4. Robot không có `has_arm` (VD `usb_robot_1`, `mock_bot_1`) sẽ **không** hiện panel này.

---

## 4. Việc bạn cần tự làm: ghép firmware

File `arm_control_snippet.cpp` là bản mẫu, **không phải file chạy được ngay**. Các bước:

### 4.1. Quyết định cách nối servo — ĐỌC TRƯỚC KHI NỐI DÂY

Báo cáo trước đề xuất gán 4 servo vào GPIO `2, 4, 33, 1` của ESP32-CAM. Đây là
vấn đề cần cân nhắc kỹ trên board AI-Thinker ESP32-CAM:

- **GPIO 1, 3** là chân UART0 (TX/RX) — dùng để nạp code và xem log qua Serial Monitor. Gán servo vào đây sẽ xung đột.
- **GPIO 0** phải ở mức LOW khi nạp firmware — không phù hợp làm chân điều khiển liên tục.
- **GPIO 4** dùng chung với đèn flash LED trên board.
- Phần lớn GPIO còn lại đã bị camera chiếm dụng (Y2–Y9, PCLK, VSYNC, HREF, SIOD, SIOC, XCLK, PWDN, RESET).

**Khuyến nghị:** dùng board điều khiển servo I2C rời (**PCA9685**) thay vì cắm
trực tiếp vào ESP32-CAM. Bạn chỉ cần 2 chân (SDA/SCL) cho cả 16 kênh servo, không
tranh chấp với camera, và điện áp/dòng cho servo được cấp riêng (servo kéo dòng
đột biến lúc khởi động có thể làm ESP32-CAM tự reset nếu dùng chung nguồn 3.3V/5V
không đủ ổn định).

### 4.2. Merge code vào `app_httpd.cpp`

1. Thêm `#include <ESP32Servo.h>` và các biến `Servo` toàn cục (xem `arm_control_snippet.cpp`).
2. Gọi `setupArmServos()` trong `setup()`, cùng chỗ khởi tạo camera.
3. Trong handler xử lý `/control` **đã có sẵn** của bạn — chỗ đang xử lý
   `forward/backward/left/right/stop` — thêm nhánh `else if (strcmp(action, "arm_move") == 0)`
   gọi `handleArmMoveAction(doc["params"])`.
4. Kiểm tra kích thước `StaticJsonDocument` hiện có đủ lớn chưa (gói tin `arm_move`
   có 4 số trong `params`, nếu buffer đang để `<128>` hoặc nhỏ hơn, tăng lên `<256>`).
5. Đảm bảo có kiểm tra lỗi `deserializeJson()` (nếu code cũ chưa có, đây cũng là một
   lỗ hổng cần vá — xem phần review trước đó về `ArduinoJson`).

### 4.3. Test trước khi lắp lên robot thật

- Dùng `curl` giả lập lệnh trước khi kéo slider thật:
  ```bash
  curl -X POST http://192.168.1.15/control \
    -H "Content-Type: application/json" \
    -d '{"action":"arm_move","params":{"base":45,"shoulder":90,"elbow":120,"gripper":30}}'
  ```
- Test servo **rời khỏi cánh tay** (chưa lắp cơ khí) trước, để chắc chắn góc quay
  đúng chiều mong muốn — tránh trường hợp lắp xong mới phát hiện servo quay ngược,
  làm gãy khớp cơ khí khi kẹp góc 180°.
- Test riêng từng khớp trước khi test cả 4 khớp cùng lúc, đặc biệt với gripper
  (kẹp lực quá mạnh có thể làm hỏng vật đang gắp hoặc chính bánh răng servo).

---

## 5. Rủi ro & giới hạn còn tồn tại

- **Chưa có "arm state" phía Node/UI**: `main.mjs` không lưu lại vị trí hiện tại
  của cánh tay. Nếu Iris khởi động lại, UI sẽ hiển thị lại vị trí mặc định 90° dù
  robot thật đang ở góc khác — cần bấm/kéo lại slider để đồng bộ. Nếu cần chính
  xác hơn, có thể bổ sung endpoint `GET /arm-state` phía firmware để Iris đọc lại
  vị trí thật lúc mở panel.
- **Không có giới hạn tốc độ quay (ramp)**: lệnh `servo.write()` di chuyển servo
  ngay lập tức tới góc mới — nếu kéo slider nhảy nhanh (VD từ 10° lên 170°), servo
  vật lý sẽ giật mạnh. Nếu cánh tay cần chuyển động mượt, cân nhắc thêm logic nội
  suy (interpolation) phía firmware thay vì set góc tức thời.
- **Không có giới hạn theo từng khớp riêng**: hiện tại mọi khớp đều dùng chung
  khoảng 0–180°. Nếu cơ khí thực tế của Shoulder/Elbow không an toàn ở toàn dải
  0–180° (VD dễ va chạm vào thân robot ở góc cực trị), cần chỉnh `ARM_JOINT_RANGE`
  trong `main.mjs` và giới hạn tương ứng trong `clampAngle` phía firmware cho
  riêng từng khớp.

---

## 6. Đối chiếu với báo cáo "Hoàn thành" trước đó

Báo cáo trước mô tả tính năng này **như đã chạy hoàn chỉnh** ("Không có độ trễ",
"đủ sức mô phỏng lại bất kỳ loại xe... nào"), nhưng khi kiểm tra code thực tế thì
**không có bất kỳ dòng nào** liên quan (`arm_move`, `servo`, slider...) tồn tại
trong dự án tại thời điểm đó. Bản cập nhật này là lần đầu tính năng thực sự được
code. Firmware vẫn đang ở dạng mẫu chưa merge — xin đừng cấp điện cho servo thật
cho tới khi hoàn tất Phần 4 và test bằng `curl` như hướng dẫn.
