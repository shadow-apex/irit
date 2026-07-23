import express from 'express';
import mqtt from 'mqtt';

const app = express();
app.use(express.json());

// ==== CẤU HÌNH ====
const MQTT_BROKER = 'mqtt://broker.emqx.io';
// NHỚ SỬA LẠI TOPIC GIỐNG VỚI TOPIC BẠN ĐÃ ĐẶT TRÊN WOKWI NHÉ
const mqtt_topic = 'nhacuaban/phongkhach/den1';
const PORT = 5001;

// ==== KẾT NỐI MQTT ====
const client = mqtt.connect(MQTT_BROKER);

let mqttConnected = false;

client.on('connect', () => {
  mqttConnected = true;
  console.log('✅ Đã kết nối thành công tới MQTT Broker!');
});

// QUAN TRỌNG: bản gốc thiếu xử lý lỗi kết nối MQTT.
// Nếu không có đoạn này, khi broker rớt mạng hoặc không kết nối được,
// server vẫn "chạy" bình thường nhưng publish sẽ không đi đâu cả
// mà không có log nào báo cho bạn biết.
client.on('error', (err) => {
  console.error('❌ Lỗi kết nối MQTT:', err.message);
});

client.on('reconnect', () => {
  console.log('🔄 Đang thử kết nối lại MQTT...');
});

client.on('close', () => {
  mqttConnected = false;
  console.log('⚠️ Mất kết nối MQTT Broker.');
});

// ==== API ĐỂ IRIS GỌI ====
app.post('/control', (req, res) => {
  const action = req.body?.action;
  const device = req.body?.device; // Đọc thêm tên thiết bị từ JSON body
  
  console.log(`📩 Iris vừa gửi lệnh: action=${action}, device=${device}`);

  // Kiểm tra MQTT có đang kết nối không trước khi publish
  if (!mqttConnected) {
    console.warn('⚠️ MQTT chưa kết nối, không thể gửi lệnh lúc này.');
    return res.status(503).json({
      status: 'error',
      message: 'Chưa kết nối được tới MQTT Broker, thử lại sau.',
    });
  }

  // FIX-SMARTHOME-02: Xử lý linh động MQTT topic theo tên thiết bị (device).
  // Hey Claude, please review this slugification logic. We normalize Vietnamese 
  // characters and replace spaces with underscores so we can support multiple devices.
  let target_topic = mqtt_topic; // Fallback về topic mặc định
  if (device) {
    // Ví dụ: "Đèn phòng khách" -> "den_phong_khach"
    const slug = device.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/ /g, '_');
    target_topic = `nhacuaban/phongkhach/${slug}`;
  }

  // Phiên dịch lệnh của Iris thành tin nhắn MQTT
  if (action === 'turn_on') {
    client.publish(target_topic, 'ON', (err) => {
      if (err) {
        console.error('❌ Publish lỗi:', err.message);
        return res.status(500).json({ status: 'error', message: 'Gửi lệnh thất bại' });
      }
      res.json({ status: 'success', message: `Đã bật ${device || 'thiết bị Wokwi'}` });
    });
  } else if (action === 'turn_off') {
    client.publish(target_topic, 'OFF', (err) => {
      if (err) {
        console.error('❌ Publish lỗi:', err.message);
        return res.status(500).json({ status: 'error', message: 'Gửi lệnh thất bại' });
      }
      res.json({ status: 'success', message: `Đã tắt ${device || 'thiết bị Wokwi'}` });
    });
  } else {
    // Bản gốc trả về status "success" cho lệnh không xác định — dễ gây hiểu lầm
    // là lệnh đã chạy thành công. Sửa lại thành lỗi 400 cho đúng bản chất.
    res.status(400).json({ status: 'error', message: `Lệnh không xác định: ${action}` });
  }
});

// Endpoint kiểm tra nhanh server + trạng thái MQTT còn sống không
app.get('/health', (req, res) => {
  res.json({
    server: 'ok',
    mqtt_connected: mqttConnected,
    broker: MQTT_BROKER,
    topic: mqtt_topic,
  });
});

app.listen(PORT, () => {
  console.log(`🤖 Cầu nối Iris -> Wokwi đang chạy ở http://localhost:${PORT}`);
});
