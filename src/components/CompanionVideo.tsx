import { useEffect, useRef, useState } from "react";
import DraggablePiP from "./DraggablePiP";
import { Smartphone, Mic, MicOff, Volume2, VolumeX } from "lucide-react";
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
  // BUGFIX-COMP-ICE-01: `hasStream` chỉ nói lên việc đã CÓ một đối tượng
  // MediaStream (tức SDP negotiation xong, pc.ontrack đã fire) — KHÔNG đảm
  // bảo media thực sự đang chảy (ICE có thể vẫn đang "checking"/"failed" do
  // client isolation / NAT hairpin, xem CompanionWebRTC.tsx). Thêm cờ riêng
  // để phân biệt 2 trạng thái này trên UI, tránh gây hiểu lầm "connected"
  // trong khi thực chất vẫn đang chờ (hoặc sẽ không bao giờ) có hình.
  const [hasFrame, setHasFrame] = useState(false);
  const [micEnabled, setMicEnabled] = useState(() => companionStream.getMicEnabled());
  const [speakerMuted, setSpeakerMuted] = useState(true);
  // BUGFIX-COMP-PIP-02: Đã bỏ hẳn chế độ "obs" (nút MonitorPlay + <iframe
  // src="http://localhost:8080/source.html">) — chế độ này KHÔNG BAO GIỜ
  // hoạt động khi Iris đang chạy: companion-server.mjs chiếm cổng 8080 và
  // chỉ phục vụ '/' và '/companion.html' (xem electron/companion-server.mjs),
  // nên request tới /source.html luôn trả 404 -> PiP đen kịt, không ảnh.
  // Kể cả trong trường hợp source.html load được (chạy PHONE_CAMERA/server.js
  // riêng, không cùng lúc với Iris vì đụng cổng 8080), trang đó cũng chủ đích
  // dùng <video muted> — không bao giờ có âm thanh, vì nó được thiết kế làm
  // OBS Browser Source (chỉ video), không phải nguồn A/V đầy đủ như luồng
  // WebRTC thật (companionStream) mà PiP này đang dùng làm mặc định.

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

  // BUGFIX-COMP-ICE-01: đợi frame video THẬT SỰ decode được (loadedmetadata /
  // canplay) trước khi coi là "đã có hình" — đây là tín hiệu đáng tin cậy hơn
  // nhiều so với chỉ dựa vào việc srcObject đã được gán. Nếu sự kiện này
  // không bao giờ bắn ra dù hasStream=true, đó chính là bằng chứng ICE chưa
  // thông (relay/TURN chưa hoạt động) chứ không phải lỗi ở component này.
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const onFrame = () => setHasFrame(true);
    video.addEventListener('loadedmetadata', onFrame);
    video.addEventListener('canplay', onFrame);
    video.addEventListener('playing', onFrame);
    return () => {
      video.removeEventListener('loadedmetadata', onFrame);
      video.removeEventListener('canplay', onFrame);
      video.removeEventListener('playing', onFrame);
    };
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
            display: hasFrame ? "block" : "none",
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
        {hasStream && !hasFrame && (
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 8,
              color: "rgb(230, 180, 60)",
              fontSize: 12,
              textAlign: "center",
              padding: "0 16px",
            }}
          >
            <Smartphone size={22} style={{ opacity: 0.6 }} />
            Đã bắt tay xong, đang thiết lập kết nối media...
            <span style={{ opacity: 0.7, fontSize: 11 }}>
              Nếu treo ở đây quá 10-15s: điện thoại và PC có thể không
              &quot;thấy&quot; nhau trên mạng (kiểm tra Client Isolation trên
              router, hoặc dùng TURN).
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
