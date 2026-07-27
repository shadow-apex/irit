import { useEffect, useRef, useState } from "react";
import DraggablePiP from "./DraggablePiP";
import { Smartphone, Mic, MicOff, Volume2, VolumeX, MonitorPlay } from "lucide-react";
import { companionStream } from "../lib/companionStream";

// BUGFIX-COMP-PIP-01: Component này (Alt+C, PiP nhỏ) trước đây hiển thị 1
// <iframe> trỏ tới OBS_SOURCE_URL (http://localhost:8080/source.html) —
// một trang hoàn toàn KHÔNG liên quan gì tới luồng WebRTC thật (không video,
// không audio, không nút mic nào có tác dụng). Trong khi đó comment trong
// companionStream.ts và App.tsx đều mô tả rằng PiP Alt+C phải hiển thị
// đúng `companionStream` (nguồn sự thật duy nhất, được nuôi bởi
// CompanionWebRTC.tsx) — giống hệt cách CompanionLiveView.tsx (modal lớn)
// đang làm. Sửa lại để dùng đúng companionStream + thêm nút tắt/mở mic
// điện thoại ngay trên PiP này (không cần mở modal lớn mới tắt được mic).
export default function CompanionVideo({ onClose }: { onClose: () => void }) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [hasStream, setHasStream] = useState(() => Boolean(companionStream.getStream()));
  const [micEnabled, setMicEnabled] = useState(() => companionStream.getMicEnabled());
  const [speakerMuted, setSpeakerMuted] = useState(true);
  const [viewMode, setViewMode] = useState<"webrtc" | "obs">("webrtc");

  useEffect(() => {
    const unsubscribe = companionStream.subscribeStream((stream) => {
      setHasStream(Boolean(stream));
      if (videoRef.current) {
        if (videoRef.current.srcObject !== stream) {
          videoRef.current.srcObject = stream;
          if (stream) videoRef.current.play().catch(() => {});
        }
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

  return (
    <DraggablePiP
      title={
        <>
          <Smartphone size={16} style={{ color: "rgb(40, 205, 170)" }} />
          Companion Camera
        </>
      }
      onClose={onClose}
      defaultPosition={{ x: window.innerWidth - 360, y: 80 }}
      defaultSize={{ width: 340, height: 240 }}
    >
      <div
        style={{
          width: "100%",
          height: "100%",
          position: "relative",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: "#000",
        }}
      >
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted={speakerMuted}
          style={{
            width: "100%",
            height: "100%",
            objectFit: "cover",
            display: hasStream ? "block" : "none",
          }}
        />
        {!hasStream && (
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 8,
              color: "rgb(40, 205, 170)",
              fontSize: 12,
              textAlign: "center",
              padding: "0 16px",
            }}
          >
            <Smartphone size={22} style={{ opacity: 0.6 }} />
            Đang chờ điện thoại kết nối...
          </div>
        )}

        {viewMode === "obs" && (
          <iframe
            src="http://localhost:8080/source.html"
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              width: "100%",
              height: "100%",
              border: "none",
              zIndex: 5,
              backgroundColor: "#000",
            }}
            title="OBS Source"
          />
        )}

        <div style={{ position: "absolute", top: 8, right: 8, display: "flex", gap: 6, zIndex: 10 }}>
          <button
            onClick={() => setViewMode(viewMode === "webrtc" ? "obs" : "webrtc")}
            title={viewMode === "webrtc" ? "Chuyển sang xem luồng OBS/YOLO" : "Chuyển về luồng WebRTC (Mặc định)"}
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              width: 26,
              height: 26,
              borderRadius: 6,
              border: "1px solid #333",
              background: viewMode === "obs" ? "rgba(40, 205, 170, 0.15)" : "rgba(0,0,0,0.6)",
              color: viewMode === "obs" ? "rgb(40, 205, 170)" : "#888",
              cursor: "pointer",
            }}
          >
            <MonitorPlay size={13} />
          </button>
          
          {viewMode === "webrtc" && (
            <>
              <button
                onClick={() => setSpeakerMuted(!speakerMuted)}
                title={speakerMuted ? "Bật âm thanh phát ra loa PC" : "Tắt âm thanh phát ra loa PC"}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  width: 26,
                  height: 26,
                  borderRadius: 6,
                  border: "1px solid #333",
                  background: !speakerMuted ? "rgba(40, 205, 170, 0.15)" : "rgba(0,0,0,0.6)",
                  color: !speakerMuted ? "rgb(40, 205, 170)" : "#888",
                  cursor: "pointer",
                }}
              >
                {speakerMuted ? <VolumeX size={13} /> : <Volume2 size={13} />}
              </button>
              <button
                onClick={() => companionStream.requestMicToggle(!micEnabled)}
                title={micEnabled ? "Tắt mic điện thoại" : "Bật mic điện thoại"}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  width: 26,
                  height: 26,
                  borderRadius: 6,
                  border: "1px solid #333",
                  background: micEnabled ? "rgba(40, 205, 170, 0.15)" : "rgba(0,0,0,0.6)",
                  color: micEnabled ? "rgb(40, 205, 170)" : "#888",
                  cursor: "pointer",
                }}
              >
                {micEnabled ? <Mic size={13} /> : <MicOff size={13} />}
              </button>
            </>
          )}
        </div>
      </div>
    </DraggablePiP>
  );
}
