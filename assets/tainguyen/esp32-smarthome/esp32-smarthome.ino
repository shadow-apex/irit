#include <WiFi.h>
#include <WebServer.h>
#include <ArduinoJson.h>

const char* ssid = "YOUR_WIFI_SSID";
const char* password = "YOUR_WIFI_PASSWORD";

// Khởi tạo WebServer ở cổng 80
WebServer server(80);

void setup() {
  Serial.begin(115200);
  delay(10);

  // Kết nối WiFi
  Serial.println();
  Serial.print("Connecting to ");
  Serial.println(ssid);
  
  // Đặt IP tĩnh tĩnh nếu cần (tuỳ chọn)
  // IPAddress ip(192, 168, 1, 15);
  // IPAddress gateway(192, 168, 1, 1);
  // IPAddress subnet(255, 255, 255, 0);
  // WiFi.config(ip, gateway, subnet);

  WiFi.begin(ssid, password);

  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }

  Serial.println("");
  Serial.println("WiFi connected.");
  Serial.print("IP address: ");
  Serial.println(WiFi.localIP());

  // Thiết lập route xử lý yêu cầu POST từ I.R.I.S
  server.on("/api/smarthome", HTTP_POST, handleSmartHome);

  // Bắt đầu server
  server.begin();
  Serial.println("HTTP server started");
}

void loop() {
  // Lắng nghe và xử lý các yêu cầu
  server.handleClient();
}

void handleSmartHome() {
  if (server.hasArg("plain") == false) { 
    // Yêu cầu POST nhưng không có body (plain)
    server.send(400, "text/plain", "Body not received");
    return;
  }
  
  // Nhận body dạng chuỗi
  String message = server.arg("plain");
  Serial.println("Received message:");
  Serial.println(message);
  
  // Parse JSON sử dụng thư viện ArduinoJson
  StaticJsonDocument<256> doc;
  DeserializationError error = deserializeJson(doc, message);

  if (error) {
    Serial.print("deserializeJson() failed: ");
    Serial.println(error.c_str());
    server.send(400, "application/json", "{\"status\":\"error\", \"message\":\"Invalid JSON\"}");
    return;
  }

  // Lấy các tham số device và action
  String device = doc["device"];
  String action = doc["action"];

  Serial.print("Device: ");
  Serial.println(device);
  Serial.print("Action: ");
  Serial.println(action);

  // === THÊM LOGIC ĐIỀU KHIỂN CỦA BẠN TẠI ĐÂY ===
  // Ví dụ:
  if (device == "light" || device == "đèn") {
    if (action == "turn_on" || action == "bật") {
      // digitalWrite(LED_PIN, HIGH);
      Serial.println("--> Đã bật đèn");
    } else if (action == "turn_off" || action == "tắt") {
      // digitalWrite(LED_PIN, LOW);
      Serial.println("--> Đã tắt đèn");
    }
  }

  // Gửi phản hồi JSON về cho server I.R.I.S
  String response = "{\"status\":\"success\", \"message\":\"Command received\"}";
  server.send(200, "application/json", response);
}
