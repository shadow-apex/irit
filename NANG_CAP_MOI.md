# 5 nâng cấp mới cho Iris

Tài liệu này mô tả 5 tính năng vừa được thêm vào dự án, cách cài đặt, và
các câu lệnh giọng nói mẫu để thử.

> **Cập nhật sau khi chạy thử thật:** phiên trước viết code nhưng chỉ kiểm
> tra cú pháp (`node --check`), chưa chạy được app thật. Phiên này đã
> `npm install`, build (`tsc --noEmit` + `vite build`), và khởi động được
> Electron thật (qua `xvfb-run` vì môi trường sandbox không có màn hình
> thật) — nhờ đó phát hiện và sửa **6 bug thật**:
>
> 1. **`get_iris_status`/Action Lanes UI im lặng vĩnh viễn** — `main.mjs`
>    import `subscribeActionLanes` nhưng chưa bao giờ gọi nó, nên kênh IPC
>    `iris:action-lanes-change` (mà `preload.cjs`/`App.tsx` đã sẵn sàng
>    lắng nghe) không bao giờ được phát đi. Panel `ActionLanes.tsx` vì vậy
>    sẽ luôn trống dù có việc chạy nền. Đã nối dây trong `app.whenReady()`.
> 2. **`stop_action` không thực sự dừng gì** — với một phiên computer-use
>    đang chạy, action-lane chỉ đổi trạng thái ghi nhớ thành `"cancelling"`,
>    nhưng vòng lặp trong `computer-session.mjs` chưa từng kiểm tra cờ đó
>    nên chuột/bàn phím vẫn tiếp tục chạy tới 15 bước. Đã thêm tham số
>    `shouldCancel` cho `runComputerSession`, kiểm tra ở đầu mỗi bước.
> 3. **`browser_open`/`browser_click`/... treo vĩnh viễn nếu bị huỷ khi
>    còn đang xếp hàng** — vòng lặp poll kết quả trong `main.mjs` chỉ nhận
>    biết `"completed"`/`"error"`, không nhận biết trạng thái cuối
>    `"cancelled"`, nên gọi `stop_action` trên một `browser_*` còn đang
>    xếp hàng sẽ khiến lượt hội thoại đó treo mãi mãi. Đã thêm nhánh xử lý.
> 4. **Lỗi biên dịch TypeScript thật** trong `useAudioPipeline.ts` —
>    `npm run build` sẽ fail vì việc tách điều kiện ra biến `isNewContext`
>    phá vỡ control-flow narrowing của TypeScript cho biến `analyser`. Đã
>    sửa lại thành điều kiện inline (giống code gốc, đã từng compile được).
> 5. **Thông báo lỗi "chưa cài Chromium" không hiện ra** — chỉ bắt được
>    trường hợp thiếu cả gói `playwright`; trường hợp phổ biến hơn (đã
>    `npm install` nhưng chưa `npx playwright install chromium`) để lọt
>    error thô của Playwright ra ngoài thay vì thông báo tiếng Việt đã hứa.
>    Đã bọc thêm try/catch quanh `chromium.launch()`.
> 6. **Validate giờ trong smart-home rule chỉ check định dạng, không check
>    khoảng giá trị** — `trigger.at: "25:99"` từng được chấp nhận âm thầm.
>    Đã sửa để validate giờ 00-23, phút 00-59.
>
> **Đã xác nhận hoạt động đúng** (test độc lập không cần GUI cho
> `action-lane.mjs`/`smarthome-rules.mjs`, cộng với khởi động Electron thật
> qua Xvfb — xem "Giới hạn khi test" bên dưới):
> - Queue/giới hạn đồng thời/huỷ/lỗi của Action Lanes.
> - CRUD + dedupe + validate của smart-home rules.
> - `stop_action` giờ dừng thật một phiên computer-use đang chạy.
> - `browser_open` báo lỗi tiếng Việt rõ ràng khi thiếu Chromium, thay vì
>   treo hoặc crash.
> - App boot thật (Electron + Vite dev server) không lỗi liên quan đến 5
>   tính năng này.
>
> **Giới hạn khi test (môi trường sandbox của phiên này, không phải bug
> code):** không có mic/loa thật nên chưa nghe được toàn bộ luồng giọng
> nói thật với Gemini Live; sandbox chặn tải Chromium
> (`npx playwright install chromium` fail vì domain bị chặn mạng) nên chưa
> chạy được `browser_click`/`browser_type`/... với trang thật — logic và
> đường lỗi thân thiện đã được test kỹ, nhưng bạn nên tự thử lại các câu
> "Thử nói" bên dưới ở máy có Chromium cài được, và báo lại nếu còn lỗi.


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
  tool cho Gemini; khởi động vòng lặp rule khi app sẵn sàng; **nối dây
  `subscribeActionLanes` → `emitToRenderer("iris:action-lanes-change", …)`
  trong `app.whenReady()`** (thiếu ở bản đầu, panel Action Lanes từng luôn
  trống); polling wrapper của browser tools giờ nhận biết trạng thái
  `"cancelled"` thay vì treo mãi; dọn dẹp khi thoát app; cập nhật system
  instructions để Gemini biết dùng tool nào khi nào. Có thêm cờ debug tuỳ
  chọn `IRIS_DEBUG_CONSOLE=1` (env var) để forward console của renderer ra
  terminal khi cần soi lỗi — không bật mặc định, không ảnh hưởng hành vi
  bình thường.
- `electron/computer-session.mjs` — `runComputerSession` nhận thêm tham số
  `shouldCancel` (optional), kiểm tra ở đầu mỗi bước để `stop_action` dừng
  được thật một phiên đang chạy thay vì chỉ đổi nhãn trạng thái.
- `electron/preload.cjs` — thêm `onSilentModeChange`, `onActionLanesChange`.
- `src/hooks/useAudioPipeline.ts` — thêm gain node output + `setSilentOutput`.
- `src/components/CommsPanel.tsx` — badge "🔇 Im lặng" dùng CSS class riêng
  (`.silent-badge` trong `src/styles/base.css`) thay vì inline style, có
  transition fade/scale mượt khi bật/tắt.
- `src/components/ActionLanes.tsx` — panel hiển thị việc đang chạy nền
  (đã có sẵn từ trước, giờ mới thực sự nhận được dữ liệu — xem bug #1).
- `src/App.tsx` — lắng nghe sự kiện silent-mode và action-lanes, gọi
  `audio.setSilentOutput` / cập nhật state cho `ActionLanes`.
- `src/vite-env.d.ts`, `src/types.ts` — khai báo kiểu cho
  `onSilentModeChange`, `onActionLanesChange`.
- `package.json` — thêm dependency `playwright`.
- `.env.example` — ghi chú cấu hình (không bắt buộc) cho 3 tính năng mới.

## Việc bạn cần tự làm trước khi chạy thử

1. `npm install`. Nếu postinstall của `ngrok` báo lỗi tải binary (mạng bị
   chặn / firewall công ty), dùng `npm install --ignore-scripts` rồi tự
   chạy `node node_modules/electron/install.js` một lần để tải Electron —
   phần còn lại của app không phụ thuộc ngrok.
2. `npx playwright install chromium` (bắt buộc cho Browser Agent — mình
   không tự chạy được lệnh này trong môi trường sandbox nên bạn cần tự
   làm; nếu quên, giờ Iris sẽ báo lỗi tiếng Việt rõ ràng thay vì crash).
3. Chạy app như bình thường (`npm run dev` / script có sẵn trong repo).
4. Mình đã khởi động được Electron thật (qua Xvfb) và xác nhận app boot
   sạch, không lỗi liên quan đến 5 tính năng này — nhưng chưa nghe được
   giọng nói thật (không có mic/loa/API key trong sandbox) và chưa mở được
   trang web thật qua Browser Agent (thiếu Chromium, xem mục 2). Hãy thử
   các câu "Thử nói" ở trên tại máy của bạn — đặc biệt phần Browser Agent
   và giọng nói end-to-end — và báo lại nếu còn lỗi.
