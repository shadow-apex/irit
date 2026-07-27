import { useEffect, useState } from "react";
import DraggablePiP from "./DraggablePiP";
import { Smartphone, Monitor, Radio, Copy, Check } from "lucide-react";

// REFACTOR (2026): Companion Camera (Alt+C) từng vẽ trực tiếp video WebRTC
// và dự phòng bằng luồng Expo Go/ngrok cũ (tunnelUrl, frameUrl, QR ngrok).
// App hiện chỉ dùng hệ thống WebRTC thuần trong thư mục PHONE_CAMERA, nên
// toàn bộ nhánh Expo Go/ngrok đã bị xoá khỏi component này.
//
// Cửa sổ PiP Alt+C giờ đóng vai trò "Bảng điều khiển kết nối": không hiện
// video (video thật vẫn chạy ngầm trong CompanionWebRTC.tsx và được các nơi
// khác — vd. Direct Stream Vision — đọc qua companionStream), mà chỉ hiển
// thị 3 điểm kết nối cố định của hệ thống PHONE_CAMERA:
//   1) Link quét cho điện thoại (đọc từ PHONE_CAMERA/.url qua IPC)
//   2) Link PC Viewer (https://localhost:8443/viewer.html)
//   3) Link OBS Source (http://localhost:8080/source.html)
const PC_VIEWER_URL = "https://localhost:8443/viewer.html";
const OBS_SOURCE_URL = "http://localhost:8080/source.html";

// FEAT-COMP-OBS-PREVIEW-01: theo yêu cầu — nhúng luôn link OBS Source
// (source.html, cổng 8080 của PHONE_CAMERA/server.js) NGAY trong panel Alt+C
// dưới dạng <iframe> thật (không phải chỉ link để copy), để người dùng xem
// trực tiếp được mà không cần mở trình duyệt riêng.
//
// Lưu ý về "key" trong link: server.js bind cổng 8080 vào 127.0.0.1
// (localhost-only) và cố tình KHÔNG bắt buộc token cho source.html
// (`attachSignaling(..., { requireToken: false })` — xem PHONE_CAMERA/server.js
// dòng ~138, comment "cổng HTTP mirror cho OBS đã bind 127.0.0.1... không
// cần thêm 1 lớp token nữa"). Vẫn gắn ROOM_TOKEN (?t=...) vào đây khi có —
// vô hại (server bỏ qua tham số thừa) và tương lai nếu bạn đổi requireToken
// thành true cho cổng này thì link vẫn hoạt động luôn, không cần sửa lại.
//
// Về "Iris cũng xem được": đây là preview cho NGƯỜI xem trong iframe — nội
// dung iframe khác domain/context nên KHÔNG thể đọc pixel để gửi cho Gemini
// (giới hạn bảo mật trình duyệt, không phải bug). Nếu muốn Iris "nhìn" qua
// camera điện thoại, dùng toggle_camera_stream_vision (Direct Stream
// Vision) — nó đọc thẳng từ companionStream (hệ thống WebRTC built-in, khác
// PHONE_CAMERA), đã tự động chạy song song, không cần làm gì thêm ở đây.
function obsSourceUrlWithToken(token: string | null): string {
  if (!token) return OBS_SOURCE_URL;
  return `${OBS_SOURCE_URL}?t=${encodeURIComponent(token)}`;
}

// Trích token (?t=...) từ phoneUrl (link gốc điện thoại quét, đã có sẵn
// token) để tái dùng cho link OBS Source ở trên — tránh phải đọc thêm 1 IPC
// riêng chỉ để lấy ROOM_TOKEN.
function extractToken(url: string | null): string | null {
  if (!url) return null;
  try {
    return new URL(url).searchParams.get("t");
  } catch {
    return null;
  }
}

function qrImgFor(data: string) {
  return `https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(data)}`;
}

// Một hàng thông tin kết nối: nhãn + link/text bấm-để-copy.
function ConnectionRow({
  icon,
  label,
  hint,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  hint: string;
  value: string | null;
}) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    if (!value) return;
    navigator.clipboard?.writeText(value).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    });
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4, width: "100%" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, color: "rgb(40, 205, 170)", fontSize: 12, fontWeight: "bold" }}>
        {icon}
        {label}
      </div>
      <div style={{ color: "#777", fontSize: 10, marginBottom: 2 }}>{hint}</div>
      <code
        onClick={handleCopy}
        title="Bấm để copy"
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 8,
          background: "#000",
          padding: "6px 8px",
          borderRadius: 4,
          fontSize: 11,
          color: value ? "#ddd" : "#555",
          wordBreak: "break-all",
          cursor: value ? "pointer" : "default",
        }}
      >
        <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{value ?? "..."}</span>
        {value ? (copied ? <Check size={12} style={{ flexShrink: 0, color: "rgb(40, 205, 170)" }} /> : <Copy size={12} style={{ flexShrink: 0, opacity: 0.5 }} />) : null}
      </code>
    </div>
  );
}

export default function CompanionVideo({ onClose }: { onClose: () => void }) {
  const [phoneUrl, setPhoneUrl] = useState<string | null>(null);

  // Đọc link quét cho điện thoại từ PHONE_CAMERA/.url (chứa link gốc kèm
  // ROOM_TOKEN param t=...) qua IPC main process, poll cho tới khi server
  // PHONE_CAMERA ghi file xong (server có thể khởi động sau app một chút).
  useEffect(() => {
    let cancelled = false;
    let timer: number | undefined;
    let hasUrlOnce = false;

    // AUDIT-COMP-QR-01 FIX: trước đây poll() dừng hẳn ngay khi lấy được URL
    // lần đầu. Nhưng PHONE_CAMERA/server.js sinh ROOM_TOKEN MỚI mỗi lần
    // server đó khởi động lại (bảo mật — token không cố định trừ khi set
    // env ROOM_TOKEN). Nếu server bị restart trong lúc panel Alt+C đang mở,
    // QR/link cũ sẽ hết hạn mà UI không hay biết. Nên tiếp tục poll định kỳ
    // (chậm hơn, 5s) kể cả sau khi đã có URL, để tự cập nhật QR khi
    // ROOM_TOKEN đổi — không chỉ dừng ở lần đọc thành công đầu tiên.
    const poll = async () => {
      if (cancelled || !window.iris?.getPhoneCamUrl) return;
      try {
        const url = await window.iris.getPhoneCamUrl();
        if (!cancelled && url) {
          setPhoneUrl(url);
          hasUrlOnce = true;
        }
      } catch (e) {
        // im lặng, thử lại ở vòng poll tiếp theo
      }
      if (!cancelled) timer = window.setTimeout(poll, hasUrlOnce ? 5000 : 2000);
    };

    poll();
    return () => {
      cancelled = true;
      if (timer) window.clearTimeout(timer);
    };
  }, []);

  return (
    <DraggablePiP
      title={
        <>
          <Smartphone size={16} style={{ color: "rgb(40, 205, 170)" }} />
          Companion Camera — Kết nối
        </>
      }
      onClose={onClose}
      defaultPosition={{ x: window.innerWidth - 360, y: 80 }}
      defaultSize={{ width: 340, height: 620 }}
    >
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 14,
          padding: 14,
          overflowY: "auto",
          backgroundColor: "#111",
          boxSizing: "border-box",
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6 }}>
          <div
            style={{
              width: 150,
              height: 150,
              backgroundColor: "#fff",
              borderRadius: 8,
              padding: 8,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            {phoneUrl ? (
              <img src={qrImgFor(phoneUrl)} alt="Phone Link QR" style={{ width: "100%", height: "100%", objectFit: "contain" }} />
            ) : (
              <div style={{ color: "#000", fontSize: 11, textAlign: "center", fontWeight: "bold" }}>Đang chờ server...</div>
            )}
          </div>
          <div style={{ color: "#888", fontSize: 11, textAlign: "center" }}>
            Quét bằng <strong>điện thoại</strong> để kết nối camera (WebRTC)
          </div>
        </div>

        <div style={{ width: "100%", display: "flex", flexDirection: "column", gap: 6 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, color: "rgb(40, 205, 170)", fontSize: 12, fontWeight: "bold" }}>
            <Radio size={13} />
            Xem trực tiếp (OBS Source)
          </div>
          <div
            style={{
              width: "100%",
              aspectRatio: "16 / 9",
              borderRadius: 6,
              overflow: "hidden",
              border: "1px solid #222",
              backgroundColor: "#000",
            }}
          >
            {/* Nhúng thẳng source.html — trang này tự nối WebSocket signaling
                (xem PHONE_CAMERA/public/source.html) và vẽ video nhận được
                vào <video> của chính nó; iframe chỉ hiển thị lại trang đó. */}
            <iframe
              src={obsSourceUrlWithToken(extractToken(phoneUrl))}
              title="OBS Source Preview"
              style={{ width: "100%", height: "100%", border: "none" }}
              allow="autoplay"
            />
          </div>
        </div>

        <div style={{ width: "100%", display: "flex", flexDirection: "column", gap: 10 }}>
          <ConnectionRow
            icon={<Smartphone size={13} />}
            label="Phone Link"
            hint="Link gốc kèm ROOM_TOKEN — quét QR ở trên hoặc dán trực tiếp"
            value={phoneUrl}
          />
          <ConnectionRow
            icon={<Monitor size={13} />}
            label="PC Viewer"
            hint="Mở trên trình duyệt PC để xem trực tiếp luồng camera"
            value={PC_VIEWER_URL}
          />
          <ConnectionRow
            icon={<Radio size={13} />}
            label="OBS Source"
            hint="Dán vào Browser Source trong OBS Studio (hoặc xem preview ở trên)"
            value={obsSourceUrlWithToken(extractToken(phoneUrl))}
          />
        </div>
      </div>
    </DraggablePiP>
  );
}
