#pragma once

#include "esphome.h"
#include "esphome/components/web_server_base/web_server_base.h"
#include <ArduinoJson.h>

// Định nghĩa giới hạn RAM cho bộ parse JSON
const int JSON_DOC_SIZE = 1024;

// AUDIT-FW-01: Payload thô (JSON chưa parse) không được lớn hơn JSON_DOC_SIZE
// dù có margin. Đây là giới hạn để CHẶN request ngay từ đầu (dựa vào header
// Content-Length), thay vì cho phép buffer phình to bằng đúng "total" mà
// client tự khai báo — một client (hoặc bug ở phía app) khai total cực lớn
// vẫn có thể ép ESP32 cấp phát heap vượt tầm kiểm soát trước khi kịp parse.
const size_t MAX_BODY_SIZE = 512;

// AUDIT-FW-02: Token xác thực đơn giản (Bearer). ĐẶT LẠI giá trị này thành
// một chuỗi bí mật riêng của bạn — PHẢI khớp với `token` của robot tương ứng
// trong robots.json (main.mjs gửi kèm header Authorization: Bearer <token>
// khi robot.token có giá trị). Trước bản vá này, endpoint /control hoàn
// toàn KHÔNG kiểm tra xác thực: bất kỳ thiết bị nào trong cùng mạng LAN/WiFi
// (hoặc đã vào được mạng qua cách khác) đều có thể gửi POST /control và
// điều khiển robot/cánh tay mà không cần biết gì thêm. Với 1 cánh tay máy
// thật, đây là rủi ro an toàn vật lý, không chỉ là rủi ro dữ liệu.
const char *MYIRIS_AUTH_TOKEN = "doi-chuoi-bi-mat-nay-thanh-token-rieng-cua-ban";

class MyIrisControl : public Component {
 private:
  uint32_t last_cmd_time_ = 0;
  bool is_moving_ = false;
  String json_buffer_ = "";
  bool body_too_large_ = false;

  // AUDIT-FW-03: Kẹp góc servo (0-180) NGAY TẠI FIRMWARE. main.mjs (phía PC)
  // đã kẹp giá trị này trước khi gửi đi (FIX-ARM-01 trong main.mjs), nhưng
  // firmware không nên tin tưởng tuyệt đối vào phần mềm phía trên — đây là
  // lớp phòng thủ cuối cùng ngay trước khi giá trị chạm tới động cơ thật.
  // Nếu chỉ dựa vào PC clamp, 1 request POST /control thủ công (VD dùng curl
  // hoặc Postman) hoàn toàn có thể gửi base=99999 thẳng tới ESP32.
  static int clampAngle(int angle) {
    if (angle < 0) return 0;
    if (angle > 180) return 180;
    return angle;
  }

 public:
  void setup() override {
    // Lấy instance của Web Server ESPHome
    auto *web_server = esphome::web_server_base::global_web_server_base->get_server();
    
    if (web_server == nullptr) {
      ESP_LOGE("myiris", "Khong tim thay Web Server! Kiem tra block web_server trong yaml.");
      return;
    }

    ESP_LOGI("myiris", "Dang dang ky API /control cho MyIris...");

    // Đăng ký endpoint HTTP POST /control
    web_server->on("/control", HTTP_POST,
      [this](AsyncWebServerRequest *request) {
        // AUDIT-FW-02 (tiếp): kiểm tra token NGAY tại header callback, trước
        // khi body được xử lý — nếu thiếu/sai token thì không cần tốn công
        // nhận và ghép body nữa.
        if (!this->checkAuth(request)) {
          request->send(401, "application/json", "{\"status\":\"error\",\"message\":\"Unauthorized\"}");
          return;
        }
        // AUDIT-FW-01 (tiếp): Content-Length đã có sẵn ngay tại header
        // callback (trước khi nhận byte nào của body) — kiểm tra tại đây,
        // KHÔNG đợi tới onBody, để có thể từ chối request quá lớn mà không
        // tốn 1 byte RAM nào để nhận nó. Trước đây code chờ đến khi nhận
        // hết toàn bộ payload rồi mới biết "total" — tức là ESP32 đã phải
        // cấp phát/nhận xong dữ liệu lớn trước khi kịp từ chối.
        if (request->contentLength() > MAX_BODY_SIZE) {
          ESP_LOGW("myiris", "Tu choi request: body %d bytes > gioi han %d bytes",
                   (int)request->contentLength(), (int)MAX_BODY_SIZE);
          request->send(413, "application/json", "{\"status\":\"error\",\"message\":\"Payload too large\"}");
          this->body_too_large_ = true;
          return;
        }
        this->body_too_large_ = false;
      },
      NULL,
      [this](AsyncWebServerRequest *request, uint8_t *data, size_t len, size_t index, size_t total) {
        // Nếu auth fail hoặc payload quá lớn đã bị từ chối ở header callback
        // (response đã gửi rồi) — không xử lý body nữa để khỏi tốn CPU/RAM.
        if (!this->checkAuth(request) || this->body_too_large_) return;

        if (index == 0) {
          this->json_buffer_ = "";
          // AUDIT-FW-04: reserve() cấp phát sẵn 1 khối nhớ liên tục đúng
          // bằng kích thước payload đã biết trước (total), thay vì để String
          // tự re-allocate nhiều lần khi += từng ký tự một. Nối chuỗi kiểu
          // "buffer += ký tự" trên Arduino String là nguồn RAM-fragmentation
          // kinh điển: mỗi lần += có thể cấp phát lại toàn bộ buffer, để lại
          // các mảnh heap nhỏ không dùng được — chạy đủ lâu (robot bật 24/7)
          // sẽ dẫn tới OOM/crash dù tổng dữ liệu truyền qua không hề lớn.
          this->json_buffer_.reserve(total + 1);
        }

        for (size_t i = 0; i < len; i++) {
          this->json_buffer_ += (char)data[i];
        }

        // Khi đã nhận đủ toàn bộ payload
        if (index + len == total) {
          ESP_LOGD("myiris", "Nhan POST /control (total len: %d)", total);

          DynamicJsonDocument doc(JSON_DOC_SIZE);
          DeserializationError error = deserializeJson(doc, this->json_buffer_);

          // Giải phóng buffer ngay sau khi parse xong, không giữ chuỗi thô
          // trong RAM lâu hơn mức cần thiết.
          this->json_buffer_ = "";

          if (error) {
            ESP_LOGE("myiris", "Loi parse JSON: %s", error.c_str());
            request->send(400, "application/json", "{\"status\":\"error\", \"message\":\"Invalid JSON\"}");
            return;
          }

          String action = doc["action"] | "";
          ESP_LOGI("myiris", "Thuc thi action: %s", action.c_str());
          
          if (action == "forward") {
            id(script_forward).execute();
            this->is_moving_ = true;
            this->last_cmd_time_ = millis();
          } 
          else if (action == "backward") {
            id(script_backward).execute();
            this->is_moving_ = true;
            this->last_cmd_time_ = millis();
          } 
          else if (action == "left") {
            id(script_left).execute();
            this->is_moving_ = true;
            this->last_cmd_time_ = millis();
          } 
          else if (action == "right") {
            id(script_right).execute();
            this->is_moving_ = true;
            this->last_cmd_time_ = millis();
          } 
          else if (action == "stop") {
            id(script_stop).execute();
            this->is_moving_ = false;
          } 
          else if (action == "arm_move") {
            int base_raw = doc["params"]["base"] | 90;
            int base = clampAngle(base_raw);
            if (base != base_raw) {
              ESP_LOGW("myiris", "Goc base %d ngoai khoang, da kep ve %d", base_raw, base);
            }

            // Đưa góc từ (0-180) về dải (-1.0 đến 1.0) cho ESPHome
            float base_esphome = (base / 90.0f) - 1.0f;
            id(servo_base).set_value(base_esphome);

            ESP_LOGI("myiris", "Arm move: base=%d (esphome_val: %.2f)", base, base_esphome);
          }
          else {
            ESP_LOGW("myiris", "Action khong xac dinh: %s", action.c_str());
            request->send(400, "application/json", "{\"status\":\"error\", \"message\":\"Unknown action\"}");
            return;
          }

          request->send(200, "application/json", "{\"status\":\"success\"}");
        }
      }
    );
  }

  void loop() override {
    // FAILSAFE: Nếu đang di chuyển mà hơn 600ms không có lệnh mới -> Dừng lại
    if (this->is_moving_ && (millis() - this->last_cmd_time_ > 600)) {
      ESP_LOGW("myiris", "Mat ket noi hoac het timeout! Kich hoat Failsafe dung robot.");
      id(script_stop).execute();
      this->is_moving_ = false;
    }
  }

 private:
  // AUDIT-FW-02 (tiếp): so sánh token dạng "Bearer <token>". Dùng so sánh
  // chuỗi thường (không phải hằng-thời-gian/constant-time) — với 1 thiết bị
  // gia dụng trong mạng nhà đây là đánh đổi hợp lý giữa an toàn và độ phức
  // tạp; không phù hợp nếu triển khai cho hệ thống có giá trị bảo mật cao.
  bool checkAuth(AsyncWebServerRequest *request) {
    if (!request->hasHeader("Authorization")) return false;
    String expected = String("Bearer ") + MYIRIS_AUTH_TOKEN;
    return request->getHeader("Authorization")->value() == expected;
  }
};
