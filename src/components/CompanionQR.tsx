import { useEffect, useState } from "react";
import { X, Smartphone } from "lucide-react";

export default function CompanionQR({ onClose }: { onClose: () => void }) {
  const [phoneCamUrl, setPhoneCamUrl] = useState<string | null>(null);

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

  const phoneCamQrUrl = phoneCamUrl ? `https://api.qrserver.com/v1/create-qr-code/?size=250x250&data=${encodeURIComponent(phoneCamUrl)}` : null;

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

        <div style={{ padding: "30px", display: "flex", flexDirection: "column", alignItems: "center", gap: 20 }}>
          <div style={{ color: "#aaa", textAlign: "center", margin: 0, lineHeight: 1.5, fontSize: 14 }}>
            Mở ứng dụng Camera và quét mã này để dùng với <strong>OBS Studio</strong> hoặc <strong>Python YOLO</strong>.
          </div>
          
          <div style={{ width: 250, height: 250, backgroundColor: "#fff", borderRadius: 12, padding: 10, display: "flex", alignItems: "center", justifyContent: "center" }}>
            {phoneCamQrUrl ? (
              <img src={phoneCamQrUrl} alt="OBS QR Code" style={{ width: "100%", height: "100%", objectFit: "contain" }} />
            ) : (
              <div style={{ color: "#d32f2f", fontWeight: "bold", textAlign: "center", fontSize: 13, padding: 10 }}>
                Không có URL Camera OBS!<br/><br/>
                <span style={{fontSize: 12, fontWeight: "normal", color: "#000"}}>
                  Hãy chắc chắn server <code>PHONE_CAMERA</code> đang chạy.
                </span>
              </div>
            )}
          </div>

          <div style={{ background: "#152a1e", border: "1px solid "  + (phoneCamUrl ? "#255a3a" : "#2a2a2a"), borderRadius: 8, padding: 16, width: "100%" }}>
            <div style={{ color: "#eee", fontWeight: "bold", marginBottom: 8, fontSize: 13 }}>
              URL kết nối (dành cho dán thủ công / dùng chung với OBS)
            </div>
            {phoneCamUrl ? (
              <>
                <code
                  onClick={() => navigator.clipboard?.writeText(phoneCamUrl)}
                  title="Bấm để copy"
                  style={{ display: "block", background: "#000", padding: "8px 10px", borderRadius: 4, fontSize: 12, color: "rgb(40, 205, 170)", wordBreak: "break-all", cursor: "pointer" }}
                >
                  {phoneCamUrl}
                </code>
                <div style={{ color: "#888", fontSize: 11, marginTop: 6 }}>Lưu ý: URL này dùng cho hệ thống OBS/Python độc lập.</div>
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
