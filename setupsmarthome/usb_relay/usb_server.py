from flask import Flask, request, jsonify
import serial
import time

app = Flask(__name__)

# Thay đổi COM_PORT thành cổng USB mà thiết bị đang cắm (Xem trong Device Manager)
COM_PORT = 'COM3'
BAUD_RATE = 9600

try:
    # Mở kết nối Serial tới mạch Arduino / Relay
    ser = serial.Serial(COM_PORT, BAUD_RATE, timeout=1)
    time.sleep(2) # Chờ khởi động
    print(f"[*] Da ket noi toi {COM_PORT}")
except Exception as e:
    print(f"[!] Khong the mo cong {COM_PORT}: {e}")
    ser = None

@app.route('/control', methods=['POST'])
def control_device():
    data = request.get_json()
    if not data or 'action' not in data:
        return jsonify({"error": "No action provided"}), 400
    
    action = data['action']
    
    if ser and ser.is_open:
        if action in ['on', 'turn_on']:
            ser.write(b'1') # Ký tự '1' ra lệnh cho Arduino bật Relay
            print("-> Da gui lenh: ON")
            return jsonify({"status": "ON"}), 200
        elif action in ['off', 'turn_off']:
            ser.write(b'0') # Ký tự '0' ra lệnh cho Arduino tắt Relay
            print("-> Da gui lenh: OFF")
            return jsonify({"status": "OFF"}), 200
        else:
            return jsonify({"error": f"Unknown action: {action}"}), 400
    else:
        return jsonify({"error": "Serial port not connected"}), 500

if __name__ == '__main__':
    # Chạy server ở cổng 5000
    print("[*] USB Smart Home Server dang chay tai: http://localhost:5000")
    app.run(host='0.0.0.0', port=5000)
