#include "esp_http_server.h"
#include "esp_timer.h"
#include "esp_camera.h"
#include "img_converters.h"
#include "Arduino.h"
#include <ArduinoJson.h>
#include <ESP32Servo.h>

Servo servoBase;
Servo servoShoulder;
Servo servoElbow;
Servo servoGripper;

// Setup Servo Framework (Call this from main ino)
void initServos() {
    servoBase.setPeriodHertz(50);
    servoShoulder.setPeriodHertz(50);
    servoElbow.setPeriodHertz(50);
    servoGripper.setPeriodHertz(50);

    // Gán tạm vào các chân GPIO 2, 4, 33, 1 (Bạn nên dùng mạch I2C PCA9685 sau này)
    servoBase.attach(2, 500, 2400);
    servoShoulder.attach(4, 500, 2400);
    servoElbow.attach(33, 500, 2400);
    servoGripper.attach(1, 500, 2400);

    // Reset về vị trí giữa
    servoBase.write(90);
    servoShoulder.write(90);
    servoElbow.write(90);
    servoGripper.write(90);
}

// ---------------------------------------------------------------------------
// F-01 — token + deadman (xem esp32_robot.ino để biết lý do)
//  * /control cần `Authorization: Bearer <CONTROL_TOKEN>`; CONTROL_TOKEN đặt trong
//    secrets.h (đã .gitignore). Để trống => TỪ CHỐI mọi lệnh (fail-closed).
//  * Deadman: lệnh lái (forward/backward/left/right) tự hết hiệu lực sau
//    DEADMAN_MS nếu không được gửi lại => motor dừng khi mất Wi-Fi / app treo.
// ---------------------------------------------------------------------------
#if defined(__has_include)
#if __has_include("secrets.h")
#include "secrets.h"
#endif
#endif
#ifndef CONTROL_TOKEN
#define CONTROL_TOKEN ""
#endif
#define DEADMAN_MS 600

static volatile uint32_t lastDriveCmdMs = 0;
static volatile bool driving = false;

static void stopDriveMotors() {
    digitalWrite(12, LOW); // MOTOR_LEFT_FWD
    digitalWrite(13, LOW); // MOTOR_LEFT_BWD
    digitalWrite(15, LOW); // MOTOR_RIGHT_FWD
    digitalWrite(14, LOW); // MOTOR_RIGHT_BWD
    driving = false;
}

// esp_timer chạy độc lập với loop() -> vẫn dừng được kể cả khi loop bị chặn.
static void deadman_timer_cb(void* /*arg*/) {
    if (driving && (uint32_t)(millis() - lastDriveCmdMs) > DEADMAN_MS) {
        stopDriveMotors();
    }
}

static bool authorized(httpd_req_t *req) {
    const char* tok = CONTROL_TOKEN;
    size_t tlen = strlen(tok);
    if (tlen == 0) return false; // fail-closed
    size_t hlen = httpd_req_get_hdr_value_len(req, "Authorization");
    if (hlen == 0 || hlen > 200) return false;
    char hdr[208];
    if (httpd_req_get_hdr_value_str(req, "Authorization", hdr, sizeof(hdr)) != ESP_OK) return false;
    const char* prefix = "Bearer ";
    size_t plen = strlen(prefix);
    if (strlen(hdr) != plen + tlen) return false;
    uint8_t diff = 0;
    for (size_t i = 0; i < plen; i++) diff |= (uint8_t)(hdr[i] ^ prefix[i]);
    for (size_t i = 0; i < tlen; i++) diff |= (uint8_t)(hdr[plen + i] ^ tok[i]);
    return diff == 0;
}

static esp_err_t send_json_status(httpd_req_t *req, const char* status, const char* body) {
    httpd_resp_set_status(req, status);
    httpd_resp_set_type(req, "application/json");
    return httpd_resp_send(req, body, strlen(body));
}

extern int MOTOR_LEFT_FWD;
extern int MOTOR_LEFT_BWD;
extern int MOTOR_RIGHT_FWD;
extern int MOTOR_RIGHT_BWD;

#define PART_BOUNDARY "123456789000000000000987654321"
static const char* _STREAM_CONTENT_TYPE = "multipart/x-mixed-replace;boundary=" PART_BOUNDARY;
static const char* _STREAM_BOUNDARY = "\r\n--" PART_BOUNDARY "\r\n";
static const char* _STREAM_PART = "Content-Type: image/jpeg\r\nContent-Length: %u\r\n\r\n";

httpd_handle_t stream_httpd = NULL;
httpd_handle_t control_httpd = NULL;

// ==========================================
// MJPEG STREAM HANDLER (Port 81)
// ==========================================
static esp_err_t stream_handler(httpd_req_t *req) {
    camera_fb_t * fb = NULL;
    esp_err_t res = ESP_OK;
    size_t _jpg_buf_len = 0;
    uint8_t * _jpg_buf = NULL;
    char * part_buf[64];

    res = httpd_resp_set_type(req, _STREAM_CONTENT_TYPE);
    if(res != ESP_OK){
        return res;
    }

    while(true){
        fb = esp_camera_fb_get();
        if (!fb) {
            Serial.println("Camera capture failed");
            res = ESP_FAIL;
        } else {
            if(fb->format != PIXFORMAT_JPEG){
                bool jpeg_converted = frame2jpg(fb, 80, &_jpg_buf, &_jpg_buf_len);
                esp_camera_fb_return(fb);
                fb = NULL;
                if(!jpeg_converted){
                    Serial.println("JPEG compression failed");
                    res = ESP_FAIL;
                }
            } else {
                _jpg_buf_len = fb->len;
                _jpg_buf = fb->buf;
            }
        }
        if(res == ESP_OK){
            size_t hlen = snprintf((char *)part_buf, 64, _STREAM_PART, _jpg_buf_len);
            res = httpd_resp_send_chunk(req, (const char *)part_buf, hlen);
        }
        if(res == ESP_OK){
            res = httpd_resp_send_chunk(req, (const char *)_jpg_buf, _jpg_buf_len);
        }
        if(res == ESP_OK){
            res = httpd_resp_send_chunk(req, _STREAM_BOUNDARY, strlen(_STREAM_BOUNDARY));
        }
        if(fb){
            esp_camera_fb_return(fb);
            fb = NULL;
            _jpg_buf = NULL;
        } else if(_jpg_buf){
            free(_jpg_buf);
            _jpg_buf = NULL;
        }
        if(res != ESP_OK){
            break;
        }
    }
    return res;
}

// ==========================================
// CONTROL HANDLER (Port 80)
// ==========================================
static esp_err_t control_handler(httpd_req_t *req) {
    if (!authorized(req)) {
        stopDriveMotors(); // request lạ không được giữ motor đang chạy
        return send_json_status(req, "401 Unauthorized", "{\"error\":\"unauthorized\"}");
    }
    char content[256];
    // FIX-ARM-01: chừa 1 byte cho ký tự NUL. Bản gốc dùng sizeof(content)
    // (=256) làm giới hạn recv -> nếu client gửi payload >= 256 byte,
    // recv_size = 256 và dòng null-terminate bên dưới ghi vào content[256],
    // NGOÀI phạm vi mảng (chỉ số hợp lệ 0-255) -> stack buffer overflow 1
    // byte -> undefined behavior, dễ gây crash/reboot ngẫu nhiên (Guru
    // Meditation Error) khi có request lớn hơn dự kiến.
    size_t recv_size = min(req->content_len, sizeof(content) - 1);
    int ret = httpd_req_recv(req, content, recv_size);
    if (ret <= 0) {
        if (ret == HTTPD_SOCK_ERR_TIMEOUT) {
            httpd_resp_send_408(req);
        }
        return ESP_FAIL;
    }
    // FIX-ARM-01 (tiếp): null-terminate tại `ret` (số byte THỰC SỰ nhận
    // được), không phải `recv_size` (số byte tối đa được phép nhận). Nếu
    // dùng recv_size trong khi ret < recv_size, phần đuôi content sẽ chứa
    // rác từ lần request trước (content là biến local trên stack, không
    // được zero-init) -> deserializeJson có thể ăn phải rác đó.
    content[ret] = '\0';

    StaticJsonDocument<512> doc;
    DeserializationError error = deserializeJson(doc, content);

    if (error) {
        stopDriveMotors();
        return send_json_status(req, "400 Bad Request", "{\"error\":\"invalid json\"}");
    }

    // FIX-ARM-02: doc["action"] trả về nullptr nếu key "action" không tồn
    // tại trong JSON. Bản gốc gọi thẳng strcmp(action, ...) ngay sau đó ->
    // strcmp(nullptr, "forward") là undefined behavior -> ESP32 gần như
    // chắc chắn crash. Chỉ cần 1 request thiếu field action (vô tình hay
    // cố ý) là rơi cả app, kéo theo cả stream_handler vì chung 1 firmware.
    // Toán tử `| ""` của ArduinoJson tự fallback về chuỗi rỗng nếu thiếu key.
    const char* action = doc["action"] | "";
    if (strlen(action) == 0) {
        return send_json_status(req, "400 Bad Request", "{\"error\":\"missing action\"}");
    }
    if (!(strcmp(action, "forward") == 0 || strcmp(action, "backward") == 0 ||
          strcmp(action, "left") == 0 || strcmp(action, "right") == 0 ||
          strcmp(action, "stop") == 0 || strcmp(action, "arm_move") == 0)) {
        return send_json_status(req, "400 Bad Request", "{\"error\":\"unknown action\"}");
    }

    // FIX-ARM-03: chỉ dừng-reset motor di chuyển khi action THỰC SỰ là lệnh
    // lái (forward/backward/left/right/stop). Bản gốc reset 4 chân motor vô
    // điều kiện ở đầu hàm, kể cả khi action == "arm_move" -> mỗi lần kéo
    // slider cánh tay sẽ VÔ TÌNH làm robot đang chạy khựng lại giữa chừng.
    bool isDriveAction = strcmp(action, "forward") == 0 ||
                          strcmp(action, "backward") == 0 ||
                          strcmp(action, "left") == 0 ||
                          strcmp(action, "right") == 0 ||
                          strcmp(action, "stop") == 0;
    if (isDriveAction) {
        stopDriveMotors();
    }

    if (strcmp(action, "forward") == 0) {
        digitalWrite(12, HIGH);
        digitalWrite(15, HIGH);
    } 
    else if (strcmp(action, "backward") == 0) {
        digitalWrite(13, HIGH);
        digitalWrite(14, HIGH);
    } 
    else if (strcmp(action, "left") == 0) {
        digitalWrite(13, HIGH);
        digitalWrite(15, HIGH);
    } 
    else if (strcmp(action, "right") == 0) {
        digitalWrite(12, HIGH);
        digitalWrite(14, HIGH);
    }

    if (isDriveAction && strcmp(action, "stop") != 0) {
        driving = true;
        lastDriveCmdMs = millis();
    }
    if (strcmp(action, "arm_move") == 0) {
        // Tín hiệu điều khiển Servo từ giao diện Iris
        JsonObject params = doc["params"];
        // FIX-ARM-04: constrain giá trị servo về [0,180] trước khi ghi.
        // UI đã giới hạn min/max="180" trên slider, nhưng server không nên
        // tin tưởng mù client — ai đó gọi thẳng API bằng curl/Postman với
        // giá trị âm hoặc >180 có thể khiến servo cố quay vượt giới hạn cơ
        // khí, dẫn tới kẹt hoặc cháy động cơ servo theo thời gian.
        if (params.containsKey("base")) servoBase.write(constrain(params["base"].as<int>(), 0, 180));
        if (params.containsKey("shoulder")) servoShoulder.write(constrain(params["shoulder"].as<int>(), 0, 180));
        if (params.containsKey("elbow")) servoElbow.write(constrain(params["elbow"].as<int>(), 0, 180));
        if (params.containsKey("gripper")) servoGripper.write(constrain(params["gripper"].as<int>(), 0, 180));
    }

    httpd_resp_set_type(req, "application/json");
    const char* resp_str = "{\"status\":\"ok\"}";
    httpd_resp_send(req, resp_str, strlen(resp_str));

    return ESP_OK;
}

// ==========================================
// SNAPSHOT HANDLER (Port 80, GET /capture) — 1 ảnh JPEG đơn.
// Phía Iris dùng cho vision để khỏi phải cắt khung từ luồng MJPEG vô hạn.
// ==========================================
static esp_err_t capture_handler(httpd_req_t *req) {
    camera_fb_t *fb = esp_camera_fb_get();
    if (!fb) {
        return send_json_status(req, "503 Service Unavailable", "{\"error\":\"capture failed\"}");
    }
    esp_err_t res;
    if (fb->format == PIXFORMAT_JPEG) {
        httpd_resp_set_type(req, "image/jpeg");
        httpd_resp_set_hdr(req, "Cache-Control", "no-store");
        res = httpd_resp_send(req, (const char *)fb->buf, fb->len);
    } else {
        uint8_t *jpg = NULL;
        size_t jlen = 0;
        if (frame2jpg(fb, 80, &jpg, &jlen)) {
            httpd_resp_set_type(req, "image/jpeg");
            res = httpd_resp_send(req, (const char *)jpg, jlen);
            free(jpg);
        } else {
            res = send_json_status(req, "500 Internal Server Error", "{\"error\":\"jpeg failed\"}");
        }
    }
    esp_camera_fb_return(fb);
    return res;
}

// ==========================================
// SERVER INITIALIZATION
// ==========================================
void startCameraServer() {
    httpd_config_t config = HTTPD_DEFAULT_CONFIG();

    httpd_uri_t stream_uri = {
        .uri       = "/stream",
        .method    = HTTP_GET,
        .handler   = stream_handler,
        .user_ctx  = NULL
    };

    httpd_uri_t control_uri = {
        .uri       = "/control",
        .method    = HTTP_POST,
        .handler   = control_handler,
        .user_ctx  = NULL
    };

    httpd_uri_t capture_uri = {
        .uri       = "/capture",
        .method    = HTTP_GET,
        .handler   = capture_handler,
        .user_ctx  = NULL
    };

    // Deadman timer (kiểm tra mỗi 100 ms)
    static esp_timer_handle_t deadman_timer = NULL;
    if (!deadman_timer) {
        esp_timer_create_args_t targs = {};
        targs.callback = &deadman_timer_cb;
        targs.name = "deadman";
        if (esp_timer_create(&targs, &deadman_timer) == ESP_OK) {
            esp_timer_start_periodic(deadman_timer, 100 * 1000);
        }
    }

    if (strlen(CONTROL_TOKEN) == 0) {
        Serial.println("[!] CONTROL_TOKEN chua cau hinh (secrets.h) -> /control se TU CHOI moi lenh.");
    }

    // NÂNG CẤP: ghim mỗi httpd instance vào 1 core riêng. Mặc định
    // HTTPD_DEFAULT_CONFIG không ghim core tường minh, nên scheduler có thể
    // xếp cả 2 task lên cùng 1 core tuỳ thời điểm -> stream có thể giật nhẹ
    // khi control_handler đang xử lý cùng lúc. Ghim rõ ràng giúp hành vi
    // ổn định, dự đoán được hơn khi cả 2 server đều bận.
    // Start Control Server on port 80
    config.server_port = 80;
    config.core_id = 1;
    if (httpd_start(&control_httpd, &config) == ESP_OK) {
        httpd_register_uri_handler(control_httpd, &control_uri);
        httpd_register_uri_handler(control_httpd, &capture_uri);
    }

    // Start Stream Server on port 81
    config.server_port = 81;
    config.ctrl_port = 81;
    config.core_id = 0;
    if (httpd_start(&stream_httpd, &config) == ESP_OK) {
        httpd_register_uri_handler(stream_httpd, &stream_uri);
    }
}
