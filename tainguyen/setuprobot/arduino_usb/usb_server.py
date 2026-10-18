from flask import Flask, request, jsonify
import serial
import time
import sys
import threading

app = Flask(__name__)

# Thay 'COM3' bằng cổng kết nối Arduino của bạn trên Windows (VD: 'COM4', 'COM5')
# Trên máy Mac/Linux sẽ là '/dev/ttyUSB0' hoặc '/dev/cu.usbmodem14101'
COM_PORT = 'COM3'

# FIX-USB-01: Đồng bộ baudrate với arduino_usb.ino (đã tăng lên 115200 để có
# thêm margin; baudrate KHÔNG phải nguyên nhân gây lag ở 9600, nhưng đồng bộ
# hai bên tránh việc quên đổi 1 trong 2 file rồi ngồi debug "sao không nhận").
BAUD_RATE = 115200

# FIX-USB-03: Lock để đảm bảo chỉ 1 luồng ghi Serial tại 1 thời điểm.
# Flask với threaded=True xử lý nhiều request song song -> nếu 2 request tới
# gần như cùng lúc mà không có lock, có thể ghi đè/xen kẽ byte trên cùng 1
# cổng Serial (dù với lệnh 1 ký tự thì rủi ro thấp, vẫn nên khóa cho chắc).
serial_lock = threading.Lock()
ser = None


def connect_serial():
    """Mở (hoặc mở lại) cổng Serial. Trả về True nếu thành công."""
    global ser
    try:
        ser = serial.Serial(COM_PORT, BAUD_RATE, timeout=1)
        time.sleep(2)  # Chờ Arduino khởi động lại sau khi mở cổng Serial
        print(f"Da ket noi voi Arduino tren cong {COM_PORT}")
        return True
    except Exception as e:
        print(f"Loi ket noi USB: {e}")
        ser = None
        return False


# FIX-USB-04: Không sys.exit(1) ngay khi khởi động thất bại — vẫn chạy server
# và trả lỗi rõ ràng (503) cho main.mjs, thay vì làm cả tiến trình chết hẳn.
# Điều này cho phép bạn cắm lại dây USB và gọi /reconnect mà không cần khởi
# động lại toàn bộ server.
if not connect_serial():
    print("Canh bao: server van chay nhung chua co ket noi Serial. Goi /reconnect sau khi cam day USB.")


@app.route('/control', methods=['POST'])
def control_robot():
    global ser

    data = request.get_json(silent=True) or {}
    action = data.get('action', '')

    command_map = {
        'forward': 'W',
        'backward': 'S',
        'left': 'A',
        'right': 'D',
        'stop': 'Q',
    }
    # FIX-USB-05: action lạ/không hợp lệ -> mặc định về Stop (an toàn) thay vì
    # để command rỗng gửi xuống Serial (bản gốc default 'Q' cũng đúng, giữ
    # nguyên tinh thần này nhưng rõ ràng hơn qua dict).
    command = command_map.get(action, 'Q')

    with serial_lock:
        if ser is None or not ser.is_open:
            return jsonify({"status": "error", "error": "Serial port chua san sang"}), 503

        # FIX-USB-06: bọc try/except quanh ser.write(). Bản gốc không có gì
        # ở đây -> nếu rút dây USB đúng lúc gửi lệnh, Flask sẽ ném lỗi 500
        # "trần" (leak traceback) và không có cơ hội để robot nhận lệnh dừng
        # khẩn cấp nào khác. Giờ trả lỗi 503 rõ ràng để main.mjs biết mà xử lý
        # (vd hiển thị "Robot mat ket noi" cho người dùng).
        try:
            ser.write(command.encode('utf-8'))
        except serial.SerialException as e:
            print(f"Loi ghi Serial (co the da rut day): {e}")
            ser = None
            return jsonify({"status": "error", "error": f"Serial write failed: {e}"}), 503

    return jsonify({"status": "ok", "sent": command})


@app.route('/reconnect', methods=['POST'])
def reconnect():
    """Gọi endpoint này sau khi cắm lại dây USB để mở lại cổng Serial."""
    with serial_lock:
        ok = connect_serial()
    return jsonify({"status": "ok" if ok else "error", "connected": ok})


@app.route('/health', methods=['GET'])
def health():
    return jsonify({"status": "ok", "serial_connected": bool(ser and ser.is_open)})


if __name__ == '__main__':
    # Chạy Server ở cổng 5000
    # FIX-USB-07: threaded=True để Flask không bị nghẽn 1 request tại 1 thời
    # điểm — quan trọng vì WASD có thể bắn nhiều request gần như đồng thời
    # (VD giữ W rồi bấm nhanh A).
    print("Dang chay USB Server tai http://localhost:5000")
    app.run(host='0.0.0.0', port=5000, threaded=True)
