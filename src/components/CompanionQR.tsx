import { useEffect, useState } from "react";
import { X, Smartphone, Mic } from "lucide-react";

// BUGFIX-COMP-QR-01: Trước đây panel này (Alt+Q) CHỈ hiện QR của
// PHONE_CAMERA/server.js (OBS/YOLO — chỉ có video, KHÔNG có mic, KHÔNG liên
// quan gì tới Gemini Live). Người dùng quét đúng QR duy nhất hiện trên màn
// hình này thì tất nhiên nói vào mic điện thoại không có tác dụng gì với
// Iris — vì QR đó chưa từng kết nối tới companion-server.mjs (WebRTC, cổng
// 8444/8080) là nơi thực sự nhận audio (companion:webrtc-audio ->
// sendAudioChunk -> liveSession.sendRealtimeInput). Các API cần thiết
// (getLocalIp / getCompanionWsToken) đã tồn tại sẵn trong preload.cjs từ
// trước nhưng chưa từng được UI nào gọi. Giờ hiển thị QR WebRTC (đúng cái
// dùng chung với CompanionWebRTC.tsx + companion.html) làm lựa chọn CHÍNH —
// đây là QR duy nhất cho phép "nói vào mic điện thoại để ra lệnh cho Iris,
// giống hệt như dùng mic laptop". QR OBS cũ vẫn giữ lại làm lựa chọn phụ,
// dành riêng cho ai muốn dùng với OBS Studio / Python YOLO.
export default function CompanionQR({ onClose }: { onClose: () => void }) {
  const [mode, setMode] = useState<"voice" | "obs">("voice");
  const [voiceUrl, setVoiceUrl] = useState<string | null>(null);
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const [phoneCamUrl, setPhoneCamUrl] = useState<string | null>(null);

  // QR chính: URL WebRTC (video + mic) trỏ thẳng tới companion.html, mang
  // theo token xác thực — đây là kênh mà companionStream / CompanionWebRTC /
  // nút mic trong CompanionLiveView đang lắng nghe.
  useEffect(() => {
    let cancelled = false;
    let timer: number | undefined;

    const poll = async () => {
      if (cancelled) return;
      if (!window.iris?.getLocalIp || !window.iris?.getCompanionWsToken) {
        if (!cancelled) setVoiceError("Bản build này thiếu API getLocalIp/getCompanionWsToken.");
        return;
      }
      try {
        const [ip, token] = await Promise.all([
          window.iris.getLocalIp(),
          window.iris.getCompanionWsToken(),
        ]);
        if (cancelled) return;
        if (!token) {
          // Token chỉ được tạo sau khi companion-server khởi động, tức là
          // sau khi bấm bắt đầu phiên Iris (startLive/sidecar:start) — chưa
          // bật Iris thì chưa có gì để quét cả.
          setVoiceUrl(null);
          setVoiceError("Chưa có token — hãy bật Iris (Start) trước, companion server sẽ tự khởi động cùng lúc.");
        } else if (ip && ip !== "localhost") {
          setVoiceUrl(`https://${ip}:8444/companion.html?token=${encodeURIComponent(token)}`);
          setVoiceError(null);
        } else {
          setVoiceError("Không lấy được IP LAN của máy tính — kiểm tra kết nối mạng.");
        }
      } catch (err) {
        if (!cancelled) setVoiceError("Lỗi khi lấy thông tin kết nối.");
      }
      if (!cancelled) timer = window.setTimeout(poll, 2000);
    };

    poll();
    return () => {
      cancelled = true;
      if (timer) window.clearTimeout(timer);
    };
  }, []);

  // QR phụ: URL của server OBS/YOLO cũ (PHONE_CAMERA/server.js) — giữ
  // nguyên hành vi cũ, chỉ chuyển thành tab phụ thay vì mặc định.
  useEffect(() => {
    let cancelled = false;
    let phoneCamPollTimer: number | undefined;

    const pollPhoneCamUrl = async () => {
      if (cancelled || !window.iris?.getPhoneCamUrl) return;
      try {
        const url = await window.iris.getPhoneCamUrl();
        if (url) {
          if (!cancelled) {
            setPhoneCamUrl(url);
          }
          return;
        }
      } catch (err) {}
      if (!cancelled) {
        phoneCamPollTimer = window.setTimeout(pollPhoneCamUrl, 2000);
      }
    };

    pollPhoneCamUrl();

    return () => {
      cancelled = true;
      if (phoneCamPollTimer) window.clearTimeout(phoneCamPollTimer);
    };
  }, []);

  const activeUrl = mode === "voice" ? voiceUrl : phoneCamUrl;
  const qrImgUrl = activeUrl ? `https://api.qrserver.com/v1/create-qr-code/?size=250x250&data=${encodeURIComponent(activeUrl)}` : null;

  return (
    <div className="history-backdrop" onClick={onClose} style={{ zIndex: 1000, position: "fixed", inset: 0, backgroundColor: "rgba(0,0,0,0.8)", display: "flex", flexDirection: "column", padding: 40, alignItems: "center", justifyContent: "center" }}>
      <div onClick={(e) => e.stopPropagation()} style={{ backgroundColor: "#111", borderRadius: 12, display: "flex", flexDirection: "column", overflow: "hidden", border: "1px solid #333", boxShadow: "0 10px 40px rgba(0,0,0,0.5)", width: 450, maxWidth: "100%" }}>
        <div style={{ padding: "16px 24px", borderBottom: "1px solid #222", display: "flex", justifyContent: "space-between", alignItems: "center", backgroundColor: "#181818" }}>
          <h2 style={{ margin: 0, fontSize: 18, display: "flex", alignItems: "center", gap: 10, color: "#eee" }}>
            <Smartphone size={22} style={{ color: "rgb(40, 205, 170)" }} /> 
            Iris Companion
          </h2>
          <button className="t-btn small" onClick={onClose} title="Đóng (X / Esc)"><X size={18} /></button>
        </div>

        <div style={{ display: "flex", borderBottom: "1px solid #222" }}>
          <button
            onClick={() => setMode("voice")}
            style={{
              flex: 1, padding: "10px 0", border: "none", cursor: "pointer",
              background: mode === "voice" ? "#181818" : "transparent",
              color: mode === "voice" ? "rgb(40, 205, 170)" : "#888",
              borderBottom: mode === "voice" ? "2px solid rgb(40, 205, 170)" : "2px solid transparent",
              display: "flex", alignItems: "center", justifyContent: "center", gap: 6, fontSize: 13, fontWeight: 600,
            }}
          >
            <Mic size={14} /> Nói lệnh cho Iris
          </button>
          <button
            onClick={() => setMode("obs")}
            style={{
              flex: 1, padding: "10px 0", border: "none", cursor: "pointer",
              background: mode === "obs" ? "#181818" : "transparent",
              color: mode === "obs" ? "rgb(40, 205, 170)" : "#888",
              borderBottom: mode === "obs" ? "2px solid rgb(40, 205, 170)" : "2px solid transparent",
              fontSize: 13, fontWeight: 600,
            }}
          >
            OBS / YOLO
          </button>
        </div>

        <div style={{ padding: "30px", display: "flex", flexDirection: "column", alignItems: "center", gap: 20 }}>
          <div style={{ color: "#aaa", textAlign: "center", margin: 0, lineHeight: 1.5, fontSize: 14 }}>
            {mode === "voice" ? (
              <>Quét mã này bằng camera điện thoại để mở camera + <strong>mic</strong> — nói vào mic điện thoại sẽ ra lệnh cho Iris giống hệt như nói qua mic laptop.</>
            ) : (
              <>Mở ứng dụng Camera và quét mã này để dùng với <strong>OBS Studio</strong> hoặc <strong>Python YOLO</strong> (không có mic).</>
            )}
          </div>

          <div style={{ width: 250, height: 250, backgroundColor: "#fff", borderRadius: 12, padding: 10, display: "flex", alignItems: "center", justifyContent: "center" }}>
            {qrImgUrl ? (
              <img src={qrImgUrl} alt={mode === "voice" ? "QR kết nối mic Iris" : "OBS QR Code"} style={{ width: "100%", height: "100%", objectFit: "contain" }} />
            ) : (
              <div style={{ color: "#d32f2f", fontWeight: "bold", textAlign: "center", fontSize: 13, padding: 10 }}>
                {mode === "voice" ? (
                  <>Chưa có mã để quét!<br/><br/>
                    <span style={{ fontSize: 12, fontWeight: "normal", color: "#000" }}>
                      {voiceError || "Hãy bấm Start để bật Iris trước — companion server chỉ khởi động cùng phiên live."}
                    </span>
                  </>
                ) : (
                  <>Không có URL Camera OBS!<br/><br/>
                    <span style={{fontSize: 12, fontWeight: "normal", color: "#000"}}>
                      Hãy chắc chắn server <code>PHONE_CAMERA</code> đang chạy.
                    </span>
                  </>
                )}
              </div>
            )}
          </div>

          <div style={{ background: "#152a1e", border: "1px solid "  + (activeUrl ? "#255a3a" : "#2a2a2a"), borderRadius: 8, padding: 16, width: "100%" }}>
            <div style={{ color: "#eee", fontWeight: "bold", marginBottom: 8, fontSize: 13 }}>
              URL kết nối (dành cho dán thủ công)
            </div>
            {activeUrl ? (
              <>
                <code
                  onClick={() => navigator.clipboard?.writeText(activeUrl)}
                  title="Bấm để copy"
                  style={{ display: "block", background: "#000", padding: "8px 10px", borderRadius: 4, fontSize: 12, color: "rgb(40, 205, 170)", wordBreak: "break-all", cursor: "pointer" }}
                >
                  {activeUrl}
                </code>
                <div style={{ color: "#888", fontSize: 11, marginTop: 6 }}>
                  {mode === "voice" ? "Điện thoại và máy tính phải cùng mạng LAN/WiFi. Trình duyệt sẽ cảnh báo chứng chỉ tự ký (mkcert) — bấm \"Tiếp tục\"/\"Nâng cao\" để vào." : "Lưu ý: URL này dùng cho hệ thống OBS/Python độc lập."}
                </div>
              </>
            ) : (
              <div style={{ color: "#888", fontSize: 12 }}>
                Đang chờ hệ thống khởi động...
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
