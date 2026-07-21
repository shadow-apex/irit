import { useEffect, useState } from "react";
import { X, Smartphone, ShieldAlert } from "lucide-react";

export default function CompanionQR({ onClose }: { onClose: () => void }) {
  const [qrUrl, setQrUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [ip, setIp] = useState<string>("");

  useEffect(() => {
    (async () => {
      // Bước 1: Khởi động Expo (non-fatal — nếu lỗi vẫn tiếp tục lấy IP)
      if (window.iris?.startCompanionExpo) {
        try {
          await window.iris.startCompanionExpo();
        } catch (err) {
          console.warn("[CompanionQR] startCompanionExpo error (non-fatal):", err);
        }
      }

      // Bước 2: Lấy IP để tạo QR — tách riêng để không bị ảnh hưởng bởi lỗi Expo
      try {
        if (window.iris?.getLocalIp) {
          const localIp = await window.iris.getLocalIp();
          setIp(localIp);
          const expUrl = `exp://${localIp}:8081`;
          setQrUrl(`https://api.qrserver.com/v1/create-qr-code/?size=250x250&data=${encodeURIComponent(expUrl)}`);
        }
      } catch (err) {
        console.error("[CompanionQR] Failed to get local IP:", err);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  return (
    <div className="history-backdrop" onClick={onClose} style={{ zIndex: 1000, position: "fixed", inset: 0, backgroundColor: "rgba(0,0,0,0.8)", display: "flex", flexDirection: "column", padding: 40, alignItems: "center", justifyContent: "center" }}>
      <div onClick={(e) => e.stopPropagation()} style={{ backgroundColor: "#111", borderRadius: 12, display: "flex", flexDirection: "column", overflow: "hidden", border: "1px solid #333", boxShadow: "0 10px 40px rgba(0,0,0,0.5)", width: 450, maxWidth: "100%" }}>
        <div style={{ padding: "16px 24px", borderBottom: "1px solid #222", display: "flex", justifyContent: "space-between", alignItems: "center", backgroundColor: "#181818" }}>
          <h2 style={{ margin: 0, fontSize: 18, display: "flex", alignItems: "center", gap: 10, color: "#eee" }}>
            <Smartphone size={22} style={{ color: "rgb(40, 205, 170)" }} /> 
            Iris Companion App
          </h2>
          <button className="t-btn small" onClick={onClose} title="Đóng (X / Esc)"><X size={18} /></button>
        </div>
        
        <div style={{ padding: 30, display: "flex", flexDirection: "column", alignItems: "center", gap: 20 }}>
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

          <div style={{ background: "#2a1515", border: "1px solid #4a2525", borderRadius: 8, padding: 16, width: "100%" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, color: "#f88", fontWeight: "bold", marginBottom: 8 }}>
              <ShieldAlert size={16} /> Nếu điện thoại báo "Network Timeout":
            </div>
            <div style={{ color: "#ccc", fontSize: 13, lineHeight: 1.6 }}>
              Lỗi này do <strong>Windows Firewall</strong> chặn kết nối từ điện thoại. Bạn có 2 cách sửa:
              <ul style={{ margin: "8px 0 0", paddingLeft: 20 }}>
                <li><strong>Cách 1:</strong> Quét mã QR <strong>ngrok tunnel</strong> đang hiển thị trong <em>cửa sổ Terminal (màu đen)</em> vừa được mở lên (cách này đi qua internet, không bị chặn).</li>
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
