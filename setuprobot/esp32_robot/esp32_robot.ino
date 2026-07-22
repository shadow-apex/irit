#include <WiFi.h>
#include <WebServer.h>
#include <ArduinoJson.h>

const char* ssid = "WIFI_SSID";
const char* password = "WIFI_PASSWORD";

WebServer server(80);

// Motor driver pins (L298N or similar)
#define MOTOR_LEFT_FWD 12
#define MOTOR_LEFT_BWD 14
#define MOTOR_RIGHT_FWD 27
#define MOTOR_RIGHT_BWD 26

void setup() {
  Serial.begin(115200);
  
  pinMode(MOTOR_LEFT_FWD, OUTPUT);
  pinMode(MOTOR_LEFT_BWD, OUTPUT);
  pinMode(MOTOR_RIGHT_FWD, OUTPUT);
  pinMode(MOTOR_RIGHT_BWD, OUTPUT);

  WiFi.begin(ssid, password);
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }
  Serial.println("\nWiFi Connected! IP Address: ");
  Serial.println(WiFi.localIP()); 

  server.on("/control", HTTP_POST, handleControl);
  server.begin();
}

void loop() {
  server.handleClient();
}

void handleControl() {
  if (server.hasArg("plain") == false) {
    server.send(400, "text/plain", "Body not received");
    return;
  }
  
  String body = server.arg("plain");
  StaticJsonDocument<200> doc;
  deserializeJson(doc, body);
  
  String action = doc["action"];
  
  // Stop all motors first
  digitalWrite(MOTOR_LEFT_FWD, LOW);
  digitalWrite(MOTOR_LEFT_BWD, LOW);
  digitalWrite(MOTOR_RIGHT_FWD, LOW);
  digitalWrite(MOTOR_RIGHT_BWD, LOW);

  if (action == "forward") {
    digitalWrite(MOTOR_LEFT_FWD, HIGH);
    digitalWrite(MOTOR_RIGHT_FWD, HIGH);
  } 
  else if (action == "backward") {
    digitalWrite(MOTOR_LEFT_BWD, HIGH);
    digitalWrite(MOTOR_RIGHT_BWD, HIGH);
  } 
  else if (action == "left") {
    digitalWrite(MOTOR_LEFT_BWD, HIGH);
    digitalWrite(MOTOR_RIGHT_FWD, HIGH); 
  } 
  else if (action == "right") {
    digitalWrite(MOTOR_LEFT_FWD, HIGH);
    digitalWrite(MOTOR_RIGHT_BWD, HIGH);
  }

  server.send(200, "application/json", "{\"status\":\"ok\"}");
}
