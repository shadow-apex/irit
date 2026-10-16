import { useEffect, useRef, useState } from "react";
import DraggablePiP from "./DraggablePiP";
import { Smartphone, Mic, MicOff, Volume2, VolumeX, QrCode } from "lucide-react";
import { companionStream } from "../lib/companionStream";

export default function CompanionVideo({ onClose }: { onClose: () => void }) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [hasStream, setHasStream] = useState(() => Boolean(companionStream.getStream()));
  const [hasFrame, setHasFrame] = useState(false);
  const [micEnabled, setMicEnabled] = useState(() => companionStream.getMicEnabled());
  const [speakerMuted, setSpeakerMuted] = useState(true);

  useEffect(() => {
    const unsubscribe = companionStream.subscribeStream((stream) => {
      setHasStream(Boolean(stream));
      setHasFrame(false);
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
    const video = videoRef.current;
    if (!video) return;
    const onFrame = () => {
      setHasFrame(true);
    };

    if (video.readyState >= 2 || video.videoWidth > 0 || (video.currentTime > 0 && !video.paused)) {
      setHasFrame(true);
    }

    video.addEventListener("loadedmetadata", onFrame);
    video.addEventListener("canplay", onFrame);
    video.addEventListener("playing", onFrame);
    video.addEventListener("timeupdate", onFrame);
    video.addEventListener("loadeddata", onFrame);
    return () => {
      video.removeEventListener("loadedmetadata", onFrame);
      video.removeEventListener("canplay", onFrame);
      video.removeEventListener("playing", onFrame);
      video.removeEventListener("timeupdate", onFrame);
      video.removeEventListener("loadeddata", onFrame);
    };
  }, [hasStream]);

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
              justifyContent: "center",
              gap: 10,
              color: "#aaa",
              fontSize: 12,
              textAlign: "center",
              padding: "0 20px",
            }}
          >
            <Smartphone size={26} style={{ color: "rgb(40, 205, 170)", opacity: 0.8 }} />
            <div>
              <div style={{ color: "#fff", fontWeight: 600, fontSize: 13, marginBottom: 4 }}>
                Chưa có tín hiệu từ điện thoại
              </div>
              <div style={{ color: "#888", fontSize: 11, lineHeight: 1.4 }}>
                Quét mã QR để mở trang kết nối camera & micro trên điện thoại
              </div>
            </div>
            <button
              onClick={() => window.dispatchEvent(new CustomEvent("companion:open-qr"))}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                padding: "8px 14px",
                borderRadius: 8,
                backgroundColor: "rgba(40, 205, 170, 0.15)",
                border: "1px solid rgb(40, 205, 170)",
                color: "rgb(40, 205, 170)",
                fontSize: 12,
                fontWeight: 600,
                cursor: "pointer",
                transition: "all 0.15s",
              }}
              onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = "rgba(40, 205, 170, 0.25)")}
              onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "rgba(40, 205, 170, 0.15)")}
            >
              <QrCode size={14} /> Quét mã QR kết nối (Alt+Q)
            </button>
            <span style={{ fontSize: 10, color: "#666" }}>
              Sau khi quét, bấm &quot;CONNECT TO IRIS&quot; trên màn hình điện thoại
            </span>
          </div>
        )}

        {hasStream && !hasFrame && (
          <div
            style={{
              position: "absolute",
              inset: 0,
              backgroundColor: "rgba(0,0,0,0.75)",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              gap: 8,
              color: "rgb(230, 180, 60)",
              fontSize: 12,
              textAlign: "center",
              padding: "0 16px",
              zIndex: 5,
            }}
          >
            <Smartphone size={22} style={{ opacity: 0.8 }} />
            <span>Đã nhận luồng, đang giải mã hình ảnh...</span>
            <span style={{ opacity: 0.7, fontSize: 11 }}>
              Nếu đợi quá 10s: kiểm tra kết nối mạng cùng Wi-Fi hoặc mở lại kết nối trên điện thoại.
            </span>
          </div>
        )}

        <div style={{ position: "absolute", top: 8, right: 8, display: "flex", gap: 6, zIndex: 10 }}>
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
        </div>
      </div>
    </DraggablePiP>
  );
}
