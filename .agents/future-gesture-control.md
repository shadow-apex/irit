# Ý tưởng tương lai — mở rộng điều khiển bằng cử chỉ tay

Iris **đã có** điều khiển cử chỉ tay ngay bây giờ (`src/hooks/useHandControl.ts`
+ MediaPipe `GestureRecognizer`, on-device). Hiện hỗ trợ 4 cử chỉ:
☝️ Point (di chuyển con trỏ + dwell-click ~0.3s), ✋ Open palm (cuộn),
🙌 Hai bàn tay mở (resize reader), ✊ Fist (đóng reader).

Dưới đây là các ý tưởng mở rộng, xếp theo độ khó tăng dần.

## 1. Tận dụng các cử chỉ MediaPipe có sẵn nhưng chưa dùng
`GestureRecognizer` đã hỗ trợ sẵn `Thumb_Up`, `Thumb_Down`, `Victory`,
`ILoveYou` (thấy trong docstring của `useHandControl.ts`) nhưng code hiện chỉ
map 4/8 lớp cử chỉ. Có thể gán ngay mà không cần huấn luyện gì thêm:
- 👍 **Thumb_Up** → xác nhận nhanh brief Hermes (thay cho việc phải nói "ừ") —
  vẫn tôn trọng "cổng xác nhận" vì chỉ là một cách khác để "user speak/act",
  cần map vào `markUserSpoke()`-tương-đương ở phía cử chỉ.
- 👎 **Thumb_Down** → huỷ đề xuất đang chờ (`resetHermesGate()`).
- ✌️ **Victory** → chụp nhanh khung hình reader hiện tại / copy kết quả.
- 🤟 **ILoveYou** → easter egg (không bắt buộc chức năng) hoặc shortcut "mở
  Settings".

## 2. Cử chỉ 2 tay có ý nghĩa (custom gesture, không có sẵn trong model)
Model hiện tại chỉ phân loại từng bàn tay độc lập. Có thể xây một lớp logic
nhỏ trên `TrackedHand[]` (đã có trong `HandState.hands`) để nhận diện **tương
quan giữa 2 tay**:
- Hai ngón trỏ chụm lại rồi kéo giãn ra → zoom Glass HUD hoặc phóng to
  `ReaderOverlay` theo tỉ lệ mượt (khác với "hai palm mở" hiện tại chỉ resize
  bước).
- Vẽ một hình chữ nhật bằng 2 ngón trỏ → chọn vùng màn hình để giao cho Hermes
  ("đọc nội dung trong vùng này") — hợp với việc Hermes có browser automation.

## 3. Cử chỉ "air-drag" giữ + kéo (thay vì chỉ dwell-click)
Hiện tại "point" chỉ dwell 0.3s để click. Có thể thêm: point + giữ tư thế
"pinch" (ngón cái chạm ngón trỏ — cần custom landmark logic vì không có sẵn
trong canned gestures) để **kéo-thả task card** trong Work Stream, ví dụ kéo
một task ra thành cửa sổ ghim riêng trong Glass HUD.

## 4. Phản hồi xúc giác/thị giác tốt hơn khi cử chỉ không chắc chắn
`stabilizeGesture()` hiện âm thầm chờ 3 khung hình ổn định rồi mới đổi cử chỉ
hiển thị — có thể thêm một chỉ báo nhỏ trên `HandReticles.tsx` (vòng tròn "độ
tin cậy" mờ dần) để người dùng biết hệ thống *đang* nhận diện chứ không phải
bị treo, đặc biệt hữu ích khi ánh sáng yếu (webcam thường, không hồng ngoại).

## 5. Cấu hình gesture theo người dùng (Settings)
Thêm một tab trong `SetupPanel.tsx` cho phép remap cử chỉ ↔ hành động (giống
key rebinding trong game): ví dụ người dùng thuận tay trái có thể muốn đảo
ngược ý nghĩa "hand trái/phải" cho thao tác 2 tay, hoặc tắt hẳn một cử chỉ hay
bị nhận nhầm.

## 6. Gesture "away" tự động tắt hand-tracking để tiết kiệm pin/CPU
`useHandControl` hiện chạy `requestAnimationFrame` liên tục khi `enabled`.
Có thể thêm: nếu không phát hiện bàn tay nào trong N giây liên tục (ví dụ 20s),
tự hạ tần suất inference (ví dụ đổi từ mỗi frame sang mỗi 3 frame) cho tới khi
có chuyển động trở lại — giảm tải GPU khi người dùng không thực sự dùng cử chỉ,
đặc biệt quan trọng ở chế độ Glass HUD chạy nền cả ngày.

## 7. Multi-hand actions cho công việc, không chỉ điều hướng UI
Hiện cử chỉ tay chỉ điều khiển **UI của Iris**, chưa chạm tới lớp Hermes. Ý
tưởng dài hạn: một cử chỉ "chỉ vào cửa sổ ứng dụng khác trên màn hình" (cần
thêm object/window detection, phức tạp hơn nhiều) để nói kiểu "giao việc này
cho Hermes" trong khi trỏ vào một cửa sổ cụ thể — vượt ra khỏi phạm vi
MediaPipe thuần, nhưng đúng tinh thần "point-and-hold to click anything" mà
README đã đặt ra.

## Ưu tiên đề xuất nếu chỉ chọn 1-2 việc để làm trước
1. Mục 1 (bật thêm Thumb_Up/Thumb_Down) — gần như miễn phí vì model đã hỗ trợ
   sẵn, không cần huấn luyện thêm, tận dụng ngay hạ tầng `stabilizeGesture()`
   hiện có.
2. Mục 4 (chỉ báo độ tin cậy) — cải thiện trải nghiệm rõ rệt với chi phí thấp,
   giúp người dùng mới tin tưởng tính năng cử chỉ hơn.
