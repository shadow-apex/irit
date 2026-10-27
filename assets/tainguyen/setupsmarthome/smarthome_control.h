#pragma once

#include "esphome.h"
#include "esphome/components/web_server_base/web_server_base.h"
#include <ArduinoJson.h>

// F-01: /control cần `Authorization: Bearer <token>`. ĐỔI token này (khớp "token" của thiết bị
// trong robots.json). Token rỗng/token mẫu => từ chối mọi lệnh.
const char *SMARTHOME_AUTH_TOKEN = "doi-chuoi-bi-mat-nay-thanh-token-rieng-cua-ban";

// S-12/F-01: so sánh token hằng-thời-gian + TỪ CHỐI token rỗng hoặc token mẫu công khai
// (chuỗi mẫu nằm trong repo/robots.example.json nên ai cũng biết).
static bool smarthome_token_ok(const char *configured, const String &header_value) {
  if (configured == nullptr || strlen(configured) == 0) return false;
  if (strcmp(configured, "doi-chuoi-bi-mat-nay-thanh-token-rieng-cua-ban") == 0) return false;  // chưa đổi token mẫu
  String expected = String("Bearer ") + configured;
  if (header_value.length() != expected.length()) return false;
  uint8_t diff = 0;
  for (size_t i = 0; i < expected.length(); i++) diff |= (uint8_t)(header_value[i] ^ expected[i]);
  return diff == 0;
}

class SmartHomeControl : public Component {
 private:
  String json_buffer_ = "";

 public:
  void setup() override {
    auto *web_server = esphome::web_server_base::global_web_server_base->get_server();
    
    if (web_server == nullptr) {
      ESP_LOGE("myiris_smarthome", "Khong tim thay Web Server! Kiem tra block web_server trong yaml.");
      return;
    }

    ESP_LOGI("myiris_smarthome", "Dang dang ky API /control cho MyIris...");

    web_server->on("/control", HTTP_POST, 
      [](AsyncWebServerRequest *request) {},
      NULL,
      [this](AsyncWebServerRequest *request, uint8_t *data, size_t len, size_t index, size_t total) {
        if (!request->hasHeader("Authorization") ||
            !smarthome_token_ok(SMARTHOME_AUTH_TOKEN, request->getHeader("Authorization")->value())) {
          if (index == 0) request->send(401, "application/json", "{\"status\":\"error\", \"message\":\"Unauthorized\"}");
          return;
        }
        if (total > 512) {
          if (index == 0) request->send(413, "application/json", "{\"status\":\"error\", \"message\":\"Body too large\"}");
          return;
        }

        // Nối chuỗi để xử lý dữ liệu bị chia nhỏ (Chunking)
        if (index == 0) this->json_buffer_ = "";
        for (size_t i = 0; i < len; i++) {
          this->json_buffer_ += (char)data[i];
        }

        if (index + len == total) {
          DynamicJsonDocument doc(1024);
          DeserializationError error = deserializeJson(doc, this->json_buffer_);
          
          if (error) {
            ESP_LOGE("myiris_smarthome", "Loi parse JSON: %s", error.c_str());
            request->send(400, "application/json", "{\"status\":\"error\", \"message\":\"Invalid JSON\"}");
            return;
          }

          String action = doc["action"] | "";
          String device = doc["device"] | "";
          ESP_LOGI("myiris_smarthome", "Nhan lenh: device=%s, action=%s", device.c_str(), action.c_str());
          
          // Xử lý bật/tắt thiết bị dựa theo lệnh của Iris
          // Bạn có thể dùng chuỗi if-else để xử lý thêm nhiều thiết bị khác (relay_2, relay_3...)
          if (action == "turn_on" || action == "on") {
             id(relay_1).turn_on();
          } 
          else if (action == "turn_off" || action == "off") {
             id(relay_1).turn_off();
          } 
          else {
             request->send(400, "application/json", "{\"status\":\"error\", \"message\":\"Unknown action\"}");
             return;
          }

          request->send(200, "application/json", "{\"status\":\"success\"}");
        }
      }
    );
  }
};
