import { useEffect, useState } from "react";
import { X, Smartphone, ShieldAlert, Globe, MonitorSmartphone } from "lucide-react";

export default function CompanionQR({ onClose }: { onClose: () => void }) {
  const [qrUrl, setQrUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [ip, setIp] = useState<string>("");
  const [wsTunnelUrl, setWsTunnelUrl] = useState<string | null>(null);
  const [wsToken, setWsToken] = useState<string | null>(null);
  const [phoneCamUrl, setPhoneCamUrl] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'iris' | 'obs' | 'expo'>('iris');

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
      pollPhoneCamUrl();
    })();

    return () => {
      cancelled = true;
      if (tunnelPollTimer) window.clearTimeout(tunnelPollTimer);
      if (wsTunnelPollTimer) window.clearTimeout(wsTunnelPollTimer);
      if (phoneCamPollTimer) window.clearTimeout(phoneCamPollTimer);
    };
  }, []);

  // HTTPS_CAM FIX: Safari trên iOS chặn getUserMedia (camera) nếu origin
  // không phải secure context. Companion server giờ chạy thêm HTTPS/WSS
  // trên port 8444 (dùng cert mkcert tại PHONE_CAMERA/cert/) song song với
  // HTTP 8080, nên fallback QR code (khi không có ngrok tunnel) phải trỏ
  // sang https://<ip>:8444 để Alt+Q mở được camera trên iPhone Safari.
  let webUrl = wsTunnelUrl ? wsTunnelUrl.replace(/^wss?:\/\//, 'https://') : `https://${ip}:8444`;
  if (wsToken) {
    webUrl += `?token=${wsToken}`;
  }
  const webQrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=250x250&data=${encodeURIComponent(webUrl)}`;
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
        
        <div style={{ padding: "0 30px", marginTop: 20, display: "flex", gap: 10 }}>
          <button 
            onClick={() => setActiveTab('iris')}
            style={{ flex: 1, padding: "10px", borderRadius: 8, border: "1px solid", borderColor: activeTab === 'iris' ? "#28cdaa" : "#333", backgroundColor: activeTab === 'iris' ? "#152a1e" : "#222", color: activeTab === 'iris' ? "#28cdaa" : "#888", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 8, fontWeight: "bold" }}
          >
            <Smartphone size={16} /> Iris Camera
          </button>
          <button 
            onClick={() => setActiveTab('obs')}
            style={{ flex: 1, padding: "10px", borderRadius: 8, border: "1px solid", borderColor: activeTab === 'obs' ? "#28cdaa" : "#333", backgroundColor: activeTab === 'obs' ? "#152a1e" : "#222", color: activeTab === 'obs' ? "#28cdaa" : "#888", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 8, fontWeight: "bold" }}
          >
            <Globe size={16} /> OBS/Python
          </button>
          <button 
            onClick={() => setActiveTab('expo')}
            style={{ flex: 1, padding: "10px", borderRadius: 8, border: "1px solid", borderColor: activeTab === 'expo' ? "#28cdaa" : "#333", backgroundColor: activeTab === 'expo' ? "#152a1e" : "#222", color: activeTab === 'expo' ? "#28cdaa" : "#888", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 8, fontWeight: "bold" }}
          >
            <MonitorSmartphone size={16} /> Expo Go
          </button>
        </div>

        <div style={{ padding: "20px 30px 30px", display: "flex", flexDirection: "column", alignItems: "center", gap: 20 }}>
          
          {activeTab === 'expo' ? (
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
                  <div style={{ color: "#d32f2f", fontWeight: "bold" }}>Lỗi lấy thông tin IP</div>
                )}
              </div>
            </>
          ) : activeTab === 'obs' ? (
            <>
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
            </>
          ) : (
            <>
              <div style={{ color: "#aaa", textAlign: "center", margin: 0, lineHeight: 1.5, fontSize: 14 }}>
                Mở ứng dụng <strong>Camera</strong> trên điện thoại và quét mã QR này để truyền video vào <strong>Iris (Alt+C)</strong>.
                {!wsTunnelUrl && ip ? (
                  <><br /><span style={{ fontSize: 12 }}>(Đang dùng Wi-Fi nội bộ: <code>{ip}</code> — QR sẽ tự đổi sang ngrok tunnel nếu/khi tunnel đó sẵn sàng.)</span></>
                ) : null}
              </div>

              <div style={{ width: 250, height: 250, backgroundColor: "#fff", borderRadius: 12, padding: 10, display: "flex", alignItems: "center", justifyContent: "center" }}>
                {ip || wsTunnelUrl ? (
                  <img src={webQrUrl} alt="Iris Web QR Code" style={{ width: "100%", height: "100%", objectFit: "contain" }} />
                ) : (
                  <div style={{ color: "#d32f2f", fontWeight: "bold", textAlign: "center", fontSize: 13, padding: 10 }}>
                    Đang lấy địa chỉ IP...
                  </div>
                )}
              </div>
            </>
          )}

          <div style={{ background: "#152a1e", border: "1px solid "  + ((phoneCamUrl || wsTunnelUrl) ? "#255a3a" : "#2a2a2a"), borderRadius: 8, padding: 16, width: "100%" }}>
            <div style={{ color: "#eee", fontWeight: "bold", marginBottom: 8, fontSize: 13 }}>
              URL kết nối (dành cho dán thủ công / dùng chung với OBS)
            </div>
            {activeTab === 'obs' && phoneCamUrl ? (
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
            ) : activeTab === 'iris' && (ip || wsTunnelUrl) ? (
              <>
                <code
                  onClick={() => navigator.clipboard?.writeText(webUrl)}
                  title="Bấm để copy"
                  style={{ display: "block", background: "#000", padding: "8px 10px", borderRadius: 4, fontSize: 12, color: "rgb(40, 205, 170)", wordBreak: "break-all", cursor: "pointer" }}
                >
                  {webUrl}
                </code>
                <div style={{ color: "#888", fontSize: 11, marginTop: 6 }}>Bấm vào URL để copy.</div>
              </>
            ) : activeTab === 'expo' && ip ? (
              <>
                <code
                  onClick={() => navigator.clipboard?.writeText(`exp://${ip}:8081`)}
                  title="Bấm để copy"
                  style={{ display: "block", background: "#000", padding: "8px 10px", borderRadius: 4, fontSize: 12, color: "rgb(40, 205, 170)", wordBreak: "break-all", cursor: "pointer" }}
                >
                  {`exp://${ip}:8081`}
                </code>
              </>
            ) : (
              <div style={{ color: "#888", fontSize: 12 }}>
                Đang chờ hệ thống khởi động...
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
