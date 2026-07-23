#pragma once

#include "esphome.h"
#include "esphome/components/web_server_base/web_server_base.h"
#include <ArduinoJson.h>

// Định nghĩa giới hạn RAM cho bộ parse JSON
const int JSON_DOC_SIZE = 1024;

class MyIrisControl : public Component {
 private:
  uint32_t last_cmd_time_ = 0;
  bool is_moving_ = false;
  String json_buffer_ = "";

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
      [](AsyncWebServerRequest *request) {
        // Hàm này xử lý request headers, nhưng phần body sẽ được xử lý ở callback bên dưới
      },
      NULL,
      [this](AsyncWebServerRequest *request, uint8_t *data, size_t len, size_t index, size_t total) {
        
        // Nối chuỗi dữ liệu (xử lý JSON bị cắt khúc / chunked)
        if (index == 0) {
          this->json_buffer_ = ""; // Xóa buffer khi bắt đầu request mới
        }
        for (size_t i = 0; i < len; i++) {
          this->json_buffer_ += (char)data[i];
        }

        // Khi đã nhận đủ toàn bộ payload
        if (index + len == total) {
          ESP_LOGD("myiris", "Nhan POST /control (total len: %d)", total);

          DynamicJsonDocument doc(JSON_DOC_SIZE);
          DeserializationError error = deserializeJson(doc, this->json_buffer_);
          
          if (error) {
            ESP_LOGE("myiris", "Loi parse JSON: %s. Payload: %s", error.c_str(), this->json_buffer_.c_str());
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
            int base = doc["params"]["base"] | 90;
            
            // Đưa góc từ (0-180) về dải (-1.0 đến 1.0) cho ESPHome
            float base_esphome = (base / 90.0) - 1.0;
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
};
