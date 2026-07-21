import { useEffect, useState } from "react";
import { X, Smartphone, ShieldAlert, Globe, MonitorSmartphone } from "lucide-react";

export default function CompanionQR({ onClose }: { onClose: () => void }) {
  const [qrUrl, setQrUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [ip, setIp] = useState<string>("");
  const [wsTunnelUrl, setWsTunnelUrl] = useState<string | null>(null);
  const [wsToken, setWsToken] = useState<string | null>(null);
  const [showExpo, setShowExpo] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let tunnelPollTimer: number | undefined;

    const pollTunnel = async () => {
      if (cancelled || !window.iris?.getCompanionTunnel) return;
      try {
        const url = await window.iris.getCompanionTunnel();
        if (url) {
          if (!cancelled) {
            setIp("ngrok tunnel");
            setQrUrl(`https://api.qrserver.com/v1/create-qr-code/?size=250x250&data=${encodeURIComponent(url)}`);
          }
          return;
        }
      } catch (err) {
        console.warn("[CompanionQR] getCompanionTunnel error:", err);
      }
      if (!cancelled) {
        tunnelPollTimer = window.setTimeout(pollTunnel, 2000);
      }
    };

    let wsTunnelPollTimer: number | undefined;
    const pollWsTunnel = async () => {
      if (cancelled || !window.iris?.getCompanionWsTunnel) return;
      try {
        const url = await window.iris.getCompanionWsTunnel();
        const token = window.iris.getCompanionWsToken ? await window.iris.getCompanionWsToken() : null;
        if (url) {
          if (!cancelled) {
            setWsTunnelUrl(url);
            if (token) setWsToken(token);
          }
          return;
        }
      } catch (err) {
        console.warn("[CompanionQR] getCompanionWsTunnel error:", err);
      }
      if (!cancelled) {
        wsTunnelPollTimer = window.setTimeout(pollWsTunnel, 2000);
      }
    };

    (async () => {
      if (window.iris?.startCompanionExpo) {
        try {
          await window.iris.startCompanionExpo();
        } catch (err) {}
      }

      try {
        if (window.iris?.getLocalIp) {
          const localIp = await window.iris.getLocalIp();
          if (!cancelled) {
            setIp(localIp);
            const expUrl = `exp://${localIp}:8081`;
            setQrUrl(`https://api.qrserver.com/v1/create-qr-code/?size=250x250&data=${encodeURIComponent(expUrl)}`);
          }
        }
      } catch (err) {
      } finally {
        if (!cancelled) setLoading(false);
      }

      pollTunnel();
      pollWsTunnel();
    })();

    return () => {
      cancelled = true;
      if (tunnelPollTimer) window.clearTimeout(tunnelPollTimer);
      if (wsTunnelPollTimer) window.clearTimeout(wsTunnelPollTimer);
    };
  }, []);

  let webUrl = wsTunnelUrl ? wsTunnelUrl.replace(/^wss?:\/\//, 'https://') : `http://${ip}:8080`;
  if (wsToken) {
    webUrl += `?token=${wsToken}`;
  }
  const webQrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=250x250&data=${encodeURIComponent(webUrl)}`;

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
        
        <div style={{ padding: "0 30px", marginTop: 20, display: "flex", gap: 10 }}>
          <button 
            onClick={() => setShowExpo(false)}
            style={{ flex: 1, padding: "10px", borderRadius: 8, border: "1px solid", borderColor: !showExpo ? "#28cdaa" : "#333", backgroundColor: !showExpo ? "#152a1e" : "#222", color: !showExpo ? "#28cdaa" : "#888", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 8, fontWeight: "bold" }}
          >
            <Globe size={16} /> Web (Mới)
          </button>
          <button 
            onClick={() => setShowExpo(true)}
            style={{ flex: 1, padding: "10px", borderRadius: 8, border: "1px solid", borderColor: showExpo ? "#28cdaa" : "#333", backgroundColor: showExpo ? "#152a1e" : "#222", color: showExpo ? "#28cdaa" : "#888", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 8, fontWeight: "bold" }}
          >
            <MonitorSmartphone size={16} /> Expo Go
          </button>
        </div>

        <div style={{ padding: "20px 30px 30px", display: "flex", flexDirection: "column", alignItems: "center", gap: 20 }}>
          
          {showExpo ? (
            <>
              <div style={{ color: "#aaa", textAlign: "center", margin: 0, lineHeight: 1.5, fontSize: 14 }}>
                Mở app <strong>Expo Go</strong> trên điện thoại và quét mã QR này.<br/>
                (Kết nối qua Wi-Fi nội bộ: <code>{ip}</code>)
              </div>
              
              <div style={{ width: 250, height: 250, backgroundColor: "#fff", borderRadius: 12, padding: 10, display: "flex", alignItems: "center", justifyContent: "center" }}>
                {loading ? (
                  <div style={{ color: "#000", fontWeight: "bold" }}>Đang khởi động Expo...</div>
                ) : qrUrl ? (
                  <img src={qrUrl} alt="Expo QR Code" style={{ width: "100%", height: "100%", objectFit: "contain" }} />
                ) : (
                  <div style={{ color: "red" }}>Lỗi lấy thông tin IP</div>
                )}
              </div>
            </>
          ) : (
            <>
              <div style={{ color: "#aaa", textAlign: "center", margin: 0, lineHeight: 1.5, fontSize: 14 }}>
                Mở ứng dụng <strong>Camera</strong> trên điện thoại (đặc biệt là iPhone đời cũ) và quét mã QR để mở trang Web Companion.
              </div>
              
              <div style={{ width: 250, height: 250, backgroundColor: "#fff", borderRadius: 12, padding: 10, display: "flex", alignItems: "center", justifyContent: "center" }}>
                {wsTunnelUrl ? (
                  <img src={webQrUrl} alt="Web QR Code" style={{ width: "100%", height: "100%", objectFit: "contain" }} />
                ) : (
                  <div style={{ color: "#d32f2f", fontWeight: "bold", textAlign: "center", fontSize: 13, padding: 10 }}>
                    Không có ngrok (HTTPS) tunnel!<br/><br/>
                    <span style={{fontSize: 12, fontWeight: "normal", color: "#000"}}>
                      Web Companion bắt buộc phải có HTTPS để xin quyền Camera/Mic. Trình duyệt sẽ chặn kết nối HTTP LAN.<br/><br/>
                      Vui lòng cài đặt ngrok hoặc <strong>chuyển sang tab Expo Go</strong> để dùng qua mạng LAN.
                    </span>
                  </div>
                )}
              </div>
            </>
          )}

          <div style={{ background: "#152a1e", border: "1px solid "  + (wsTunnelUrl ? "#255a3a" : "#2a2a2a"), borderRadius: 8, padding: 16, width: "100%" }}>
            <div style={{ color: "#eee", fontWeight: "bold", marginBottom: 8, fontSize: 13 }}>
              URL kết nối Camera/Audio (dành cho dán thủ công)
            </div>
            {wsTunnelUrl ? (
              <>
                <code
                  onClick={() => navigator.clipboard?.writeText(showExpo ? wsTunnelUrl : webUrl)}
                  title="Bấm để copy"
                  style={{ display: "block", background: "#000", padding: "8px 10px", borderRadius: 4, fontSize: 12, color: "rgb(40, 205, 170)", wordBreak: "break-all", cursor: "pointer" }}
                >
                  {showExpo ? wsTunnelUrl : webUrl}
                </code>
                <div style={{ color: "#888", fontSize: 11, marginTop: 6 }}>Bấm vào URL để copy. Dùng URL này để stream qua internet — không cần chung Wi-Fi.</div>
              </>
            ) : (
              <div style={{ color: "#888", fontSize: 12 }}>
                Đang dò tunnel… nếu mất quá lâu, kiểm tra đã cài package <code>ngrok</code> và đặt biến môi trường <code>IRIS_NGROK_AUTHTOKEN</code> chưa.
              </div>
            )}
          </div>

          <div style={{ background: "#2a1515", border: "1px solid #4a2525", borderRadius: 8, padding: 16, width: "100%" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, color: "#f88", fontWeight: "bold", marginBottom: 8 }}>
              <ShieldAlert size={16} /> Nếu điện thoại báo "Network Timeout":
            </div>
            <div style={{ color: "#ccc", fontSize: 13, lineHeight: 1.6 }}>
              Lỗi này do <strong>Windows Firewall</strong> chặn kết nối từ điện thoại. Bạn có 2 cách sửa:
              <ul style={{ margin: "8px 0 0", paddingLeft: 20 }}>
                <li><strong>Cách 1:</strong> Đợi vài giây — Iris đang tự dò kết nối <strong>ngrok tunnel</strong> ở nền (đi qua internet, không bị Firewall chặn). Mã QR ở trên sẽ <em>tự động đổi</em> sang "ngrok tunnel" ngay khi sẵn sàng, không cần thao tác gì.</li>
                <li><strong>Cách 2:</strong> Mở PowerShell bằng quyền Admin và chạy lệnh sau để sửa Firewall vĩnh viễn:
                  <code style={{ display: "block", background: "#000", padding: "6px 10px", borderRadius: 4, marginTop: 4, fontSize: 11, color: "rgb(40, 205, 170)", wordBreak: "break-all" }}>
                    netsh advfirewall firewall add rule name="Iris Expo" dir=in action=allow protocol=TCP localport=8081
                  </code>
                </li>
              </ul>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
