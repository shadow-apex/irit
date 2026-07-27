import { useEffect, useRef, useState } from "react";
import { X, Mic, MicOff, Smartphone } from "lucide-react";
import { companionStream } from "../lib/companionStream";

// FEAT-COMP-LIVE-01: Cửa sổ xem video Companion Camera LỚN, Ở GIỮA màn hình.
//
// Khác với CompanionVideo.tsx (Alt+C — Bảng điều khiển kết nối, không hiện
// video, KHÔNG đụng vào) và Direct Stream Vision (canvas vẽ mỗi 3.5s, JPEG
// nén thấp, chỉ để gửi cho Gemini xem — không nhằm hiển thị đẹp cho người
// dùng), component này hiện <video> THẬT (mượt, thời gian thực) từ
// `companionStream` (singleton, nguồn sự thật duy nhất, được nuôi bởi
// CompanionWebRTC.tsx đang chạy ngầm) — không tạo thêm RTCPeerConnection.
export default function CompanionLiveView({ onClose }: { onClose: () => void }) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [hasStream, setHasStream] = useState(() => Boolean(companionStream.getStream()));
  const [micEnabled, setMicEnabled] = useState(() => companionStream.getMicEnabled());

  useEffect(() => {
    const unsubscribe = companionStream.subscribeStream((stream) => {
      setHasStream(Boolean(stream));
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        if (stream) videoRef.current.play().catch(() => {});
      }
    });
    return unsubscribe;
  }, []);

  useEffect(() => {
    const unsubscribe = companionStream.subscribeMicState((enabled) => {
      setMicEnabled(enabled);
    });
    return unsubscribe;
  }, []);

  // Phím Escape đóng cửa sổ — chỉ ẩn UI, KHÔNG đụng tới stream/WebRTC nền
  // (companionStream/CompanionWebRTC.tsx vẫn chạy ngầm bình thường sau khi
  // đóng, giống hệt cách đóng panel Alt+C không làm rớt kết nối).
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 900,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        // Overlay đen mờ phía sau để tách hẳn khỏi UI chính, không phải PiP
        // kéo-thả — đây là modal xem trực tiếp, ở giữa màn hình cố định.
        backgroundColor: "rgba(0, 0, 0, 0.7)",
        backdropFilter: "blur(4px)",
      }}
      onClick={onClose}
    >
      <div
        style={{
          position: "relative",
          width: "min(80vw, 900px)",
          maxHeight: "85vh",
          backgroundColor: "#0a0a0a",
          borderRadius: 12,
          border: "1px solid #333",
          overflow: "hidden",
          boxShadow: "0 20px 60px rgba(0,0,0,0.6)",
          display: "flex",
          flexDirection: "column",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Thanh tiêu đề */}
        <div
          style={{
            padding: "10px 14px",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            borderBottom: "1px solid #222",
            flexShrink: 0,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 8, color: "rgb(40, 205, 170)", fontSize: 13, fontWeight: 600 }}>
            <Smartphone size={16} />
            Companion Camera — Xem trực tiếp
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            {/* Mic toggle — tắt mic tại đây hợp lý vì đang xem video trực
                tiếp; dùng lại đúng API companionStream đã có sẵn. */}
            <button
              onClick={() => companionStream.requestMicToggle(!micEnabled)}
              title={micEnabled ? "Tắt mic điện thoại" : "Bật mic điện thoại"}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                width: 28,
                height: 28,
                borderRadius: 6,
                border: "1px solid #333",
                background: micEnabled ? "rgba(40, 205, 170, 0.12)" : "#151515",
                color: micEnabled ? "rgb(40, 205, 170)" : "#888",
                cursor: "pointer",
              }}
            >
              {micEnabled ? <Mic size={14} /> : <MicOff size={14} />}
            </button>
            <button
              onClick={onClose}
              title="Đóng (Esc)"
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                width: 28,
                height: 28,
                borderRadius: 6,
                border: "1px solid #333",
                background: "#151515",
                color: "#ccc",
                cursor: "pointer",
              }}
            >
              <X size={14} />
            </button>
          </div>
        </div>

        {/* Vùng video */}
        <div
          style={{
            position: "relative",
            width: "100%",
            aspectRatio: "16 / 9",
            backgroundColor: "#000",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <video
            ref={videoRef}
            autoPlay
            playsInline
            style={{
              width: "100%",
              height: "100%",
              objectFit: "contain",
              display: hasStream ? "block" : "none",
            }}
          />
          {!hasStream && (
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: 10,
                color: "rgb(40, 205, 170)",
                fontSize: 13,
                textAlign: "center",
                padding: "0 24px",
              }}
            >
              <Smartphone size={28} style={{ opacity: 0.6 }} />
              Đang chờ điện thoại kết nối...
              <span style={{ color: "#777", fontSize: 11 }}>
                Quét QR ở panel Companion Camera (Alt+C) để kết nối.
              </span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
