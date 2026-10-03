# 🔬 Báo Cáo Kiểm Thử (QA Report) — myiris
**Ngày:** 2026-07-21 | **QA Engineer:** Antigravity AI  
**Phạm vi:** 3 module mới — Robot Cameras, Hand Gesture Control, Mobile Companion App

---

## 📋 TÓM TẮT ĐIỀU HÀNH

| Module | Trạng thái | Độ nghiêm trọng lỗi phát hiện |
|--------|-----------|-------------------------------|
| 1. Camera Robot | ⚠️ Có rủi ro | MEDIUM |
| 2. Điều khiển cử chỉ | 🔴 Có lỗ hổng nghiêm trọng | HIGH |
| 3. Mobile Companion | 🔴 Còn thiếu hàng loạt tính năng | HIGH |

---

## MODULE 1: CAMERA ROBOT (RobotCameras.tsx + robots.json)

### 🔍 Phân tích mã nguồn

**Luồng dữ liệu:**
```
robots.json (disk)
  → getRobotsConfig() [main.mjs:172]        ← đọc đồng bộ (sync), parse JSON, try/catch ✅
  → ipcMain.handle("robots:get") [line 2887]
  → preload: getRobots() → ipcRenderer.invoke("robots:get")
  → RobotCameras.tsx: window.iris.getRobots().then(setRobots)
  → render grid → <img src={imgUrl} />
```

**Cơ chế chống cache:**
```tsx
const imgUrl = config.camera_url
  ? `${config.camera_url}${config.camera_url.includes('?') ? '&' : '?'}ts=${tick}`
  : "";
// tick tăng mỗi 4 giây → URL thay đổi → browser fetch lại ảnh
```

**Error handling khi ảnh lỗi:**
```tsx
onError={(e) => {
  e.currentTarget.style.display = "none";
  const errDiv = e.currentTarget.parentElement?.querySelector('.err-msg') as HTMLElement;
  if (errDiv) errDiv.style.display = 'block';
}}
```

### 🐛 Bugs & Rủi Ro Phát Hiện

#### BUG-CAM-01: `getRobotsConfig()` đọc đĩa mỗi lần gọi (không cache)
- **File:** `electron/main.mjs:172`
- **Mức độ:** LOW
- **Mô tả:** Hàm này bị gọi tại nhiều điểm (lines 202, 223, 1915, 1956, 2887). Mỗi lần gọi là một `fs.readFileSync` + `JSON.parse`. Với robot vision loop chạy hàng giây, đây là disk I/O lãng phí.
- **Gợi ý fix:**
```js
// Thêm cache đơn giản với invalidation
let _robotsCache = null;
let _robotsCacheTime = 0;
function getRobotsConfig() {
  if (_robotsCache && Date.now() - _robotsCacheTime < 5000) return _robotsCache;
  // ... đọc file ...
  _robotsCache = parsed.robots || {};
  _robotsCacheTime = Date.now();
  return _robotsCache;
}
```

#### BUG-CAM-02: `err-msg` div không reset khi tick thay đổi
- **File:** `src/components/RobotCameras.tsx:54-58`
- **Mức độ:** MEDIUM
- **Mô tả:** Khi ảnh lỗi, `onError` ẩn `<img>` và hiện `err-msg`. Khi tick thay đổi (URL mới), React **không re-mount** `<img>` — nó chỉ cập nhật `src`. Điều này có nghĩa là nếu URL trở lại hợp lệ sau một lúc, ảnh sẽ không tự hiện lại vì `style.display = "none"` đã được set thủ công vào DOM.
- **Gợi ý fix:** Dùng React state thay vì DOM mutation trực tiếp:
```tsx
const [imgError, setImgError] = useState(false);
// Reset mỗi khi tick thay đổi để retry
useEffect(() => setImgError(false), [tick]);
// ...
{!imgError && config.camera_url && (
  <img src={imgUrl} onError={() => setImgError(true)} ... />
)}
{imgError && <div>Không thể tải Camera...</div>}
```

#### BUG-CAM-03: Cấu hình rỗng `robots.json` — Behavior không nhất quán
- **File:** `electron/main.mjs:172-196`
- **Mức độ:** LOW
- **Mô tả:** Khi file `robots.json` không tồn tại, hệ thống **tự động tạo** file với robot demo `robodog` trỏ đến IP `192.168.1.100`. Người dùng sẽ thấy 1 robot trong grid nhưng camera sẽ fail load (IP giả). Đây là UX khó hiểu.
- **Gợi ý:** Nên trả về `{}` (empty) nếu file không tồn tại, không tự tạo file demo.

#### BUG-CAM-04: `token` trong `robots.json` không bao giờ được dùng trong UI
- **File:** `src/components/RobotCameras.tsx`
- **Mức độ:** INFO
- **Mô tả:** Field `token` có trong cấu hình nhưng camera fetch trong UI (`<img src>`) không gửi header Authorization. Camera có bảo vệ auth sẽ fail với 401. Chỉ robot vision loop trong main.mjs (`fetch(url)`) cũng không gửi token.

---

### ✅ Test Cases — Module 1 (Thực hiện thủ công)

**Setup:** App đang chạy (`npm run dev`), `robots.json` đã có trong thư mục gốc.

#### TC-CAM-01: Test Happy Path — Camera hợp lệ
1. Mở `robots.json`, sửa `camera_url` thành URL ảnh JPEG thật (VD: `http://192.168.1.x/snap.jpg`)
2. Nhấn **Alt + R** để mở Robot Cameras panel
3. **Expect:** Grid hiển thị card robot "RoboDog", ảnh tải được
4. Chờ 4 giây → **Expect:** Ảnh refresh tự động (URL có `?ts=1`, `?ts=2`...)
5. Mở DevTools (F12) → Network tab → filter `snap.jpg` → **Verify:** Mỗi 4s có 1 request mới

#### TC-CAM-02: Test Empty Config
1. Xóa hoặc sửa `robots.json` thành `{ "robots": {} }`
2. Đóng và mở lại panel (Alt + R)
3. **Expect:** Thấy message "Chưa có cấu hình robot nào..."

#### TC-CAM-03: Test Malformed JSON
1. Sửa `robots.json` thành text không hợp lệ (`{ invalid json`)
2. Nhấn Alt + R
3. **Expect:** Panel mở bình thường, grid rỗng (không crash app)
4. Kiểm tra terminal → **Expect:** Log "Failed to parse robots.json:"

#### TC-CAM-04: Test URL không hợp lệ / Camera offline
1. Để `camera_url` trỏ đến IP không tồn tại
2. Nhấn Alt + R
3. **Expect:** Ảnh fail → hiện "Không thể tải Camera..." ⚠️ **[BUG-CAM-02 có thể fail TC này]**
4. Sửa URL thành URL hợp lệ (không reload app), đợi 4s
5. **Expect:** Ảnh xuất hiện lại ← **Hiện tại: FAIL do BUG-CAM-02**

#### TC-CAM-05: Test Camera URL có query string sẵn
1. Sửa `camera_url` thành `http://192.168.1.x/snap.jpg?auth=abc`
2. Nhấn Alt + R
3. **Expect:** URL tạo ra là `http://192.168.1.x/snap.jpg?auth=abc&ts=0` (dùng `&`, không phải `?`)

---

## MODULE 2: ĐIỀU KHIỂN CỬ CHỈ (useHandControl.ts + main.mjs)

### 🔍 Phân tích mã nguồn

**Luồng dữ liệu:**
```
Webcam → MediaPipe GestureRecognizer (GPU, 60fps rAF loop)
  → stabilizeGesture() [3-frame buffer]
  → setState() → App.tsx useEffect [hand state dependencies]
  → trigger() [1s debounce per gesture name]
  → window.iris.sendHandGesture(gesture) [preload.cjs:89]
  → ipcRenderer.send("iris:hand-gesture", gesture)
  → ipcMain.on("iris:hand-gesture") [main.mjs:2977]
  → @nut-tree-fork/nut-js: keyboard/mouse actions
```

**Bảng mapping cử chỉ → hành động:**
| Cử chỉ (Frontend) | Tín hiệu IPC | Hành động (nut-js) |
|---|---|---|
| `hand.shush` | — | `audio.toggleMute()` (local, không qua IPC) |
| `hand.pinch` | `"pinch"` | minimize/restore mainWindow |
| `hand.swipe` → left/right | `"swipe_left"/"swipe_right"` | Alt+Shift+Tab / Alt+Tab |
| `hand.zoom` → in/out | `"zoom_in"/"zoom_out"` | Ctrl+= / Ctrl+- |
| `Thumb_Up` | `"thumb_up"` | Windows Key (Super) |
| `Thumb_Down` | `"thumb_down"` | Alt+F4 |
| `Victory` | `"victory"` | Win+D (show desktop) |
| `hand.grab` | `{type:"grab", x, y}` | mouse pressButton LEFT |
| release grab | `{type:"release"}` | mouse releaseButton LEFT |

### 🐛 Bugs & Rủi Ro Phát Hiện

#### BUG-HAND-01: 🔴 **CRITICAL** — Key Stuck Risk trong Grab/Release
- **File:** `src/App.tsx:819-829`, `electron/main.mjs:3016-3028`
- **Mức độ:** HIGH
- **Mô tả:** Logic grab/release rất fragile:
  1. Grab đang active (`global.isGrabbing = true`, mouse button đang giữ)
  2. User đóng app hoặc hand tracking bị mất tín hiệu
  3. `release` event **không bao giờ được gửi** → **chuột bị kẹt ở trạng thái giữ phím**
  4. User phải click thủ công để reset
- **Thêm nữa:** Trong App.tsx line 821:
```tsx
} else if (!hand.grab && lastGestureRef.current?.name === "grab") {
  window.iris.sendHandGesture({ type: "release" });
```
Nếu `useEffect` cleanup chạy trong khi đang grab (component unmount), release không được gọi.

- **Gợi ý fix:**
```js
// main.mjs: Thêm cleanup khi app quit
app.on('before-quit', async () => {
  if (global.isGrabbing) {
    try {
      const { mouse, Button } = await import("@nut-tree-fork/nut-js");
      await mouse.releaseButton(Button.LEFT);
      global.isGrabbing = false;
    } catch {}
  }
});
```

#### BUG-HAND-02: 🔴 **CRITICAL** — Thumb_Down = Alt+F4: Quá nguy hiểm
- **File:** `electron/main.mjs:3008-3010`
- **Mức độ:** HIGH
- **Mô tả:** `Thumb_Down` → `Alt+F4` sẽ **đóng cửa sổ đang active** (bất kỳ app nào đang focused). Nếu người dùng đang dùng app quan trọng (text editor, IDE) và vô tình làm cử chỉ Thumb_Down → **mất dữ liệu**.
- Debounce 1 giây là không đủ để ngăn accidental trigger.
- **Gợi ý:** Yêu cầu xác nhận hoặc hold gesture ≥ 2 giây cho gestures phá hoại.

#### BUG-HAND-03: Gesture `Thumb_Up` → Win Key quá mơ hồ
- **File:** `electron/main.mjs:3005-3006`
- **Mức độ:** MEDIUM
- **Mô tả:** `pressKey(Key.LeftSuper) + releaseKey(Key.LeftSuper)` mở Start Menu trên Windows. Trigger không mong muốn khi MediaPipe nhận diện sai Pointing_Up thành Thumb_Up (2 gestures khó phân biệt).

#### BUG-HAND-04: Debounce dùng `lastGestureRef.current` không thread-safe với grab
- **File:** `src/App.tsx:793-829`
- **Mức độ:** MEDIUM
- **Mô tả:** `lastGestureRef` bị dùng cho cả 2 mục đích: debounce gesture thông thường VÀ track grab state. Lines 827-829 ghi đè ref khi grab, có thể làm hỏng debounce logic của gestures khác:
```tsx
// Line 821: release ghi "release" vào ref
lastGestureRef.current = { name: "release", time: now };
// Line 827: grab ghi "grab" vào ref  
lastGestureRef.current = { name: "grab", time: now };
// Conflict: nếu swipe xảy ra đồng thời, debounce sẽ so sánh sai
```

#### BUG-HAND-05: nut-js `import()` động mỗi lần gọi — Latency
- **File:** `electron/main.mjs:2985, 2996, 3000, 3004, 3008, 3012, 3016`
- **Mức độ:** LOW-MEDIUM
- **Mô tả:** Mỗi gesture branch có `await import("@nut-tree-fork/nut-js")`. Lần đầu import (~50-200ms). Node.js cache module nên các lần sau nhanh hơn, nhưng `await import()` vẫn là overhead không cần thiết khi gọi nhiều lần/giây.
- **Gợi ý:**
```js
// Pre-import một lần khi app start
let _nutJs = null;
async function getNutJs() {
  if (!_nutJs) _nutJs = await import("@nut-tree-fork/nut-js");
  return _nutJs;
}
```

---

### ✅ Test Cases — Module 2 (Thực hiện thủ công)

**Setup:** App chạy, đang ở trạng thái Wake (W), hand tracking enabled.

#### TC-HAND-01: Test Shush (Mute Mic)
1. Giơ tay trước camera, giữ ngón trỏ chỉ lên (Pointing_Up)
2. Di chuyển ngón trỏ vào vùng giữa màn hình, Y < 40% chiều cao
3. **Expect:** Mic mute indicator bật trong UI
4. Lặp lại → **Expect:** Mic unmute
5. Kiểm tra: Shush không gửi IPC (chỉ xử lý local) → mở DevTools, không thấy "iris:hand-gesture" event

#### TC-HAND-02: Test Pinch (Minimize Window)
1. Dùng 2 tay, cả 2 tay pinch (ngón cái + trỏ chạm nhau)
2. **Expect:** App minimize
3. Restore app, pinch lại → **Expect:** App restore
4. **Verify timing:** Gesture phải hold ≥ 3 frames (~100ms) trước khi trigger

#### TC-HAND-03: Test Swipe
1. Mở tay (Open_Palm), swipe nhanh sang phải (>40% width trong <500ms)
2. **Expect:** Alt+Tab (app switcher xuất hiện)
3. Swipe sang trái → **Expect:** Alt+Shift+Tab (reverse app switch)

#### TC-HAND-04: 🔴 Test Thumb Down — Danger Test
1. **CẢNH BÁO:** Lưu tất cả file đang mở trước khi test
2. Focus vào 1 app không quan trọng (VD: Notepad)
3. Làm cử chỉ Thumb_Down trước camera
4. **Expect:** Notepad bị đóng (Alt+F4)
5. Verify debounce: Làm Thumb_Down liên tục, đảm bảo chỉ trigger 1 lần mỗi 1 giây

#### TC-HAND-05: 🔴 Test Grab/Release — Key Stuck
1. Làm cử chỉ Closed_Fist để grab
2. **Verify:** Mouse button LEFT đang giữ (thử drag một file)
3. Thả tay → **Expect:** Mouse button release, drag kết thúc
4. **Stress test:** Mở tay đột ngột (làm mất tracking), kiểm tra chuột có bị stuck không
5. **Kill hand tracking** (tắt camera permission) khi đang grab → **Expect:** Mouse tự release (hiện tại FAIL — BUG-HAND-01)

#### TC-HAND-06: Test Latency Gesture → Action
1. Dùng stopwatch để đo thời gian từ khi làm cử chỉ đến khi action xảy ra
2. **Target:** < 300ms tổng (mediapipe ~16ms/frame + 3-frame stabilize ~50ms + IPC ~5ms + nut-js ~10ms)
3. **Expect:** < 200ms trong điều kiện tốt

---

## MODULE 3: MOBILE COMPANION APP

### 🔍 Phân tích mã nguồn

**Luồng dữ liệu — Camera/Video:**
```
iris-companion/App.js (Expo/React Native)
  → setInterval(1000ms): cameraRef.takePictureAsync() → base64 JPEG
  → wsRef.send(JSON.stringify({ type: "frame", data: base64 }))
  → WebSocket ws://[ip]:8080
  → companion-server.mjs: ws.on("message")
  → JSON.parse → type === "frame"
  → mainWindow.webContents.send("companion:frame", parsed.data)
  → [Renderer lắng nghe "companion:frame"?] ← CẦN KIỂM TRA
```

**Luồng dữ liệu — Audio:**
```
iris-companion/App.js
  → Audio.Recording (expo-av, LOW_QUALITY preset)
  → [CHƯA IMPLEMENT: không stream PCM realtime]
  → companion-server.mjs: ws.on("message") + Buffer check
  → sendAudioChunk(message)
  → main.mjs: ipcMain.on("live:audio") → sendAudioChunk(chunk) → Gemini Live
```

### 🐛 Bugs & Rủi Ro Phát Hiện

#### BUG-COMP-01: 🔴 **CRITICAL** — Audio KHÔNG được streaming realtime
- **File:** `iris-companion/App.js:83-97`
- **Mức độ:** HIGH — **Tính năng chưa hoàn thiện**
- **Mô tả:** App dùng `Audio.Recording.createAsync()` nhưng **không có code stream audio buffer qua WebSocket**. Recordings chỉ được lưu vào file. Comment trong code tự thừa nhận:
```js
// In a real production app, we would use react-native-live-audio-stream 
// to stream PCM chunks directly. For this demo, we'll keep it simple.
```
- Audio sẽ **không bao giờ đến** Gemini Live qua luồng này.

#### BUG-COMP-02: 🔴 **CRITICAL** — Thiếu Renderer listener cho `companion:frame`
- **File:** `companion-server.mjs:22`, `electron/main.mjs`, `src/App.tsx`
- **Mức độ:** HIGH
- **Mô tả:** Server gửi `mainWindow.webContents.send("companion:frame", parsed.data)` nhưng trong `preload.cjs` và `src/App.tsx` **không có handler nào lắng nghe** event `"companion:frame"`. Video frames từ điện thoại gửi lên sẽ bị **silently dropped**.

#### BUG-COMP-03: WebSocket Server không hỗ trợ nhiều connection đồng thời
- **File:** `electron/companion-server.mjs:4, 15`
- **Mức độ:** MEDIUM
- **Mô tả:** `activeConnection` là biến đơn lẻ. Nếu 2 điện thoại kết nối, connection cũ bị ghi đè. Không có logic reject connection thứ 2 hoặc thông báo cho client.

#### BUG-COMP-04: expoProcess không có error handling đầy đủ
- **File:** `electron/main.mjs:2901-2916`
- **Mức độ:** MEDIUM
- **Mô tả:** `expoProcess` spawn với `detached: true` và `unref()` — process con hoàn toàn tách biệt. Nếu `npx expo start` fail (không có `node_modules`, port 8081 bị chiếm...), không có notification nào đến UI.

#### BUG-COMP-05: `expoProcess` không được cleanup khi app quit
- **File:** `electron/main.mjs:2901-2916`
- **Mức độ:** MEDIUM
- **Mô tả:** `detached: true` + `unref()` → Expo process tiếp tục chạy ngầm dù app Electron đã đóng. Gây ra port 8081 bị chiếm ở lần chạy sau.

#### BUG-COMP-06: QR Code URL cứng port 8081 có thể sai
- **File:** `src/components/CompanionQR.tsx:18`
- **Mức độ:** LOW
- **Mô tả:** `exp://${ip}:8081` — port 8081 là default của Expo nhưng không được verify thực tế. Nếu port bị thay đổi hoặc Expo Metro dùng port khác, QR sẽ sai.

#### BUG-COMP-07: Audio từ companion server gọi `sendAudioChunk(message)` với raw Buffer
- **File:** `electron/companion-server.mjs:26`
- **Mức độ:** MEDIUM
- **Mô tả:** `sendAudioChunk` trong main.mjs được thiết kế nhận PCM 16kHz. Nhưng `expo-av` không stream PCM — nó tạo file audio (AAC/MP3). Nếu buffer binary từ phone được truyền vào Gemini Live, format không tương thích → có thể gây crash hoặc noise.

---

### ✅ Test Cases — Module 3 (Thực hiện thủ công)

**Setup:** Điện thoại và máy tính cùng mạng WiFi, Expo Go đã cài trên điện thoại.

#### TC-COMP-01: Test Khởi động Expo qua Alt+Q
1. Nhấn **Alt + Q** để mở CompanionQR panel
2. **Expect:** Hiện "Đang khởi động Expo..."
3. Sau vài giây → **Expect:** QR code xuất hiện
4. Mở terminal, chạy: `tasklist | findstr node` → **Verify:** Expo process đang chạy
5. Đóng app Iris, kiểm tra lại `tasklist` → **Check BUG-COMP-05:** Expo vẫn chạy?

#### TC-COMP-02: Test Kết nối WebSocket từ điện thoại
1. Lấy IP máy tính (hiển thị trong QR)
2. Mở Expo Go → quét QR
3. Nhập IP vào app companion, nhấn **CONNECT TO IRIS**
4. **Expect:** Desktop log hiện "Mobile Companion App connected!"
5. Ngắt kết nối → **Expect:** Desktop log hiện "Mobile Companion App disconnected."

#### TC-COMP-03: 🔴 Test Video Frame — Expect FAIL
1. Kết nối thành công như TC-COMP-02
2. Mở DevTools trên desktop (F12), kiểm tra console
3. **Expect (hiện tại FAIL):** Không có event "companion:frame" được xử lý do BUG-COMP-02
4. Workaround: Thêm tạm thời vào `preload.cjs`:
```js
ipcRenderer.on("companion:frame", (_, data) => console.log("Frame received:", data?.length));
```

#### TC-COMP-04: Test Audio Stream — Expect FAIL
1. Kết nối companion app
2. Nói vào microphone điện thoại
3. Kiểm tra Gemini Live có nhận audio không
4. **Expect (hiện tại FAIL):** Audio không được stream do BUG-COMP-01

#### TC-COMP-05: Test Multiple Connections
1. Kết nối điện thoại thứ nhất → **Verify:** Kết nối bình thường
2. Kết nối điện thoại thứ hai → **Check BUG-COMP-03:** Phone 1 bị drop silently?
3. **Expect behavior tốt:** Server reject phone 2 hoặc thông báo "Already connected"

#### TC-COMP-06: Test IP Detection
1. Nhấn Alt+Q
2. Kiểm tra IP trong QR code khớp với `ipconfig` → `IPv4 Address` trên máy tính
3. Trường hợp có nhiều network adapters (VPN, virtual adapters) → **Verify:** IP đúng adapter

---

## 📋 DANH SÁCH BUG ƯU TIÊN FIX

| Priority | Bug ID | Module | Mô tả ngắn | Effort |
|----------|--------|--------|-----------|--------|
| 🔴 P0 | BUG-HAND-01 | Hand Gesture | Key/Mouse stuck khi app đóng giữa grab | 1h |
| 🔴 P0 | BUG-COMP-01 | Companion | Audio không stream realtime từ phone | 3-5h |
| 🔴 P0 | BUG-COMP-02 | Companion | companion:frame không có Renderer handler | 30m |
| 🔴 P1 | BUG-HAND-02 | Hand Gesture | Thumb_Down = Alt+F4 có thể đóng app sai | 30m |
| 🟡 P2 | BUG-CAM-02 | Camera | img không hiện lại sau khi offline→online | 30m |
| 🟡 P2 | BUG-HAND-04 | Hand Gesture | lastGestureRef conflict grab vs debounce | 1h |
| 🟡 P2 | BUG-COMP-04 | Companion | Expo process fail silently | 1h |
| 🟡 P2 | BUG-COMP-05 | Companion | Expo process zombie sau khi Iris đóng | 30m |
| 🔵 P3 | BUG-CAM-01 | Camera | getRobotsConfig() disk I/O mỗi lần gọi | 30m |
| 🔵 P3 | BUG-HAND-05 | Hand Gesture | nut-js import() dynamic mỗi gesture | 30m |
| 🔵 P3 | BUG-COMP-03 | Companion | Server không handle multiple connections | 1h |

---

## 🔧 QUICK FIXES — Code Snippets Sẵn Sàng Dùng

### Fix BUG-COMP-02: Thêm companion:frame listener vào preload.cjs
```js
// Thêm vào preload.cjs trong contextBridge.exposeInMainWorld
onCompanionFrame: (callback) => {
  const handler = (_event, data) => callback(data);
  ipcRenderer.on("companion:frame", handler);
  return () => ipcRenderer.removeListener("companion:frame", handler);
},
```

### Fix BUG-HAND-01: Cleanup mouse trước khi quit
```js
// Thêm vào electron/main.mjs
app.on('before-quit', async () => {
  if (global.isGrabbing) {
    try {
      const { mouse, Button } = await import("@nut-tree-fork/nut-js");
      await mouse.releaseButton(Button.LEFT);
      global.isGrabbing = false;
    } catch (e) { /* ignore */ }
  }
});
```

### Fix BUG-CAM-02: img retry khi tick thay đổi (RobotCameras.tsx)
```tsx
// Thay thế local state imgError boolean bằng per-robot map
const [imgErrors, setImgErrors] = useState<Record<string, boolean>>({});
// Reset khi tick thay đổi
useEffect(() => setImgErrors({}), [tick]);
// Trong render:
{!imgErrors[id] && config.camera_url && (
  <img 
    src={imgUrl} 
    onError={() => setImgErrors(prev => ({ ...prev, [id]: true }))}
    ...
  />
)}
```

### Fix BUG-COMP-05: Kill expoProcess khi app quit
```js
// Thêm vào electron/main.mjs trong app.on('before-quit')
if (expoProcess && !expoProcess.killed) {
  expoProcess.kill();
}
```
> **Lưu ý:** Vì `expoProcess.unref()` đã được gọi, bạn cần giữ reference ở scope ngoài handler.

---

*Báo cáo được tạo bởi Antigravity AI — QA Review Session 2026-07-21*
