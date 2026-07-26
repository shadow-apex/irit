# 5 nâng cấp mới cho Iris

Tài liệu này mô tả 5 tính năng vừa được thêm vào dự án, cách cài đặt, và
các câu lệnh giọng nói mẫu để thử.

> Lưu ý: các thay đổi này được viết và kiểm tra cú pháp (`node --check`)
> trong môi trường không có màn hình / thiết bị thật, nên **chưa chạy thử
> được toàn bộ ứng dụng Electron thật**. Hãy `npm install` rồi chạy thử ở
> máy của bạn; nếu gặp lỗi khi chạy thật, gửi lại log để mình sửa tiếp.

## 1. Điều khiển máy tính đầy đủ bằng giọng nói (đã có sẵn phần lớn, nay bọc thêm)

Repo đã có sẵn `electron/computer-session.mjs` — một agent loop dùng Claude
Computer Use + `nut.js` để tự lái chuột/bàn phím/đọc màn hình, gọi qua tool
`start_computer_use_task`. Phần mới thêm:

- Chạy qua **"computer" lane** (xem mục 3) thay vì bắn-và-quên trần trụi:
  nếu bạn nhờ Iris điều khiển máy tính lúc nó đang làm việc đó rồi, lệnh mới
  sẽ tự xếp hàng thay vì làm hai phiên tranh nhau con chuột.
- Tool mới `get_action_status(action_id)` — hỏi "phiên điều khiển máy tính
  đó xong chưa" bất cứ lúc nào.
- Tool mới `stop_action(action_id)` — yêu cầu dừng một phiên đang chạy.

**Thử nói:** *"Mở Notepad và gõ giúp tôi ghi chú này"* → Iris trả lời ngay
"đã bắt đầu, đang chạy nền", rồi tự làm trong khi bạn tiếp tục nói chuyện.

## 2. Trình duyệt tự hành (Browser Agent) — MỚI

File mới: `electron/browser-agent.mjs`, dùng
[Playwright](https://playwright.dev/) để điều khiển một tab Chromium riêng —
nhanh và chính xác hơn nhiều so với việc dùng Computer Use để rê chuột trên
màn hình, vì thao tác trực tiếp trên DOM của trang.

Các tool mới Iris có thể gọi: `browser_open`, `browser_click`,
`browser_type`, `browser_extract_text`, `browser_screenshot`,
`browser_close`.

**Cài đặt (bắt buộc, 1 lần):**
```bash
npm install
npx playwright install chromium
```

**Thử nói:**
- *"Mở trang vnexpress.net cho tôi"*
- *"Đọc cho tôi nghe nội dung trang này"*
- *"Click vào nút đăng nhập"*
- *"Gõ 'áo khoác nam' vào ô tìm kiếm rồi Enter"*

Nếu chưa `npx playwright install chromium`, Iris sẽ báo lỗi rõ ràng thay vì
crash, kèm hướng dẫn chạy lệnh đó.

## 3. Đa nhiệm song song (Action Lanes) — MỚI

File mới: `electron/action-lane.mjs`. Trước đây MỌI việc gửi qua
`submit_claude_task` (PO/DEV/plain Claude) chạy **tuần tự, một việc một
lúc** — đây là thiết kế đúng cho việc code (giữ được `--resume` phiên làm
việc), nhưng có nghĩa nếu Claude đang bận code một task dài, các việc khác
phải chờ.

Nay các việc "nhanh" (điều khiển máy tính, trình duyệt, nhà thông minh)
chạy trong các **lane riêng, độc lập với hàng đợi của Claude** và độc lập
với nhau — mỗi lane có giới hạn đồng thời riêng để tránh xung đột (ví dụ:
tối đa 1 phiên điều khiển máy tính cùng lúc, để hai phiên không tranh
chuột):

| Lane | Giới hạn đồng thời | Dùng cho |
|---|---|---|
| `computer` | 1 | Computer Use (mục 1) |
| `browser` | 2 | Browser Agent (mục 2) |
| `smarthome` | 5 | Automation nhà thông minh (mục 5) |

Tool mới `get_iris_status` — hỏi *"Iris đang làm gì vậy"* để xem tất cả
việc đang chạy nền trên mọi lane cùng lúc, cộng với trạng thái chế độ im
lặng.

**Kết quả thực tế:** bạn có thể nhờ Claude viết code một tính năng dài
(chạy trong hàng đợi Claude), rồi ngay sau đó nhờ Iris "tắt đèn phòng
khách" hoặc "mở Google cho tôi" — hai việc này **không phải chờ** task code
kia chạy xong.

## 4. Chế độ im lặng / thì thầm (Silent Mode) — MỚI

Khi bật, Iris **vẫn nghe** (mic không tắt) và **vẫn trả lời** (chữ vẫn hiện
trong khung Comms như bình thường) — chỉ là **không phát tiếng ra loa**.
Khác với nút mute cũ (tắt mic), đây là mute chiều ngược lại: tắt tiếng nói
ra của Iris.

Cách hoạt động: audio phát ra được dẫn qua một `GainNode` trong
`src/hooks/useAudioPipeline.ts`; khi silent mode bật, gain = 0. `main.mjs`
phát sự kiện `iris:silent-mode` qua Electron IPC (`electron/preload.cjs` →
`window.iris.onSilentModeChange`), `src/App.tsx` lắng nghe và gọi
`audio.setSilentOutput(enabled)`.

Tool mới cho Gemini: `set_silent_mode({ enabled })`.

**Thử nói:**
- *"Im lặng thôi, đừng nói to"* → Iris chuyển sang chỉ trả lời bằng chữ.
- *"Nói bình thường lại đi"* → tắt chế độ im lặng.

## 5. Tự động hoá nhà thông minh bằng ngôn ngữ tự nhiên — MỚI

File mới: `electron/smarthome-rules.mjs`. Trước đây, `trigger_smart_home` chỉ
làm được lệnh tức thời ("bật đèn ngay bây giờ"). Nay bạn có thể tạo
**automation đứng yên** (rule), Iris tự dịch câu nói của bạn thành cấu trúc
`{trigger, condition, action}` và lưu vào `~/.iris/smarthome-rules.json`.
Một vòng lặp chạy mỗi 20 giây (độc lập với hội thoại) sẽ tự kiểm tra và
kích hoạt rule khi tới hạn, gọi lại đúng cơ chế `triggerSmartHome` sẵn có —
không có protocol thiết bị mới nào được thêm.

Hai loại trigger được hỗ trợ:
- `time`: giờ cố định mỗi ngày, ví dụ `{ type: "time", at: "22:00" }`
- `interval`: lặp mỗi N phút, ví dụ `{ type: "interval", every_minutes: 30 }`

Có thể giới hạn theo thứ trong tuần: `condition: { type: "day_of_week", days: ["mon","tue","wed","thu","fri"] }`.

Tool mới cho Gemini: `create_smarthome_rule`, `list_smarthome_rules`,
`delete_smarthome_rule`, `set_smarthome_rule_enabled`.

**Thử nói:**
- *"Cứ 10 giờ tối là tắt đèn phòng khách giúp tôi"*
- *"Cứ mỗi 30 phút thì bật quạt lên"*
- *"Có automation nào đang chạy không?"*
- *"Xoá cái automation tắt đèn đó đi"*

## Danh sách file đã thêm / sửa

**File mới:**
- `electron/action-lane.mjs`
- `electron/browser-agent.mjs`
- `electron/smarthome-rules.mjs`
- `NANG_CAP_MOI.md` (tài liệu này)

**File đã sửa:**
- `electron/main.mjs` — import 3 module trên; state `silentMode` +
  `smarthomeRuleTimer`; các hàm cầu nối (computer-use qua lane, browser
  tools, smart-home rule tools, silent mode); đăng ký case xử lý + khai báo
  tool cho Gemini; khởi động vòng lặp rule khi app sẵn sàng; dọn dẹp khi
  thoát app; cập nhật system instructions để Gemini biết dùng tool nào khi
  nào.
- `electron/preload.cjs` — thêm `onSilentModeChange`.
- `src/hooks/useAudioPipeline.ts` — thêm gain node output + `setSilentOutput`.
- `src/App.tsx` — lắng nghe sự kiện silent-mode, gọi `audio.setSilentOutput`.
- `src/vite-env.d.ts`, `src/types.ts` — khai báo kiểu cho
  `onSilentModeChange`.
- `package.json` — thêm dependency `playwright`.
- `.env.example` — ghi chú cấu hình (không bắt buộc) cho 3 tính năng mới.

## Việc bạn cần tự làm trước khi chạy thử

1. `npm install`
2. `npx playwright install chromium` (cho Browser Agent)
3. Chạy app như bình thường (`npm run dev` / script có sẵn trong repo).
4. Vì mình không có màn hình/thiết bị thật để chạy Electron trong môi
   trường này, hãy thử từng tính năng và báo lại nếu có lỗi runtime — khả
   năng cao nhất sẽ nằm ở phần UI (badge hiển thị silent mode chưa được vẽ
   thêm — hiện tại tính năng hoạt động nhưng chưa có huy hiệu riêng trên
   giao diện, mình có thể thêm nếu bạn muốn).
