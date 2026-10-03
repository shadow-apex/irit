// ============================================================
// FIX-USB-01: Tăng Baudrate 9600 -> 115200
// 9600 không phải nguyên nhân gây lag (1 ký tự chỉ mất ~1ms ở 9600),
// nhưng 115200 cho thêm margin và khớp với usb_server.py đã cập nhật.
// ============================================================
#define BAUD_RATE 115200

// ============================================================
// FIX-USB-02: Failsafe watchdog — nếu KHÔNG nhận được lệnh mới
// trong COMMAND_TIMEOUT_MS, tự động dừng motor.
// Đây là lỗ hổng nghiêm trọng nhất của bản gốc: nếu rút cáp USB,
// Python server crash, hoặc gói tin "stop" bị mất trên đường truyền
// (HTTP -> Serial), robot sẽ tiếp tục chạy MÃI MÃI ở lệnh cuối cùng
// nhận được vì Arduino không có khái niệm "hết hạn". Với một robot
// vật lý, đây là rủi ro về an toàn (đâm tường, ngã cầu thang...).
// ============================================================
const unsigned long COMMAND_TIMEOUT_MS = 400;
unsigned long lastCommandTime = 0;
bool hasActiveCommand = false;

void stopMotors() {
  digitalWrite(5, LOW);
  digitalWrite(6, LOW);
  digitalWrite(9, LOW);
  digitalWrite(10, LOW);
}

void setup() {
  Serial.begin(BAUD_RATE);

  pinMode(5, OUTPUT);
  pinMode(6, OUTPUT);
  pinMode(9, OUTPUT);
  pinMode(10, OUTPUT);

  stopMotors(); // Đảm bảo trạng thái khởi động luôn là đứng yên
}

void loop() {
  // Nếu có tín hiệu từ máy tính gửi xuống qua dây cáp USB
  if (Serial.available() > 0) {
    char command = Serial.read(); // Đọc 1 ký tự (W, A, S, D, Q)

    stopMotors(); // Tắt hết động cơ trước khi áp lệnh mới

    if (command == 'W') {
      digitalWrite(5, HIGH); digitalWrite(9, HIGH);
      hasActiveCommand = true;
    } else if (command == 'S') {
      digitalWrite(6, HIGH); digitalWrite(10, HIGH);
      hasActiveCommand = true;
    } else if (command == 'A') {
      digitalWrite(6, HIGH); digitalWrite(9, HIGH);
      hasActiveCommand = true;
    } else if (command == 'D') {
      digitalWrite(5, HIGH); digitalWrite(10, HIGH);
      hasActiveCommand = true;
    } else {
      // 'Q' (Stop) hoặc ký tự lạ -> đã stopMotors() ở trên, không chạy nữa
      hasActiveCommand = false;
    }

    lastCommandTime = millis(); // Ghi nhận mốc thời gian nhận lệnh gần nhất
  }

  // FIX-USB-02 (tiếp): Nếu đang có lệnh chạy (W/A/S/D) mà quá lâu không có
  // lệnh mới nào tới (kể cả lệnh lặp lại cùng hướng), coi như mất kết nối
  // và tự dừng khẩn cấp.
  if (hasActiveCommand && (millis() - lastCommandTime > COMMAND_TIMEOUT_MS)) {
    stopMotors();
    hasActiveCommand = false;
  }
}
