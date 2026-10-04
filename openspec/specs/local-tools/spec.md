# local-tools

## Purpose
Hành vi của các tool OS/phần cứng mà Gemini Live gọi trực tiếp (script Python trong `tools/` + lớp bọc `electron/main/local-tools.mjs`): schema kết quả, an toàn khi thực thi, quyền riêng tư và tính trung thực của trạng thái trả về.

## Requirements

### Requirement: Một schema kết quả duy nhất
Mỗi script SHALL in đúng một dòng JSON `{"success": bool, ...}` và thoát mã ≠ 0 khi thất bại (kể cả lỗi tham số). Lớp Node SHALL trả `{..., status: "success"|"error"}` với `status` đặt sau cùng, và SHALL coi mọi kết quả không phân tích được thành JSON là `error`.

#### Scenario: Script báo lỗi nhưng thoát mã 0
- **WHEN** script in `{"success": false, "error": "x"}` và thoát mã 0
- **THEN** Gemini nhận `status: "error"` với `error: "x"`

#### Scenario: Script không in JSON
- **WHEN** script thoát mã 0 nhưng stdout không có JSON hợp lệ
- **THEN** Gemini nhận `status: "error"`, không bao giờ `success`

### Requirement: Không có đường chèn lệnh
Tool SHALL NOT dùng `os.system`, `shell=True`, tự `pip install`, hay nội suy dữ liệu từ Gemini/người dùng vào mã PowerShell/cmd. Tiêu đề cửa sổ và tên tiến trình SHALL chỉ là dữ liệu so khớp, được kiểm tra độ dài/ký tự.

#### Scenario: Tiêu đề cửa sổ chứa ký tự lệnh
- **WHEN** `move_window_precise` nhận `name = "x'); calc; ('"`
- **THEN** không lệnh nào được thực thi; tiêu đề chỉ được so khớp như chuỗi

### Requirement: Đóng tiến trình có bảo vệ
`process_manager kill` và `close_app` SHALL từ chối ký tự đại diện và đường dẫn, từ chối tiến trình hệ điều hành và chính Iris, mặc định đóng êm, và chỉ buộc kết thúc (`/F`) khi `force=true` sau xác nhận hai bước. Kết quả SHALL chỉ báo thành công khi tiến trình thật sự đã thoát.

#### Scenario: Kill ký tự đại diện
- **WHEN** gọi kill với `*` hoặc `*.exe`
- **THEN** bị từ chối trước khi chạy bất kỳ lệnh nào

### Requirement: Chuột không bao giờ kẹt
`mouse_control` SHALL luôn nhả nút chuột khi kết thúc, kể cả khi bị huỷ; khi hết giờ, Node SHALL gọi `release`. Toạ độ SHALL được kẹp theo màn hình ảo (mọi màn hình) và né các góc fail-safe; toạ độ đọc từ khung vision SHALL được đổi sang pixel vật lý khi `space:"frame"`.

#### Scenario: Drag bị timeout
- **WHEN** tiến trình `drag` bị giết do quá thời gian
- **THEN** Node chạy `mouse_control release` ngay sau đó

### Requirement: Quyền riêng tư mặc định
Lịch sử clipboard SHALL tắt mặc định (`IRIS_CLIPBOARD_HISTORY=1` để bật), lưu trong thư mục dữ liệu của Iris, giữ ngắn hạn, bỏ qua chuỗi giống mật khẩu/OTP/số thẻ, và dừng khi Iris thoát. `read_system_notifications` SHALL che mã OTP trừ khi người dùng yêu cầu rõ qua xác nhận hai bước.

#### Scenario: Gọi lịch sử clipboard khi chưa bật
- **WHEN** Gemini gọi `clipboard_history list` mà `IRIS_CLIPBOARD_HISTORY` chưa là `1`
- **THEN** nhận `status: "error"` giải thích người dùng cần tự bật

### Requirement: Nhắc việc bền vững và trung thực
Nhắc việc SHALL do tiến trình Electron quản lý, lưu trong userData, nạp lại khi khởi động (bỏ mục quá hạn hơn 1 giờ) và SHALL ghi log khi gửi thông báo thất bại thay vì nuốt lỗi.

#### Scenario: Khởi động lại Iris
- **WHEN** Iris khởi động và có nhắc việc còn hạn trong file lưu
- **THEN** timer được đặt lại và nhắc vẫn bắn đúng giờ
