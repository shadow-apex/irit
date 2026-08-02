#pragma once

#include "esphome.h"
#include "esphome/components/web_server_base/web_server_base.h"
#include <ArduinoJson.h>

// Cùng các hằng số/rủi ro đã ghi chú chi tiết trong myiris_control.h
// (AUDIT-FW-01 .. 04) — component này áp dụng lại nguyên bộ fix đó, chỉ
// mở rộng thêm 3 khớp (shoulder/elbow/gripper) bên cạnh base.
const int JSON_DOC_SIZE_ARM = 1024;
const size_t MAX_BODY_SIZE_ARM = 512;

// ĐẶT LẠI token này thành bí mật riêng của bạn, khớp với "token" của entry
// "esp32_arm_1" (hoặc tên bạn đặt) trong robots.json.
const char *MYIRIS_ARM_AUTH_TOKEN = "doi-chuoi-bi-mat-nay-thanh-token-rieng-cua-ban";

class MyIrisArmControl : public Component {
 private:
  String json_buffer_ = "";
  bool body_too_large_ = false;

  static int clampAngle(int angle) {
    if (angle < 0) return 0;
    if (angle > 180) return 180;
    return angle;
  }

  // Đưa góc 0-180° về dải -1.0..1.0 mà ESPHome servo component dùng, kèm
  // clamp phòng thủ ngay trước khi set giá trị thật ra động cơ.
  static float angleToServoValue(int raw, const char *jointName) {
    int a = clampAngle(raw);
    if (a != raw) {
      ESP_LOGW("myiris_arm", "Goc %s=%d ngoai khoang, da kep ve %d", jointName, raw, a);
    }
    return (a / 90.0f) - 1.0f;
  }

 public:
  void setup() override {
    auto *web_server = esphome::web_server_base::global_web_server_base->get_server();
    if (web_server == nullptr) {
      ESP_LOGE("myiris_arm", "Khong tim thay Web Server! Kiem tra block web_server trong yaml.");
      return;
    }

    ESP_LOGI("myiris_arm", "Dang dang ky API /control cho canh tay MyIris...");

    web_server->on("/control", HTTP_POST,
      [this](AsyncWebServerRequest *request) {
        if (!this->checkAuth(request)) {
          request->send(401, "application/json", "{\"status\":\"error\",\"message\":\"Unauthorized\"}");
          return;
        }
        if (request->contentLength() > MAX_BODY_SIZE_ARM) {
          ESP_LOGW("myiris_arm", "Tu choi request: body %d bytes > gioi han %d bytes",
                   (int)request->contentLength(), (int)MAX_BODY_SIZE_ARM);
          request->send(413, "application/json", "{\"status\":\"error\",\"message\":\"Payload too large\"}");
          this->body_too_large_ = true;
          return;
        }
        this->body_too_large_ = false;
      },
      NULL,
      [this](AsyncWebServerRequest *request, uint8_t *data, size_t len, size_t index, size_t total) {
        if (!this->checkAuth(request) || this->body_too_large_) return;

        if (index == 0) {
          this->json_buffer_ = "";
          this->json_buffer_.reserve(total + 1); // AUDIT-FW-04: cấp phát 1 lần, tránh phân mảnh heap
        }
        for (size_t i = 0; i < len; i++) {
          this->json_buffer_ += (char)data[i];
        }

        if (index + len == total) {
          DynamicJsonDocument doc(JSON_DOC_SIZE_ARM);
          DeserializationError error = deserializeJson(doc, this->json_buffer_);
          this->json_buffer_ = "";

          if (error) {
            ESP_LOGE("myiris_arm", "Loi parse JSON: %s", error.c_str());
            request->send(400, "application/json", "{\"status\":\"error\", \"message\":\"Invalid JSON\"}");
            return;
          }

          String action = doc["action"] | "";
          if (action != "arm_move") {
            ESP_LOGW("myiris_arm", "Action khong xac dinh: %s", action.c_str());
            request->send(400, "application/json", "{\"status\":\"error\", \"message\":\"Unknown action\"}");
            return;
          }

          // Mỗi khớp là optional trong payload — giữ nguyên góc hiện tại của
          // servo nếu client (UI) không gửi kèm khớp đó trong request (VD
          // chỉ kéo mỗi slider "gripper" thì base/shoulder/elbow không nên
          // tự nhảy về 90°). Dùng doc["params"].containsKey() để phân biệt
          // "không gửi" với "gửi giá trị 90".
          JsonVariant params = doc["params"];
          if (params.containsKey("base")) {
            id(servo_base).set_value(angleToServoValue(params["base"] | 90, "base"));
          }
          if (params.containsKey("shoulder")) {
            id(servo_shoulder).set_value(angleToServoValue(params["shoulder"] | 90, "shoulder"));
          }
          if (params.containsKey("elbow")) {
            id(servo_elbow).set_value(angleToServoValue(params["elbow"] | 90, "elbow"));
          }
          if (params.containsKey("gripper")) {
            id(servo_gripper).set_value(angleToServoValue(params["gripper"] | 90, "gripper"));
          }

          ESP_LOGI("myiris_arm", "Arm move applied");
          request->send(200, "application/json", "{\"status\":\"success\"}");
        }
      }
    );
  }

  void loop() override {}

 private:
  bool checkAuth(AsyncWebServerRequest *request) {
    if (!request->hasHeader("Authorization")) return false;
    String expected = String("Bearer ") + MYIRIS_ARM_AUTH_TOKEN;
    return request->getHeader("Authorization")->value() == expected;
  }
};
