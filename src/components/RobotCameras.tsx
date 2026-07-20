import { useEffect, useState } from "react";
import { X, Bot, RefreshCw } from "lucide-react";

export default function RobotCameras({ onClose }: { onClose: () => void }) {
  const [robots, setRobots] = useState<any>({});
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (window.iris?.getRobots) {
      window.iris.getRobots().then(setRobots);
    }
  }, []);

  // Force image refresh every 4 seconds for static snapshot URLs
  useEffect(() => {
    const id = setInterval(() => setTick(t => t + 1), 4000);
    return () => clearInterval(id);
  }, []);

  const robotList = Object.entries(robots);

  return (
    <div className="history-backdrop" onClick={onClose} style={{ zIndex: 1000, position: "fixed", inset: 0, backgroundColor: "rgba(0,0,0,0.8)", display: "flex", flexDirection: "column", padding: 40 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ flex: 1, backgroundColor: "#111", borderRadius: 12, display: "flex", flexDirection: "column", overflow: "hidden", border: "1px solid #333", boxShadow: "0 10px 40px rgba(0,0,0,0.5)" }}>
        <div style={{ padding: "16px 24px", borderBottom: "1px solid #222", display: "flex", justifyContent: "space-between", alignItems: "center", backgroundColor: "#181818" }}>
          <h2 style={{ margin: 0, fontSize: 18, display: "flex", alignItems: "center", gap: 10, color: "#eee" }}>
            <Bot size={22} style={{ color: "rgb(40, 205, 170)" }} /> 
            Live: Đội Hình Robot
          </h2>
          <button className="t-btn small" onClick={onClose} title="Đóng (X / Esc)"><X size={18} /></button>
        </div>
        
        <div style={{ flex: 1, overflowY: "auto", padding: 24, display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 24 }}>
          {robotList.length === 0 ? (
            <div style={{ color: "#888", textAlign: "center", gridColumn: "1/-1", paddingTop: 80, fontSize: 16 }}>
              Chưa có cấu hình robot nào trong file <code>robots.json</code>.
            </div>
          ) : (
            robotList.map(([id, config]: any) => {
              // Thêm timestamp để lách cache trình duyệt nếu là ảnh tĩnh
              const imgUrl = config.camera_url ? `${config.camera_url}${config.camera_url.includes('?') ? '&' : '?'}ts=${tick}` : "";
              return (
                <div key={id} style={{ backgroundColor: "#000", borderRadius: 10, overflow: "hidden", border: "1px solid #333", display: "flex", flexDirection: "column" }}>
                  <div style={{ padding: "10px 14px", borderBottom: "1px solid #222", fontSize: 14, fontWeight: "600", color: "#ddd", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <span>{config.name || id}</span>
                    <span style={{ fontSize: 11, color: "#666", display: "flex", alignItems: "center", gap: 4 }}><RefreshCw size={10} /> Live</span>
                  </div>
                  <div style={{ flex: 1, minHeight: 240, display: "flex", alignItems: "center", justifyContent: "center", backgroundColor: "#050505", position: "relative" }}>
                    {config.camera_url ? (
                      <img 
                        src={imgUrl} 
                        alt={config.name || id} 
                        style={{ width: "100%", height: "100%", objectFit: "cover", position: "absolute", inset: 0 }} 
                        onError={(e) => { 
                          e.currentTarget.style.display = "none";
                          const errDiv = e.currentTarget.parentElement?.querySelector('.err-msg') as HTMLElement;
                          if (errDiv) errDiv.style.display = 'block';
                        }} 
                      />
                    ) : null}
                    <div className="err-msg" style={{ display: config.camera_url ? 'none' : 'block', color: "#555", fontSize: 13, zIndex: 10 }}>
                      {config.camera_url ? "Không thể tải Camera..." : "Không có Camera"}
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
