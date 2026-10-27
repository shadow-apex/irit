#include <WiFi.h>
#include <WebServer.h>
#include <ArduinoJson.h>

const char* ssid = "WIFI_SSID";
const char* password = "WIFI_PASSWORD";

// ---------------------------------------------------------------------------
// F-01 — AN TOÀN
//  1) Token: /control chỉ nhận request có header `Authorization: Bearer <CONTROL_TOKEN>`
//     (khớp trường "token" của robots.json phía Iris). CONTROL_TOKEN KHÔNG được commit:
//     tạo file `secrets.h` cạnh sketch (đã nằm trong .gitignore) với nội dung
//         #define CONTROL_TOKEN "chuoi-bi-mat-dai-ngau-nhien"
//     Nếu để trống, firmware TỪ CHỐI mọi lệnh (fail-closed) và in cảnh báo ra Serial.
//  2) Deadman: motor chỉ chạy khi còn nhận lệnh. Sau DEADMAN_MS không có lệnh mới
//     (mất Wi-Fi, app treo, nhả phím mà gói "stop" bị rớt) => TỰ DỪNG. Phía Iris phải
//     gửi lại lệnh lái mỗi <= 300 ms (RobotCameras.tsx đang gửi mỗi 150 ms).
// ---------------------------------------------------------------------------
#if defined(__has_include)
#if __has_include("secrets.h")
#include "secrets.h"
#endif
#endif
#ifndef CONTROL_TOKEN
#define CONTROL_TOKEN ""
#endif

const unsigned long DEADMAN_MS = 600;

WebServer server(80);

// Motor driver pins (L298N or similar)
#define MOTOR_LEFT_FWD 12
#define MOTOR_LEFT_BWD 14
#define MOTOR_RIGHT_FWD 27
#define MOTOR_RIGHT_BWD 26

volatile unsigned long lastCmdMs = 0;
volatile bool moving = false;

void handleControl();

void stopMotors() {
  digitalWrite(MOTOR_LEFT_FWD, LOW);
  digitalWrite(MOTOR_LEFT_BWD, LOW);
  digitalWrite(MOTOR_RIGHT_FWD, LOW);
  digitalWrite(MOTOR_RIGHT_BWD, LOW);
  moving = false;
}

// So sánh token hằng-thời-gian (không rò độ dài khớp từng ký tự).
bool authorized() {
  const char* tok = CONTROL_TOKEN;
  size_t tlen = strlen(tok);
  if (tlen == 0) return false;  // fail-closed: chưa cấu hình token
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

  pinMode(MOTOR_LEFT_FWD, OUTPUT);
  pinMode(MOTOR_LEFT_BWD, OUTPUT);
  pinMode(MOTOR_RIGHT_FWD, OUTPUT);
  pinMode(MOTOR_RIGHT_BWD, OUTPUT);
  stopMotors();

  if (strlen(CONTROL_TOKEN) == 0) {
    Serial.println("\n[!] CONTROL_TOKEN chua duoc cau hinh (secrets.h) -> firmware se TU CHOI moi lenh /control.");
  }

  WiFi.begin(ssid, password);
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }
  Serial.println("\nWiFi Connected! IP Address: ");
  Serial.println(WiFi.localIP());

  // WebServer chỉ giữ lại header đã đăng ký -> bắt buộc để đọc Authorization.
  static const char* headerKeys[] = {"Authorization"};
  server.collectHeaders(headerKeys, 1);

  server.on("/control", HTTP_POST, handleControl);
  server.begin();
  lastCmdMs = millis();
}

void loop() {
  server.handleClient();

  // Deadman: quá hạn không có lệnh => dừng toàn bộ chân motor.
  if (moving && (millis() - lastCmdMs) > DEADMAN_MS) {
    stopMotors();
    Serial.println("[deadman] no command -> motors stopped");
  }

  // Mất Wi-Fi: dừng ngay và thử nối lại (không chờ hết deadman).
  static unsigned long lastReconnectMs = 0;
  if (WiFi.status() != WL_CONNECTED) {
    if (moving) stopMotors();
    if (millis() - lastReconnectMs > 5000) {
      lastReconnectMs = millis();
      WiFi.reconnect();
    }
  }
}

void handleControl() {
  if (!authorized()) {
    stopMotors();  // request lạ không bao giờ được giữ motor đang chạy
    server.send(401, "application/json", "{\"error\":\"unauthorized\"}");
    return;
  }

  if (server.hasArg("plain") == false) {
    server.send(400, "application/json", "{\"error\":\"body not received\"}");
    return;
  }

  String body = server.arg("plain");
  StaticJsonDocument<200> doc;
  DeserializationError err = deserializeJson(doc, body);
  if (err) {
    stopMotors();
    server.send(400, "application/json", "{\"error\":\"invalid json\"}");
    return;
  }

  String action = doc["action"] | "";
  bool known = action == "forward" || action == "backward" || action == "left" ||
               action == "right" || action == "stop";
  if (!known) {
    server.send(400, "application/json", "{\"error\":\"unknown action\"}");
    return;
  }

  // Stop all motors first (tránh bật FWD+BWD cùng lúc khi đổi hướng)
  stopMotors();

  if (action == "forward") {
    digitalWrite(MOTOR_LEFT_FWD, HIGH);
    digitalWrite(MOTOR_RIGHT_FWD, HIGH);
    moving = true;
  } else if (action == "backward") {
    digitalWrite(MOTOR_LEFT_BWD, HIGH);
    digitalWrite(MOTOR_RIGHT_BWD, HIGH);
    moving = true;
  } else if (action == "left") {
    digitalWrite(MOTOR_LEFT_BWD, HIGH);
    digitalWrite(MOTOR_RIGHT_FWD, HIGH);
    moving = true;
  } else if (action == "right") {
    digitalWrite(MOTOR_LEFT_FWD, HIGH);
    digitalWrite(MOTOR_RIGHT_BWD, HIGH);
    moving = true;
  }
  lastCmdMs = millis();

  server.send(200, "application/json", "{\"status\":\"ok\"}");
}
