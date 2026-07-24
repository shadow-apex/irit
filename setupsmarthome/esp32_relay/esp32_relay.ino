#include <WiFi.h>
#include <WebServer.h>
#include <ArduinoJson.h>

const char* ssid = "YOUR_WIFI_SSID";
const char* password = "YOUR_WIFI_PASSWORD";

// Chân điều khiển Relay (Nối với chân IN của Module Relay)
const int RELAY_PIN = 26; 

WebServer server(80);

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

  // Đăng ký API nhận lệnh từ Iris
  server.on("/control", HTTP_POST, handleControl);
  server.begin();
}

void loop() {
  server.handleClient();
}

void handleControl() {
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
  String action = doc["action"];

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
