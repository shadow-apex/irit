#include <WiFi.h>
#include <WebServer.h>
#include <ArduinoJson.h>

const char* ssid = "YOUR_WIFI_SSID";
const char* password = "YOUR_WIFI_PASSWORD";

// F-01: /control chỉ nhận `Authorization: Bearer <CONTROL_TOKEN>`. Đặt token trong
// `secrets.h` (đã .gitignore): #define CONTROL_TOKEN "chuoi-bi-mat-dai-ngau-nhien"
// Để trống => firmware TỪ CHỐI mọi lệnh (fail-closed).
#if defined(__has_include)
#if __has_include("secrets.h")
#include "secrets.h"
#endif
#endif
#ifndef CONTROL_TOKEN
#define CONTROL_TOKEN ""
#endif

// Chân điều khiển Relay (Nối với chân IN của Module Relay)
const int RELAY_PIN = 26; 

WebServer server(80);

void handleControl();

bool authorized() {
  const char* tok = CONTROL_TOKEN;
  size_t tlen = strlen(tok);
  if (tlen == 0) return false;
  if (!server.hasHeader("Authorization")) return false;
  String got = server.header("Authorization");
  String expected = String("Bearer ") + tok;
  if (got.length() != expected.length()) return false;
  uint8_t diff = 0;
  for (size_t i = 0; i < got.length(); i++) diff |= (uint8_t)(got[i] ^ expected[i]);
  return diff == 0;
}

void setup() {
  Serial.begin(115200);
  
  // Khởi tạo chân Relay
  pinMode(RELAY_PIN, OUTPUT);
  digitalWrite(RELAY_PIN, HIGH); // Tùy mạch Relay (HIGH hoặc LOW để ngắt)

  // Kết nối WiFi
  WiFi.begin(ssid, password);
  while (WiFi.status() != WL_CONNECTED) {
    delay(1000);
    Serial.println("Connecting to WiFi...");
  }
  Serial.println("Connected to WiFi!");
  Serial.print("Smart Home IP: ");
  Serial.println(WiFi.localIP());

  // WebServer chỉ giữ header đã đăng ký -> cần để đọc Authorization
  static const char* headerKeys[] = {"Authorization"};
  server.collectHeaders(headerKeys, 1);

  // Đăng ký API nhận lệnh từ Iris
  server.on("/control", HTTP_POST, handleControl);
  server.begin();
}

void loop() {
  server.handleClient();
  // Tự nối lại Wi-Fi nếu rớt (relay giữ nguyên trạng thái, không tự đổi)
  static unsigned long lastTry = 0;
  if (WiFi.status() != WL_CONNECTED && millis() - lastTry > 5000) {
    lastTry = millis();
    WiFi.reconnect();
  }
}

void handleControl() {
  if (!authorized()) {
    server.send(401, "application/json", "{\"error\": \"unauthorized\"}");
    return;
  }
  if (server.hasArg("plain") == false) {
    server.send(400, "application/json", "{\"error\": \"No payload\"}");
    return;
  }
  
  String payload = server.arg("plain");
  StaticJsonDocument<200> doc;
  DeserializationError error = deserializeJson(doc, payload);

  if (error) {
    server.send(400, "application/json", "{\"error\": \"Invalid JSON\"}");
    return;
  }

  // Iris sẽ gửi JSON dạng {"action": "on"} hoặc {"action": "off"}
  String action = doc["action"] | "";

  if (action == "on" || action == "turn_on") {
    digitalWrite(RELAY_PIN, LOW); // Đóng mạch Relay (Bật đèn)
    Serial.println("Da BAT thiet bi");
    server.send(200, "application/json", "{\"status\": \"ON\"}");
  } 
  else if (action == "off" || action == "turn_off") {
    digitalWrite(RELAY_PIN, HIGH); // Ngắt mạch Relay (Tắt đèn)
    Serial.println("Da TAT thiet bi");
    server.send(200, "application/json", "{\"status\": \"OFF\"}");
  } 
  else {
    server.send(400, "application/json", "{\"error\": \"Unknown action\"}");
  }
}
