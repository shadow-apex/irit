import { useEffect, useRef, useState } from "react";
import DraggablePiP from "./DraggablePiP";
import { Smartphone, Mic, MicOff } from "lucide-react";
import { companionStream, type AudioResumeState } from "../lib/companionStream";

// FIX BUG-COMP-WEBRTC-02:
// Trước đây cửa sổ này (mở bằng Alt+C) chỉ biết vẽ ảnh JPEG rời rạc nhận
// qua window.iris.onCompanionFrame — đường dành cho app Expo Go cũ. Luồng
// WebRTC mới (video + audio thời gian thực) chạy ngầm trong
// CompanionWebRTC.tsx và trước đây bị ẩn hoàn toàn (display:none), khiến
// PiP bị đen/kẹt ở màn hình chờ ngrok dù điện thoại đã kết nối WebRTC.
//
// Sửa: PiP giờ lấy trực tiếp MediaStream từ store dùng chung
// (companionStream) và gắn vào thẻ <video> của chính nó — không tạo thêm
// RTCPeerConnection mới, không đụng vào luồng signalling hiện có.
// onCompanionFrame / QR ngrok vẫn được giữ lại làm phương án dự phòng cho
// trường hợp máy chưa hỗ trợ WebRTC (ví dụ vẫn dùng app Expo Go cũ).
export default function CompanionVideo({ onClose }: { onClose: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [webrtcStream, setWebrtcStream] = useState<MediaStream | null>(() => companionStream.getStream());
  const [audioState, setAudioState] = useState<AudioResumeState>(() => companionStream.getAudioState());
  const [micEnabled, setMicEnabled] = useState<boolean>(() => companionStream.getMicEnabled());
  const [frameUrl, setFrameUrl] = useState<string | null>(null);
  const [tunnelUrl, setTunnelUrl] = useState<string | null>(null);

  // Nguồn ưu tiên #1: luồng WebRTC thời gian thực
  useEffect(() => {
    const unsubscribe = companionStream.subscribeStream(setWebrtcStream);
    return unsubscribe;
  }, []);

  useEffect(() => {
    const unsubscribe = companionStream.subscribeAudioState(setAudioState);
    return unsubscribe;
  }, []);

  // FEAT-COMP-MIC-01: theo dõi trạng thái mic điện thoại để tô sáng/mờ icon
  // nút bấm cho đúng, kể cả khi bị đổi từ nơi khác (ví dụ reset khi có kết
  // nối mới trong CompanionWebRTC.tsx).
  useEffect(() => {
    const unsubscribe = companionStream.subscribeMicState(setMicEnabled);
    return unsubscribe;
  }, []);

  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.srcObject = webrtcStream;
      if (webrtcStream) {
        // BUG-COMP-WEBRTC-03 FIX: some Chromium builds don't honor the
        // `autoPlay` attribute reliably when `srcObject` is (re)assigned
        // after mount — calling play() explicitly is the documented
        // workaround. Errors here are expected/harmless (e.g. a stale
        // AbortError if the stream changes again immediately after).
        videoRef.current.play().catch(() => {});
      }
    }
  }, [webrtcStream]);

  // Nguồn dự phòng #2: đường Expo Go cũ (chỉ dùng khi chưa có WebRTC stream)
  useEffect(() => {
    if (webrtcStream || !window.iris?.onCompanionFrame) return;

    const cleanup = window.iris.onCompanionFrame((base64Jpeg) => {
      setFrameUrl(`data:image/jpeg;base64,${base64Jpeg}`);
    });

    return cleanup;
  }, [webrtcStream]);

  // Nguồn dự phòng #3: QR ngrok, chỉ hiện khi không có cả WebRTC lẫn frame Expo Go
  useEffect(() => {
    let intervalId: number;
    if (!webrtcStream && !tunnelUrl && !frameUrl) {
      intervalId = window.setInterval(async () => {
        try {
          if (window.iris?.getCompanionTunnel) {
            const url = await window.iris.getCompanionTunnel();
            if (url) {
              setTunnelUrl(url);
              window.clearInterval(intervalId);
            }
          }
        } catch (e) {}
      }, 2000);
    }
    return () => window.clearInterval(intervalId);
  }, [webrtcStream, tunnelUrl, frameUrl]);

  return (
    <DraggablePiP
      title={
        <>
          <Smartphone size={16} style={{ color: "rgb(40, 205, 170)" }} />
          Companion Camera
          {/* FEAT-COMP-MIC-01: bật/tắt mic điện thoại ngay từ cửa sổ PiP —
              chỉ hiện khi đã có luồng WebRTC thật (không hiện khi đang ở màn
              hình chờ QR/ngrok vì lúc đó chưa có mic nào để tắt). */}
          {webrtcStream && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                companionStream.requestMicToggle(!micEnabled);
              }}
              title={micEnabled ? "Tắt mic điện thoại" : "Bật mic điện thoại"}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                width: 24,
                height: 24,
                padding: 0,
                border: "none",
                borderRadius: 6,
                cursor: "pointer",
                background: micEnabled ? "transparent" : "rgba(220, 60, 60, 0.85)",
                color: micEnabled ? "rgb(40, 205, 170)" : "#fff",
              }}
            >
              {micEnabled ? <Mic size={14} /> : <MicOff size={14} />}
            </button>
          )}
        </>
      }
      onClose={onClose}
      defaultPosition={{ x: window.innerWidth - 340, y: 80 }} // Top right corner default
      defaultSize={{ width: 320, height: 240 }}
    >
      <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", backgroundColor: "#000", position: "relative" }}>
        {/* Thẻ video luôn được mount để srcObject gắn được ngay khi stream tới,
            chỉ ẩn đi bằng CSS khi chưa có stream (không unmount, tránh giật). */}
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          style={{
            width: "100%",
            height: "100%",
            objectFit: "contain",
            display: webrtcStream ? "block" : "none",
          }}
        />
        {webrtcStream && audioState === "suspended" && (
          <div
            onClick={() => companionStream.requestResume()}
            style={{
              position: "absolute",
              bottom: 8,
              left: "50%",
              transform: "translateX(-50%)",
              padding: "4px 10px",
              borderRadius: 999,
              background: "rgba(0,0,0,0.6)",
              color: "#fff",
              fontSize: 11,
              cursor: "pointer",
              whiteSpace: "nowrap",
            }}
          >
            🔇 Click để bật audio
          </div>
        )}
        {webrtcStream ? null : frameUrl ? (
          <img 
            src={frameUrl} 
            alt="Companion Stream" 
            style={{ width: "100%", height: "100%", objectFit: "contain" }} 
          />
        ) : tunnelUrl ? (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: 10 }}>
            <img 
              src={`https://api.qrserver.com/v1/create-qr-code/?size=150x150&data=${encodeURIComponent(tunnelUrl)}`} 
              alt="QR Code" 
              style={{ width: 150, height: 150, backgroundColor: "white", padding: 5, borderRadius: 5 }} 
            />
            <div style={{ color: "#666", fontSize: 13, textAlign: "center", marginTop: 10 }}>
              Scan with Expo Go to connect<br />
              <span style={{ fontSize: 10, color: "#444" }}>{tunnelUrl}</span>
            </div>
          </div>
        ) : (
          <div style={{ color: "#666", fontSize: 13, textAlign: "center", padding: 20 }}>
            Waiting for ngrok tunnel...<br />
            (Ensure Iris Companion is starting)
          </div>
        )}
      </div>
    </DraggablePiP>
  );
}
