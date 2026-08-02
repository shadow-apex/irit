# Hướng Dẫn Kết Nối Toàn Diện: Điện Thoại, Robot & Nhà Thông Minh

Tài liệu này hướng dẫn chi tiết cách thiết lập và kết nối Iris với các thiết bị ngoại vi để biến Iris thành một trợ lý đa năng thực thụ.

---

## 1. Kết Nối Điện Thoại (Làm Camera & Mic Rời)

Hệ thống cung cấp 2 phương thức kết nối. Bạn có thể chọn cách phù hợp nhất với mình.

### Phương pháp A: Dùng Web Companion (Khuyên dùng)
Phương pháp này mở trực tiếp trên trình duyệt điện thoại (Safari/Chrome), cho phép bạn mang điện thoại ra khỏi nhà (dùng 4G) mà vẫn kết nối được về Laptop.

**Yêu cầu bắt buộc:** Phải có kết nối bảo mật HTTPS (thông qua `ngrok`), nếu không trình duyệt trên điện thoại sẽ ngầm khóa quyền Camera/Mic.

**Cách thiết lập:**
1. Truy cập [ngrok.com](https://ngrok.com) và đăng nhập (có thể dùng Google).
2. Vào mục **Your Authtoken**, sao chép đoạn mã token của bạn.
3. Mở file `.env` ở thư mục gốc của dự án (`C:\Users\vanha\Downloads\myiris\.env`), thêm dòng sau:
   ```env
   IRIS_NGROK_AUTHTOKEN=dán_đoạn_mã_token_của_bạn_vào_đây
   ```
4. Khởi động lại Iris (`npm run dev`). Mở bảng QR, chọn tab **Web (Mới)** và quét mã. Bấm nút "CONNECT TO IRIS" trên điện thoại để cấp quyền.

### Phương pháp B: Dùng Expo Go (Qua mạng nội bộ LAN)
Phương pháp này dùng qua mạng Wi-Fi tại nhà, độ trễ cực thấp.

**Cách thiết lập:**
1. Điện thoại và Laptop **phải bắt chung một mạng Wi-Fi**.
2. Lên App Store (iOS) hoặc Google Play (Android), tải ứng dụng **Expo Go**.
   *(Lưu ý từ hệ thống: Nếu bạn quét mã bị văng lỗi, hãy lên App Store cập nhật Expo Go lên phiên bản mới nhất, vì phiên bản cũ không tương thích với dự án).*
3. Trên Iris, mở bảng QR, chọn tab **Expo Go** và dùng camera điện thoại quét mã để mở app.

> **💡 Mẹo:** Sau khi kết nối thành công, nhấn **`Alt + C`** trên Laptop để mở cửa sổ nổi (PiP) theo dõi luồng video từ điện thoại.

---

## 2. Kết Nối Robot & Camera An Ninh (Robot Cameras)

Iris có khả năng gộp chung luồng video của nhiều camera IP, ESP32-CAM, webcam, hoặc xe robot vào một cửa sổ nổi duy nhất để tiện giám sát.

**Cách thiết lập:**
1. Tạo một file tên là `robots.json` tại thư mục gốc của dự án (`C:\Users\vanha\Downloads\myiris\robots.json`).
2. Nhập cấu hình theo mẫu sau:
   ```json
   {
     "robots": {
       "camera_nha_xe": {
         "name": "Camera Nhà Xe",
         "camera_url": "http://192.168.1.15:81/stream"
       },
       "xe_robot": {
         "name": "Robot Thám Hiểm",
         "camera_url": "http://192.168.1.20:81/stream",
         "control_url": "http://192.168.1.20/action"
       }
     }
   }
   ```
   *(Lưu ý: `camera_url` là link truyền hình ảnh trực tiếp (MJPEG stream). Iris sẽ tự động refresh để phá cache).*

3. Không cần khởi động lại app. Hãy nhấn **`Alt + R`** (hoặc bấm vào icon hình Robot trên menu) để mở bảng điều khiển Robot.

---

## 3. Kết Nối Nhà Thông Minh (Smart Home)

Hiện tại Iris chưa có sẵn driver giao tiếp với Home Assistant. Tuy nhiên, vì Iris là một AI, bạn có thể dạy Iris điều khiển nhà thông minh theo 2 cách:

### Cách 1: Điều khiển qua dòng lệnh (Không cần code)
Nếu hệ thống Smart Home của bạn (Home Assistant, IFTTT, webhook) có hỗ trợ nhận lệnh qua URL, bạn chỉ cần ra lệnh bằng giọng nói:
> *"Iris, hãy dùng lệnh curl gọi tới địa chỉ http://192.168.1.100/api/bat-den để bật đèn phòng khách giúp tôi."*

Lúc này, Iris sẽ chuyển yêu cầu cho trợ lý Claude chạy ngầm (Workstream), Claude sẽ mở terminal và gõ lệnh kích hoạt webhook tự động.

### Cách 2: Tích hợp vĩnh viễn vào bộ não của Iris (Code trực tiếp)
Bạn có thể cấp cho Iris một "Kỹ năng" (Tool) mới để AI tự biết cách bật đèn.

**Bước 1:** Mở file `electron/main.mjs`, tìm mảng chứa các tools của Gemini (`const tools = [...]`), thêm đoạn sau:
```javascript
{
  name: "turn_on_smart_lights",
  description: "Dùng công cụ này để bật hoặc tắt đèn trong nhà.",
  parameters: {
    type: "OBJECT",
    properties: {
      state: { type: "STRING", description: "'on' để bật, 'off' để tắt" },
      room: { type: "STRING", description: "Tên phòng, ví dụ: 'phòng khách'" }
    }
  }
}
```

**Bước 2:** Kéo xuống tìm hàm `handleToolCall(call)`, chèn thêm logic xử lý:
```javascript
if (call.name === "turn_on_smart_lights") {
  const { state, room } = call.args;
  try {
    // Gọi API tới hệ thống Home Assistant nội bộ của bạn
    await fetch(`http://192.168.1.50/api/lights?room=${room}&state=${state}`);
    return `Đã ${state === 'on' ? 'bật' : 'tắt'} đèn ${room} thành công!`;
  } catch (e) {
    return `Lỗi hệ thống nhà thông minh: ${e.message}`;
  }
}
```

Khởi động lại ứng dụng. Từ giờ, bạn chỉ cần nói: *"Iris, bật đèn phòng khách lên"* — Gemini AI sẽ tự động phân tích câu nói và kích hoạt tool `turn_on_smart_lights` trong chớp mắt!
